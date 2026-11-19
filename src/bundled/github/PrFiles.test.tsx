// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PrFiles } from "./PrFiles";
import { createInlineDelivery } from "./inline-delivery";
import { createPrComments, type Comment, type Thread } from "./pr-comments";
import {
  fixturePull,
  githubCommentHost,
} from "../../../tests/fixtures/github-comment-host";

afterEach(cleanup);

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
      delivery={createInlineDelivery()}
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

async function setupComposer() {
  const fixture = githubCommentHost();
  const api = createPrComments(fixture.host);
  if (!api) throw new Error("Missing adapter");
  const snapshot = await api.loadSnapshot(fixturePull);
  await api.create(
    snapshot,
    { ...snapshot, path: "src/example.ts", side: "RIGHT", line: 5001 },
    "Existing thread",
    "seed",
  );
  const delivery = createInlineDelivery();
  const panel = () => (
    <PrFiles
      api={api}
      pull={fixturePull}
      head={snapshot.head}
      base={snapshot.base}
      delivery={delivery}
    />
  );
  const open = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    return screen.getByRole("textbox", { name: "GitHub comment" });
  };
  return { ...fixture, panel, open, delivery };
}
it.each(["Cancel", "Escape", "refresh", "unmount"])(
  "discards unsent text on %s and reopens empty",
  async (action) => {
    const { panel, open } = await setupComposer();
    let view = render(panel());
    const input = await open();
    fireEvent.change(input, { target: { value: "Disposable text" } });
    if (action === "Cancel")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    else if (action === "Escape") fireEvent.keyDown(input, { key: "Escape" });
    else if (action === "refresh")
      fireEvent.click(screen.getByRole("button", { name: "Refresh changes" }));
    else {
      view.unmount();
      view = render(panel());
    }
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(await open()).toHaveProperty("value", "");
  },
);
it("keeps an in-flight lock and unknown receipt after cancel and remount", async () => {
  const { panel, open, state, delivery } = await setupComposer();
  state.mode = "hold";
  const view = render(panel());
  const input = await open();
  fireEvent.change(input, { target: { value: "Submitted once" } });
  const form = input.closest("form");
  if (!form) throw new Error("Missing composer");
  fireEvent.submit(form);
  await waitFor(() => expect(state.release).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  view.unmount();
  render(panel());
  expect(screen.queryByRole("textbox")).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reply" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
  state.mode = "timeout";
  await act(async () => {
    state.release?.();
  });
  await screen.findByRole("button", { name: "Check delivery" });
  expect(delivery.get().unknown).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check delivery" }));
  await screen.findByRole("link", { name: "View on GitHub" });
  expect(state.calls.filter((call) => call.args[0] === "POST")).toHaveLength(2); // seed + one submission
  expect(delivery.get().unknown).toBe(false);
});
