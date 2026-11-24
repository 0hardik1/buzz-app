import type { ReactNode } from "react";
import { BellIcon } from "../../../shared/design-system/icons";
import styles from "./WelcomeTour.module.css";

/*
 * Small decorative drawings for the welcome tour's cards: a conversation, a
 * list or the search field. They hide from assistive tech, so each card's copy
 * carries the meaning. Motion loops on one shared timeline; reduced motion
 * holds the finished frame.
 */

export function Scene({
  children,
  still = false,
}: {
  children: ReactNode;
  /** Hold one frame instead of looping, for a drawing that only sets context. */
  still?: boolean;
}) {
  return (
    <div
      className={styles.scene}
      data-still={still ? "" : undefined}
      aria-hidden="true"
    >
      <div className={styles.stage}>{children}</div>
    </div>
  );
}

/** A conversation or list: a title bar, then its rows. */
export function Sketch({
  header,
  children,
}: {
  /** Shown with the title, such as a Bell. */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.sketch}>
      <div className={styles.header}>
        <span className={styles.bar} />
        {header}
      </div>
      {children}
    </div>
  );
}

export function Row({
  lead = "channel",
  tone = "neutral",
  enter,
  trail,
}: {
  /** The leading mark: a channel, a person (circle) or an agent (squircle). */
  lead?: "channel" | "person" | "agent";
  /** Accent marks the row the drawing is about. */
  tone?: "neutral" | "accent";
  /** Arrive on the timeline; the step staggers rows that arrive together. */
  enter?: 1 | 2 | 3;
  /** A control at the row's end, such as a Switch. */
  trail?: ReactNode;
}) {
  return (
    <span className={styles.row} data-tone={tone} data-enter={enter}>
      <span className={styles.lead} data-lead={lead} />
      <span className={styles.bar} />
      {trail != null && <span className={styles.trail}>{trail}</span>}
    </span>
  );
}

/** The bell before a title, ringing once as the first item arrives. */
export function Bell() {
  return <BellIcon className={styles.bell} />;
}

/** An on/off switch; flip turns on during the loop. */
export function Switch({ state = "off" }: { state?: "off" | "on" | "flip" }) {
  return (
    <span className={styles.switch} data-state={state}>
      <span className={styles.knob} />
    </span>
  );
}

/** The search field: an agent's face unless agent is false, then a question typing itself out. */
export function Search({ agent = true }: { agent?: boolean }) {
  return (
    <span className={styles.search} data-agent={agent}>
      {agent && <span className={styles.face} />}
      <span className={styles.typed} />
    </span>
  );
}
