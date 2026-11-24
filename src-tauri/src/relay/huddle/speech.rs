#[cfg(target_os = "macos")]
pub(super) async fn recognize(samples: Vec<i16>) -> Result<String, String> {
    use std::ffi::{c_char, c_void, CStr};
    use tokio::sync::oneshot;

    type ResultSender = oneshot::Sender<Result<String, String>>;

    unsafe extern "C" {
        fn buzz_huddle_recognize(
            samples: *const i16,
            length: u32,
            context: *mut c_void,
            callback: extern "C" fn(*mut c_void, *const c_char, *const c_char),
        );
    }

    extern "C" fn complete(context: *mut c_void, text: *const c_char, error: *const c_char) {
        // The native operation invokes the callback exactly once and owns both
        // strings until it returns.
        let sender = unsafe { Box::from_raw(context.cast::<ResultSender>()) };
        let result = if !error.is_null() {
            Err(unsafe { CStr::from_ptr(error) }
                .to_string_lossy()
                .into_owned())
        } else if !text.is_null() {
            Ok(unsafe { CStr::from_ptr(text) }
                .to_string_lossy()
                .into_owned())
        } else {
            Ok(String::new())
        };
        let _ = sender.send(result);
    }

    let (send, receive) = oneshot::channel();
    // The native function copies the sample buffer before returning.
    unsafe {
        buzz_huddle_recognize(
            samples.as_ptr(),
            samples.len() as u32,
            Box::into_raw(Box::new(send)).cast(),
            complete,
        );
    }
    receive
        .await
        .map_err(|_| "Speech recognition ended".to_string())?
}

#[cfg(not(target_os = "macos"))]
pub(super) async fn recognize(_samples: Vec<i16>) -> Result<String, String> {
    Err("Huddle microphone transcription is available on macOS.".into())
}

#[cfg(target_os = "macos")]
pub(super) async fn synthesize(
    text: String,
    pcm: tokio::sync::mpsc::Sender<Vec<f32>>,
) -> Result<(), String> {
    use std::time::Duration;
    use tokio::{io::AsyncWriteExt, process::Command};

    let dir = tempfile::tempdir().map_err(|_| "Could not prepare Huddle playback")?;
    let wave = dir.path().join("speech.wav");
    let mut child = Command::new("/usr/bin/say")
        .args(["--file-format=WAVE", "--data-format=LEI16@48000", "-o"])
        .arg(&wave)
        .args(["-f", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Could not start Huddle speech")?;
    let rendered = tokio::time::timeout(Duration::from_secs(10), async {
        {
            let mut input = child.stdin.take().ok_or("Speech input unavailable")?;
            input
                .write_all(text.as_bytes())
                .await
                .map_err(|_| "Speech input failed")?;
        }
        child.wait().await.map_err(|_| "Huddle speech failed")
    })
    .await
    .map_err(|_| "Huddle speech took too long")??;
    if !rendered.success() {
        return Err("Could not synthesize the Huddle reply".into());
    }
    // say renders a private local file. Play at the relay's usual 20 ms frame
    // cadence and drop a frame if live audio already filled the bounded queue.
    let bytes = std::fs::read(wave).map_err(|_| "Could not load Huddle speech")?;
    let samples = wave_data(&bytes).ok_or("Invalid Huddle speech audio")?;
    let mut clock = tokio::time::interval(Duration::from_millis(20));
    clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    for frame in samples.chunks(960 * 2) {
        clock.tick().await;
        if pcm.is_closed() {
            break;
        }
        let mut audio: Vec<f32> = frame
            .chunks_exact(2)
            .map(|sample| i16::from_le_bytes([sample[0], sample[1]]) as f32 / 32768.0)
            .collect();
        audio.resize(960, 0.0);
        let _ = pcm.try_send(audio);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn wave_data(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.get(..4)? != b"RIFF" || bytes.get(8..12)? != b"WAVE" {
        return None;
    }
    let mut rest = bytes.get(12..)?;
    let mut format = false;
    while rest.len() >= 8 {
        let size = u32::from_le_bytes(rest[4..8].try_into().ok()?) as usize;
        let chunk = rest.get(8..8 + size)?;
        match &rest[..4] {
            b"fmt " => {
                format = chunk.get(..8)? == [1, 0, 1, 0, 128, 187, 0, 0]
                    && chunk.get(14..16)? == [16, 0];
            }
            b"data" if format => return Some(chunk),
            _ => {}
        }
        rest = rest.get(8 + size + size % 2..)?;
    }
    None
}

#[cfg(not(target_os = "macos"))]
pub(super) async fn synthesize(
    _text: String,
    _pcm: tokio::sync::mpsc::Sender<Vec<f32>>,
) -> Result<(), String> {
    Err("Playback of text replies in Huddles is available on macOS.".into())
}
