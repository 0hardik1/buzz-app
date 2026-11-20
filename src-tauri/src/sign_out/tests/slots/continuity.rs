//! Native boot/creator ownership with real temporary discovery and fake OS work.
use super::super::creators::{exclusive, released_lock};
use super::*;
use crate::identity::IdentityHost;

fn slots<'a>(paths: &Paths, vault: &'a Vault, wait: Duration) -> Slots<'a> {
    let scope = paths.inspection_scope(Some(&vault.root)).unwrap();
    let (root, store) = (vault.root.clone(), vault.store.clone());
    let mut slots = vault.slots_waiting(BUDGET, wait);
    slots.continuity = Some(Box::new(move || {
        secrets::continuity::establish(&scope, &root, store.as_ref())
    }));
    slots
}

#[test]
fn continuity_boot_count_creator_journal_and_restart_share_one_witness() {
    for choices in [PLAIN, choices(true)] {
        let (_dir, paths) = fixture();
        let vault = Vault::new(paths.lock.parent().unwrap().join("inventory"));
        let instance = boot(
            &paths,
            Some(slots(&paths, &vault, BUDGET)),
            no_agents,
            || panic!("no marker"),
        )
        .unwrap();
        assert!(!instance.h1_unknown());
        assert!(instance.continuity.is_some());
        assert!(paths.preflight_with_inventory(Some(&vault.root)).is_err());
        instance.observe_sign_outs(Some(&vault.root)).unwrap();
        drop(instance.creator().unwrap());
        let identity = IdentityHost::fixture();
        let viewer = identity.current_viewer().unwrap().unwrap();
        let accounts = vault.enroll(&paths.app_data, "default", &[&viewer]);
        instance.inspect_continuity().unwrap();
        let calls = vault.calls();
        let witness = calls
            .iter()
            .find_map(|call| {
                call.strip_prefix("add ")
                    .filter(|account| !accounts.iter().any(|value| value == account))
            })
            .unwrap()
            .to_owned();
        let bytes = vault.store.items.lock().unwrap()[&witness].clone();
        run(attempt_native(
            &instance,
            &paths,
            choices,
            Some(&vault.root),
            &identity,
            || async { Ok(()) },
            || {},
            || async { Ok(()) },
            || async { panic!("no forced exit") },
        ))
        .unwrap();
        assert!(vault.pending() && paths.marker.exists());
        drop(instance);
        let instance = boot(
            &paths,
            Some(slots(&paths, &vault, BUDGET)),
            |_| Ok(()),
            || Ok(()),
        )
        .unwrap();
        assert!(!instance.h1_unknown());
        assert!(!vault.pending() && !paths.marker.exists());
        instance.observe_sign_outs(Some(&vault.root)).unwrap();
        drop(instance.creator().unwrap());
        assert_eq!(vault.saved(), vec![witness.clone()]);
        assert_eq!(vault.store.items.lock().unwrap()[&witness], bytes);
        assert!(!vault.calls().iter().any(|call| call.starts_with("add ")));
    }
}

#[test]
fn continuity_timeout_retains_all_native_locks_until_actual_os_completion() {
    let (_dir, paths) = fixture();
    let vault = Vault::new(paths.lock.parent().unwrap().join("inventory"));
    let (started, entered) = mpsc::channel();
    let (release, released) = mpsc::channel();
    *vault.store.add_stall.lock().unwrap() = Some((started, released));
    let result = boot(
        &paths,
        Some(slots(&paths, &vault, Duration::from_millis(20))),
        no_agents,
        || panic!("no marker"),
    );
    assert!(result.is_err());
    assert_eq!(entered.recv_timeout(BUDGET).unwrap(), Step::Stalled);
    assert!(!exclusive(&paths.key_lock));
    assert!(!exclusive(&paths.lock));
    assert!(!exclusive(&paths.other_key_lock));
    // The intent exists, but the native owner cannot be replaced while OS work is held.
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(vault.root.join("state.json")).unwrap()).unwrap();
    assert_eq!(value["installation"]["committed"], false);
    release.send(()).unwrap();
    released_lock(&paths.key_lock);
    released_lock(&paths.lock);
    released_lock(&paths.other_key_lock);
    let instance = boot(
        &paths,
        Some(slots(&paths, &vault, BUDGET)),
        no_agents,
        || panic!("no marker"),
    )
    .unwrap();
    assert!(!instance.h1_unknown());
    assert_eq!(
        vault
            .calls()
            .iter()
            .filter(|call| call.starts_with("add "))
            .count(),
        1
    );
}

#[test]
fn continuity_failure_never_suppresses_readable_journal_cleanup() {
    let (_dir, paths) = fixture();
    let vault = Vault::new(paths.lock.parent().unwrap().join("inventory"));
    let instance = boot(
        &paths,
        Some(slots(&paths, &vault, BUDGET)),
        no_agents,
        || panic!("no marker"),
    )
    .unwrap();
    instance.observe_sign_outs(Some(&vault.root)).unwrap();
    let accounts = vault.enroll(&paths.app_data, "default", &[ALICE]);
    secrets::begin_sign_out(&vault.root, Some(ALICE), None).unwrap();
    // Lose just the witness. A committed journal still owns its cleanup attempt.
    vault
        .store
        .items
        .lock()
        .unwrap()
        .retain(|account, _| accounts.contains(account));
    drop(instance);
    vault.deny(Some(StoreError::Denied));
    assert!(boot(
        &paths,
        Some(slots(&paths, &vault, BUDGET)),
        no_agents,
        || panic!("no marker")
    )
    .is_err());
    assert_eq!(vault.attempts(), 1);
    assert!(vault.pending());
    vault.deny(None);
    let instance = boot(
        &paths,
        Some(slots(&paths, &vault, BUDGET)),
        no_agents,
        || panic!("no marker"),
    )
    .unwrap();
    assert_eq!(vault.attempts(), 2);
    assert!(!vault.pending());
    assert!(vault.saved().is_empty());
    assert!(instance.h1_unknown());
    assert!(instance.creator().is_err());
    assert!(instance.observe_sign_outs(Some(&vault.root)).is_err());
}

#[test]
fn continuity_reinspection_refuses_every_declared_candidate_without_repair() {
    let (_dir, mut paths) = fixture();
    let base = paths.lock.parent().unwrap().to_owned();
    paths.plugin_home = Some(base.join("alternate-home"));
    paths.seeds = vec![base.join("seed")];
    paths.moves = vec![(base.join("old-home"), base.join("new-home"))];
    let vault = Vault::new(base.join("inventory"));
    let scope = paths.inspection_scope(Some(&vault.root)).unwrap();
    // Establish directly: artificial seed configuration must not start real seeding.
    let established =
        secrets::continuity::establish(&scope, &vault.root, vault.store.as_ref()).unwrap();
    let adds = vault.calls();
    assert_eq!(
        adds.iter().filter(|call| call.starts_with("add ")).count(),
        1
    );
    for home in &scope.homes {
        let profile = home.join("profiles/not-selected");
        fs::create_dir_all(&profile).unwrap();
        fs::write(
            profile.join("registry.json"),
            b"unreadable candidate evidence",
        )
        .unwrap();
        assert!(
            paths
                .inspect_continuity(Some(&vault.root), Some(&established))
                .is_err(),
            "{home:?}"
        );
        fs::remove_dir_all(home.join("profiles")).unwrap();
    }
    for inventory in scope.inventories.iter().filter(|path| **path != vault.root) {
        fs::create_dir_all(inventory).unwrap();
        assert!(
            paths
                .inspect_continuity(Some(&vault.root), Some(&established))
                .is_err(),
            "{inventory:?}"
        );
        fs::remove_dir_all(inventory).unwrap();
    }
    paths
        .inspect_continuity(Some(&vault.root), Some(&established))
        .unwrap();
    assert!(
        vault.calls().is_empty(),
        "reinspection performs no OS read, repair or add"
    );
}

#[test]
fn continuity_late_evidence_refuses_creator_and_journal_before_metadata() {
    for boundary in ["creator", "journal"] {
        let (_dir, paths) = fixture();
        let vault = Vault::new(paths.lock.parent().unwrap().join("inventory"));
        let instance = boot(
            &paths,
            Some(slots(&paths, &vault, BUDGET)),
            no_agents,
            || panic!("no marker"),
        )
        .unwrap();
        let profile = paths.app_data.join("profiles/late");
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("registry.json"), b"foreign evidence").unwrap();
        vault.calls();
        let before = fs::read(vault.root.join("state.json")).unwrap();
        if boundary == "creator" {
            assert!(instance.creator().is_err());
        } else {
            let identity = IdentityHost::fixture();
            assert_eq!(
                run(attempt_native(
                    &instance,
                    &paths,
                    PLAIN,
                    Some(&vault.root),
                    &identity,
                    || async { Ok(()) },
                    || panic!("must not close"),
                    || async { panic!("must not stop") },
                    || async { panic!("must not exit") }
                )),
                Err(refuse(H1_UNKNOWN))
            );
        }
        assert!(instance.h1_unknown());
        assert_eq!(fs::read(vault.root.join("state.json")).unwrap(), before);
        assert!(vault.calls().is_empty());
        assert!(!paths.marker.exists());
    }
}
