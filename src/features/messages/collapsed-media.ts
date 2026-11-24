import { readView, subscribeView, writeView } from "../../shared/view-state";

const viewKey = "collapsed-media";
const limit = 500;
const pageGroups = new Map<string | undefined, string[]>();
const pageChanges = new EventTarget();
const pageEvent = (scope: string | undefined) => JSON.stringify([scope]);

function groups(scope: string | undefined): string[] {
  const unsaved = pageGroups.get(scope);
  if (unsaved) return unsaved;
  if (scope === undefined) return [];
  const saved = readView<unknown>(scope, viewKey, []);
  return Array.isArray(saved)
    ? saved.filter((key): key is string => typeof key === "string")
    : [];
}

export function mediaCollapsed(scope: string | undefined, key: string) {
  return groups(scope).includes(key);
}

export function setMediaCollapsed(
  scope: string | undefined,
  key: string,
  collapsed: boolean,
) {
  const saved = groups(scope);
  if (saved.includes(key) === collapsed) return;
  const next = collapsed
    ? [...saved.slice(1 - limit), key]
    : saved.filter((group) => group !== key);
  // A successful write notifies synchronously. Its readers must see the saved list.
  pageGroups.delete(scope);
  if (scope !== undefined && writeView(scope, viewKey, next)) return;
  pageGroups.set(scope, next);
  pageChanges.dispatchEvent(new Event(pageEvent(scope)));
}

export function subscribeCollapsedMedia(
  scope: string | undefined,
  listener: () => void,
) {
  const stop =
    scope === undefined
      ? undefined
      : subscribeView(
          scope,
          () => {
            pageGroups.delete(scope);
            listener();
          },
          viewKey,
        );
  pageChanges.addEventListener(pageEvent(scope), listener);
  return () => {
    stop?.();
    pageChanges.removeEventListener(pageEvent(scope), listener);
  };
}
