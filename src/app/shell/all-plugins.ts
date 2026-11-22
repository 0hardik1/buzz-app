import type { ReactNode } from "react";

/** One plugin as the All plugins popover shows it. The host builds these;
 * the popover owns layout and sorting only. */
export type AllPluginsEntry = {
  /** The plugin id, such as `buzz.reminders`; stable whether on or off. */
  key: string;
  label: string;
  /** Rendered by the host: page icon when there is a page, else the plugin icon. */
  icon: ReactNode;
  enabled: boolean;
  /** Synced pin. Pinned entries arrive in the person's order. */
  pinned: boolean;
  /** On, with a nav page: it can be opened and pinned. Otherwise switch only. */
  pinnable: boolean;
  /** Its page is the one currently open. */
  active: boolean;
  /** Absent means no switch (for example, a required plugin). */
  toggle?: { disabled: boolean; reason?: string | undefined } | undefined;
};

export type AllPluginsProps = {
  plugins: readonly AllPluginsEntry[];
  onOpen: (key: string) => void;
  onEnabledChange: (key: string, enabled: boolean) => void;
  onPinnedChange: (key: string, pinned: boolean) => void;
  /** The complete pinned order after a move. */
  onPinnedOrderChange: (keys: readonly string[]) => void;
};
