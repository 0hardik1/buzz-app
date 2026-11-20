//! Fake store only; inventory and declared filesystem discovery are real.
use super::*;
use crate::secrets::{continuity as installation, preflight};
use serde_json::{json, Value};
use std::sync::mpsc;

fn scope(env: &Env) -> preflight::Scope {
    let base = fs::canonicalize(env.temp.path()).unwrap();
    preflight::Scope {
        inventories: vec![base.join("secrets"), base.join("other-build-inventory")],
        homes: vec![base.join("home"), base.join("alternate-home")],
    }
}
fn establish(env: &Env, scope: &preflight::Scope) -> Result<installation::Established> {
    installation::establish(scope, &scope.inventories[0], env.store.as_ref())
}
fn state(scope: &preflight::Scope) -> Value {
    serde_json::from_slice(&fs::read(scope.inventories[0].join(STATE)).unwrap()).unwrap()
}
fn write_state(scope: &preflight::Scope, state: &Value) {
    fs::write(
        scope.inventories[0].join(STATE),
        serde_json::to_vec(state).unwrap(),
    )
    .unwrap();
}

#[test]
fn fresh_pair_survives_restart_provider_clear_and_journaled_sign_out() {
    let env = Env::new();
    env.ready(SLOT);
    let scope = scope(&env);
    let observed = establish(&env, &scope).unwrap();
    assert_eq!(env.store.adds.load(Ordering::SeqCst), 1);
    assert!(state(&scope)["installation"]["committed"]
        .as_bool()
        .unwrap());
    assert!(state(&scope).get("signedOutSeen").is_none());
    assert!(
        preflight::inspect(&scope).is_err(),
        "a pair is not no-H1 absence"
    );
    let witness = env.store.items.lock().unwrap()[installation::ACCOUNT].clone();
    observe_sign_outs(&scope.inventories[0], 0).unwrap();
    env.set(ALICE, SENTINEL).unwrap();
    observed.inspect(&scope).unwrap();
    establish(&env, &scope).unwrap();
    assert_eq!(env.store.adds.load(Ordering::SeqCst), 2);
    env.manager
        .secret_clear(PLUGIN, &env.current(), "api-key", ALICE)
        .unwrap();
    env.set(ALICE, SENTINEL).unwrap();
    begin_sign_out(&scope.inventories[0], Some(ALICE), None).unwrap();
    finish_sign_out(
        &scope.inventories[0],
        env.store.as_ref(),
        Duration::from_secs(5),
    )
    .unwrap();
    observe_sign_outs(&scope.inventories[0], 1).unwrap();
    establish(&env, &scope).unwrap();
    assert_eq!(env.status(ALICE), SecretStatus::Missing);
    assert_eq!(env.store.items.lock().unwrap().len(), 1);
    assert_eq!(
        env.store.items.lock().unwrap()[installation::ACCOUNT],
        witness
    );
}

#[test]
fn count_only_preexisting_v3_and_foreign_evidence_never_get_retroactive_witnesses() {
    for prior in ["count", "zero", "v3", "foreign"] {
        let env = Env::new();
        env.ready(SLOT);
        let scope = scope(&env);
        match prior {
            "count" | "zero" => {
                fs::create_dir(&scope.inventories[0]).unwrap();
                write_state(
                    &scope,
                    &json!({"version":1,"namespaces":[],"signedOutSeen":if prior == "zero" {0} else {1}}),
                );
            }
            "v3" => {
                env.set(ALICE, SENTINEL).unwrap();
            }
            _ => {
                fs::create_dir(&scope.inventories[1]).unwrap();
            }
        }
        let adds = env.store.adds.load(Ordering::SeqCst);
        assert!(establish(&env, &scope).is_err(), "{prior}");
        assert_eq!(env.store.adds.load(Ordering::SeqCst), adds);
        assert!(!env
            .store
            .items
            .lock()
            .unwrap()
            .contains_key(installation::ACCOUNT));
    }
}

#[test]
fn missing_malformed_mismatched_or_denied_pair_refuses_without_repair() {
    for damage in [
        "inventory",
        "witness",
        "malformed",
        "scope",
        "uncommitted",
        "denied",
    ] {
        let env = Env::new();
        env.ready(SLOT);
        let scope = scope(&env);
        establish(&env, &scope).unwrap();
        match damage {
            "inventory" => fs::remove_dir_all(&scope.inventories[0]).unwrap(),
            "witness" => {
                env.store
                    .items
                    .lock()
                    .unwrap()
                    .remove(installation::ACCOUNT);
            }
            "malformed" => {
                env.store
                    .items
                    .lock()
                    .unwrap()
                    .insert(installation::ACCOUNT.into(), b"broken".to_vec());
            }
            "denied" => {
                *env.store.fail_read.lock().unwrap() = Some(Error::Denied);
            }
            _ => {
                let mut record = state(&scope);
                if damage == "scope" {
                    record["installation"]["installation"]["scope"] = json!("0".repeat(64));
                } else {
                    record["installation"]["committed"] = json!(false);
                }
                write_state(&scope, &record);
            }
        }
        let adds = env.store.adds.load(Ordering::SeqCst);
        let deletes = env.store.deletes.load(Ordering::SeqCst);
        assert!(establish(&env, &scope).is_err(), "{damage}");
        assert_eq!(env.store.adds.load(Ordering::SeqCst), adds);
        assert_eq!(env.store.deletes.load(Ordering::SeqCst), deletes);
    }
}

#[test]
fn failed_or_changed_intent_is_not_automatically_completed_later() {
    for changed in [false, true] {
        let env = Env::new();
        env.ready(SLOT);
        let scope = scope(&env);
        if changed {
            let root = scope.inventories[0].clone();
            *env.store.on_add.lock().unwrap() = Some(Arc::new(move |account| {
                if account == installation::ACCOUNT {
                    let path = root.join(STATE);
                    let mut value: Value =
                        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                    value["signedOutSeen"] = json!(0);
                    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
                }
            }));
        } else {
            *env.store.fail_add.lock().unwrap() = Some(Error::Denied);
        }
        assert!(establish(&env, &scope).is_err());
        assert_eq!(state(&scope)["installation"]["committed"], false);
        *env.store.on_add.lock().unwrap() = None;
        *env.store.fail_add.lock().unwrap() = None;
        let adds = env.store.adds.load(Ordering::SeqCst);
        assert!(establish(&env, &scope).is_err());
        assert_eq!(env.store.adds.load(Ordering::SeqCst), adds);
    }
}

#[test]
fn held_os_add_keeps_completion_lock_but_no_metadata_lock() {
    let env = Env::new();
    env.ready(SLOT);
    let scope = scope(&env);
    let root = scope.inventories[0].clone();
    let (started, entered) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let released = Mutex::new(released);
    *env.store.on_add.lock().unwrap() = Some(Arc::new(move |account| {
        if account == installation::ACCOUNT {
            assert!(try_lock(&root.join("installation.lock")).unwrap().is_none());
            let _g = try_lock(&root.join("state.lock")).unwrap().unwrap();
            started.send(()).unwrap();
            drop(_g);
            released
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
        }
    }));
    std::thread::scope(|threads| {
        let worker = threads.spawn(|| establish(&env, &scope));
        entered.recv_timeout(Duration::from_secs(10)).unwrap();
        let duplicate = establish(&env, &scope);
        release.send(()).unwrap();
        assert!(duplicate.is_err());
        worker.join().unwrap().unwrap().inspect(&scope).unwrap();
    });
    assert_eq!(env.store.adds.load(Ordering::SeqCst), 1);
}

#[test]
fn valid_pair_does_not_hide_alternate_inventory_registry_or_link_evidence() {
    for damage in ["inventory", "registry", "link"] {
        let env = Env::new();
        env.ready(SLOT);
        let scope = scope(&env);
        let observed = establish(&env, &scope).unwrap();
        observe_sign_outs(&scope.inventories[0], 0).unwrap();
        env.set(ALICE, SENTINEL).unwrap();
        let alternate = scope.homes[1].join("profiles/test");
        match damage {
            "inventory" => fs::create_dir(&scope.inventories[1]).unwrap(),
            "registry" => {
                fs::create_dir_all(&alternate).unwrap();
                fs::copy(
                    env.manager.root.join("registry.json"),
                    alternate.join("registry.json"),
                )
                .unwrap();
            }
            _ => {
                fs::create_dir_all(alternate.parent().unwrap()).unwrap();
                std::os::unix::fs::symlink(env.manager.root.clone(), &alternate).unwrap();
            }
        }
        assert!(observed.inspect(&scope).is_err(), "{damage}");
        assert!(establish(&env, &scope).is_err(), "{damage}");
    }
}

#[test]
fn readable_committed_journal_cleanup_remains_available_after_witness_loss() {
    let env = Env::new();
    env.ready(SLOT);
    let scope = scope(&env);
    establish(&env, &scope).unwrap();
    observe_sign_outs(&scope.inventories[0], 0).unwrap();
    env.set(ALICE, SENTINEL).unwrap();
    begin_sign_out(&scope.inventories[0], Some(ALICE), None).unwrap();
    env.store
        .items
        .lock()
        .unwrap()
        .remove(installation::ACCOUNT);
    assert!(establish(&env, &scope).is_err());
    *env.store.fail_delete.lock().unwrap() = Some(Error::Denied);
    assert!(finish_sign_out(
        &scope.inventories[0],
        env.store.as_ref(),
        Duration::from_secs(5)
    )
    .is_err());
    assert!(sign_out_pending(&scope.inventories[0]).unwrap());
    *env.store.fail_delete.lock().unwrap() = None;
    finish_sign_out(
        &scope.inventories[0],
        env.store.as_ref(),
        Duration::from_secs(5),
    )
    .unwrap();
    assert!(!sign_out_pending(&scope.inventories[0]).unwrap());
    assert!(
        establish(&env, &scope).is_err(),
        "cleanup does not repair missing continuity"
    );
}

#[test]
fn established_namespace_accepts_exact_registry_limit() {
    let env = Env::new();
    env.ready(SLOT);
    let scope = scope(&env);
    let observed =
        installation::establish(&scope, &scope.inventories[0], env.store.as_ref()).unwrap();
    observe_sign_outs(&scope.inventories[0], 0).unwrap();
    env.set(ALICE, SENTINEL).unwrap();
    let path = env.manager.root.join("registry.json");
    let mut bytes = fs::read(&path).unwrap();
    bytes.resize(crate::LIMIT as usize, b' ');
    fs::write(&path, &bytes).unwrap();
    observed.inspect(&scope).unwrap();
}

#[test]
fn established_namespace_refuses_oversized_valid_json_prefix_and_whitespace() {
    for extra in [1, 2, 1024] {
        let env = Env::new();
        env.ready(SLOT);
        let scope = scope(&env);
        let observed =
            installation::establish(&scope, &scope.inventories[0], env.store.as_ref()).unwrap();
        observe_sign_outs(&scope.inventories[0], 0).unwrap();
        env.set(ALICE, SENTINEL).unwrap();
        let path = env.manager.root.join("registry.json");
        let mut bytes = fs::read(&path).unwrap();
        bytes.resize(crate::LIMIT as usize + extra, b' ');
        if extra == 1024 {
            *bytes.last_mut().unwrap() = b'{';
        }
        fs::write(&path, &bytes).unwrap();
        let adds = env.store.adds.load(Ordering::SeqCst);
        let before = fs::read(scope.inventories[0].join(STATE)).unwrap();
        assert!(observed.inspect(&scope).is_err(), "oversized registry with {extra} bytes beyond the limit must not qualify its valid bounded prefix");
        assert!(
            installation::establish(&scope, &scope.inventories[0], env.store.as_ref()).is_err()
        );
        assert_eq!(env.store.adds.load(Ordering::SeqCst), adds);
        assert_eq!(fs::read(scope.inventories[0].join(STATE)).unwrap(), before);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}
