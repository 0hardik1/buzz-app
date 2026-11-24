//! One confirmed, fixed-rule repository announcement for a channel.
use super::*;
use serde_json::{json, Value};
use tokio::sync::Mutex;

static REQUESTS: Mutex<()> = Mutex::const_new(());

pub(super) fn announcement(channel: &str, name: &str, created_at: u64) -> EventTemplate {
    EventTemplate {
        kind: 30617,
        created_at,
        content: String::new(),
        tags: vec![
            vec!["d".into(), name.into()],
            vec!["name".into(), name.into()],
            vec!["buzz-channel".into(), channel.into()],
            vec![
                "buzz-protect".into(),
                "refs/heads/**".into(),
                "no-force-push".into(),
                "no-delete".into(),
            ],
            vec![
                "buzz-protect".into(),
                "refs/heads/main".into(),
                "push:owner".into(),
                "no-force-push".into(),
                "no-delete".into(),
            ],
        ],
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

fn tag<'a>(event: &'a Value, key: &str) -> Option<&'a str> {
    event["tags"]
        .as_array()?
        .iter()
        .find_map(|t| (t[0] == key).then(|| t[1].as_str()).flatten())
}

async fn send_bound(
    host: &IdentityHost,
    fi: &FederatedIdentity,
    url: Url,
    method: &str,
    body: Option<String>,
    viewer: &str,
) -> Result<RelayResponse> {
    let assertion = evidence(host, Some(fi), &url).await?;
    send_authorized(
        host,
        AuthorizationContext {
            fi: Some(fi),
            assertion: assertion.as_ref(),
        },
        url,
        method,
        body,
        true,
        MAX_RESPONSE,
        Some(viewer),
    )
    .await
}

async fn query(
    host: &IdentityHost,
    fi: &FederatedIdentity,
    community: &str,
    viewer: &str,
    filter: Value,
) -> Result<Vec<Value>> {
    if host.viewer().await? != viewer {
        return Err("Your identity changed; try again.".into());
    }
    let result = send_bound(
        host,
        fi,
        request_url(community, "/query", "POST")?,
        "POST",
        Some(json!([filter]).to_string()),
        viewer,
    )
    .await?;
    if host.viewer().await? != viewer {
        return Err("Your identity changed; try again.".into());
    }
    if result.status != 200 {
        return Err("Could not verify repository access with the community.".into());
    }
    serde_json::from_str(&result.body).map_err(|_| "Invalid community response".into())
}

async fn check(
    host: &IdentityHost,
    fi: &FederatedIdentity,
    community: &str,
    viewer: &str,
    authority: &str,
    channel: &str,
    name: &str,
) -> Result<String> {
    let events = query(
        host,
        fi,
        community,
        viewer,
        json!({"kinds":[39000,39002],"authors":[authority],"#d":[channel],"consistency":"strong"}),
    )
    .await?;
    let channel_name = checked_channel(&events, authority, viewer, channel)?;
    let own = query(
        host,
        fi,
        community,
        viewer,
        json!({"kinds":[30617],"authors":[viewer],"#d":[name],"limit":1,"consistency":"strong"}),
    )
    .await?;
    if !own.is_empty() {
        return Err(
            "You already have a repository with this name; announcing it again would move it."
                .into(),
        );
    }
    let existing = query(
        host,
        fi,
        community,
        viewer,
        json!({"kinds":[30617],"#d":[name],"limit":1,"consistency":"strong"}),
    )
    .await?;
    if !existing.is_empty() {
        return Err("A repository with this name already exists in this community.".into());
    }
    Ok(channel_name)
}

fn checked_channel(
    events: &[Value],
    authority: &str,
    viewer: &str,
    channel: &str,
) -> Result<String> {
    let current = |kind| {
        events
            .iter()
            .filter(|e| {
                e["kind"] == kind
                    && e["pubkey"] == authority
                    && tag(e, "d") == Some(channel)
                    && verify_signature(e).is_ok()
            })
            .max_by(|a, b| {
                a["created_at"]
                    .as_u64()
                    .cmp(&b["created_at"].as_u64())
                    .then_with(|| b["id"].as_str().cmp(&a["id"].as_str()))
            })
    };
    let metadata = current(39000).ok_or("Channel could not be read.")?;
    let channel_name = tag(metadata, "name")
        .filter(|s| !s.is_empty())
        .ok_or("Channel has no name.")?;
    let allowed = current(39002)
        .and_then(|e| e["tags"].as_array())
        .is_some_and(|tags| {
            tags.iter()
                .any(|t| t[0] == "p" && t[1] == viewer && (t[3] == "owner" || t[3] == "admin"))
        });
    if !allowed {
        return Err("Only a channel owner or admin can create its repository.".into());
    }
    Ok(channel_name.to_owned())
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepositoryInput {
    community: String,
    viewer: String,
    channel: String,
    name: String,
    plugin: String,
}

#[tauri::command]
pub(crate) async fn relay_channel_repository(
    host: tauri::State<'_, IdentityHost>,
    fi: tauri::State<'_, FederatedIdentity>,
    request: RepositoryInput,
) -> Result<String> {
    let RepositoryInput {
        community,
        viewer,
        channel,
        name,
        plugin,
    } = request;
    let base = origin(&community)?;
    if !channel_writes::uuid(&channel) || !valid_name(&name) || !hex_key(&viewer) {
        return Err("Invalid channel or repository name.".into());
    }
    let label: String = plugin
        .chars()
        .filter(|c| !c.is_control())
        .take(128)
        .collect();
    if label.is_empty() {
        return Err("Plugin identity is unavailable.".into());
    }
    let _guard = REQUESTS.lock().await;
    if host.viewer().await? != viewer {
        return Err("Your identity changed; try again.".into());
    }
    let info = relay_info(&community).await?;
    let authority = info["self"]
        .as_str()
        .or(info["pubkey"].as_str())
        .filter(|s| hex_key(s))
        .ok_or("Community identity unavailable.")?
        .to_owned();
    execute(&NativeRequest {
        host: &host,
        fi: &fi,
        community: &community,
        viewer: &viewer,
        authority: &authority,
        channel: &channel,
        name: &name,
        label: &label,
        display_host: &base[url::Position::BeforeHost..url::Position::AfterPort],
    })
    .await
}

trait RepositoryRequest {
    async fn check(&self) -> Result<String>;
    async fn confirm(&self, channel_name: &str) -> Result<bool>;
    async fn sign(&self) -> Result<Value>;
    async fn current_viewer(&self) -> Result<String>;
    fn viewer(&self) -> &str;
    async fn publish(&self, event: &Value) -> Result<()>;
    async fn readback(&self, event: &Value) -> Result<bool>;
    async fn probe(&self) -> Result<()>;
}

async fn execute(request: &impl RepositoryRequest) -> Result<String> {
    let channel_name = request.check().await?;
    if !request.confirm(&channel_name).await? {
        return Err("Repository creation cancelled.".into());
    }
    if request.check().await? != channel_name {
        return Err("The channel changed; try again.".into());
    }
    let event = request.sign().await?;
    if event["pubkey"] != request.viewer() || request.current_viewer().await? != request.viewer() {
        return Err("Your identity changed; try again.".into());
    }
    request.publish(&event).await?;
    if !request.readback(&event).await? {
        return Err("Repository announced, but its announcement could not be confirmed.".into());
    }
    request.probe().await?;
    event["id"]
        .as_str()
        .map(str::to_owned)
        .ok_or("Invalid announcement".into())
}

struct NativeRequest<'a> {
    host: &'a IdentityHost,
    fi: &'a FederatedIdentity,
    community: &'a str,
    viewer: &'a str,
    authority: &'a str,
    channel: &'a str,
    name: &'a str,
    label: &'a str,
    display_host: &'a str,
}
impl RepositoryRequest for NativeRequest<'_> {
    async fn check(&self) -> Result<String> {
        check(
            self.host,
            self.fi,
            self.community,
            self.viewer,
            self.authority,
            self.channel,
            self.name,
        )
        .await
    }
    async fn confirm(&self, channel_name: &str) -> Result<bool> {
        let channel_name: String = channel_name
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect();
        let description = format!("A plugin identifying itself as {} (unverified) requests a repository.\n\nCommunity: {}\nChannel: {}\nRepository: {}\n\nNo one may force-push or delete branches. The main branch is limited to the relay's Owner role, which includes the repository creator.", self.label, self.display_host, channel_name, self.name);
        tokio::task::spawn_blocking(move || {
            let result = rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Warning)
                .set_title("Create channel repository?")
                .set_description(&description)
                .set_buttons(rfd::MessageButtons::OkCancelCustom(
                    "Create repository".into(),
                    "Cancel".into(),
                ))
                .show();
            result == rfd::MessageDialogResult::Ok
                || result == rfd::MessageDialogResult::Custom("Create repository".into())
        })
        .await
        .map_err(|_| "Could not show confirmation.".into())
    }
    async fn sign(&self) -> Result<Value> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "System clock is unavailable")?
            .as_secs();
        let event = self
            .host
            .sign(announcement(self.channel, self.name, now))
            .await?;
        verify_signature(&event)?;
        Ok(event)
    }
    async fn current_viewer(&self) -> Result<String> {
        self.host.viewer().await
    }
    fn viewer(&self) -> &str {
        self.viewer
    }
    async fn publish(&self, event: &Value) -> Result<()> {
        let response = send_bound(
            self.host,
            self.fi,
            request_url(self.community, "/events", "POST")?,
            "POST",
            Some(event.to_string()),
            self.viewer,
        )
        .await
        .map_err(|_| {
            "Repository announcement could not be confirmed; it may have been accepted."
        })?;
        let receipt: Value = serde_json::from_str(&response.body)
            .map_err(|_| "Repository announcement could not be confirmed.")?;
        if response.status != 200
            || receipt["accepted"] != true
            || receipt["event_id"] != event["id"]
        {
            return Err("Repository announcement was not accepted.".into());
        }
        Ok(())
    }
    async fn readback(&self, event: &Value) -> Result<bool> {
        let events = query(self.host, self.fi, self.community, self.viewer, json!({"kinds":[30617],"authors":[self.viewer],"#d":[self.name],"limit":1,"consistency":"strong"})).await.map_err(|_| "Repository announced, but its announcement could not be confirmed.")?;
        Ok(events.iter().any(|candidate| candidate == event))
    }
    async fn probe(&self) -> Result<()> {
        probe(self.host, self.fi, self.community, self.viewer, self.name).await
    }
}

async fn probe(
    host: &IdentityHost,
    fi: &FederatedIdentity,
    community: &str,
    viewer: &str,
    name: &str,
) -> Result<()> {
    probe_inner(host, fi, community, viewer, name)
        .await
        .map_err(|error| {
            if error == "Repository was announced, but was not created."
                || error.starts_with("Repository announced,")
            {
                error
            } else {
                "Repository announced, but its Git availability could not be confirmed.".into()
            }
        })
}

async fn probe_inner(
    host: &IdentityHost,
    fi: &FederatedIdentity,
    community: &str,
    viewer: &str,
    name: &str,
) -> Result<()> {
    let root = origin(community)?
        .join(&format!("git/{viewer}/{name}.git"))
        .map_err(|_| "Invalid repository")?;
    let assertion = evidence(host, Some(fi), &root)
        .await
        .map_err(|_| "Repository announced, but its Git availability could not be confirmed.")?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "System clock unavailable")?
        .as_secs();
    let auth = host
        .sign(EventTemplate {
            kind: 27235,
            created_at: now,
            content: String::new(),
            tags: vec![
                vec!["u".into(), root.to_string()],
                vec!["method".into(), "GET".into()],
            ],
        })
        .await?;
    if auth["pubkey"] != viewer || host.viewer().await? != viewer {
        return Err(
            "Repository announced, but your identity changed before Git could be confirmed.".into(),
        );
    }
    admit(host, Some(fi), assertion.as_ref()).await?;
    let url = Url::parse(&format!("{root}/info/refs?service=git-upload-pack"))
        .map_err(|_| "Invalid repository")?;
    let mut request = client()?.get(url).header(
        "Authorization",
        format!(
            "Nostr {}",
            STANDARD.encode(serde_json::to_vec(&auth).map_err(|_| "Invalid authentication")?)
        ),
    );
    if let Some(header) = assertion.as_ref().and_then(Authorization::header) {
        request = request.header(HEADER, header);
    }
    let operation = async {
        let mut response = request.send().await.map_err(|_| {
            "Repository announced, but its Git availability could not be confirmed."
        })?;
        let status = response.status().as_u16();
        if status == 401 {
            if let Some(assertion) = assertion
                .as_ref()
                .and_then(|authorization| authorization.assertion.as_ref())
            {
                fi.reject_assertion(assertion).await;
            }
        }
        if let Some(reason) = assertion
            .as_ref()
            .and_then(|authorization| authorization.refusal(status))
        {
            return Err(reason.into());
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned);
        if status == 404 {
            return Err("Repository was announced, but was not created.".into());
        }
        let body = read_bounded(
            &mut response,
            MAX_RESPONSE,
            "Repository Git advertisement was interrupted",
            "Repository Git advertisement is too large",
        )
        .await?;
        advertisement(status, content_type.as_deref(), &body)
    };
    if let Some(authorization) = assertion.as_ref() {
        fi.during_admitted_operation(host, authorization, false, operation)
            .await?
    } else {
        operation.await
    }
}

fn advertisement(status: u16, content_type: Option<&str>, body: &[u8]) -> Result<()> {
    if status == 404 {
        return Err("Repository was announced, but was not created.".into());
    }
    if status != 200
        || content_type != Some("application/x-git-upload-pack-advertisement")
        || !body.starts_with(b"001e# service=git-upload-pack\n0000")
    {
        return Err(
            "Repository announced, but its Git availability could not be confirmed.".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct Fixture {
        checks: Cell<usize>,
        change: &'static str,
        published: Cell<bool>,
        confirmed: bool,
        exists: bool,
        readback: bool,
    }
    impl RepositoryRequest for Fixture {
        async fn check(&self) -> Result<String> {
            let n = self.checks.get();
            self.checks.set(n + 1);
            if self.change == "duplicate" || (n > 0 && matches!(self.change, "demoted" | "taken")) {
                return Err("Not allowed or name already taken".into());
            }
            Ok("Channel".into())
        }
        async fn confirm(&self, _: &str) -> Result<bool> {
            Ok(self.confirmed)
        }
        async fn sign(&self) -> Result<Value> {
            Ok(
                json!({"id":"event", "pubkey": if self.change == "signer" { "other" } else { "viewer" }}),
            )
        }
        async fn current_viewer(&self) -> Result<String> {
            Ok(if self.change == "viewer" {
                "other"
            } else {
                "viewer"
            }
            .into())
        }
        fn viewer(&self) -> &str {
            "viewer"
        }
        async fn publish(&self, _: &Value) -> Result<()> {
            self.published.set(true);
            Ok(())
        }
        async fn readback(&self, _: &Value) -> Result<bool> {
            Ok(self.readback)
        }
        async fn probe(&self) -> Result<()> {
            if self.exists {
                Ok(())
            } else {
                Err("Repository was announced, but was not created.".into())
            }
        }
    }
    fn fixture(change: &'static str) -> Fixture {
        Fixture {
            checks: Cell::new(0),
            change,
            published: Cell::new(false),
            confirmed: true,
            exists: true,
            readback: true,
        }
    }
    #[tokio::test]
    async fn consent_and_rechecks_precede_publication() {
        for change in ["duplicate", "demoted", "taken", "signer", "viewer"] {
            let f = fixture(change);
            assert!(execute(&f).await.is_err(), "{change}");
            assert!(!f.published.get(), "{change}");
        }
        let mut f = fixture("");
        f.confirmed = false;
        assert!(execute(&f).await.unwrap_err().contains("cancelled"));
        assert!(!f.published.get());
    }
    #[tokio::test]
    async fn success_requires_announcement_and_repository_readback() {
        let mut f = fixture("");
        f.readback = false;
        assert!(execute(&f).await.unwrap_err().contains("announcement"));
        assert!(f.published.get());
        let mut f = fixture("");
        f.exists = false;
        assert!(execute(&f).await.unwrap_err().contains("not created"));
        assert_eq!(execute(&fixture("")).await.unwrap(), "event");
    }
    #[tokio::test]
    async fn channel_role_comes_from_the_relay_signed_roster() {
        let relay = IdentityHost::fixture();
        let authority = relay.viewer().await.unwrap();
        let channel = "11111111-1111-4111-8111-111111111111";
        let viewer = "a".repeat(64);
        let signed = |kind, tags| EventTemplate {
            kind,
            created_at: 1,
            content: String::new(),
            tags,
        };
        let metadata = relay
            .sign(signed(
                39000,
                vec![
                    vec!["d".into(), channel.into()],
                    vec!["name".into(), "Team".into()],
                ],
            ))
            .await
            .unwrap();
        let roster = relay
            .sign(signed(
                39002,
                vec![
                    vec!["d".into(), channel.into()],
                    vec!["p".into(), viewer.clone(), "".into(), "admin".into()],
                ],
            ))
            .await
            .unwrap();
        assert_eq!(
            checked_channel(
                &[metadata.clone(), roster.clone()],
                &authority,
                &viewer,
                channel
            )
            .unwrap(),
            "Team"
        );
        assert!(checked_channel(
            &[metadata.clone(), roster.clone()],
            &authority,
            &"b".repeat(64),
            channel
        )
        .is_err());
        let mut tampered = roster;
        tampered["tags"][1][3] = json!("owner");
        assert!(checked_channel(&[metadata, tampered], &authority, &viewer, channel).is_err());
    }
    #[test]
    fn git_advertisement_requires_a_real_success_response() {
        let content = Some("application/x-git-upload-pack-advertisement");
        let body = b"001e# service=git-upload-pack\n0000";
        assert!(advertisement(404, None, b"")
            .unwrap_err()
            .contains("not created"));
        assert!(advertisement(200, content, b"not git").is_err());
        assert!(advertisement(503, content, body).is_err());
        assert!(advertisement(200, content, body).is_ok());
    }
    #[test]
    fn input_rejects_caller_supplied_tags() {
        assert!(serde_json::from_value::<RepositoryInput>(json!({"community":"https://relay.test", "viewer":"viewer", "channel":"channel", "name":"docs", "plugin":"plugin", "tags":[]})).is_err());
    }
    #[test]
    fn repository_names_follow_relay_rules() {
        for name in ["", ".secret", "a..b", "x/y", "x y"] {
            assert!(!valid_name(name));
        }
        for name in ["docs", "a_b-1.git"] {
            assert!(valid_name(name));
        }
    }
}
