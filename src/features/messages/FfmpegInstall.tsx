import { isHeic } from "../relay/video-preparation";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useLayoutEffect, useRef, useState } from "react";
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
  const selection = useRef<{ file: File } | null>(null);
  useLayoutEffect(() => {
    selection.current = { file };
    setBusy(false);
    setError("");
    return () => {
      selection.current = null;
    };
  }, [file]);
  const desktop = isTauri() && window.location.pathname !== "/huddle.html";
  const needsUpdate =
    /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/.test(file.type);
  async function install() {
    const current = selection.current;
    if (!current) return;
    setBusy(true);
    try {
      if (desktop) {
        const header = new Uint8Array(
          await current.file.slice(0, 4096).arrayBuffer(),
        );
        if (selection.current !== current) return;
        await invoke("install_ffmpeg", {
          requireVersion8: isHeic(header, file.name),
        });
      }
      if (selection.current !== current) return;
      setError("");
      retry();
    } catch (cause) {
      if (selection.current !== current) return;
      setError(
        typeof cause === "string" ? cause : "Installation failed. Try again.",
      );
    } finally {
      if (selection.current === current) setBusy(false);
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
