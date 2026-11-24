//! Install the media encoder using the host's package manager.
use std::{ffi::OsStr, path::PathBuf, process::Stdio, time::Duration};
use tokio::process::Command;

static INSTALL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) fn program(path: &OsStr) -> PathBuf {
    #[cfg(windows)]
    if let Some(link) = dirs::data_local_dir()
        .map(|dir| dir.join("Microsoft/WinGet/Links/ffmpeg.exe"))
        .filter(|link| link.is_file())
    {
        return link;
    }
    crate::host_command::resolve_program("ffmpeg", path)
}

fn command(executable: PathBuf, path: &OsStr) -> Command {
    let mut cmd = Command::new(executable);
    cmd.env("PATH", path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    cmd
}

async fn version(path: &OsStr) -> Option<u32> {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        command(program(path), path)
            .arg("-version")
            .stdout(Stdio::piped())
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    std::str::from_utf8(&output.stdout)
        .ok()?
        .strip_prefix("ffmpeg version ")?
        .trim_start_matches('n')
        .split('.')
        .next()?
        .parse()
        .ok()
}

#[tauri::command]
pub(crate) async fn install_ffmpeg(require_version8: bool) -> Result<(), String> {
    let _guard = INSTALL.lock().await;
    let path = crate::host_command::effective_path();
    let current = version(&path).await;
    let minimum = if require_version8 { 8 } else { 1 };
    if current.is_some_and(|v| v >= minimum) {
        return Ok(());
    }
    let (manager, args, missing): (&str, &[&str], &str) = match std::env::consts::OS {
        "macos" => (
            "brew",
            &["install", "ffmpeg"],
            "Automatic installation requires Homebrew on this Mac.",
        ),
        "windows" => (
            "winget",
            &[
                if current.is_some() {
                    "upgrade"
                } else {
                    "install"
                },
                "--id",
                "Gyan.FFmpeg",
                "--exact",
                "--source",
                "winget",
                "--scope",
                "user",
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--disable-interactivity",
            ],
            "Automatic installation requires Windows App Installer.",
        ),
        "linux" => (
            "pkcon",
            &[
                "-y",
                if current.is_some() {
                    "update"
                } else {
                    "install"
                },
                "ffmpeg",
            ],
            "Automatic installation requires PackageKit on this computer.",
        ),
        _ => return Err("Automatic installation is unavailable on this device.".into()),
    };
    let status = tokio::time::timeout(
        Duration::from_secs(900),
        command(crate::host_command::resolve_program(manager, &path), &path)
            .args(args)
            .status(),
    )
    .await
    .map_err(|_| "Installation timed out. Try again.")?
    .map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            missing
        } else {
            "Buzz could not start the package manager."
        }
    })?;
    if !status.success() {
        return Err("Installation didn’t finish. Check your connection and any system approval prompt, then try again.".into());
    }
    if !version(&path).await.is_some_and(|v| v >= minimum) {
        return Err(
            "The package manager finished, but a compatible FFmpeg is still unavailable.".into(),
        );
    }
    Ok(())
}
