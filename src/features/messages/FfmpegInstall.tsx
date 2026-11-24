import { isHeic } from "../relay/video-preparation";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useState } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import styles from "./ComposerAttachments.module.css";

export function FfmpegInstall({
  file,
  disabled,
  retry,
}: {
  file: File;
  disabled: boolean;
  retry(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const desktop = isTauri() && window.location.pathname !== "/huddle.html";
  const needsUpdate =
    /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/.test(file.type);
  async function install() {
    setBusy(true);
    try {
      if (desktop) {
        const header = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        await invoke("install_ffmpeg", {
          requireVersion8: isHeic(header, file.name),
        });
      }
      setError("");
      retry();
    } catch (cause) {
      setError(
        typeof cause === "string" ? cause : "Installation failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.encoderCard}>
      <div>
        <strong>
          {needsUpdate ? "Install or update FFmpeg" : "Install FFmpeg"}
        </strong>
        <p role="status">
          {error ||
            (desktop
              ? needsUpdate
                ? "Buzz needs FFmpeg 8 or newer to upload this photo."
                : "Buzz uses FFmpeg to send voice notes, videos, and photos."
              : "Install or update FFmpeg on the computer running Buzz, then retry the upload.")}
        </p>
      </div>
      <Button
        variant="prominent"
        size="sm"
        disabled={disabled}
        loading={busy}
        onClick={() => void install()}
      >
        {error
          ? "Try again"
          : !desktop
            ? "Retry upload"
            : needsUpdate
              ? "Install or update"
              : "Install"}
      </Button>
    </div>
  );
}
