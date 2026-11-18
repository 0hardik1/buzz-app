// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, assert, expect, it, vi } from "vitest";
import { DeliveryNotice } from "./DeliveryNotice";
import type { ChannelMessage } from "../relay/contracts";
import { eventDto, type RelayEvent } from "../relay/events";
import {
  PublishRejected,
  type Outbox,
  type OutgoingEvent,
} from "../relay/outbox";
import { matchesEvent } from "../relay/projection";
import { createRelaySession } from "../relay/session";
import { soloAdminRecovery } from "../relay/solo-admins";
import { keypair, metadata, ownedProfile, signed } from "../relay/testing";

const sessions: ReturnType<typeof createRelaySession>[] = [];
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const session of sessions.splice(0)) session.dispose();
});
const row: ChannelMessage = {
  id: "message",
  channelId: "channel",
  authorId: "author",
  content: "Message",
  createdAt: 1,
  mentions: [],
  attachments: [],
  reactions: [],
  participants: [],
  replyCount: 0,
};

it.each(["sending", "accepted", "unknown", "failed"] as const)(
  "keeps %s feedback visible without a retry handler",
  (delivery) => {
    render(<DeliveryNotice row={{ ...row, delivery }} />);
    expect(screen.getByRole("status")).not.toHaveClass("sr-only");
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  },
);

it.each(["sending", "accepted", "unknown", "failed"] as const)(
  "hides %s feedback only when its retry action is available",
  (delivery) => {
    render(<DeliveryNotice row={{ ...row, delivery }} retry={vi.fn()} />);
    const canRetry = delivery === "unknown" || delivery === "failed";
    expect(screen.getByRole("status").classList.contains("sr-only")).toBe(
      canRetry,
    );
    expect(!!screen.queryByRole("button", { name: "Retry" })).toBe(canRetry);
  },
);

it("offers Retry as soon as a pending send fails, and stays quiet while unconfirmed", () => {
  vi.useFakeTimers({ now: 100_050 });
  const pending = { ...row, createdAt: 100 };
  const retry = vi.fn();
  const view = render(
    <DeliveryNotice row={{ ...pending, delivery: "sending" }} retry={retry} />,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  view.rerender(
    <DeliveryNotice row={{ ...pending, delivery: "failed" }} retry={retry} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Couldn’t send this message.",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  view.rerender(
    <DeliveryNotice row={{ ...pending, delivery: "unknown" }} retry={retry} />,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("explains a refused retry and stops offering it until the delivery changes", () => {
  const retry = vi.fn(() => {
    throw new Error("Retry this from the plugin that sent it.");
  });
  const view = render(
    <DeliveryNotice row={{ ...row, delivery: "failed" }} retry={retry} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Couldn’t send this message. Retry this from the plugin that sent it.",
  );
  expect(screen.getByRole("status")).not.toHaveClass("sr-only");
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <DeliveryNotice row={{ ...row, delivery: "unknown" }} retry={retry} />,
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});

const SETUP_ENDED =
  "Couldn’t send this message. Chat admin setup has ended, and the chat keeps its current roles. Retry this message, or send it again if it has expired.";

/** A Solo chat the relay has, whose opening admins are still being granted,
 * on the real session, outbox and admin setup. Its create is a minute old. */
async function soloChat({ owned = false } = {}) {
  const viewer = keypair(),
    relay = keypair();
  const keys = [keypair(), keypair()];
  const agents = keys.map((key) => key.pubkey);
  const channel = crypto.randomUUID();
  const creation = signed(viewer, {
    kind: 9007,
    created_at: Math.floor(Date.now() / 1000) - 60,
    content: "",
    tags: [["h", channel], ...agents.map((agent) => ["p", agent])],
  });
  let records: readonly OutgoingEvent[] = [
    {
      event: eventDto(creation),
      signed: creation,
      delivery: "accepted",
      recovery: soloAdminRecovery(channel, agents, agents),
    },
  ];
  const profiles = owned
    ? (await Promise.all(keys.map((key) => ownedProfile(key, viewer)))).map(
        eventDto,
      )
    : [];
  const events = new Map<string, RelayEvent>([[creation.id, creation]]);
  const record = async (event: RelayEvent) => {
    events.set(event.id, event);
  };
  const publish = vi.fn(record);
  const grant = vi.fn(record);
  // The receipt's lock, as the shared journal provides it across windows.
  let held = Promise.resolve();
  const lock = vi.fn((_id: string, run: () => Promise<unknown>) => {
    const work = held.then(run, run);
    held = work.then(
      () => {},
      () => {},
    );
    return work;
  });
  let failSave = false;
  const owner = createRelaySession(
    {
      viewer: viewer.pubkey,
      relayAuthor: relay.pubkey,
      channelIdentity: true,
      media: () => undefined,
      query: async (filters) =>
        [
          ...profiles,
          ...events.values(),
          metadata(relay, channel, "Work", creation.created_at, [
            ["t", "stream"],
            ["t", "buzz.solo"],
            ["private"],
            ["P", viewer.pubkey],
          ]),
          signed(relay, {
            kind: 39002,
            content: "",
            tags: [
              ["d", channel],
              ["p", viewer.pubkey, "", "owner"],
              ...agents.map((agent) => ["p", agent, "", "member"]),
            ],
          }),
        ].filter((event) =>
          filters.some((filter) => matchesEvent(event, filter)),
        ),
      writer: {
        kinds: [9, 9007],
        sign: async (template) => signed(viewer, template),
        publish,
      },
      memberAdministration: {
        sign: async (template) => signed(viewer, template),
        publish: grant,
      },
    },
    {
      outboxStorage: {
        lock: lock as <T>(id: string, run: () => Promise<T>) => Promise<T>,
        load: () => structuredClone(records),
        save: (next) => {
          if (failSave) throw new Error("Storage unavailable");
          records = structuredClone(next);
        },
      },
    },
  );
  sessions.push(owner);
  const outbox = owner.session.outbox;
  assert.exists(outbox);
  await outbox.ready();
  owner.session.channels.ensureList();
  await vi.waitFor(() =>
    expect(owner.session.channels.list().status).toBe("ready"),
  );
  const item = (id: string) =>
    outbox.snapshot().find((item) => item.event.id === id);
  return {
    channel,
    agents,
    create: creation.id,
    outbox,
    events,
    publish,
    grant,
    lock,
    item,
    settingUp: () => outbox.snapshot().some((item) => item.recovery),
    failSave: (fail: boolean) => {
      failSave = fail;
    },
    /** Sends a message and shows its notice once the send has failed. */
    async failed(text: string) {
      const id = owner.session.messages.send(channel, text, agents);
      await waitFor(() => expect(item(id)?.delivery).toBe("failed"));
      return id;
    },
    send: (text: string) => owner.session.messages.send(channel, text, agents),
  };
}

/** The notice as a message row shows it: delivery follows the outbox. */
function Sent({
  outbox,
  id,
  channelId,
}: {
  outbox: Outbox;
  id: string;
  channelId: string;
}) {
  const item = useSyncExternalStore(outbox.subscribe, () =>
    outbox.snapshot().find((item) => item.event.id === id),
  );
  return (
    <DeliveryNotice
      row={{
        ...row,
        id,
        channelId,
        delivery: item?.delivery,
        deliveryError: item?.error,
      }}
      retry={outbox.retry}
      outbox={outbox}
    />
  );
}
const abandon = () =>
  screen.queryByRole("button", { name: "Abandon admin setup" });
const confirm = () =>
  within(
    screen.getByRole("alertdialog", { name: "Abandon admin setup?" }),
  ).getByRole("button", { name: "Abandon admin setup" });

it("says why a message failed while its chat’s admin setup is unfinished, and sends it once setup is abandoned", async () => {
  const chat = await soloChat();
  const message = await chat.failed("Work on this");
  render(<Sent outbox={chat.outbox} id={message} channelId={chat.channel} />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent(
    "Couldn’t send this message. An opening agent is not verified as owned by the chat creator. Retry this message. The chat continues with current roles once setup is 15 minutes old.",
  );
  expect(status).not.toHaveClass("sr-only");
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();

  const offer = abandon();
  assert.exists(offer);
  fireEvent.click(offer);
  const confirmation = screen.getByRole("alertdialog", {
    name: "Abandon admin setup?",
  });
  expect(
    within(confirmation).getByText(/The chat keeps its current roles/),
  ).toBeVisible();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(chat.settingUp()).toBe(true);

  // A dismissal that cannot be saved leaves setup, and the offer, in place.
  chat.failSave(true);
  fireEvent.click(offer);
  fireEvent.click(confirm());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Storage unavailable",
  );
  expect(chat.settingUp()).toBe(true);
  chat.failSave(false);
  fireEvent.click(confirm());
  await waitFor(() => expect(chat.settingUp()).toBe(false));

  // The same row says that setup ended, and Retry now sends the message.
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(SETUP_ENDED),
  );
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(abandon()).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(chat.events.has(message)).toBe(true));
  expect(chat.grant).not.toHaveBeenCalled();
  expect(chat.publish.mock.calls.every(([event]) => event.kind === 9)).toBe(
    true,
  );
});

it("ends setup only after a grant that is being published, and grants nothing more", async () => {
  const chat = await soloChat({ owned: true });
  let release = () => {};
  const landing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const record = chat.grant.getMockImplementation();
  assert.exists(record);
  chat.grant
    .mockRejectedValueOnce(new Error("Grant refused"))
    .mockImplementationOnce(async (event) => {
      await landing;
      await record(event);
    });
  try {
    const first = await chat.failed("Work on this");
    render(<Sent outbox={chat.outbox} id={first} channelId={chat.channel} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn’t send this message. Grant refused",
    );
    // A second message starts setup again, and its grant is on its way.
    const second = chat.send("And this");
    await waitFor(() => expect(chat.grant).toHaveBeenCalledTimes(2));
    const locks = chat.lock.mock.calls.length;
    const offer = abandon();
    assert.exists(offer);
    fireEvent.click(offer);
    fireEvent.click(confirm());
    // The dismissal has reached the receipt's lock, which the grant holds.
    await waitFor(() => expect(chat.lock).toHaveBeenCalledTimes(locks + 1));
    expect(chat.lock.mock.lastCall?.[0]).toBe(chat.create);
    expect(chat.settingUp()).toBe(true);
    expect(confirm()).toBeDisabled();
    release();
    await waitFor(() => expect(chat.settingUp()).toBe(false));
    await waitFor(() => expect(chat.item(second)?.delivery).toBe("failed"));
    // The grant that was under way stands; the other agent was never granted.
    expect(chat.grant).toHaveBeenCalledTimes(2);
    expect(
      chat.grant.mock.calls.map(
        ([event]) => event.tags.find(([tag]) => tag === "p")?.[1],
      ),
    ).toEqual([chat.agents[0], chat.agents[0]]);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(SETUP_ENDED),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(chat.events.has(first)).toBe(true));
    expect(chat.grant).toHaveBeenCalledTimes(2);
  } finally {
    release();
  }
});

it("says that setup ended when it expires under a failed message", async () => {
  const chat = await soloChat();
  const clock = vi.spyOn(Date, "now");
  try {
    const message = await chat.failed("Work on this");
    render(<Sent outbox={chat.outbox} id={message} channelId={chat.channel} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "not verified as owned",
    );
    // Past the relay's window the next attempt ends setup by itself, and the
    // relay refuses the opening message, which is as old as the create.
    clock.mockReturnValue(Date.now() + 16 * 60 * 1000);
    chat.publish.mockRejectedValueOnce(new PublishRejected("Event too old"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(chat.settingUp()).toBe(false));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(SETUP_ENDED),
    );
    expect(screen.getByRole("status")).not.toHaveClass("sr-only");
    expect(abandon()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    const next = chat.send("Sent again");
    await waitFor(() => expect(chat.events.has(next)).toBe(true));
    expect(chat.events.has(message)).toBe(false);
    expect(chat.grant).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

it("stops saying that setup ended once the message is retried and fails for another reason", async () => {
  const chat = await soloChat();
  const message = await chat.failed("Work on this");
  render(<Sent outbox={chat.outbox} id={message} channelId={chat.channel} />);
  const offer = abandon();
  assert.exists(offer);
  fireEvent.click(offer);
  fireEvent.click(confirm());
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(SETUP_ENDED),
  );
  // The relay refuses the retry for a reason that has nothing to do with setup.
  chat.publish.mockRejectedValueOnce(new PublishRejected("Rate limited"));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(chat.item(message)?.error).toBe("Rate limited"));
  expect(chat.item(message)?.delivery).toBe("failed");
  expect(screen.getByRole("status")).toHaveTextContent(
    /^Couldn’t send this message\.$/,
  );
  expect(screen.getByRole("status")).toHaveClass("sr-only");
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});

/** A saved setup as the outbox holds it, for a chat named `channel`. */
function setupReceipt(
  delivery: OutgoingEvent["delivery"],
  channel = "channel",
) {
  const agent = "a".repeat(64);
  return {
    event: {
      id: `create-${channel}`,
      kind: 9007,
      pubkey: "f".repeat(64),
      content: "",
      tags: [
        ["h", channel],
        ["p", agent],
      ],
    },
    delivery,
    recovery: soloAdminRecovery(channel, [agent], [agent]),
  } as OutgoingEvent;
}
function holding(...items: OutgoingEvent[]) {
  return {
    snapshot: () => items,
    subscribe: () => () => {},
    dismiss: vi.fn(),
  } as unknown as Outbox;
}
const refusal = { delivery: "failed", deliveryError: "Grant refused" } as const;

it.each(["sending", "unknown", "failed"] as const)(
  "explains the failure but does not offer to abandon a setup whose create is %s",
  (delivery) => {
    render(
      <DeliveryNotice
        row={{ ...row, ...refusal }}
        retry={vi.fn()}
        outbox={holding(setupReceipt(delivery))}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn’t send this message. Grant refused",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(abandon()).not.toBeInTheDocument();
  },
);

it.each(["accepted", "seen"] as const)(
  "offers to abandon a setup whose create is %s, beside Retry",
  (delivery) => {
    render(
      <DeliveryNotice
        row={{ ...row, ...refusal }}
        retry={vi.fn()}
        outbox={holding(setupReceipt(delivery))}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(abandon()).toBeVisible();
  },
);

it("keeps a failed message as it was when no setup holds its chat", () => {
  const outbox = holding(setupReceipt("accepted", "another"));
  const view = render(
    <DeliveryNotice
      row={{ ...row, ...refusal }}
      retry={vi.fn()}
      outbox={outbox}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    /^Couldn’t send this message\.$/,
  );
  expect(screen.getByRole("status")).toHaveClass("sr-only");
  expect(abandon()).not.toBeInTheDocument();
  // An unconfirmed message keeps its own wording, and offers no way out of setup.
  view.rerender(
    <DeliveryNotice
      row={{ ...row, delivery: "unknown", deliveryError: "Grant refused" }}
      retry={vi.fn()}
      outbox={holding(setupReceipt("accepted"))}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    /^Delivery not yet confirmed\. Grant refused$/,
  );
  expect(screen.getByRole("status")).toHaveClass("sr-only");
  expect(abandon()).not.toBeInTheDocument();
});
