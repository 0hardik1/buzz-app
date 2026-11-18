import { Viewer } from "../file-viewer/Viewer";
import { fileFormat } from "../file-viewer/formats";
import { canvasFile } from "../../features/home/canvas-files";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useMotionValue,
  useVelocity,
  useTransform,
  useSpring,
  useMotionValueEvent,
} from "motion/react";
import { SurfaceButton } from "../../shared/design-system/ui/SurfaceButton";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  MenuPopup,
  MenuItem,
} from "../../shared/design-system/ui/Menu";
import { Panel } from "../../shared/design-system/ui/Panel";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Button } from "../../shared/design-system/ui/Button";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { MediaAttachment } from "../../features/messages/MediaAttachment";
import { AudioAttachment } from "../../features/messages/AudioAttachment";
import { FileTypeIcon } from "../../features/messages/FileTypeIcon";
import { formatFileSize } from "../../features/messages/FileAttachment";
import type { CanvasObject as ObjectValue, Point } from "./canvas-state";
import styles from "./HomeCanvas.module.css";

type CanvasObjectProps = {
  object: ObjectValue;
  scale: number;
  move(point: Point): boolean;
  remove(): void;
  children: ReactNode;
  image?: boolean;
  actions?: ReactNode;
};

export function CanvasObject({
  object,
  scale,
  move,
  remove,
  children,
  image,
  actions,
}: CanvasObjectProps) {
  const element = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    point: Point;
    pointerId: number;
  }>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement>();
  const [reducedMotion, setReducedMotion] = useState(
    () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(!!media?.matches);
    media?.addEventListener("change", update);
    return () => media?.removeEventListener("change", update);
  }, []);
  const dragX = useMotionValue(0);
  const velocity = useVelocity(dragX);
  const targetTilt = useTransform(velocity, [-1000, 0, 1000], [-5, 0, 5]);
  const tilt = useSpring(targetTilt, {
    stiffness: 600,
    damping: 40,
    mass: 0.7,
  });
  useMotionValueEvent(tilt, "change", (angle) => {
    if (surface.current && !reducedMotion)
      surface.current.style.transform =
        Math.abs(angle) < 0.01 && !drag.current
          ? ""
          : `rotate(${angle}deg) scale(${drag.current ? 1.01 : 1})`;
  });
  useEffect(() => {
    if (reducedMotion && surface.current) surface.current.style.transform = "";
  }, [reducedMotion]);
  const cancel = () => {
    if (!drag.current) return;
    drag.current = undefined;
    dragX.jump(0);
    tilt.jump(0);
    if (element.current) {
      element.current.style.transform = `translate(${object.x}px, ${object.y}px)`;
      element.current.style.zIndex = "";
    }
    if (surface.current) surface.current.style.transform = "";
  };
  return (
    <ContextMenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
      <section
        ref={element}
        className={styles.object}
        data-canvas-object=""
        data-kind={object.kind}
        data-image={image || undefined}
        style={{ transform: `translate(${object.x}px, ${object.y}px)` }}
        aria-label={object.name}
      >
        <Panel as="div" ref={surface} shape="card" data-home-card-surface="">
          <div className={image ? styles.imageInset : styles.cardInset}>
            <ContextMenuTrigger
              render={
                <SurfaceButton
                  className={image ? styles.imageHeader : styles.objectHeader}
                  aria-label={`Move ${object.name}; use arrow keys to adjust`}
                  onContextMenu={() => setMenuAnchor(undefined)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10")
                    ) {
                      event.preventDefault();
                      setMenuAnchor(event.currentTarget);
                      setMenuOpen(true);
                      return;
                    }
                    if (event.key === "Escape" && drag.current) {
                      event.preventDefault();
                      cancel();
                      return;
                    }
                    if (event.key === "Delete") {
                      event.preventDefault();
                      remove();
                      return;
                    }
                    if (event.metaKey || event.ctrlKey || event.altKey) return;
                    const delta = (
                      {
                        ArrowLeft: [-16, 0],
                        ArrowRight: [16, 0],
                        ArrowUp: [0, -16],
                        ArrowDown: [0, 16],
                      } as const
                    )[event.key as "ArrowLeft"];
                    if (!delta) return;
                    event.preventDefault();
                    dragX.jump(0);
                    tilt.jump(0);
                    if (surface.current) surface.current.style.transform = "";
                    move({ x: object.x + delta[0], y: object.y + delta[1] });
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.ctrlKey || drag.current)
                      return;
                    event.stopPropagation();
                    dragX.jump(0);
                    tilt.jump(0);
                    if (surface.current && !reducedMotion)
                      surface.current.style.transform = "scale(1.01)";
                    if (element.current) element.current.style.zIndex = "2";
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {
                      x: event.clientX,
                      y: event.clientY,
                      point: object,
                      pointerId: event.pointerId,
                    };
                  }}
                  onPointerMove={(event) => {
                    const start = drag.current;
                    if (
                      start?.pointerId !== event.pointerId ||
                      !element.current
                    )
                      return;
                    const dx = (event.clientX - start.x) / scale;
                    element.current.style.transform = `translate(${start.point.x + dx}px, ${start.point.y + (event.clientY - start.y) / scale}px)`;
                    if (!reducedMotion) dragX.set(dx);
                  }}
                  onPointerUp={(event) => {
                    const start = drag.current;
                    if (start?.pointerId !== event.pointerId) return;
                    drag.current = undefined;
                    dragX.jump(0);
                    if (element.current) element.current.style.zIndex = "";
                    if (surface.current)
                      surface.current.style.transform =
                        !reducedMotion && Math.abs(tilt.get()) >= 0.01
                          ? `rotate(${tilt.get()}deg)`
                          : "";
                    if (
                      !move({
                        x: start.point.x + (event.clientX - start.x) / scale,
                        y: start.point.y + (event.clientY - start.y) / scale,
                      }) &&
                      element.current
                    )
                      element.current.style.transform = `translate(${object.x}px, ${object.y}px)`;
                  }}
                  onPointerCancel={(event) => {
                    if (drag.current?.pointerId === event.pointerId) cancel();
                  }}
                  onLostPointerCapture={(event) => {
                    if (drag.current?.pointerId === event.pointerId) cancel();
                  }}
                />
              }
            >
              {image ? (
                children
              ) : (
                <span className="text-label-sm">{object.name}</span>
              )}
            </ContextMenuTrigger>
            {!image && <div className={styles.objectBody}>{children}</div>}
          </div>
        </Panel>
      </section>
      <MenuPopup anchor={menuAnchor} size="compact">
        {actions}
        <MenuItem tone="danger" onClick={remove}>
          Remove {object.name}
        </MenuItem>
      </MenuPopup>
    </ContextMenuRoot>
  );
}

export function ClockWidget({ timezone }: { timezone?: string } = {}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const parts = new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).formatToParts(now);
  const period = parts.find((part) => part.type === "dayPeriod")?.value;
  const time = parts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  return (
    <div className={styles.stack}>
      <time className="text-display" dateTime={now.toISOString()}>
        {time}
      </time>
      <p className="text-caption text-subtle">
        {period ? `${period} · ` : ""}
        {now.toLocaleDateString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: timezone,
        })}
      </p>
    </div>
  );
}

export function LocalFile({
  scope,
  ...props
}: { scope: string } & Omit<
  CanvasObjectProps,
  "children" | "image" | "actions"
>) {
  const { object } = props;
  const [result, setResult] = useState<{
    file?: File;
    url?: string;
    error?: string;
  }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    void retry;
    let alive = true;
    let url: string | undefined;
    setResult(undefined);
    void canvasFile(scope, object.id).then(
      (file) => {
        if (!alive) return;
        if (!file) {
          setResult({ error: "This file is unavailable on this device." });
          return;
        }
        url = URL.createObjectURL(file);
        setResult({ file, url });
      },
      (error) => {
        if (alive)
          setResult({
            error:
              error instanceof Error
                ? error.message
                : "The file could not be opened.",
          });
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [scope, object.id, retry]);
  const file = result?.file;
  const url = result?.url;
  const format = file ? fileFormat(object.name, file.type) : undefined;
  const kind = file?.type.startsWith("image/")
    ? "image"
    : file?.type.startsWith("audio/")
      ? "audio"
      : file?.type.startsWith("video/")
        ? "video"
        : "file";
  return (
    <CanvasObject
      {...props}
      image={kind === "image"}
      actions={
        file && url ? (
          <MenuItem
            nativeButton={false}
            render={<a href={url} download={object.name} />}
          >
            Save a copy
          </MenuItem>
        ) : undefined
      }
    >
      <LoadingRegion
        pending={!result}
        statusVisibility="screen-reader"
        label="Opening file…"
        feedback={
          result?.error ? (
            <div role="alert">
              <p className="text-body">{result.error}</p>
              <Button size="sm" onClick={() => setRetry((value) => value + 1)}>
                Retry
              </Button>
            </div>
          ) : undefined
        }
      >
        {file && url && (
          <div className={styles.stack}>
            {kind === "image" ? (
              <img
                className={styles.canvasImage}
                src={url}
                alt={object.name}
                draggable={false}
                onError={() =>
                  setResult({
                    error:
                      "This image could not be displayed. Try opening it again.",
                  })
                }
              />
            ) : kind === "video" ? (
              <MediaAttachment
                attachment={{ url, name: object.name, mime: file.type, kind }}
                media={() => url}
                preload="none"
              />
            ) : kind === "audio" ? (
              <AudioAttachment
                attachment={{ url, name: object.name, mime: file.type, kind }}
                source={url}
              />
            ) : format ? null : (
              <InlineHeader
                title={object.name}
                icon={<FileTypeIcon name={object.name} mime={file.type} />}
                subtitle={formatFileSize(file.size)}
              />
            )}
            {kind === "file" && format && (
              <div className={styles.filePreview}>
                <Viewer
                  file={{ url, name: object.name, mime: file.type, format }}
                  source={url}
                  openLink={() => false}
                />
              </div>
            )}
          </div>
        )}
      </LoadingRegion>
    </CanvasObject>
  );
}
