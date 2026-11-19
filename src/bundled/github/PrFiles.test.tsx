// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PrFiles } from "./PrFiles";
import { createInlineDraft } from "./inline-draft";
import { createPrComments, type Comment, type Thread } from "./pr-comments";
import {
  fixturePull,
  githubCommentHost,
} from "../../../tests/fixtures/github-comment-host";

// Keep thread rows outside the renderer: this test exercises async panel ownership.
vi.mock("../diffs/DiffViewer", () => ({ DiffViewer: () => null }));

it("discards a reply page that completes after a new snapshot replaces its owner", async () => {
  const fixture = githubCommentHost();
  const transport = createPrComments(fixture.host);
  if (!transport) throw new Error("Missing adapter");
  const snapshot = await transport.loadSnapshot(fixturePull);
  const comment: Comment = {
    id: "first",
    databaseId: 1,
    body: "First page",
    author: "reviewer",
    url: "https://github.com/example-org/sample/pull/1#discussion_r1",
    createdAt: "2026-01-01T00:00:00Z",
    commit: snapshot.head,
    originalCommit: snapshot.head,
  };
  const thread: Thread = {
    id: "thread",
    path: "src/example.ts",
    side: "RIGHT",
    line: 5001,
    originalLine: 5001,
    outdated: false,
    resolved: false,
    rootCommentId: 1,
    comments: [comment],
    commentsComplete: false,
    commentsCursor: "page-2",
  };
  let release!: (value: { items: Comment[]; nextCursor: null }) => void;
  const page = new Promise<{ items: Comment[]; nextCursor: null }>(
    (resolve) => {
      release = resolve;
    },
  );
  const loadSnapshot = vi.fn().mockResolvedValue(snapshot);
  const loadComments = vi.fn().mockReturnValue(page);
  const api = {
    ...transport,
    loadSnapshot,
    loadComments,
    loadThreads: vi.fn().mockResolvedValue({
      items: [thread],
      head: snapshot.head,
      base: snapshot.base,
      nextCursor: null,
    }),
  };
  render(
    <PrFiles
      api={api}
      pull={fixturePull}
      head={snapshot.head}
      base={snapshot.base}
      draft={createInlineDraft()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Load more replies" }),
  );
  expect(loadComments).toHaveBeenCalledWith("thread", "page-2");
  // A refresh gets a distinct verified object even when the refs did not move.
  loadSnapshot.mockResolvedValue({ ...snapshot });
  fireEvent.click(screen.getByRole("button", { name: "Refresh changes" }));
  await screen.findByText("First page");
  await act(async () => {
    release({
      items: [{ ...comment, id: "late", body: "Late old page" }],
      nextCursor: null,
    });
  });
  expect(screen.queryByText("Late old page")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Load more replies" }),
  ).toBeTruthy();
});
