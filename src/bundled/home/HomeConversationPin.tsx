import { useRef, useState } from "react";
import { PackedAgentAvatar } from "../../features/agents/PackedAgentAvatar";
import { agentAvatars } from "../../features/agents/avatar-packs";
import type { RelaySession } from "../../features/relay/session";
import { avatarMedia } from "../../shared/avatar-source";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  MenuItem,
  MenuPopup,
} from "../../shared/design-system/ui/Menu";
import { SurfaceButton } from "../../shared/design-system/ui/SurfaceButton";
import { Tooltip } from "../../shared/design-system/ui/Tooltip";
import { pinSizes, type CanvasObject, type Point } from "./canvas-state";
import styles from "./HomeConversationPin.module.css";

export type PinPortrait = {
  id: string;
  name: string;
  picture?: string | undefined;
  agent: boolean;
};

/** An unframed conversation destination; Home owns its position and persistence. */
export function HomeConversationPin({
  object,
  label,
  portraits,
  media,
  scale,
  available,
  move,
  resize,
  open,
  remove,
}: {
  object: CanvasObject;
  label: string;
  portraits: readonly PinPortrait[];
  media: RelaySession["media"];
  scale: number;
  available: boolean;
  move(point: Point): boolean;
  resize(size: number): void;
  open(): void;
  remove(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    point: Point;
    moved: boolean;
  }>(undefined);
  const suppressClick = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement>();
  const size = object.pinSize ?? pinSizes.default;
  const reset = () => {
    drag.current = undefined;
    if (element.current)
      element.current.style.transform = `translate(${object.x}px, ${object.y}px)`;
  };
  return (
    <div
      ref={element}
      className={styles.pin}
      data-canvas-object=""
      data-home-conversation-pin=""
      style={{
        width: size,
        height: size,
        transform: `translate(${object.x}px, ${object.y}px)`,
      }}
    >
      <ContextMenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
        <ContextMenuTrigger
          className={styles.control}
          onContextMenu={() => setMenuAnchor(undefined)}
          onKeyDown={(event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              setMenuAnchor(event.currentTarget);
              setMenuOpen(true);
            }
          }}
        >
          <Tooltip content={label}>
            <SurfaceButton
              type="button"
              className={styles.control}
              aria-label={label}
              aria-disabled={!available || undefined}
              aria-description="Drag or use arrow keys to move. Right-click or press Shift+F10 for size and removal."
              onClick={(event) => {
                if (suppressClick.current && event.detail !== 0) {
                  suppressClick.current = false;
                  event.preventDefault();
                  return;
                }
                if (available) open();
              }}
              onKeyDown={(event) => {
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
                move({ x: object.x + delta[0], y: object.y + delta[1] });
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || event.ctrlKey || drag.current) return;
                suppressClick.current = false;
                drag.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  point: object,
                  moved: false,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const start = drag.current;
                if (
                  !start ||
                  start.pointerId !== event.pointerId ||
                  !element.current
                )
                  return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (!start.moved && Math.hypot(dx, dy) < 4) return;
                start.moved = true;
                suppressClick.current = true;
                element.current.style.transform = `translate(${start.point.x + dx / scale}px, ${start.point.y + dy / scale}px)`;
              }}
              onPointerUp={(event) => {
                const start = drag.current;
                if (!start || start.pointerId !== event.pointerId) return;
                drag.current = undefined;
                if (
                  start.moved &&
                  !move({
                    x: start.point.x + (event.clientX - start.x) / scale,
                    y: start.point.y + (event.clientY - start.y) / scale,
                  })
                )
                  reset();
              }}
              onPointerCancel={reset}
              onLostPointerCapture={() => {
                if (drag.current) reset();
              }}
            >
              <span className={styles.artwork} aria-hidden="true">
                {(portraits.length
                  ? portraits
                  : [{ id: object.id, name: label, agent: false }]
                )
                  .slice(0, 3)
                  .map((portrait, index, shown) => (
                    <span
                      key={portrait.id}
                      className={styles.portrait}
                      style={
                        shown.length > 1
                          ? {
                              left: `${index * 22}%`,
                              width: "56%",
                              height: "56%",
                              top: index % 2 ? "44%" : 0,
                            }
                          : undefined
                      }
                    >
                      <Portrait portrait={portrait} media={media} />
                    </span>
                  ))}
              </span>
            </SurfaceButton>
          </Tooltip>
        </ContextMenuTrigger>
        <MenuPopup anchor={menuAnchor} size="compact">
          <MenuItem
            disabled={size >= pinSizes.maximum}
            onClick={() => resize(Math.min(pinSizes.maximum, size + 32))}
          >
            Larger
          </MenuItem>
          <MenuItem
            disabled={size <= pinSizes.minimum}
            onClick={() => resize(Math.max(pinSizes.minimum, size - 32))}
          >
            Smaller
          </MenuItem>
          <MenuItem
            disabled={size === pinSizes.default}
            onClick={() => resize(pinSizes.default)}
          >
            Reset size
          </MenuItem>
          <MenuItem tone="danger" onClick={remove}>
            Remove pin
          </MenuItem>
        </MenuPopup>
      </ContextMenuRoot>
    </div>
  );
}

function Portrait({
  portrait,
  media,
}: {
  portrait: PinPortrait;
  media: RelaySession["media"];
}) {
  const pack =
    portrait.agent && portrait.picture
      ? agentAvatars.find(
          (avatar) =>
            avatar.url === portrait.picture?.split("#", 1)[0] ||
            avatar.preview === portrait.picture,
        )
      : undefined;
  const source = avatarMedia(portrait.picture, media);
  const [failed, setFailed] = useState<string>();
  if (pack) return <PackedAgentAvatar avatar={pack} />;
  if (portrait.agent && source && failed !== source)
    return (
      <img
        className={styles.image}
        src={source}
        alt=""
        draggable={false}
        onError={() => setFailed(source)}
      />
    );
  return (
    <Avatar
      src={portrait.agent ? undefined : source}
      alt=""
      fallback={portrait.name}
      shape={portrait.agent ? "squircle" : "circle"}
      size="fill"
    />
  );
}
