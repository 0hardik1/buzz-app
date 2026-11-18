//! Tells the main view whether scroll-wheel input comes from a mouse wheel.
//!
//! WebKit scrolls each mouse-wheel tick in one frame, and its DOM wheel events
//! look the same for a wheel and a trackpad. AppKit knows: a trackpad or Magic
//! Mouse reports precise deltas, a notched wheel does not. An NSEvent local
//! monitor sends `buzz:wheel-input` with `"coarse"` or `"precise"` to the main
//! view when the kind changes, so the timeline can ease wheel ticks
//! (`src/features/messages/wheel-easing.ts`). Events always pass through.
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU8, Ordering};

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask};
use tauri::{AppHandle, Manager, Runtime};

const UNKNOWN: u8 = 0;
const PRECISE: u8 = 1;
const COARSE: u8 = 2;

/// The kind last sent to the main view's current page.
static SENT: AtomicU8 = AtomicU8::new(UNKNOWN);

fn kind(precise: bool) -> u8 {
    if precise {
        PRECISE
    } else {
        COARSE
    }
}

/// The script for a kind change, or `None` when the page already has it.
fn change(sent: &AtomicU8, kind: u8) -> Option<String> {
    if sent.swap(kind, Ordering::Relaxed) == kind {
        return None;
    }
    let detail = if kind == COARSE { "coarse" } else { "precise" };
    // The global covers a page whose listener is not installed yet.
    Some(format!(
        "window.__buzzWheelInput = \"{detail}\"; window.dispatchEvent(new CustomEvent(\"buzz:wheel-input\", {{ detail: \"{detail}\" }}));"
    ))
}

/// A new page has not been told the kind yet. Called on both load events.
pub(crate) fn page_load() {
    SENT.store(UNKNOWN, Ordering::Relaxed);
}

pub(crate) fn install<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // AppKit supplies a live event for the duration of this callback.
        let ns_event = unsafe { event.as_ref() };
        if let Some(script) = change(&SENT, kind(ns_event.hasPreciseScrollingDeltas())) {
            // The page can see this event's DOM wheel events first; the next
            // tick then has the new kind.
            match app.get_webview_window("main") {
                Some(window) => {
                    if let Err(error) = window.eval(script) {
                        SENT.store(UNKNOWN, Ordering::Relaxed);
                        eprintln!("Could not send the Buzz wheel input kind: {error}");
                    }
                }
                None => SENT.store(UNKNOWN, Ordering::Relaxed),
            }
        }
        event.as_ptr()
    });
    // The callback returns only the original event.
    let token = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &handler)
    };
    match token {
        // The monitor lives for the whole app.
        Some(token) => std::mem::forget(token),
        None => eprintln!("Could not install the Buzz wheel input monitor"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_only_kind_changes() {
        let sent = AtomicU8::new(UNKNOWN);
        let coarse = change(&sent, kind(false)).expect("first coarse event is sent");
        assert!(coarse.contains("\"buzz:wheel-input\""));
        assert!(coarse.contains("detail: \"coarse\""));
        assert!(coarse.contains("window.__buzzWheelInput = \"coarse\""));
        assert_eq!(change(&sent, kind(false)), None);
        let precise = change(&sent, kind(true)).expect("a trackpad event is sent");
        assert!(precise.contains("detail: \"precise\""));
        assert_eq!(change(&sent, kind(true)), None);
        assert!(change(&sent, kind(false)).is_some());
    }

    #[test]
    fn a_reset_page_is_told_again() {
        let sent = AtomicU8::new(UNKNOWN);
        assert!(change(&sent, COARSE).is_some());
        sent.store(UNKNOWN, Ordering::Relaxed);
        assert!(change(&sent, COARSE).is_some());
    }
}
