import { createRoot } from "react-dom/client";
import { useState } from "react";
import { GitHubReactions } from "../../src/bundled/github/GitHubReactions";
import {
  createPrReactions,
  type ReactionGroup,
  type ReactionContent,
} from "../../src/bundled/github/pr-reactions";
import type { GitHubCli } from "../../src/bundled/github/gh";
import type { Snapshot } from "../../src/bundled/github/pr-comments";
import { GitHubComment } from "../../src/bundled/github/GitHubComment";
import { Button } from "../../src/shared/design-system/ui/Button";
import { InlineCommentForm } from "../../src/bundled/github/InlineCommentForm";
import { DiffViewer } from "../../src/bundled/diffs/DiffViewer";
import { parsePatch } from "../../src/bundled/diffs/parse";
import { fixturePatch } from "./github-comment-host";
import "@fontsource-variable/inter/wght.css";
import "../../src/shared/styles/globals.css";
import styles from "./github-comment-layout.module.css";

const pull = "https://github.com/example-org/sample/pull/1";
const snapshot: Snapshot = {
  repository: "example-org/sample",
  number: 1,
  pullId: "preview",
  viewer: "you",
  head: "a",
  base: "b",
  diff: fixturePatch,
  files: [],
};
const initialGroups: ReactionGroup[] = [
  { content: "HEART", viewerHasReacted: false, users: { totalCount: 3 } },
];
const reactionGroups = new Map<string, ReactionGroup[]>();
const previewGh: GitHubCli = async <T,>(
  query: string,
  variables: Record<string, unknown>,
) => {
  const id = String(variables.id);
  let groups = reactionGroups.get(id) ?? initialGroups;
  if (query.startsWith("mutation")) {
    const add = query.includes("addReaction");
    const content = variables.content as ReactionContent;
    const before = groups.find((group) => group.content === content);
    groups = [
      ...groups.filter((group) => group.content !== content),
      {
        content,
        viewerHasReacted: add,
        users: { totalCount: (before?.users.totalCount ?? 0) + (add ? 1 : -1) },
      },
    ];
    reactionGroups.set(id, groups);
    return {
      [add ? "addReaction" : "removeReaction"]: {
        subject: { id, reactionGroups: groups },
      },
    } as T;
  }
  return {
    viewer: { login: "you" },
    node: { id, pullRequest: { id: "preview" }, reactionGroups: groups },
  } as T;
};
const reactions = createPrReactions(previewGh);
const sample: {
  id?: string;
  author: string;
  avatar: string | undefined;
  body: string;
}[] = [
  {
    author: "alex",
    avatar: "./design-system/assets/avatar.png",
    body: "Could we give this value a more descriptive name?",
  },
  {
    author: "sam",
    avatar: undefined,
    body: "Good catch. I’ll rename it to `isAvailable`.\n\nThe behavior stays the same:\n- Existing records remain available.\n- New records use the updated check.\n\n```ts\nconst isAvailable = record.active && !record.archived;\n```\n\nSee the [implementation notes](https://example.org/notes) for details.",
  },
  {
    author: "alex",
    avatar: "./design-system/assets/avatar.png",
    body: "That reads much better, thanks! **Looks good.**",
  },
];
function Thread({
  comments,
  label,
}: {
  comments: typeof sample;
  label: string;
}) {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [localReplies, setLocalReplies] = useState<typeof sample>([]);
  return (
    <section className={styles.thread} aria-label={label}>
      {[...comments, ...localReplies].map((row, index) => {
        const comment = {
          id: row.id ?? `${label}:${index}`,
          databaseId: index + 1,
          author: row.author,
          avatarUrl: row.avatar,
          body: row.body,
          url: `${pull}#discussion_r${index + 1}`,
          createdAt: "2026-01-01T00:00:00Z",
          commit: null,
          originalCommit: null,
          reactions: initialGroups,
        };
        return (
          <GitHubComment key={comment.id} comment={comment}>
            <GitHubReactions
              api={reactions}
              snapshot={snapshot}
              comment={comment}
            />
          </GitHubComment>
        );
      })}
      {replying && (
        <InlineCommentForm
          body={body}
          busy={false}
          blocked={false}
          onChange={setBody}
          onCancel={() => {
            setReplying(false);
            setBody("");
          }}
          onSubmit={() => {
            setLocalReplies((previous) => [
              ...previous,
              {
                id: crypto.randomUUID(),
                author: "you",
                avatar: undefined,
                body,
              },
            ]);
            setReplying(false);
            setBody("");
          }}
        />
      )}
      <div className={styles.reply}>
        <Button size="sm" onClick={() => setReplying(true)}>
          Reply
        </Button>
      </div>
    </section>
  );
}
function Preview() {
  const [dark, setDark] = useState(false);
  const [narrow, setNarrow] = useState(false);
  return (
    <main
      className={styles.page}
      style={{ maxWidth: narrow ? "480px" : "1100px" }}
    >
      <h1 className="text-title">PR comments · design workbench</h1>
      <p className="text-body">
        Synthetic comments; no GitHub requests. The comment renderer is shared
        with the PR view.
      </p>
      <div className={styles.controls}>
        <Button
          size="sm"
          onClick={() => {
            document.documentElement.dataset.colorMode = dark
              ? "light"
              : "dark";
            setDark(!dark);
          }}
        >
          {dark ? "Light theme" : "Dark theme"}
        </Button>
        <Button size="sm" onClick={() => setNarrow(!narrow)}>
          {narrow ? "Wide layout" : "Narrow layout"}
        </Button>
      </div>
      <DiffViewer
        content={fixturePatch}
        files={parsePatch(fixturePatch)}
        comments={{
          readOnly: true,
          onSelect() {},
          annotations: [
            {
              path: "src/example.ts",
              side: "additions",
              lineNumber: 5000,
              content: (
                <Thread label="Discussion with replies" comments={sample} />
              ),
            },
            {
              path: "src/example.ts",
              side: "additions",
              lineNumber: 5001,
              content: (
                <Thread
                  label="Separate discussion"
                  comments={[
                    {
                      author: "taylor",
                      avatar: "./missing-avatar.png",
                      body: "One separate thought: could this check return early?",
                    },
                  ]}
                />
              ),
            },
          ],
        }}
      />
      <section className={styles.unmapped} aria-label="Outdated comments">
        <p className="text-body-sm">src/previous.ts · Old line 42 · Outdated</p>
        <Thread
          label="Outdated discussion"
          comments={[
            {
              author: "sam",
              avatar: undefined,
              body: "This feedback refers to an earlier version of the file.",
            },
          ]}
        />
      </section>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<Preview />);
