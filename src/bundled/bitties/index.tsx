import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginModule } from "../../plugins/api";
import type { AgentAvatarSource } from "../../features/agents/service";
import {
  DiceIcon,
  LockIcon,
  LockOpenIcon,
} from "../../shared/design-system/icons";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { SurfaceButton } from "../../shared/design-system/ui/SurfaceButton";
import {
  bitty,
  bittyColors,
  bittyFile,
  bittySeed,
  paintBitty,
  randomBittySeed,
} from "./generated-avatars";
import styles from "./Bitties.module.css";

const variants = Array.from({ length: 12 }, (_, index) => `v${index + 1}`);
// The seed the host hands back: `name:` follows the name, `pin:` keeps it.
const following = "name:";
const pinning = "pin:";
const iconSeed = bittySeed("Bitties");

/** A Bitty painted on a canvas; its parent sets the displayed size. */
export function BittyArtwork({
  seed,
  size = 96,
}: {
  seed: string;
  size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const colors = useMemo(() => bittyColors(bitty(seed)), [seed]);
  useEffect(() => {
    if (canvas.current) paintBitty(canvas.current, colors, size);
  }, [colors, size]);
  return <canvas ref={canvas} className={styles.artwork} />;
}

/** The Bitties tab: the name's Bitty until one is pinned, then that one. */
export const Bitties: AgentAvatarSource["component"] = ({
  name,
  seed,
  disabled,
  choose,
}) => {
  const pinned = seed?.startsWith(pinning)
    ? seed.slice(pinning.length)
    : undefined;
  const named = bittySeed(name);
  const current = pinned ?? named;
  const [variant, setVariant] = useState(0);
  const [failed, setFailed] = useState(false);
  const strip = useRef<HTMLFieldSetElement>(null);
  // Encoding is async: only the newest request may reach `choose`.
  const request = useRef(0);
  const send = (next: string, pin: boolean) => {
    const token = ++request.current;
    void bittyFile(next).then(
      (file) => {
        if (token !== request.current) return;
        setFailed(false);
        choose(file, `${pin ? pinning : following}${next}`);
      },
      () => {
        if (token === request.current) setFailed(true);
      },
    );
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  // An unpinned Bitty follows the name, including after a Save unlocks.
  useEffect(() => {
    if (disabled || pinned !== undefined) return;
    if (seed !== `${following}${named}`) sendRef.current(named, false);
  }, [disabled, pinned, seed, named]);
  return (
    <div className={styles.controls}>
      <IconButton
        variant="glass"
        shape="round"
        size="sm"
        aria-label="Shuffle"
        icon={<DiceIcon aria-hidden="true" />}
        disabled={disabled}
        onClick={() => send(randomBittySeed(), true)}
      />
      <IconButton
        variant="glass"
        shape="round"
        size="sm"
        aria-label="Keep this avatar when the name changes"
        aria-pressed={pinned !== undefined}
        icon={
          pinned === undefined ? (
            <LockOpenIcon aria-hidden="true" />
          ) : (
            <LockIcon aria-hidden="true" />
          )
        }
        disabled={disabled}
        onClick={() =>
          pinned === undefined ? send(current, true) : send(named, false)
        }
      />
      {/* One Tab stop; arrows, Home and End move within the strip. */}
      <fieldset
        ref={strip}
        aria-label="Bitties for this name"
        className={styles.strip}
        onKeyDown={(event) => {
          const last = variants.length - 1;
          const next =
            event.key === "ArrowRight" || event.key === "ArrowDown"
              ? Math.min(last, variant + 1)
              : event.key === "ArrowLeft" || event.key === "ArrowUp"
                ? Math.max(0, variant - 1)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? last
                    : undefined;
          if (next === undefined) return;
          event.preventDefault();
          setVariant(next);
          strip.current?.querySelectorAll("button")[next]?.focus();
        }}
      >
        {variants.map((nonce, index) => {
          const option = bittySeed(name, nonce);
          return (
            <SurfaceButton
              key={nonce}
              className={styles.option}
              tabIndex={index === variant ? 0 : -1}
              disabled={disabled}
              onFocus={() => setVariant(index)}
              aria-label={`Bitty ${index + 1}`}
              aria-pressed={pinned === option}
              onClick={() => {
                setVariant(index);
                send(option, true);
              }}
            >
              <BittyArtwork seed={option} />
            </SurfaceButton>
          );
        })}
      </fieldset>
      {failed && (
        <p role="alert" className="m-0 text-body-sm text-danger">
          Couldn't draw this Bitty. Try another.
        </p>
      )}
    </div>
  );
};

export const bitties: AgentAvatarSource = {
  id: "bitties",
  title: "Bitties",
  icon: <BittyArtwork seed={iconSeed} />,
  component: Bitties,
};

export const inject = ["agents"];
export const apply: PluginModule["apply"] = ({ agents }) => {
  agents.registerAvatarSource(bitties);
};
