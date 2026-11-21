//! Speech-to-text for voice jump. A distributor's endpoint
//! (`BUZZ_VOICE_TRANSCRIPTION_URL`, at build time or in the environment)
//! mints a short-lived OpenAI Realtime transcription key, answering a JSON
//! POST with `{"client_secret": …, "expires_at": …}`. Native code keeps that
//! key and uses it to answer the webview's WebRTC offer, so the key never
//! reaches the webview and the webview needs no OpenAI connect source. Audio
//! then streams peer to peer. Without an endpoint, voice is unavailable.
//!
//! The key is fetched ahead of time (`voice_search_prepare`) and reused until
//! shortly before it expires, so starting to listen costs one round trip.
//!
//! The offer path (`BUZZ_VOICE_CALLS_URL`) instead sends the offer to a
//! Builderlab kgoose route that answers it with its own key and meters the
//! call. Nothing is fetched ahead of time, so starting to listen costs a round
//! trip to kgoose and kgoose's round trip to OpenAI. The route takes a
//! Builderlab session (`BUZZ_VOICE_CALLS_TOKEN_FILE`, read on each call) and
//! the community it bills (`BUZZ_VOICE_CALLS_COMMUNITY`).
//! `BUZZ_VOICE_CALLS_BAGGAGE` adds a `Baggage` header, which routes the call to
//! a staging Playpen.
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

const OPENAI_CALLS_URL: &str = "https://api.openai.com/v1/realtime/calls";
const OFFER_LIMIT: usize = 64 * 1024;
/// A kept key is replaced once it has less than this long left.
const KEY_MARGIN_SECS: u64 = 60;
/// How long a key without `expires_at` is kept.
const KEY_DEFAULT_SECS: u64 = 120;

#[derive(Deserialize)]
struct CallAnswer {
    sdp: String,
    call_id: String,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Deserialize)]
struct Secret {
    client_secret: String,
    #[serde(default)]
    expires_at: Option<u64>,
}

struct Kept {
    secret: Zeroizing<String>,
    expires_at: u64,
}

static KEPT: Mutex<Option<Kept>> = Mutex::const_new(None);

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: std::sync::OnceLock<Option<reqwest::Client>> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(15))
                .build()
                .ok()
        })
        .as_ref()
        .ok_or_else(|| "Voice search is unavailable".to_string())
}

pub(super) fn endpoint() -> Option<String> {
    std::env::var("BUZZ_VOICE_TRANSCRIPTION_URL")
        .ok()
        .or_else(|| option_env!("BUZZ_VOICE_TRANSCRIPTION_URL").map(str::to_owned))
        .filter(|url| url.starts_with("https://"))
}

fn env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// The kgoose route that answers offers itself, when one is configured.
pub(super) fn calls_endpoint() -> Option<String> {
    env("BUZZ_VOICE_CALLS_URL").filter(|url| url.starts_with("https://"))
}

/// Answers a WebRTC offer through the kgoose route, which forwards it to
/// OpenAI with its own key and returns the answer and the call's ID.
pub(super) async fn connect_offer(offer: String, model: Option<String>) -> Result<String, String> {
    if offer.is_empty() || offer.len() > OFFER_LIMIT {
        return Err("Invalid voice offer".into());
    }
    let url = calls_endpoint().ok_or("The voice offer route isn't configured")?;
    let community =
        env("BUZZ_VOICE_CALLS_COMMUNITY").ok_or("The voice offer route has no community")?;
    let token_file =
        env("BUZZ_VOICE_CALLS_TOKEN_FILE").ok_or("The voice offer route has no session")?;
    let token = Zeroizing::new(
        std::fs::read_to_string(&token_file)
            .map_err(|_| "The voice offer route's session couldn't be read")?
            .trim()
            .to_owned(),
    );
    let mut body = serde_json::json!({ "sdp": offer, "languages": ["en"] });
    if let Some(model) = model.filter(|model| !model.is_empty()) {
        body["model"] = serde_json::Value::String(model);
    }
    let mut request = client()?
        .post(url)
        .bearer_auth(token.as_str())
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("X-Buzz-Community", community)
        .body(body.to_string());
    if let Some(baggage) = env("BUZZ_VOICE_CALLS_BAGGAGE") {
        request = request.header("Baggage", baggage);
    }
    let started = std::time::Instant::now();
    let response = request
        .send()
        .await
        .map_err(|_| "Voice search couldn't reach the offer route")?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|_| "Voice search got no answer")?;
    if !status.is_success() {
        eprintln!("voice: offer route refused the call ({})", status.as_u16());
        return Err(format!("Voice search was refused ({})", status.as_u16()));
    }
    let answer = serde_json::from_str::<CallAnswer>(&text)
        .map_err(|_| "Voice search got an unreadable answer")?;
    eprintln!(
        "voice: offer route answered call {} ({}) in {} ms",
        answer.call_id,
        answer.model.as_deref().unwrap_or("default model"),
        started.elapsed().as_millis()
    );
    Ok(answer.sdp)
}

async fn mint() -> Result<Kept, String> {
    let url = endpoint().ok_or("Voice search is unavailable")?;
    let response = client()?
        .post(url)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .body(r#"{"language":"en"}"#)
        .send()
        .await
        .map_err(|_| "Voice search couldn't get a transcription key")?;
    if !response.status().is_success() {
        return Err(format!(
            "Voice search was refused a transcription key ({})",
            response.status().as_u16()
        ));
    }
    let body = Zeroizing::new(
        response
            .bytes()
            .await
            .map_err(|_| "Voice search got no key")?
            .to_vec(),
    );
    let parsed = serde_json::from_slice::<Secret>(&body)
        .map_err(|_| "Voice search got an unreadable key")?;
    Ok(Kept {
        expires_at: parsed
            .expires_at
            .unwrap_or_else(|| now() + KEY_DEFAULT_SECS),
        secret: Zeroizing::new(parsed.client_secret),
    })
}

/// The kept key, fetching a new one when it is missing or nearly expired.
async fn key(fresh: bool) -> Result<Zeroizing<String>, String> {
    let mut kept = KEPT.lock().await;
    if fresh {
        *kept = None;
    }
    if let Some(current) = kept.as_ref() {
        if current.expires_at > now() + KEY_MARGIN_SECS {
            return Ok(current.secret.clone());
        }
    }
    let next = mint().await?;
    let secret = next.secret.clone();
    *kept = Some(next);
    Ok(secret)
}

/// Fetches a transcription key ahead of listening, if none is kept.
pub(super) async fn prepare() -> Result<(), String> {
    key(false).await.map(|_| ())
}

async fn answer(secret: &str, offer: &str) -> Result<(reqwest::StatusCode, String), String> {
    let response = client()?
        .post(OPENAI_CALLS_URL)
        .bearer_auth(secret)
        .header("Content-Type", "application/sdp")
        .body(offer.to_owned())
        .send()
        .await
        .map_err(|_| "Voice search couldn't reach OpenAI")?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|_| "Voice search got no answer")?;
    Ok((status, text))
}

/// Answers a WebRTC offer with a transcription session's SDP answer.
pub(super) async fn connect(offer: String) -> Result<String, String> {
    if offer.is_empty() || offer.len() > OFFER_LIMIT {
        return Err("Invalid voice offer".into());
    }
    let started = std::time::Instant::now();
    let secret = key(false).await?;
    let keyed = started.elapsed();
    let (mut status, mut text) = answer(&secret, &offer).await?;
    // A kept key the service no longer accepts is replaced once.
    if status == reqwest::StatusCode::UNAUTHORIZED {
        (status, text) = answer(&key(true).await?, &offer).await?;
    }
    if !status.is_success() {
        return Err(format!("Voice search was refused ({})", status.as_u16()));
    }
    eprintln!(
        "voice: key path answered in {} ms ({} ms getting the key)",
        started.elapsed().as_millis(),
        keyed.as_millis()
    );
    Ok(text)
}
