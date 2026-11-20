import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import {
  threadPlacementPreference,
  useThreadPlacementPreference,
} from "./thread-preferences";

/** A composer's name, the way its draft is named: the channel's own composer
 * or a thread's reply box. Containers record the composer they open over by
 * name, so they follow it wherever it is shown. */
export type ComposerName = string;
export const channelComposer = (channelId: string): ComposerName =>
  `channel:${channelId}`;
export const threadComposer = (
  channelId: string,
  rootId: string,
): ComposerName => `thread:${channelId}:${rootId}`;
/** The channel a composer writes to. */
export const composerChannel = (name: ComposerName) => name.split(":")[1] ?? "";

/** The composer the content below writes with. Rows read it to name where
 * what they open goes; it never changes while they are mounted. */
export const ComposerScope = createContext<ComposerName | undefined>(undefined);
export const useComposerName = () => useContext(ComposerScope);

/** Where a composer is on screen, only so a sheet can be drawn around it. */
export type ComposerOverlayHost = Readonly<{
  composer: HTMLElement;
  pane: HTMLElement;
  /** Layout bounds may exceed the source reader for expanded media. */
  viewport: HTMLElement;
  container: HTMLElement;
}>;
export type MediaReviewOrigin = Readonly<{
  host: ComposerOverlayHost | null;
  rootId: string;
}>;
// The last composer to register a name is the one shown under it.
const hosts = new Map<ComposerName, HTMLElement[]>();
const hostListeners = new Set<() => void>();
let hostsVersion = 0;
function hostsChanged() {
  hostsVersion += 1;
  for (const listener of hostListeners) listener();
}

/** The registered composer named `name`, wherever it is now. */
export function composerHost(
  name: ComposerName | undefined,
): ComposerOverlayHost | null {
  const composer = name ? hosts.get(name)?.at(-1) : undefined;
  if (!composer?.isConnected) return null;
  const pane =
    composer.closest<HTMLElement>("[data-composer-host]") ??
    composer.parentElement;
  if (!pane) return null;
  return {
    composer,
    pane,
    viewport: pane,
    // A composer inside a sheet portals the next sheet outside that filtered
    // sheet, resolved from its live ancestry.
    container:
      pane.closest<HTMLElement>("[data-details-sheet]")?.parentElement ?? pane,
  };
}

/** Where something opened with `name`'s composer goes inline. Readers open
 * over their conversation only with the Inline setting; without a host, each
 * surface opens its tab, dialog or fullscreen viewer instead. */
export function overlayHost(
  name: ComposerName | undefined,
): ComposerOverlayHost | null {
  if (threadPlacementPreference() !== "inline") return null;
  return composerHost(name);
}

export function registerOverlayComposer(
  name: ComposerName,
  composer: HTMLElement,
) {
  hosts.set(name, [...(hosts.get(name) ?? []), composer]);
  hostsChanged();
  return () => {
    const rest = (hosts.get(name) ?? []).filter((item) => item !== composer);
    if (rest.length) hosts.set(name, rest);
    else hosts.delete(name);
    hostsChanged();
  };
}

function subscribeHosts(listener: () => void) {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}
/** Changes whenever a composer registers or leaves. */
export function useComposerHosts() {
  return useSyncExternalStore(
    subscribeHosts,
    () => hostsVersion,
    () => hostsVersion,
  );
}

/** Whether a reader opened with `name`'s composer opens on its sheet, as
 * composers come and go and the placement setting changes. */
export function useOpensOnSheet(
  name: ComposerName | null | undefined,
): boolean {
  const { placement } = useThreadPlacementPreference();
  useComposerHosts();
  return placement === "inline" && !!name && !!composerHost(name);
}

export function useOverlayComposerRef(ref: RefObject<HTMLFormElement | null>) {
  const name = useComposerName();
  return useCallback(
    (element: HTMLFormElement | null) => {
      ref.current = element;
      if (!element) return;
      const release = name ? registerOverlayComposer(name, element) : undefined;
      return () => {
        release?.();
        ref.current = null;
      };
    },
    [ref, name],
  );
}

/** Resolves once no composer within `root` is sending, or `root` leaves the
 * page: unmounting a composer cancels its send. */
export function composerSettled(root: HTMLElement): Promise<void> {
  const busy = () =>
    root.isConnected &&
    !!root.querySelector('[data-message-composer][aria-busy="true"]');
  if (!busy()) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (busy()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(root.ownerDocument.body, {
      subtree: true,
      childList: true,
      attributeFilter: ["aria-busy"],
    });
  });
}
