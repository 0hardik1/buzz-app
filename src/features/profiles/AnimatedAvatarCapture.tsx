import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Select } from "../../shared/design-system/ui/Select";
import {
  ImageIcon,
  PaletteIcon,
  UserIcon,
  VideoCameraIcon,
} from "../../shared/design-system/icons";
import { scrollAvatarPalette } from "./scroll-avatar-palette";
import { avatarColors } from "./avatar-colors";
import editorStyles from "./AvatarEditor.module.css";
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

function clampOffset(value: number) {
  return Math.max(-192, Math.min(192, value));
}

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
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const frames = useRef<ImageBitmap[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "starting" | "live" | "recording" | "review" | "saving"
  >("idle");
  const [cameras, setCameras] = useState<AvatarCameraDevice[]>([]);
  const [camera, setCamera] = useState("");
  const [error, setError] = useState("");
  const [segmented, setSegmented] = useState(true);
  const [progress, setProgress] = useState(0);
  const colorDrag = useRef<{ x: number; left: number } | null>(null);
  const [section, setSection] = useState<"You" | "Background" | "Frame">("You");
  const [poster, setPoster] = useState(0);
  const reducedMotion = useReducedMotion();
  const [composition, setComposition] = useState(initialComposition);

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
    if (section === "Frame" || reducedMotion) return;
    const timer = window.setInterval(draw, 1000 / 12);
    return () => window.clearInterval(timer);
  }, [phase, poster, composition, section, reducedMotion]);

  async function start(device = camera) {
    if (operation.current || disabled) return;
    const request = new AbortController();
    operation.current = request;
    setError("");
    setPhase("starting");
    if (stream.current) stopAvatarCamera(stream.current);
    stream.current = null;
    try {
      const acquired = await openAvatarCamera(device || undefined);
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
      setSection("You");
      setPoster(0);
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
    <div className={styles.capture} data-phase={phase}>
      <div className={styles.stage} data-phase={phase}>
        {phase === "idle" && <VideoCameraIcon aria-hidden="true" size={36} />}
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
        {phase === "starting" && (
          <span role="status" className="relative grid place-items-center">
            <span
              aria-hidden="true"
              className="size-6 rounded-full border-4 border-current/10 border-t-current motion-safe:animate-[spin_500ms_linear_infinite]"
            />
            <span className="sr-only">Starting camera…</span>
          </span>
        )}

        {phase === "recording" && (
          <svg
            className={styles.timerRing}
            viewBox="0 0 100 100"
            role="progressbar"
            aria-label="Recording progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <circle
              cx="50"
              cy="50"
              r="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - progress * 100}
            />
          </svg>
        )}
        {(phase === "review" || phase === "saving") && (
          <canvas
            ref={canvas}
            width={ANIMATED_AVATAR_SIZE}
            height={ANIMATED_AVATAR_SIZE}
            className={styles.preview}
            tabIndex={phase === "review" ? 0 : -1}
            aria-label="Animated avatar preview. Drag or use arrow keys to position yourself."
            onKeyDown={(event) => {
              if (phase !== "review" || disabled) return;
              const step = event.shiftKey ? 16 : 4;
              const moves: Record<string, [number, number]> = {
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
              };
              const move = moves[event.key];
              if (!move) return;
              event.preventDefault();
              setComposition((prev) => ({
                ...prev,
                offsetX: clampOffset(prev.offsetX + move[0]),
                offsetY: clampOffset(prev.offsetY + move[1]),
              }));
            }}
            onPointerDown={(event) => {
              if (phase !== "review" || disabled || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                offsetX: composition.offsetX,
                offsetY: composition.offsetY,
              };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (
                !start ||
                start.id !== event.pointerId ||
                !event.currentTarget.hasPointerCapture(event.pointerId)
              )
                return;
              const ratio =
                ANIMATED_AVATAR_SIZE /
                event.currentTarget.getBoundingClientRect().width;
              const offsetX = clampOffset(
                start.offsetX + (event.clientX - start.x) * ratio,
              );
              const offsetY = clampOffset(
                start.offsetY + (event.clientY - start.y) * ratio,
              );
              setComposition((prev) => ({ ...prev, offsetX, offsetY }));
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
          />
        )}
      </div>
      {(phase === "idle" || phase === "live") && (
        <div className={styles.actions}>
          {cameras.length > 1 && (
            <Select
              label="Camera"
              variant="compact"
              size="md"
              value={camera}
              leading={<VideoCameraIcon aria-hidden="true" />}
              groups={[
                {
                  label: "Cameras",
                  options: [
                    { value: "", label: "Default camera" },
                    ...cameras.map((item, index) => ({
                      value: item.deviceId,
                      label: item.label || `Camera ${index + 1}`,
                    })),
                  ],
                },
              ]}
              disabled={disabled}
              onValueChange={(device) => {
                setCamera(device);
                void start(device);
              }}
            />
          )}
          {phase === "idle" ? (
            <Button
              shape="capsule"
              disabled={disabled || !community}
              onClick={() => void start()}
            >
              Start camera
            </Button>
          ) : (
            <Button
              shape="capsule"
              variant="prominent"
              disabled={disabled}
              onClick={() => void record()}
            >
              Record 3 seconds
            </Button>
          )}
        </div>
      )}
      {phase === "review" && (
        <>
          {!segmented && (
            <p className="text-body-sm">
              Background removal was unavailable. Your camera background is
              included.
            </p>
          )}
          <div className={styles.tools}>
            {(
              [
                ["You", UserIcon],
                ["Background", PaletteIcon],
                ["Frame", ImageIcon],
              ] as const
            ).map(([label, Icon]) => (
              <div key={label}>
                <IconButton
                  aria-label={label}
                  shape="round"
                  size="large"
                  variant={section === label ? "solid" : "subtle"}
                  aria-pressed={section === label}
                  icon={<Icon />}
                  onClick={() => {
                    setSection(label);
                  }}
                />
                <span className="text-caption">{label}</span>
              </div>
            ))}
            <div>
              <IconButton
                aria-label="Retake the recording"
                shape="round"
                size="large"
                variant="subtle"
                icon={<VideoCameraIcon />}
                onClick={() => void start()}
                disabled={disabled}
              />
              <span className="text-caption">Retake</span>
            </div>
          </div>
          {section === "Background" && (
            <div className={styles.controls}>
              <fieldset
                className={styles.colorRow}
                ref={(row) => {
                  if (!row) return;
                  row.addEventListener("wheel", scrollAvatarPalette, {
                    passive: false,
                  });
                  return () =>
                    row.removeEventListener("wheel", scrollAvatarPalette);
                }}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse" && event.button === 0)
                    colorDrag.current = {
                      x: event.clientX,
                      left: event.currentTarget.scrollLeft,
                    };
                }}
                onPointerMove={(event) => {
                  if (!event.buttons || !colorDrag.current) return;
                  const distance = event.clientX - colorDrag.current.x;
                  if (
                    Math.abs(distance) < 4 &&
                    !event.currentTarget.hasPointerCapture(event.pointerId)
                  )
                    return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  event.currentTarget.scrollLeft =
                    colorDrag.current.left - distance;
                }}
                onPointerUp={() => {
                  colorDrag.current = null;
                }}
                onPointerCancel={() => {
                  colorDrag.current = null;
                }}
                aria-label="Background colors"
              >
                {[null, ...avatarColors].map((color) => (
                  <button
                    key={color ?? "clear"}
                    type="button"
                    className={editorStyles.swatch}
                    data-transparent={color === null || undefined}
                    aria-label={color ?? "Transparent background"}
                    aria-pressed={composition.backdropColor === color}
                    style={{ backgroundColor: color ?? "transparent" }}
                    onClick={() =>
                      setComposition({ ...composition, backdropColor: color })
                    }
                  />
                ))}
              </fieldset>
            </div>
          )}
          {section === "You" && (
            <div className={styles.framing}>
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
              <IconButton
                shape="round"
                variant="outline"
                size="large"
                aria-label="Outline"
                title={
                  composition.personOutline
                    ? "Turn outline off"
                    : "Turn outline on"
                }
                aria-pressed={composition.personOutline}
                icon={
                  <span aria-hidden="true" className={styles.outlineGlyph} />
                }
                onClick={() =>
                  setComposition({
                    ...composition,
                    personOutline: !composition.personOutline,
                  })
                }
              />
            </div>
          )}
          {section === "Frame" && (
            <div className={styles.controls}>
              <div className={styles.filmstrip}>
                {frames.current
                  .filter(
                    (_, i) => i % Math.ceil(frames.current.length / 8) === 0,
                  )
                  .map((frame) => {
                    const i = frames.current.indexOf(frame);
                    return (
                      <button
                        type="button"
                        key={i}
                        aria-label={`Choose frame ${i + 1}`}
                        aria-pressed={poster === i}
                        onClick={() => {
                          setPoster(i);
                        }}
                      >
                        <canvas
                          width={ANIMATED_AVATAR_SIZE}
                          height={ANIMATED_AVATAR_SIZE}
                          ref={(node) => {
                            const ctx = node?.getContext("2d");
                            if (ctx)
                              composeAvatarFrame(ctx, frame, composition);
                          }}
                        />
                      </button>
                    );
                  })}
              </div>
              <label className="text-label-sm">
                Still frame
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, frames.current.length - 1)}
                  step={1}
                  value={poster}
                  onChange={(event) => {
                    setPoster(Number(event.target.value));
                  }}
                />
              </label>
            </div>
          )}
          <Button
            variant="prominent"
            disabled={disabled || !community}
            onClick={() => void save()}
          >
            Use animated avatar
          </Button>
        </>
      )}
      {phase === "saving" && (
        <p role="status" className="text-body-sm">
          Uploading animated avatar…
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
