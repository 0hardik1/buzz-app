import type { Attachment, ChannelMessage } from "../relay/contracts";

export type SidelineLink = Readonly<{
  url: string;
  kind: "pull" | "issue" | "commit" | "path" | "repository";
  /** `#123`, a short sha, a file name or the repository name. */
  label: string;
  /** The link's own text when it names the target, else the repository/path. */
  title: string;
  repository: string;
}>;

/** One message worth seeing on the sideline. */
export type SidelineMarker = Readonly<{
  id: string;
  createdAt: number;
  pinned: boolean;
  media: readonly Attachment[];
  links: readonly SidelineLink[];
  excerpt: string;
}>;

const GITHUB_URL = /https:\/\/github\.com\/[^\s)<>\]"'`]+/g;
const MARKDOWN_LINK =
  /\[([^\]\n]{1,200})\]\((https:\/\/github\.com\/[^\s)]+)\)/g;

function trimUrl(value: string) {
  return value.replace(/[.,;:!?]+$/, "");
}

export function githubLink(
  value: string,
  text?: string,
): SidelineLink | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (url.hostname !== "github.com" || url.username || url.password) return;
  const [owner, repo, surface, ...rest] = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  if (!owner || !repo) return;
  const repository = `${owner}/${repo}`;
  const named = text && text !== value && !text.startsWith("http") ? text : "";
  const href = url.href;
  if (
    (surface === "pull" || surface === "issues") &&
    /^\d+$/.test(rest[0] ?? "")
  )
    return {
      url: href,
      kind: surface === "pull" ? "pull" : "issue",
      label: `#${rest[0]}`,
      title: named || repository,
      repository,
    };
  if (surface === "commit" && rest[0])
    return {
      url: href,
      kind: "commit",
      label: rest[0].slice(0, 7),
      title: named || repository,
      repository,
    };
  if ((surface === "blob" || surface === "tree") && rest.length > 1) {
    const path = rest.slice(1).join("/");
    return {
      url: href,
      kind: "path",
      label: rest.at(-1) ?? path,
      title: named || `${repo}/${path}`,
      repository,
    };
  }
  return {
    url: href,
    kind: "repository",
    label: repo,
    title: named || repository,
    repository,
  };
}

/** The GitHub links a message names, its own link text first. */
export function githubLinks(content: string): SidelineLink[] {
  const found = new Map<string, SidelineLink>();
  for (const [, text, url] of content.matchAll(MARKDOWN_LINK)) {
    const link = url && githubLink(trimUrl(url), text);
    if (link && !found.has(link.url)) found.set(link.url, link);
  }
  for (const [match] of content.matchAll(GITHUB_URL)) {
    const link = githubLink(trimUrl(match));
    if (link && !found.has(link.url)) found.set(link.url, link);
  }
  return [...found.values()];
}

/** Plain text for a short preview: link targets, Markdown marks and newlines dropped. */
export function excerpt(content: string, length = 80): string {
  const text = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_~`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length
    ? `${text.slice(0, length - 1).trimEnd()}…`
    : text;
}

/** Rows with media, GitHub links or a pin, in history order. */
export function sidelineMarkers(
  rows: readonly ChannelMessage[],
  pinned: ReadonlySet<string>,
): SidelineMarker[] {
  const markers: SidelineMarker[] = [];
  for (const row of rows) {
    if (row.membership) continue;
    const media = row.attachments.filter(
      (attachment) =>
        attachment.kind === "image" || attachment.kind === "video",
    );
    // Pull requests and issues have a state to show; other GitHub pages don't.
    const links = githubLinks(row.content).filter(
      (link) => link.kind === "pull" || link.kind === "issue",
    );
    const pin = pinned.has(row.id);
    if (!pin && !media.length && !links.length) continue;
    markers.push({
      id: row.id,
      createdAt: row.createdAt,
      pinned: pin,
      media,
      links,
      excerpt: excerpt(row.content),
    });
  }
  return markers;
}
