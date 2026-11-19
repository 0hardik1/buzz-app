import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { uploadAvatar } from "./avatar-upload";
import { animatedAvatarUrl } from "./animated-avatar";
import styles from "./AnimatedAvatarCapture.module.css";
import {
  type AvatarCameraDevice,
  type AvatarComposition,
  ANIMATED_AVATAR_SIZE,
  DEFAULT_PERSON_SCALE,
  DEFAULT_PERSON_OFFSET_X,
  DEFAULT_PERSON_OFFSET_Y,
  DEFAULT_SHAPE_SCALE,
  DEFAULT_SHAPE_OFFSET_X,
  DEFAULT_SHAPE_OFFSET_Y,
  openAvatarCamera,
  stopAvatarCamera,
  listAvatarCameras,
  preloadAvatarSegmenter,
  recordAnimatedAvatarFrames,
  createAvatarFrameBitmaps,
  composeAvatarFrame,
  composeAvatarFrames,
  encodeAvatarAnimation,
  renderAvatarPosterPng,
} from "./animated-avatar-capture";

const initialComposition: AvatarComposition = {
  backdropColor: "#FFE75C",
  scale: DEFAULT_PERSON_SCALE,
  offsetX: DEFAULT_PERSON_OFFSET_X,
  offsetY: DEFAULT_PERSON_OFFSET_Y,
  personOutline: true,
  shapeScale: DEFAULT_SHAPE_SCALE,
  shapeOffsetX: DEFAULT_SHAPE_OFFSET_X,
  shapeOffsetY: DEFAULT_SHAPE_OFFSET_Y,
};

/** Owns camera and draft resources only while the Animated tab is mounted. */
export function AnimatedAvatarCapture({
  community,
  disabled,
  onApply,
}: {
  community: string | undefined;
  disabled: boolean;
  onApply(value: string): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const operation = useRef<AbortController | null>(null);
  const frames = useRef<ImageBitmap[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "starting" | "live" | "recording" | "review" | "saving"
  >("idle");
  const [cameras, setCameras] = useState<AvatarCameraDevice[]>([]);
  const [camera, setCamera] = useState("");
  const [error, setError] = useState("");
  const [segmented, setSegmented] = useState(true);
  const [progress, setProgress] = useState(0);
  const [poster, setPoster] = useState(0);
  const reducedMotion = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [composition, setComposition] = useState(initialComposition);
  const busy =
    phase === "starting" || phase === "recording" || phase === "saving";
  useEffect(
    () => () => {
      operation.current?.abort();
      if (stream.current) stopAvatarCamera(stream.current);
      frames.current.forEach((frame) => {
        frame.close();
      });
    },
    [],
  );
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (phase !== "review" || !context) return;
    let index = poster;
    let direction = 1;
    const draw = () => {
      const frame = frames.current[index];
      if (frame) composeAvatarFrame(context, frame, composition);
      if (index >= frames.current.length - 1) direction = -1;
      if (index <= 0) direction = 1;
      index += direction;
    };
    draw();
    if (!playing || reducedMotion) return;
    const timer = window.setInterval(draw, 1000 / 12);
    return () => window.clearInterval(timer);
  }, [phase, poster, composition, playing, reducedMotion]);

  async function start() {
    if (operation.current || disabled) return;
    const request = new AbortController();
    operation.current = request;
    setError("");
    setPhase("starting");
    if (stream.current) stopAvatarCamera(stream.current);
    stream.current = null;
    try {
      const acquired = await openAvatarCamera(camera || undefined);
      if (request.signal.aborted) {
        stopAvatarCamera(acquired);
        return;
      }
      stream.current = acquired;
      const preview = video.current;
      if (!preview)
        throw new Error("Camera preview is unavailable. Try again.");
      preview.srcObject = acquired;
      await preview.play();
      if (request.signal.aborted) return;
      if (!preview.videoWidth || !preview.videoHeight)
        throw new Error("Camera has no video. Try another camera.");
      setPhase("live");
      preloadAvatarSegmenter();
      void listAvatarCameras().then(
        (devices) => {
          if (!request.signal.aborted) setCameras(devices);
        },
        () => {
          /* Recording remains usable when enumeration is unavailable. */
        },
      );
    } catch (reason) {
      if (stream.current) stopAvatarCamera(stream.current);
      stream.current = null;
      if (!request.signal.aborted) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Camera access failed. Try again.",
        );
        setPhase("idle");
      }
    } finally {
      if (operation.current === request) operation.current = null;
    }
  }
  async function record() {
    if (!video.current || operation.current || disabled) return;
    const request = new AbortController();
    operation.current = request;
    setError("");
    setProgress(0);
    setPhase("recording");
    try {
      const recording = await recordAnimatedAvatarFrames(video.current, {
        signal: request.signal,
        onProgress: (value) => {
          if (!request.signal.aborted) setProgress(value);
        },
      });
      if (stream.current) stopAvatarCamera(stream.current);
      stream.current = null;
      const bitmaps = await createAvatarFrameBitmaps(recording.frames);
      if (request.signal.aborted) {
        bitmaps.forEach((frame) => {
          frame.close();
        });
        return;
      }
      frames.current.forEach((frame) => {
        frame.close();
      });
      frames.current = bitmaps;
      setSegmented(recording.backgroundRemoved);
      setPoster(0);
      setPlaying(!reducedMotion);
      setPhase("review");
    } catch (reason) {
      if (!request.signal.aborted) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Recording failed. Try again.",
        );
        setPhase("idle");
      }
    } finally {
      if (stream.current) stopAvatarCamera(stream.current);
      stream.current = null;
      if (operation.current === request) operation.current = null;
    }
  }
  async function save() {
    if (!community || operation.current || disabled) return;
    const request = new AbortController();
    operation.current = request;
    setError("");
    setPhase("saving");
    try {
      const composed = composeAvatarFrames(frames.current, composition);
      const selected = composed[poster];
      if (!selected) throw new Error("Record an avatar first.");
      const still = await renderAvatarPosterPng(selected);
      request.signal.throwIfAborted();
      const animation = encodeAvatarAnimation(composed);
      const posterUrl = await uploadAvatar(
        new File([Uint8Array.from(still)], "avatar-poster.png", {
          type: "image/png",
        }),
        community,
        request.signal,
      );
      const animationUrl = await uploadAvatar(
        new File([Uint8Array.from(animation)], "avatar-animation.png", {
          type: "image/png",
        }),
        community,
        request.signal,
      );
      request.signal.throwIfAborted();
      onApply(animatedAvatarUrl(posterUrl, animationUrl));
    } catch (reason) {
      if (!request.signal.aborted) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not upload the animation. Try again.",
        );
        setPhase("review");
      }
    } finally {
      if (operation.current === request) operation.current = null;
    }
  }
  return (
    <div className={styles.capture}>
      {
        <video
          hidden={
            phase !== "starting" && phase !== "live" && phase !== "recording"
          }
          ref={video}
          autoPlay
          muted
          playsInline
          aria-label="Camera preview"
          className={styles.preview}
        />
      }
      {(phase === "review" || phase === "saving") && (
        <canvas
          ref={canvas}
          width={ANIMATED_AVATAR_SIZE}
          height={ANIMATED_AVATAR_SIZE}
          className={styles.preview}
          role="img"
          aria-label="Animated avatar poster preview"
        />
      )}
      {(phase === "idle" || phase === "live") && (
        <>
          {cameras.length > 1 && (
            <label className="text-label-sm">
              Camera
              <select
                value={camera}
                disabled={disabled}
                onChange={(event) => setCamera(event.target.value)}
              >
                <option value="">Default camera</option>
                {cameras.map((item, index) => (
                  <option key={item.deviceId} value={item.deviceId}>
                    {item.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            disabled={disabled || !community}
            onClick={() => void start()}
          >
            {phase === "idle" ? "Start camera" : "Switch camera"}
          </Button>
          {phase === "live" && (
            <Button disabled={disabled} onClick={() => void record()}>
              Record 3 seconds
            </Button>
          )}
        </>
      )}
      {phase === "review" && (
        <>
          {!segmented && (
            <p className="text-body-sm">
              Background removal was unavailable. Your camera background is
              included.
            </p>
          )}
          <label className="text-label-sm">
            Background color
            <input
              type="color"
              value={composition.backdropColor ?? "#FFE75C"}
              onChange={(event) =>
                setComposition({
                  ...composition,
                  backdropColor: event.target.value,
                })
              }
            />
          </label>
          <label className="text-label-sm">
            Size
            <input
              type="range"
              min={0.7}
              max={2}
              step={0.01}
              value={composition.scale}
              onChange={(event) =>
                setComposition({
                  ...composition,
                  scale: Number(event.target.value),
                })
              }
            />
          </label>
          <Button
            onClick={() => setPlaying(!playing)}
            disabled={!!reducedMotion}
          >
            {playing && !reducedMotion ? "Pause preview" : "Play preview"}
          </Button>
          <label className="text-label-sm">
            Still frame
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.current.length - 1)}
              step={1}
              value={poster}
              onChange={(event) => {
                setPlaying(false);
                setPoster(Number(event.target.value));
              }}
            />
          </label>
          <Button disabled={disabled} onClick={() => void start()}>
            Record again
          </Button>
          <Button
            variant="prominent"
            disabled={disabled || !community}
            onClick={() => void save()}
          >
            Use animated avatar
          </Button>
        </>
      )}
      {busy && (
        <p role="status" className="text-body-sm">
          {phase === "starting"
            ? "Starting camera…"
            : phase === "recording"
              ? `Recording… ${Math.round(progress * 100)}%`
              : "Uploading animated avatar…"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
