//! Installation continuity in the existing inventory and build-specific OS store.
//! A matching pair is a completed observation, not rollback detection or use authority.
use super::*;
use preflight::{Observation, Scope};
use std::collections::BTreeSet;

pub(super) const ACCOUNT: &str = "installation-continuity-v1";
const FAILED: &str = "Saved credential installation continuity could not be established";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Installation {
    version: u32,
    id: String,
    variant: String,
    scope: String,
}
impl Installation {
    fn valid(&self) -> bool {
        self.version == 1
            && valid_uuid(&self.id).is_ok()
            && self.variant == VARIANT
            && hex64(&self.scope)
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Record {
    installation: Installation,
    committed: bool,
}
impl Record {
    pub(super) fn valid(&self) -> bool {
        self.installation.valid()
    }
}

/// An OS-witness-qualified installation observation. Reinspect the declared scope
/// at native destructive/admission boundaries; retaining this is not a snapshot.
pub struct Established {
    root: PathBuf,
    installation: Installation,
}
impl Established {
    pub fn inspect(&self, scope: &Scope) -> Result<()> {
        if binding(scope, &self.root)? != self.installation.scope {
            return Err(FAILED.into());
        }
        inspect(
            scope,
            &self.root,
            &Record {
                installation: self.installation.clone(),
                committed: true,
            },
        )
    }
}

fn binding(scope: &Scope, root: &Path) -> Result<String> {
    if scope.homes.is_empty()
        || scope
            .inventories
            .iter()
            .filter(|path| *path == root)
            .count()
            != 1
        || scope.inventories.iter().collect::<BTreeSet<_>>().len() != scope.inventories.len()
        || scope.homes.iter().collect::<BTreeSet<_>>().len() != scope.homes.len()
    {
        return Err(FAILED.into());
    }
    let mut parts: Vec<&[u8]> = vec![
        b"buzz-plugin-installation-v1",
        root.as_os_str().as_encoded_bytes(),
    ];
    parts.extend(
        scope
            .inventories
            .iter()
            .map(|path| path.as_os_str().as_encoded_bytes()),
    );
    parts.push(b"homes");
    parts.extend(
        scope
            .homes
            .iter()
            .map(|path| path.as_os_str().as_encoded_bytes()),
    );
    Ok(digest(&parts))
}

fn state(root: &Path) -> Result<Option<State>> {
    match preflight::checked(root).map_err(|_| FAILED)? {
        None => Ok(None),
        Some(meta) if meta.is_dir() => {
            let state: State =
                serde_json::from_slice(&read::bytes(&root.join(STATE), MAX_RECORD_BYTES)?)
                    .map_err(|_| FAILED)?;
            if !state.valid()
                || state.namespaces.iter().collect::<BTreeSet<_>>().len() != state.namespaces.len()
            {
                return Err(FAILED.into());
            }
            Ok(Some(state))
        }
        _ => Err(FAILED.into()),
    }
}

/// Read/create-only OS work is synchronous so its caller can retain the existing
/// native creator lease through worker completion, even after a bounded wait.
/// No R/G/I metadata lock spans either OS call. Never repairs partial evidence.
pub fn establish(scope: &Scope, root: &Path, store: &dyn SecretStore) -> Result<Established> {
    if cfg!(not(unix)) {
        return Err(UNSUPPORTED.into());
    }
    let expected_scope = binding(scope, root)?;
    let witness = match store.read(ACCOUNT) {
        Ok(bytes) if bytes.len() <= MAX_VALUE_BYTES => {
            Some(serde_json::from_slice::<Installation>(&bytes).map_err(|_| FAILED)?)
        }
        Err(Error::Absent) => None,
        _ => return Err(FAILED.into()),
    };
    let existing = state(root)?;
    match (existing, witness) {
        (Some(state), Some(witness)) => {
            let record = state.installation.ok_or(FAILED)?;
            if !record.committed
                || !witness.valid()
                || record.installation != witness
                || witness.scope != expected_scope
            {
                return Err(FAILED.into());
            }
            let observed = Established {
                root: root.to_owned(),
                installation: witness,
            };
            observed.inspect(scope)?;
            Ok(observed)
        }
        (None, None) => {
            preflight::inspect(scope)?;
            let inventory = Inventory { root };
            inventory.establish()?;
            // Stable completion ownership, not a structural lock. A competing
            // initializer refuses; it cannot replace an in-flight OS witness.
            let _writer = try_lock(&root.join("installation.lock"))?.ok_or(BUSY)?;
            let mut record = Record {
                installation: Installation {
                    version: 1,
                    id: fresh(),
                    variant: VARIANT.into(),
                    scope: expected_scope,
                },
                committed: false,
            };
            {
                let _g = inventory.global()?;
                if preflight::checked(&root.join(STATE))
                    .map_err(|_| FAILED)?
                    .is_some()
                    || inventory.has_records()?
                {
                    return Err(FAILED.into());
                }
                let mut state = State {
                    installation: Some(record.clone()),
                    ..State::default()
                };
                inventory.save_state(&mut state)?;
            }
            let bytes =
                Zeroizing::new(serde_json::to_vec(&record.installation).map_err(|_| FAILED)?);
            store.add(ACCOUNT, &bytes).map_err(|_| FAILED)?;
            inspect(scope, root, &record)?;
            {
                let _g = inventory.global()?;
                let mut state = state(root)?.ok_or(FAILED)?;
                if state.installation.as_ref() != Some(&record)
                    || !state.namespaces.is_empty()
                    || state.signed_out_seen.is_some()
                    || state.journal.is_some()
                    || inventory.has_records()?
                {
                    return Err(FAILED.into());
                }
                record.committed = true;
                state.installation = Some(record.clone());
                inventory.save_state(&mut state)?;
            }
            let observed = Established {
                root: root.to_owned(),
                installation: record.installation,
            };
            observed.inspect(scope)?;
            Ok(observed)
        }
        _ => Err(FAILED.into()),
    }
}

fn inspect(scope: &Scope, root: &Path, expected: &Record) -> Result<()> {
    let current = state(root)?.ok_or(FAILED)?;
    if current.installation.as_ref() != Some(expected) {
        return Err(FAILED.into());
    }
    let inventory = Inventory { root };
    let mut namespaces = BTreeMap::new();
    for id in inventory.members(&current.namespaces)? {
        let namespace: Namespace = serde_json::from_slice(&read::bytes(
            &root.join(format!("ns-{id}.json")),
            MAX_RECORD_BYTES,
        )?)
        .map_err(|_| FAILED)?;
        if id
            != digest(&[
                b"buzz-plugin-secret-namespace-v1",
                namespace.home.as_bytes(),
                namespace.profile.as_bytes(),
            ])
            || !namespace.valid()
            || valid_id(&namespace.profile).is_err()
            || !scope
                .homes
                .iter()
                .any(|home| home_hash(home).is_ok_and(|hash| hash == namespace.home))
        {
            return Err(FAILED.into());
        }
        namespaces.insert(id, namespace);
    }
    if !expected.committed
        && (!namespaces.is_empty()
            || current.signed_out_seen.is_some()
            || current.journal.is_some())
    {
        return Err(FAILED.into());
    }
    let mut home = None;
    let mut seen_inventory = false;
    let mut observed = BTreeSet::new();
    preflight::walk(scope, |observation| {
        let mut validate = || -> Result<()> {
            match observation {
                Observation::InventoryPresent(path) if path == root => {
                    seen_inventory = true;
                }
                Observation::InventoryPresent(_) => return Err(FAILED.into()),
                Observation::InventoryAbsent(path) if path == root => return Err(FAILED.into()),
                Observation::InventoryAbsent(_) => {}
                Observation::Profiles(path) => {
                    home = Some(path.to_owned());
                }
                Observation::NoProfiles(_) | Observation::End => {
                    home = None;
                }
                Observation::Profile { name, registry } => {
                    let home = home.as_ref().ok_or(FAILED)?;
                    let profile = name.to_str().ok_or(FAILED)?;
                    valid_id(profile)?;
                    let Some(bytes) = registry else {
                        return Ok(());
                    };
                    if preflight::legacy(bytes).is_ok() {
                        return Ok(());
                    }
                    let id = digest(&[
                        b"buzz-plugin-secret-namespace-v1",
                        home_hash(home)?.as_bytes(),
                        profile.as_bytes(),
                    ]);
                    if !current.namespaces.contains(&id) {
                        return Err(FAILED.into());
                    }
                    let namespace = namespaces.get(&id).ok_or(FAILED)?;
                    read::inspect_namespace(bytes, namespace, home, profile)?;
                    observed.insert(id);
                }
                Observation::Unresolved => return Err(FAILED.into()),
            }
            Ok(())
        };
        validate().map_err(std::io::Error::other)
    })
    .map_err(|_| FAILED)?;
    if !seen_inventory {
        return Err(FAILED.into());
    }
    for (id, namespace) in &namespaces {
        if !observed.contains(id) {
            // Lost/erased homes may leave only retired cleanup debt. Neither
            // those nor unlisted records can qualify a live generation.
            read::inspect_retired(namespace)?;
        }
    }
    if state(root)?.ok_or(FAILED)?.installation.as_ref() != Some(expected) {
        return Err(FAILED.into());
    }
    Ok(())
}
