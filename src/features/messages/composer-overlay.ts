import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  threadPlacementPreference,
  useThreadPlacementPreference,
} from "./thread-preferences";

/** An explicitly marked reader owns its composer and overlay placement. */
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
const hosts = new WeakMap<HTMLElement, ComposerOverlayHost>();
const hostListeners = new Set<() => void>();
function hostsChanged() {
  for (const listener of hostListeners) listener();
}

/** The renderer marks its reader boundary; styling never chooses ownership.
 * Readers open over their conversation only with the Inline setting; without
 * a host, each surface opens its tab, dialog or fullscreen viewer instead. */
export function overlayHostFor(
  origin: Element | null,
): ComposerOverlayHost | null {
  if (threadPlacementPreference() !== "inline") return null;
  const pane = origin?.closest<HTMLElement>("[data-composer-host]");
  const host = pane && hosts.get(pane);
  if (!host?.composer.isConnected) return null;
  return {
    ...host,
    // Retained readers register while detached, then move into sheets or tabs.
    // Resolve the portal from their live ancestry, outside any filtered sheet.
    container:
      host.pane.closest<HTMLElement>("[data-details-sheet]")?.parentElement ??
      host.pane,
  };
}

export function registerOverlayComposer(composer: HTMLElement) {
  const pane = composer.closest<HTMLElement>("[data-composer-host]");
  if (!pane) return () => {};
  const host = {
    composer,
    pane,
    viewport: pane,
    container: pane,
  };
  hosts.set(pane, host);
  hostsChanged();
  return () => {
    if (hosts.get(pane) !== host) return;
    hosts.delete(pane);
    hostsChanged();
  };
}

/** Whether a reader opened from `origin` opens on its conversation's sheet,
 * as hosts come and go and the placement setting changes. */
export function useOpensOnSheet(origin: Element | null): boolean {
  const { placement } = useThreadPlacementPreference();
  const [onSheet, setOnSheet] = useState(false);
  useEffect(() => {
    if (placement !== "inline" || !origin) return setOnSheet(false);
    const check = () => setOnSheet(!!overlayHostFor(origin));
    check();
    hostListeners.add(check);
    return () => {
      hostListeners.delete(check);
    };
  }, [origin, placement]);
  return onSheet;
}

export function useOverlayComposerRef(ref: RefObject<HTMLFormElement | null>) {
  return useCallback(
    (element: HTMLFormElement | null) => {
      ref.current = element;
      if (!element) return;
      const release = registerOverlayComposer(element);
      return () => {
        release();
        ref.current = null;
      };
    },
    [ref],
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

/** Accepted local sends dismiss an agent details reader attached to this editor. */
export const COMPOSER_SENT = "message-composer-sent";
/** A reader opened as a tab closes the others over its composer; the event's
 * detail is the promoted reader's id. */
export const COMPOSER_PROMOTED = "message-composer-promoted";
