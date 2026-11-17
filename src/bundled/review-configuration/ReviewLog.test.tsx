// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { RelaySession } from "../../features/relay/session";
import { ReviewLog } from "./ReviewLog";
import { loadReviewLog, loadLogMessages } from "./review-log";
vi.mock("./review-log", () => ({
  loadReviewLog: vi.fn(),
  loadLogMessages: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const session = {
  profiles: { snapshot: () => new Map() },
} as unknown as RelaySession;
it("bounds root batches, retains each pagination cursor, and refreshes on reopening under StrictMode", async () => {
  const roots = Array.from({ length: 240 }, (_, i) => String(i));
  vi.mocked(loadReviewLog).mockResolvedValue({
    entries: [],
    roots,
    more: false,
  });
  vi.mocked(loadLogMessages).mockImplementation(
    async (_s, _c, batch, _signal, cursor) => ({
      entries: [],
      cursor: cursor ? undefined : { until: 10, before_id: batch[0] ?? "" },
    }),
  );
  render(
    <StrictMode>
      <ReviewLog
        session={session}
        channel="channel"
        repository="example-org/project"
        pr={1}
      />
    </StrictMode>,
  );
  const user = userEvent.setup();
  expect(loadReviewLog).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Log" }));
  await waitFor(() =>
    expect(screen.queryByText("Loading review log…")).toBeNull(),
  );
  expect(
    vi
      .mocked(loadLogMessages)
      .mock.calls.every((call) => call[2].length <= 100),
  ).toBe(true);
  for (let i = 0; i < 3; i++)
    await user.click(
      screen.getByRole("button", { name: "Load earlier messages" }),
    );
  await screen.findByText("All available events loaded.");
  expect(
    vi
      .mocked(loadLogMessages)
      .mock.calls.filter((call) => call[4])
      .map((call) => call[4]?.before_id),
  ).toEqual(["0", "100", "200"]);
  const count = vi.mocked(loadReviewLog).mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Log" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Review timeline" }),
    ).toBeNull(),
  );
  await user.click(screen.getByRole("button", { name: "Log" }));
  await waitFor(() =>
    expect(vi.mocked(loadReviewLog).mock.calls.length).toBeGreaterThan(count),
  );
});
it("keeps a failed page retryable", async () => {
  vi.mocked(loadReviewLog)
    .mockRejectedValueOnce(new Error("Log read failed"))
    .mockResolvedValue({ entries: [], roots: [], more: false });
  render(
    <ReviewLog
      session={session}
      channel="channel"
      repository="example-org/project"
      pr={1}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Log" }));
  await screen.findByText("Log read failed");
  await user.click(screen.getByRole("button", { name: "Load earlier events" }));
  await screen.findByText("All available events loaded.");
});

it("replaces an open log on resubmission and ignores the previous in-flight read", async () => {
  let finish!: (page: Awaited<ReturnType<typeof loadReviewLog>>) => void;
  vi.mocked(loadReviewLog)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ entries: [], roots: [], more: false });
  const view = render(
    <ReviewLog
      session={session}
      channel="channel"
      repository="example-org/project"
      pr={1}
      scope={{ id: "old", startedAt: 1 }}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Log" }));
  await screen.findByText("Loading review log…");
  const oldSignal = vi.mocked(loadReviewLog).mock.calls[0]?.[5];
  view.rerender(
    <ReviewLog
      session={session}
      channel="channel"
      repository="example-org/project"
      pr={1}
      scope={{ id: "new", startedAt: 2 }}
    />,
  );
  await screen.findByText("All available events loaded.");
  expect(oldSignal?.aborted).toBe(true);
  expect(vi.mocked(loadReviewLog).mock.lastCall?.[6]).toEqual({
    id: "new",
    startedAt: 2,
  });
  await act(async () =>
    finish({
      entries: [
        {
          event: {
            id: "stale",
            kind: 9,
            pubkey: "author",
            created_at: 1,
            tags: [],
            content: "",
          },
          title: "Old submission event",
          detail: "",
        },
      ],
      roots: [],
      more: false,
    }),
  );
  expect(screen.queryByText(/Old submission event/)).toBeNull();
});
