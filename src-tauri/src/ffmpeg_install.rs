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
    install_with_path(&path, require_version8, std::env::consts::OS).await
}

async fn install_with_path(path: &OsStr, require_version8: bool, os: &str) -> Result<(), String> {
    let current = version(path).await;
    let minimum = if require_version8 { 8 } else { 1 };
    if current.is_some_and(|v| v >= minimum) {
        return Ok(());
    }
    let (manager, args, missing): (&str, &[&str], &str) = match os {
        "macos" => (
            "brew",
            &["install", "ffmpeg"],
            "Automatic installation requires Homebrew on this Mac.",
        ),
        "windows" => (
            "winget",
            &[
                "install",
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
        command(crate::host_command::resolve_program(manager, path), path)
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
    let installed = version(path).await;
    if installed.is_some_and(|v| v >= minimum) {
        return Ok(());
    }
    if os == "linux" {
        if let Some(major) = installed {
            return Err(format!("Buzz found FFmpeg {major}. This photo needs FFmpeg 8 or newer. Install a compatible version through your distribution, or upload a JPEG instead."));
        }
        return Err("PackageKit could not make FFmpeg available. Install FFmpeg with your distribution’s package manager, then try again.".into());
    }
    if !status.success() {
        return Err("Installation didn’t finish. Check your connection and any system approval prompt, then try again.".into());
    }
    Err("The package manager finished, but a compatible FFmpeg is still unavailable.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Run explicitly on a host prepared for acceptance. This may install software.
    #[tokio::test]
    #[ignore = "requires a real host package manager"]
    async fn host_installation() {
        let path = crate::host_command::effective_path();
        let before = version(&path).await;
        install_ffmpeg(false)
            .await
            .expect("install or detect FFmpeg");
        let after = version(&path).await.expect("probe installed FFmpeg");
        println!(
            "{} FFmpeg major before={before:?} after={after}",
            std::env::consts::OS
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn older_unmanaged_ffmpeg_is_replaced_and_rechecked() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let write = |name: &str, body: &str| {
            let file = directory.path().join(name);
            std::fs::write(&file, body).unwrap();
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).unwrap();
        };
        let path = directory.path().as_os_str();
        let missing = install_with_path(path, false, "linux").await.unwrap_err();
        assert!(missing.contains("PackageKit"));
        write("ffmpeg", "#!/bin/sh\necho 'ffmpeg version 7.0'\n");
        write("pkcon", "#!/bin/sh\nexit 0\n");
        let error = install_with_path(path, true, "linux").await.unwrap_err();
        assert!(error.contains("FFmpeg 7") && error.contains("JPEG"));
        write(
            "winget",
            r##"#!/bin/sh
[ "$1" = install ] || exit 1
echo "#!/bin/sh" > "$PATH/ffmpeg"
echo "echo ffmpeg version 8.0" >> "$PATH/ffmpeg"
"##,
        );
        install_with_path(path, true, "windows").await.unwrap();
        assert_eq!(version(path).await, Some(8));
    }
}
