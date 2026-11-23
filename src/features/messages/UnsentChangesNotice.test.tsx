// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { getEventHash } from "nostr-tools";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import {
  createOutbox,
  PENDING_FULL,
  type OutgoingEvent,
} from "../relay/outbox";
import { keypair, signed } from "../relay/testing";
import { UnsentChangesNotice } from "./UnsentChangesNotice";

afterEach(cleanup);
const viewer = keypair();

function held(
  content: string,
  delivery: OutgoingEvent["delivery"],
  record = "plugin-state",
) {
  const event = signed(viewer, {
    kind: 30078,
    content,
    tags: [["d", record]],
  });
  return { event, signed: event, delivery, held: true as const };
}

// Unsigned saved intents keep 256 records cheap; restore checks their IDs.
function fullQueue(): OutgoingEvent[] {
  return Array.from({ length: 256 }, (_, index) => {
    const template = {
      kind: 9,
      pubkey: viewer.pubkey,
      created_at: 1_700_000_000,
      content: `message ${index}`,
      tags: [["h", "chat"]],
    };
    return {
      event: { ...template, id: getEventHash(template) },
      delivery: "unknown" as const,
      recovery: { key: `owned:${index}`, value: "" },
    };
  });
}

async function restore(records: readonly OutgoingEvent[]) {
  let saved = records;
  let saves = 0;
  let failOn = new Set<number>();
  const sign = vi.fn();
  const publish = vi.fn();
  const owner = createOutbox(
    viewer.pubkey,
    { sign, publish },
    {
      load: () => structuredClone(saved),
      save: (next) => {
        saves += 1;
        if (failOn.has(saves)) throw new Error("Disk is full.");
        saved = next;
      },
    },
  );
  await owner.ready;
  render(
    <ToastProvider>
      <UnsentChangesNotice
        outbox={owner.outbox}
        channelName={(id) => (id === "chat" ? "General" : undefined)}
      />
    </ToastProvider>,
  );
  return {
    owner,
    saved: () => saved,
    sign,
    publish,
    failSaves: (...after: number[]) => {
      failOn = new Set(after.map((count) => saves + count));
    },
  };
}

it("lists restored held plugin writes and discards one without sending it", async () => {
  const h = await restore([
    held("{}", "unknown"),
    held('{"step":2}', "failed"),
  ]);
  const notice = await screen.findByRole("dialog", {
    name: "2 unsent changes",
  });
  const discards = within(notice).getAllByRole("button", {
    name: /^Discard Plugin change \(kind 30078\)/,
  });
  expect(discards).toHaveLength(2);
  expect(notice).toHaveTextContent(
    "Not confirmed. It may already be on the relay. Discarding only stops this device from sending it.",
  );
  expect(notice).toHaveTextContent("Not sent");
  fireEvent.click(discards[0] as HTMLElement);
  await screen.findByRole("dialog", { name: "1 unsent change" });
  expect(h.owner.outbox.snapshot()).toHaveLength(1);
  expect(h.saved()).toHaveLength(1);
  expect(h.sign).not.toHaveBeenCalled();
  expect(h.publish).not.toHaveBeenCalled();
  h.owner.dispose();
});

it("names the record a plugin write targets", async () => {
  const h = await restore([
    held("{}", "failed", "theme"),
    held("{}", "failed", "a-very-long-plugin-record-name"),
  ]);
  const notice = await screen.findByRole("dialog", {
    name: "2 unsent changes",
  });
  expect(
    within(notice).getByRole("button", {
      name: /^Discard Plugin change \(kind 30078\) · for theme · /,
    }),
  ).toBeInTheDocument();
  expect(
    within(notice).getByRole("button", {
      name: /· for a-very-long-plugin-reco… · /,
    }),
  ).toBeInTheDocument();
  h.owner.dispose();
});

it("keeps a full queue's notice through Discard all and lists every write that failed until its own discard succeeds", async () => {
  const h = await restore(fullQueue());
  expect(() =>
    h.owner.outbox.send({ kind: 9, content: "new", tags: [["h", "chat"]] }),
  ).toThrow(PENDING_FULL);
  const notice = await screen.findByRole("dialog", {
    name: "256 unsent changes",
  });
  h.failSaves(100, 200);
  fireEvent.click(within(notice).getByRole("button", { name: "Discard all" }));
  fireEvent.click(
    within(
      await screen.findByRole("alertdialog", {
        name: "Discard 256 unsent changes?",
      }),
    ).getByRole("button", { name: "Discard all" }),
  );
  expect(await within(notice).findByRole("alert")).toHaveTextContent(
    "Couldn’t discard 2 changes. Disk is full.",
  );
  expect(h.owner.outbox.snapshot()).toHaveLength(2);
  const failed = within(notice).getAllByRole("button", {
    name: /^Discard Message/,
  });
  expect(failed).toHaveLength(2);
  fireEvent.click(failed[0] as HTMLElement);
  await vi.waitFor(() => expect(h.owner.outbox.snapshot()).toHaveLength(1));
  expect(notice).toHaveAccessibleName("1 unsent change");
  expect(within(notice).getByRole("alert")).toHaveTextContent(
    "Couldn’t discard 1 change.",
  );
  fireEvent.click(
    within(notice).getByRole("button", { name: /^Discard Message/ }),
  );
  await vi.waitFor(() => expect(h.owner.outbox.snapshot()).toEqual([]));
  expect(screen.queryByRole("dialog", { name: /unsent change/ })).toBeNull();
  h.owner.dispose();
});

it("keeps an entry point after the notice is hidden, until nothing needs attention", async () => {
  const h = await restore([held("{}", "failed")]);
  await screen.findByRole("dialog", { name: "1 unsent change" });
  fireEvent.click(screen.getByRole("button", { name: "Hide unsent changes" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /^Discard Plugin change/ }),
  );
  await vi.waitFor(() => expect(h.owner.outbox.snapshot()).toEqual([]));
  expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  h.owner.dispose();
});

it("recovers a full queue of writes with caller-owned recovery after confirming Discard all", async () => {
  const h = await restore(fullQueue());
  const send = () =>
    h.owner.outbox.send({ kind: 9, content: "new", tags: [["h", "chat"]] });
  expect(send).toThrow(PENDING_FULL);
  const notice = await screen.findByRole("dialog", {
    name: "256 unsent changes",
  });
  expect(
    within(notice).getByRole("button", {
      name: /^Discard Message · in General · .* · “message 0”$/,
    }),
  ).toBeInTheDocument();
  fireEvent.click(within(notice).getByRole("button", { name: "Discard all" }));
  const confirm = await screen.findByRole("alertdialog", {
    name: "Discard 256 unsent changes?",
  });
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(h.owner.outbox.snapshot()).toHaveLength(256);
  fireEvent.click(within(notice).getByRole("button", { name: "Discard all" }));
  fireEvent.click(
    within(
      await screen.findByRole("alertdialog", {
        name: "Discard 256 unsent changes?",
      }),
    ).getByRole("button", { name: "Discard all" }),
  );
  await vi.waitFor(() => expect(h.owner.outbox.snapshot()).toEqual([]));
  expect(h.saved()).toEqual([]);
  expect(h.publish).not.toHaveBeenCalled();
  expect(send()).toEqual(expect.any(String));
  h.owner.dispose();
});
