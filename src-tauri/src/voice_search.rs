//! Speech-to-text for voice jump, on device. On macOS, `voice_search.swift`
//! (linked in by build.rs) records the microphone and transcribes it with
//! Apple's speech recognition: SpeechAnalyzer on macOS 26, SFSpeechRecognizer
//! restricted to on-device recognition before that. Audio never leaves the
//! Mac and no key or server is needed. Elsewhere voice jump is unavailable.
//!
//! One listen runs at a time: starting another cancels the first. Its events
//! reach the webview on the channel it passed, until it ends or fails.
use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::Channel;

/// Hints bias recognition toward the names voice jump can match. Beyond
/// this many (Apple's limit for contextual strings) they are dropped, as are
/// longer ones.
const HINT_LIMIT: usize = 100;
const HINT_CHARS: usize = 100;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) enum VoiceEvent {
    /// The microphone is on.
    Listening,
    /// The transcript so far, each time it changes.
    Text { text: String },
    /// The final transcript; nothing follows.
    Ended { text: String },
    /// Listening failed; nothing follows.
    Error { message: String },
}

impl VoiceEvent {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn from_native(kind: i32, text: String) -> Option<Self> {
        Some(match kind {
            0 => Self::Listening,
            1 => Self::Text { text },
            2 => Self::Ended { text },
            3 => Self::Error { message: text },
            _ => return None,
        })
    }

    fn last(&self) -> bool {
        matches!(self, Self::Ended { .. } | Self::Error { .. })
    }
}

/// The listen in progress and where its events go.
static CURRENT: Mutex<Option<(u64, Channel<VoiceEvent>)>> = Mutex::new(None);

fn current() -> std::sync::MutexGuard<'static, Option<(u64, Channel<VoiceEvent>)>> {
    CURRENT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Delivers one event to its listen's channel, if that listen is current.
fn deliver(session: u64, event: VoiceEvent) {
    let mut current = current();
    let Some((id, channel)) = current.as_ref() else {
        return;
    };
    if *id != session {
        return;
    }
    let last = event.last();
    let _ = channel.send(event);
    if last {
        *current = None;
    }
}

/// Newline-separated hints for native code: trimmed, single-line, capped.
fn hint_lines(hints: &[String]) -> String {
    hints
        .iter()
        .map(|hint| {
            hint.split(|c: char| c.is_control())
                .filter(|part| !part.trim().is_empty())
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_owned()
        })
        .filter(|hint| !hint.is_empty() && hint.chars().count() <= HINT_CHARS)
        .take(HINT_LIMIT)
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(target_os = "macos")]
mod native {
    use std::ffi::{c_char, CStr, CString};

    type Callback = extern "C" fn(u64, i32, *const c_char);

    extern "C" {
        fn buzz_voice_available() -> bool;
        fn buzz_voice_prepare();
        fn buzz_voice_start(session: u64, hints: *const c_char, callback: Callback);
        fn buzz_voice_finish(session: u64);
        fn buzz_voice_cancel(session: u64);
    }

    extern "C" fn on_event(session: u64, kind: i32, text: *const c_char) {
        let text = if text.is_null() {
            String::new()
        } else {
            // SAFETY: native code passes a NUL-terminated string that lives
            // for the duration of this call.
            unsafe { CStr::from_ptr(text) }
                .to_string_lossy()
                .into_owned()
        };
        if let Some(event) = super::VoiceEvent::from_native(kind, text) {
            super::deliver(session, event);
        }
    }

    pub(super) fn available() -> bool {
        // SAFETY: takes no arguments and only reads system state.
        unsafe { buzz_voice_available() }
    }

    pub(super) fn prepare() {
        // SAFETY: takes no arguments; the work runs on a Swift task.
        unsafe { buzz_voice_prepare() }
    }

    pub(super) fn start(session: u64, hints: &str) {
        // Hint lines never hold NUL: control characters are removed.
        let hints = CString::new(hints).unwrap_or_default();
        // SAFETY: `hints` outlives the call, which copies it; `on_event` is a
        // plain function that may be called from any thread.
        unsafe { buzz_voice_start(session, hints.as_ptr(), on_event) }
    }

    pub(super) fn finish(session: u64) {
        // SAFETY: an unknown session is ignored.
        unsafe { buzz_voice_finish(session) }
    }

    pub(super) fn cancel(session: u64) {
        // SAFETY: an unknown session is ignored.
        unsafe { buzz_voice_cancel(session) }
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    pub(super) fn available() -> bool {
        false
    }
    pub(super) fn prepare() {}
    pub(super) fn start(session: u64, _hints: &str) {
        super::deliver(
            session,
            super::VoiceEvent::Error {
                message: "Voice search is unavailable".into(),
            },
        );
    }
    pub(super) fn finish(_session: u64) {}
    pub(super) fn cancel(_session: u64) {}
}

/// Whether this device can transcribe speech on device.
#[tauri::command]
pub(crate) fn voice_search_available() -> bool {
    native::available()
}

/// Loads the speech model ahead of listening, downloading it the first time.
#[tauri::command]
pub(crate) fn voice_search_prepare() {
    native::prepare();
}

/// Starts listening, biased toward `hints`; returns the listen's number for
/// finishing or cancelling it.
#[tauri::command]
pub(crate) fn voice_search_start(hints: Vec<String>, on_event: Channel<VoiceEvent>) -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let session = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    *current() = Some((session, on_event));
    native::start(session, &hint_lines(&hints));
    session
}

/// Stops listening; the final transcript follows as `ended`.
#[tauri::command]
pub(crate) fn voice_search_finish(session: u64) {
    native::finish(session);
}

/// Stops listening without reporting anything more.
#[tauri::command]
pub(crate) fn voice_search_cancel(session: u64) {
    {
        let mut current = current();
        if current.as_ref().is_some_and(|(id, _)| *id == session) {
            *current = None;
        }
    }
    native::cancel(session);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hints_are_single_lines_within_limits() {
        let hints = [
            "  buzz-security ".to_owned(),
            "two\nlines".to_owned(),
            "nul\0inside".to_owned(),
            String::new(),
            "x".repeat(HINT_CHARS + 1),
            "murderbot".to_owned(),
        ];
        assert_eq!(
            hint_lines(&hints),
            "buzz-security\ntwo lines\nnul inside\nmurderbot"
        );
        let many: Vec<String> = (0..HINT_LIMIT + 5).map(|n| format!("h{n}")).collect();
        assert_eq!(hint_lines(&many).lines().count(), HINT_LIMIT);
    }

    #[test]
    fn native_events_map_to_webview_events() {
        let text = || "said".to_owned();
        assert_eq!(
            VoiceEvent::from_native(0, text()),
            Some(VoiceEvent::Listening)
        );
        assert_eq!(
            VoiceEvent::from_native(1, text()),
            Some(VoiceEvent::Text { text: text() })
        );
        assert_eq!(
            VoiceEvent::from_native(2, text()),
            Some(VoiceEvent::Ended { text: text() })
        );
        assert_eq!(
            VoiceEvent::from_native(3, text()),
            Some(VoiceEvent::Error { message: text() })
        );
        assert_eq!(VoiceEvent::from_native(9, text()), None);
        assert!(!VoiceEvent::Listening.last());
        assert!(VoiceEvent::Ended { text: text() }.last());
    }
}
