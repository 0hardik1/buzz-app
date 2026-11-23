import { useCallback, useState, type ReactNode } from "react";
import type { ChannelSummary } from "../../features/relay/contracts";

type Section = {
  key: string;
  rows: readonly ChannelSummary[];
  hiddenRows?: readonly ChannelSummary[];
};
type RowMenu = {
  channelId: string;
  sectionKey: string;
  anchor?: HTMLElement;
  revealed: boolean;
};

/** Sidebar-owned menu identity follows rendered placement, not a saved group id. */
export function useChannelRowMenu(
  sections: readonly Section[],
  actionsFor: (
    channel: ChannelSummary,
    sectionKey: string,
  ) => readonly ReactNode[],
) {
  const [rowMenu, setRowMenu] = useState<RowMenu>();
  // Clear during render so children cannot commit a stale portal after a move.
  // Merely masking `open` leaves the old identity able to resurrect on return.
  if (rowMenu) {
    const section = sections.find(({ key }) => key === rowMenu.sectionKey);
    const rows = rowMenu.revealed ? section?.hiddenRows : section?.rows;
    const channel = rows?.find(({ id }) => id === rowMenu.channelId);
    if (!channel || actionsFor(channel, rowMenu.sectionKey).length === 0)
      setRowMenu(undefined);
  }
  const open = useCallback(
    (
      channel: ChannelSummary,
      sectionKey: string,
      anchor?: HTMLElement,
      revealed = false,
    ) => {
      setRowMenu({
        channelId: channel.id,
        sectionKey,
        revealed,
        ...(anchor ? { anchor } : {}),
      });
    },
    [],
  );
  const close = useCallback(() => setRowMenu(undefined), []);
  return { rowMenu, open, close };
}
