import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import { safeLinkUrl } from "../../features/relay/message-content";
import { parseBuzzLink } from "../../features/navigation/buzz-links";
import {
  readView,
  writeView,
  subscribeView,
  viewRevision,
} from "../../shared/view-state";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  MenuPopup,
  MenuItem,
} from "../../shared/design-system/ui/Menu";
import { LinkIcon } from "../../shared/design-system/icons";

/** Bookmarks remain device-local until the signed navigation schema supports URLs. */
const KEY = "navigation-section-links:v1";
type RailLink = { section: string; url: string; label: string };
const safeUrl = (value: string) =>
  value.length <= 8192
    ? (safeLinkUrl(value) ?? (parseBuzzLink(value) ? value : undefined))
    : undefined;
function read(scope: string): RailLink[] {
  const raw = readView<unknown>(scope, KEY, []);
  return Array.isArray(raw)
    ? raw.flatMap((item) => {
        if (
          !item ||
          typeof item.section !== "string" ||
          typeof item.url !== "string" ||
          typeof item.label !== "string"
        )
          return [];
        const url = safeUrl(item.url);
        return url
          ? [
              {
                section: item.section,
                url,
                label: item.label.slice(0, 256) || url,
              },
            ]
          : [];
      })
    : [];
}
export function forgetRailLinks(scope: string, section: string) {
  const current = read(scope);
  if (current.some((item) => item.section === section))
    writeView(
      scope,
      KEY,
      current.filter((item) => item.section !== section),
    );
}
function droppedLinks(transfer: DataTransfer): Omit<RailLink, "section">[] {
  const html = transfer.getData("text/html").slice(0, 65536);
  // A template keeps dragged markup inert, including images and frames.
  const template = document.createElement("template");
  template.innerHTML = html;
  const anchors = [...template.content.querySelectorAll("a[href]")].slice(
    0,
    32,
  );
  const titles = new Map(
    anchors.flatMap((anchor) => {
      const url = safeUrl(anchor.getAttribute("href") ?? "");
      return url
        ? [
            [
              url,
              anchor.textContent?.replace(/\s+/g, " ").trim() ?? "",
            ] as const,
          ]
        : [];
    }),
  );
  const moz = transfer.getData("text/x-moz-url").split(/\r?\n/);
  const uris = transfer.getData("text/uri-list");
  const values = uris
    ? uris.split(/\r?\n/).filter((line) => !line.startsWith("#"))
    : moz[0]
      ? [moz[0]]
      : anchors.length
        ? [...titles.keys()]
        : [transfer.getData("text/plain")];
  const seen = new Set<string>();
  return values.slice(0, 32).flatMap((value) => {
    const url = safeUrl(value?.trim() ?? "");
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const parsed = new URL(url);
    const label =
      titles.get(url) ||
      (url === safeUrl(moz[0] ?? "") && moz[1]?.trim()) ||
      `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}` ||
      url;
    return [{ url, label: label.slice(0, 256) }];
  });
}
export function useRailLinks(scope: string, section: string, enabled: boolean) {
  const subscribe = useCallback(
    (notify: () => void) => subscribeView(scope, notify),
    [scope],
  );
  const revision = useSyncExternalStore(
    subscribe,
    () => viewRevision(scope, KEY),
    () => undefined,
  );
  const links = useMemo(
    () =>
      revision === undefined
        ? []
        : read(scope).filter((item) => item.section === section),
    [scope, section, revision],
  );
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const save = (next: RailLink[]) =>
    setError(
      writeView(scope, KEY, next)
        ? ""
        : "Couldn’t save this link on this device. Try again.",
    );
  const supported = (event: DragEvent) =>
    enabled &&
    !event.dataTransfer.types.includes("Files") &&
    event.dataTransfer.types.some((type) =>
      ["text/uri-list", "text/x-moz-url", "text/html", "text/plain"].includes(
        type,
      ),
    );
  return {
    links,
    over: enabled && over,
    error,
    remove(url: string) {
      save(
        read(scope).filter(
          (item) => item.section !== section || item.url !== url,
        ),
      );
    },
    handlers: {
      onDragOver(event: DragEvent) {
        if (!supported(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      },
      onDragLeave(event: DragEvent) {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOver(false);
      },
      onDrop(event: DragEvent) {
        setOver(false);
        if (!supported(event)) return;
        const dropped = droppedLinks(event.dataTransfer);
        if (!dropped.length) return;
        event.preventDefault();
        event.stopPropagation();
        const current = read(scope);
        const existing = new Set(
          current
            .filter((item) => item.section === section)
            .map((item) => item.url),
        );
        save([
          ...current,
          ...dropped
            .filter((item) => !existing.has(item.url))
            .map((item) => ({ ...item, section })),
        ]);
      },
    },
  };
}
export function RailLinkRow({
  link,
  remove,
}: {
  link: RailLink;
  remove(): void;
}) {
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger render={<div />}>
        <NavigationItem
          role="link"
          nativeButton={false}
          render={
            <a href={link.url} target="_blank" rel="noopener noreferrer" />
          }
          label={link.label}
          title={link.url}
          icon={<LinkIcon size={18} />}
        />
      </ContextMenuTrigger>
      <MenuPopup>
        <MenuItem onClick={remove}>Remove link</MenuItem>
      </MenuPopup>
    </ContextMenuRoot>
  );
}
