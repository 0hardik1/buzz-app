// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationPresentation } from "../conversation/ConversationPresentation";
import { discardReaction } from "../conversation/ReactionTool";
import { MessageReactionControls, MessageReactions } from "./MessageReactions";
import { PREVIEW_REST_MS } from "../../shared/design-system/ui/hoverIntent";
import { createRelaySession } from "../relay/session";
import {
  flush,
  keypair,
  message,
  profile,
  roster,
  scriptedTransport,
  signed,
} from "../relay/testing";
import type { LiveCallbacks } from "../relay/live";
import type { ReadFilter, RelayEvent } from "../relay/events";
import type {
  ComposerTool,
  ContributionReader,
  InlineRenderer,
  ReactionToolProps,
} from "../conversation/contracts";
import { PublishRejected } from "../relay/outbox";
import { useSyncExternalStore } from "react";

const viewer = keypair(),
  other = keypair(),
  relay = keypair();
const owners: { dispose(): void }[] = [];
beforeEach(() => {
  // jsdom hides [popover] but does not implement showPopover. Model opening
  // for content assertions; browser tests cover top-layer painting and clipping.
  HTMLElement.prototype.showPopover = function () {
    this.style.display = "block";
  };
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  for (const owner of owners.splice(0)) owner.dispose();
  localStorage.clear();
  vi.restoreAllMocks();
});
const registry = <T,>(
  entries: ReturnType<ContributionReader<T>["snapshot"]>,
): ContributionReader<T> => ({
  snapshot: () => entries,
  subscribe: () => () => {},
});
const inline = registry<InlineRenderer>([]);
const tools = registry<ComposerTool>([
  {
    key: "picker",
    pluginId: "picker",
    revision: "one",
    id: "picker",
    title: "Picker",
    component: () => null,
    reactionComponent: ({ select, disabled }: ReactionToolProps) => (
      <button type="button" disabled={disabled} onClick={() => select("👍")}>
        Choose reaction
      </button>
    ),
  },
]);
const root = message(other, "c", "Message", 1);
const react = (key = viewer, time = 2) =>
  signed(key, {
    kind: 7,
    content: "👍",
    created_at: time,
    tags: [
      ["h", "c"],
      ["e", root.id],
    ],
  });
const customReaction = (key: typeof viewer, code: string, url: string) =>
  signed(key, {
    kind: 7,
    content: `:${code}:`,
    created_at: 2,
    tags: [
      ["h", "c"],
      ["e", root.id],
      ["emoji", code, url],
    ],
  });
function harness(
  events: RelayEvent[] = [],
  publish = vi.fn(async (_event: RelayEvent) => {}),
  pickerTools = tools,
  media?: (url: string, size?: "small") => string | undefined,
) {
  const wire = scriptedTransport(viewer.pubkey, relay.pubkey);
  let live!: LiveCallbacks;
  /** How the relay answers a strong read by ID: with the events it `has`,
   * or by failing. Every such filter is recorded. */
  const check: { has: RelayEvent[]; fail?: Error; asked: ReadFilter[] } = {
    has: [],
    asked: [],
  };
  const owner = createRelaySession(
    {
      ...wire.transport,
      query(filters, signal) {
        const strong = filters.filter(
          (filter) => filter.consistency === "strong" && filter.ids,
        );
        if (!strong.length) return wire.transport.query(filters, signal);
        check.asked.push(...strong);
        return check.fail
          ? Promise.reject(check.fail)
          : Promise.resolve(
              check.has.filter((event) =>
                strong.some((filter) => filter.ids?.includes(event.id)),
              ),
            );
      },
      ...(media ? { media } : {}),
      writer: { sign: async (template) => signed(viewer, template), publish },
      subscribe(callbacks) {
        live = callbacks;
        return { update() {}, retry() {}, dispose() {} };
      },
    },
    { outboxStorage: { load: () => [], save() {} } },
  );
  owners.push(owner);
  owner.session.channels.ensure("c");
  live.receive([roster(relay, "c", [viewer.pubkey], 1), root, ...events]);
  function Controls({
    disabled = false,
    onFocusedRemoval,
    audience,
  }: {
    audience?: "agents";
    disabled?: boolean;
    onFocusedRemoval?: () => void;
  }) {
    const state = useSyncExternalStore(
      (fn) => owner.session.channels.subscribeWindow("c", fn),
      () => owner.session.channels.window("c"),
    );
    const row = state.rows[0];
    return (
      row && (
        <>
          <div data-testid="reaction-controls">
            <MessageReactionControls
              row={audience ? { ...row, audience } : row}
              session={owner.session}
              scope="test"
              disabled={disabled}
              tools={pickerTools}
              inline={inline}
            />
          </div>
          <MessageReactions
            {...(onFocusedRemoval ? { onFocusedRemoval } : {})}
            row={audience ? { ...row, audience } : row}
            session={owner.session}
            scope="test"
            disabled={disabled}
            tools={pickerTools}
            inline={inline}
          />
        </>
      )
    );
  }
  /** The session runs three reads at a time. Answers the scripted ones still
   * open, so a read that follows is not queued behind them. */
  const idle = () => {
    for (const open of wire.pending.splice(0)) open.respond([]);
  };
  return { ...owner, live, wire, publish, check, idle, Controls };
}
/** The relay takes a signed event for 15 minutes. As the native writer does,
 * an older one is looked up, never sent again. */
const TOO_OLD =
  "This event is too old to retry and was not found on the relay. Check the conversation before sending it again.";
const intake =
  (relay: (event: RelayEvent) => Promise<void>) =>
  async (event: RelayEvent) => {
    if (event.created_at < Math.floor(Date.now() / 1000) - 15 * 60)
      throw new PublishRejected(TOO_OLD);
    await relay(event);
  };
const refused = async () => {
  throw new PublishRejected("Nope");
};
/** Dispatched and never answered. */
const unanswered = async () => {
  throw new Error("Connection lost");
};
const settle = () =>
  act(async () => {
    await flush();
    await flush();
  });
/** Moves the clock past the intake window of everything sent so far. */
const expire = () => {
  const now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now + 16 * 60_000);
};
const picker = () =>
  within(screen.getByTestId("reaction-controls")).getByRole<HTMLButtonElement>(
    "button",
    { name: "Choose reaction" },
  );
const retry = () => screen.queryByRole("button", { name: "Retry reaction" });
const discard = () =>
  screen.queryByRole("button", { name: "Discard reaction update" });
it("shows one bubble per emoji, counts unique people, and removes all my duplicate events", async () => {
  const mine = react(),
    duplicate = react(viewer, 3),
    theirs = react(other);
  const h = harness([mine, duplicate, theirs]);
  render(<h.Controls />);
  expect(
    screen.queryAllByRole("button", { name: /React with|Remove/ }),
  ).toHaveLength(0);
  expect(
    screen.getByTestId("reaction-row").querySelectorAll("[data-reaction]"),
  ).toHaveLength(1);
  const own = screen.getByRole("button", {
    name: "👍: 2 people",
  });
  expect(own.getAttribute("aria-pressed")).toBe("true");
  // The pill's highlight follows whether I am among its reactors.
  expect(own.closest("[data-mine]")).not.toBeNull();
  expect(own.textContent).toBe("👍2");
  fireEvent.mouseEnter(own);
  fireEvent.mouseMove(own);
  const preview = await screen.findByRole("tooltip", {}, { timeout: 2500 });
  expect(preview.textContent).toContain("You");
  expect(preview.textContent).toContain(other.pubkey.slice(0, 10));
  fireEvent.click(own);
  const deletions = h.session.outbox?.snapshot().map((item) => item.event);
  expect(deletions?.every((event) => event.kind === 5)).toBe(true);
  expect(
    deletions?.map((event) => event.tags.filter(([name]) => name === "e")),
  ).toEqual([[["e", mine.id]], [["e", duplicate.id]]]);
  const remaining = screen.getByRole("button", {
    name: `👍: ${other.pubkey.slice(0, 10)}`,
  });
  expect(remaining.getAttribute("aria-pressed")).toBe("false");
  expect(remaining.closest("[data-mine]")).toBeNull();
  await act(async () => {
    await flush();
    await flush();
  });
});
it("keeps one bubble and focus when the count crosses the former grouping threshold", async () => {
  const others = Array.from({ length: 8 }, () => keypair());
  const h = harness(others.map((person) => react(person)));
  const onFocusedRemoval = vi.fn();
  render(<h.Controls onFocusedRemoval={onFocusedRemoval} />);
  const pills = () =>
    screen.getByTestId("reaction-row").querySelectorAll("[data-reaction]");
  expect(pills()).toHaveLength(1);
  // A second event from one person must not increase the count.
  act(() => h.live.receive([react(others[0], 3)]));
  expect(pills()).toHaveLength(1);
  expect(screen.getByRole("button", { name: "👍: 8 people" }).textContent).toBe(
    "👍8",
  );
  act(() => h.live.receive([react()]));
  expect(pills()).toHaveLength(1);
  const group = screen.getByRole("button", { name: "👍: 9 people" });
  expect(group.textContent).toBe("👍9");
  expect(group.getAttribute("aria-pressed")).toBe("true");
  act(() => group.focus());
  const preview = await screen.findByRole("tooltip");
  expect(preview.textContent).toContain("You");
  for (const person of others)
    expect(preview.textContent).toContain(person.pubkey.slice(0, 10));
  expect(preview.textContent).not.toContain("others");
  fireEvent.click(group);
  expect(pills()).toHaveLength(1);
  expect(document.activeElement).toBe(group);
  expect(onFocusedRemoval).not.toHaveBeenCalled();
  expect(h.session.outbox?.snapshot()[0]?.event.kind).toBe(5);
  await act(async () => {
    await flush();
    await flush();
  });
});

it.each([3, 4, 5])("shows all %i reactors in the preview", async (count) => {
  const people = Array.from({ length: count }, () => keypair());
  const h = harness(people.map((person) => react(person)));
  render(<h.Controls />);
  act(() =>
    screen.getByRole("button", { name: `👍: ${count} people` }).focus(),
  );
  const preview = await screen.findByRole("tooltip");
  for (const person of people)
    expect(preview.textContent).toContain(person.pubkey.slice(0, 10));
  expect(
    within(preview).getByRole("region", { name: "Everyone who reacted" })
      .tabIndex,
  ).toBe(-1);
});

it("opening a large preview preserves unrelated cached profiles", async () => {
  const h = harness([react(other)]);
  const unrelated = profile(other, { name: "Existing colleague" });
  act(() =>
    h.live.receive([
      unrelated,
      ...Array.from({ length: 63 }, (_, index) =>
        profile(keypair(), { name: `Cached colleague ${index}` }),
      ),
    ]),
  );
  const people = Array.from({ length: 1025 }, () => keypair());
  const events = new Map(
    people.map((person, index) => [
      person.pubkey,
      profile(person, { name: `Reactor ${index}` }),
    ]),
  );
  const row = h.session.channels.window("c").rows[0];
  const first = people[0],
    last = people.at(-1);
  if (!row || !first || !last) throw new Error("Missing fixture data");
  const completed = new Set();
  const settleReads = async () => {
    await flush();
    let pending = h.wire.pending.find((entry) => !completed.has(entry));
    while (pending) {
      completed.add(pending);
      pending.respond(
        pending.filters.flatMap((filter) =>
          filter.kinds?.includes(0)
            ? (filter.authors ?? []).flatMap((id) =>
                events.get(id) ? [events.get(id) as RelayEvent] : [],
              )
            : [],
        ),
      );
      await flush();
      pending = h.wire.pending.find((entry) => !completed.has(entry));
    }
  };
  await act(settleReads);
  render(
    <MessageReactions
      row={{
        ...row,
        reactions: [
          {
            content: "👍",
            events: people.map((person, index) => ({
              id: String(index),
              authorId: person.pubkey,
            })),
          },
        ],
      }}
      session={h.session}
      scope="test"
      disabled={false}
      tools={tools}
      inline={inline}
    />,
  );
  const pill = screen.getByRole("button", { name: "👍: 1025 people" });
  fireEvent.mouseEnter(pill);
  // Pointer transit must not start profile enrichment before opening.
  expect(h.session.profiles.snapshot().get(first.pubkey)).toBeUndefined();
  act(() => pill.focus());
  const preview = await screen.findByRole("tooltip");
  await act(settleReads);
  expect(preview.textContent).toContain("Reactor 0");
  expect(h.session.profiles.snapshot().get(other.pubkey)?.name).toBe(
    "Existing colleague",
  );
  // Names outside the first visible page remain readable as identity fallbacks.
  expect(preview.textContent).toContain(last.pubkey.slice(0, 10));
  expect(h.session.profiles.snapshot().has(last.pubkey)).toBe(false);
});

it("keeps custom emoji URLs separate and updates a grouped count when I join", async () => {
  const people = Array.from({ length: 9 }, () => keypair());
  const first = "https://a.test/first.gif";
  const second = "https://a.test/second.gif";
  const h = harness([
    ...people.map((person) => customReaction(person, "party", first)),
    customReaction(other, "party", second),
  ]);
  const onFocusedRemoval = vi.fn();
  render(<h.Controls onFocusedRemoval={onFocusedRemoval} />);
  const group = screen.getByRole("button", { name: ":party:: 9 people" });
  expect(group.getAttribute("aria-pressed")).toBe("false");
  expect(group.querySelector("img")?.getAttribute("src")).toBe(first);
  expect(
    screen
      .getByRole("button", { name: `:party:: ${other.pubkey.slice(0, 10)}` })
      .querySelector("img")
      ?.getAttribute("src"),
  ).toBe(second);
  fireEvent.click(group);
  const joined = screen.getByRole("button", { name: ":party:: 10 people" });
  expect(joined).toBe(group);
  expect(joined.textContent).toBe("10");
  expect(joined.getAttribute("aria-pressed")).toBe("true");
  expect(h.session.outbox?.snapshot()[0]?.event.tags).toContainEqual([
    "emoji",
    "party",
    first,
  ]);
  await act(async () => {
    await flush();
    await flush();
  });
  act(() => joined.focus());
  fireEvent.click(joined);
  expect(screen.getByRole("button", { name: ":party:: 9 people" })).toBe(
    joined,
  );
  expect(document.activeElement).toBe(joined);
  expect(onFocusedRemoval).not.toHaveBeenCalled();
  await act(async () => {
    await flush();
    await flush();
  });
});

it("keeps the same bubble and focus through single and multiple reactor transitions", async () => {
  const others = [other];
  const h = harness([react(other)]);
  render(
    <>
      <button type="button">Elsewhere</button>
      <h.Controls />
    </>,
  );
  const individual = screen.getByRole("button", { name: /^👍:/ });
  if (!individual) throw new Error("Expected an individual reaction");
  act(() => individual.focus());
  fireEvent.click(individual);
  const group = screen.getByRole("button", { name: "👍: 2 people" });
  expect(group).toBe(individual);
  expect(document.activeElement).toBe(group);
  await act(async () => {
    await flush();
    await flush();
  });
  // A live removal takes the count back to one without replacing the control.
  const removedPerson = others[0];
  if (!removedPerson) throw new Error("Expected another reactor");
  const removed = react(removedPerson);
  act(() =>
    h.live.receive([
      signed(removedPerson, {
        kind: 5,
        content: "",
        created_at: 3,
        tags: [["e", removed.id]],
      }),
    ]),
  );
  expect(document.activeElement).toBe(
    screen.getAllByRole("button", { name: /^👍:/ })[0],
  );
  // A live second reactor updates the same focused control.
  act(() => h.live.receive([react(keypair(), 4)]));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "👍: 2 people" }),
  );
  act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
  act(() => h.live.receive([react(keypair(), 5)]));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Elsewhere" }),
  );
});

it("keeps failed first-reaction delivery visible and retries the same event", async () => {
  const publish = vi.fn(async (_event: RelayEvent) => {
    throw new PublishRejected("Nope");
  });
  const h = harness([], publish);
  render(<h.Controls />);
  fireEvent.click(
    within(screen.getByTestId("reaction-controls")).getByRole("button", {
      name: "Choose reaction",
    }),
  );
  await act(async () => {
    await flush();
    await flush();
  });
  expect(screen.queryByRole("button", { name: "❤️: You" })).toBeNull();
  const original = publish.mock.calls[0]?.[0];
  publish.mockImplementation(async () => undefined as never);
  fireEvent.click(screen.getByRole("button", { name: "Retry reaction" }));
  await act(async () => {
    await flush();
    await flush();
  });
  expect(publish.mock.calls[1]?.[0]).toEqual(original);
});
it("prevents duplicate submissions and unavailable-message actions", async () => {
  const h = harness();
  const view = render(<h.Controls disabled />);
  fireEvent.click(
    within(screen.getByTestId("reaction-controls")).getByRole("button", {
      name: "Choose reaction",
    }),
  );
  expect(h.session.outbox?.snapshot()).toHaveLength(0);
  view.rerender(<h.Controls />);
  const button = within(screen.getByTestId("reaction-controls")).getByRole(
    "button",
    { name: "Choose reaction" },
  );
  fireEvent.click(button);
  fireEvent.click(button);
  expect(h.session.outbox?.snapshot()).toHaveLength(1);
  await act(async () => {
    await flush();
    await flush();
  });
});

it.each(["hover", "focus"] as const)(
  "shows who reacted on %s to someone who cannot react",
  async (reveal) => {
    const h = harness([react(other)]);
    render(<h.Controls disabled />);
    const pill = screen.getByRole("button", {
      name: `👍: ${other.pubkey.slice(0, 10)}`,
    });
    // A disabled button drops hover, focus and keys, and the preview with them.
    expect(pill.hasAttribute("disabled")).toBe(false);
    expect(pill.hasAttribute("data-disabled")).toBe(false);
    expect(pill.getAttribute("aria-disabled")).toBe("true");
    if (reveal === "hover") {
      fireEvent.mouseEnter(pill);
      fireEvent.mouseMove(pill);
    } else act(() => pill.focus());
    const preview = await screen.findByRole("tooltip", {}, { timeout: 2500 });
    expect(preview.textContent).toContain(other.pubkey.slice(0, 10));
  },
);

it("does not let someone who cannot react toggle, and leaves keys to ancestors", async () => {
  const h = harness([react(other)]);
  const keys: string[] = [];
  render(
    // Thread Escape, the message menu and timeline scrolling skip prevented keys.
    // biome-ignore lint/a11y/noStaticElementInteractions: Observes bubbling keys.
    <div
      onKeyDown={(event) => {
        if (!event.defaultPrevented) keys.push(event.key);
      }}
    >
      <h.Controls disabled />
    </div>,
  );
  const pill = screen.getByRole("button", {
    name: `👍: ${other.pubkey.slice(0, 10)}`,
  });
  act(() => pill.focus());
  await screen.findByRole("tooltip");
  // Enter and Space activate a native button by dispatching this click.
  fireEvent.click(pill);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  expect(h.session.outbox?.snapshot()).toHaveLength(0);
  expect(pill.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByTestId("inline-add-reaction")).toBeNull();
  for (const key of ["F10", "ContextMenu", "ArrowUp", "PageUp"])
    fireEvent.keyDown(pill, { key, shiftKey: key === "F10" });
  // The open preview is a nested surface: Escape dismisses only it first.
  fireEvent.keyDown(pill, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  fireEvent.keyDown(pill, { key: "Escape" });
  expect(keys).toEqual(["F10", "ContextMenu", "ArrowUp", "PageUp", "Escape"]);
});

it("keeps emojis visually active but rejects another click while delivery is pending or failed", async () => {
  let release!: () => void;
  const publish = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const h = harness([react(other)], publish);
  render(<h.Controls />);
  fireEvent.click(
    screen.getByRole("button", { name: `👍: ${other.pubkey.slice(0, 10)}` }),
  );
  await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  const pill = screen.getByRole("button", {
    name: "👍: 2 people",
  });
  expect(pill.getAttribute("aria-disabled")).toBe("true");
  expect(pill.hasAttribute("disabled")).toBe(false);
  fireEvent.click(pill);
  expect(h.session.outbox?.snapshot()).toHaveLength(1);
  // Fresh hover still keeps the preview off delivery recovery controls.
  vi.useFakeTimers();
  try {
    fireEvent.mouseEnter(pill);
    fireEvent.mouseMove(pill);
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_REST_MS));
    expect(screen.queryByRole("tooltip")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
  await act(async () => {
    release();
    await flush();
    await flush();
  });
  expect(pill.getAttribute("aria-disabled")).toBe("false");
  // Only delivery held back the preview that the hover opened.
  expect(screen.getByRole("tooltip").textContent).toContain("You");

  const failed = harness(
    [react(other)],
    vi.fn(async () => {
      throw new PublishRejected("Nope");
    }),
  );
  const failedView = render(<failed.Controls />);
  fireEvent.click(
    within(failedView.container).getByRole("button", {
      name: `👍: ${other.pubkey.slice(0, 10)}`,
    }),
  );
  await act(async () => {
    await flush();
    await flush();
  });
  const failedPill = within(failedView.container)
    .getByTestId("reaction-row")
    .querySelector("button[data-reaction]");
  if (!failedPill) throw new Error("Reaction missing");
  expect(failedPill.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(failedPill);
  expect(failed.session.outbox?.snapshot()).toHaveLength(1);
});

it("uses the picker catalog URL even when an old URL has my reaction", async () => {
  const oldUrl = "https://a.test/old.png";
  const newUrl = "https://a.test/new.png";
  const pickerTools = registry<ComposerTool>([
    {
      key: "picker",
      pluginId: "picker",
      revision: "one",
      id: "picker",
      title: "Picker",
      component: () => null,
      reactionComponent: ({ select }: ReactionToolProps) => (
        <button type="button" onClick={() => select(":party:")}>
          Choose party
        </button>
      ),
    },
  ]);
  const h = harness(
    [customReaction(viewer, "party", oldUrl)],
    undefined,
    pickerTools,
  );
  h.live.receive([
    signed(other, {
      kind: 30030,
      content: "",
      created_at: 3,
      tags: [
        ["d", "buzz:custom-emoji"],
        ["emoji", "party", newUrl],
      ],
    }),
  ]);
  render(<h.Controls />);
  fireEvent.click(
    within(screen.getByTestId("inline-add-reaction")).getByRole("button", {
      name: "Choose party",
    }),
  );
  const operation = h.session.outbox?.snapshot()[0];
  expect(operation?.event.kind).toBe(7);
  expect(operation?.event.tags).toContainEqual(["emoji", "party", newUrl]);
  const parties = screen.getAllByRole("button", {
    name: ":party:: You",
  });
  expect(parties).toHaveLength(2);
  expect(parties[0]?.querySelector("img")?.getAttribute("src")).toBe(oldUrl);
  expect(parties[1]?.querySelector("img")?.getAttribute("src")).toBe(newUrl);
  await act(async () => {
    await flush();
    await flush();
  });
});

it("uses the original animated emoji in reaction emojis and previews", async () => {
  const url = "https://a.test/eyes-intensifies.gif";
  const media = vi.fn((source: string, size?: "small") =>
    size === "small" ? source.replace(/\.gif$/, ".thumb.jpg") : source,
  );
  const h = harness(
    [customReaction(other, "eyes-intensifies", url)],
    undefined,
    tools,
    media,
  );
  render(<h.Controls />);
  const pill = screen.getByRole("button", {
    name: `:eyes-intensifies:: ${other.pubkey.slice(0, 10)}`,
  });
  expect(pill.querySelector("img")?.getAttribute("src")).toBe(url);
  fireEvent.mouseEnter(pill);
  fireEvent.mouseMove(pill);
  const preview = await screen.findByRole("tooltip", {}, { timeout: 2500 });
  expect(preview.querySelector("img")?.getAttribute("src")).toBe(url);
  expect(media).not.toHaveBeenCalledWith(url, "small");
});

it("loads names for people who only reacted after a preview opens", async () => {
  const people = Array.from({ length: 5 }, () => keypair());
  const h = harness(people.map((person) => react(person)));
  render(<h.Controls />);
  // Complete startup reads so the scheduler can admit background reactor names.
  await act(async () => {
    const completed = new Set();
    await flush();
    let pending = h.wire.pending.find((entry) => !completed.has(entry));
    while (pending) {
      completed.add(pending);
      pending.respond([]);
      await flush();
      pending = h.wire.pending.find((entry) => !completed.has(entry));
    }
  });
  const pill = screen.getByRole("button", {
    name: "👍: 5 people",
  });
  fireEvent.mouseEnter(pill);
  fireEvent.mouseMove(pill);
  const preview = await screen.findByRole("tooltip");
  const profileReads = () =>
    h.wire.pending.filter((entry) =>
      entry.filters.some((filter) => filter.kinds?.includes(0)),
    );
  await waitFor(() => {
    const requested = profileReads().flatMap((entry) =>
      entry.filters.flatMap((filter) => filter.authors ?? []),
    );
    for (const person of people) expect(requested).toContain(person.pubkey);
  });
  await act(async () => {
    for (const entry of profileReads()) {
      const requested = entry.filters.flatMap((filter) => filter.authors ?? []);
      entry.respond(
        people.flatMap((person, index) =>
          requested.includes(person.pubkey)
            ? [profile(person, { name: `Fresh Reactor ${index + 1}` })]
            : [],
        ),
      );
    }
    await flush();
  });
  await waitFor(() => {
    for (let index = 1; index <= people.length; index++)
      expect(preview.textContent).toContain(`Fresh Reactor ${index}`);
  });
});

const tagless = (key: typeof viewer, code: string) =>
  signed(key, {
    kind: 7,
    content: `:${code}:`,
    created_at: 2,
    tags: [
      ["h", "c"],
      ["e", root.id],
    ],
  });
const palette = (code: string, url: string) =>
  signed(other, {
    kind: 30030,
    content: "",
    created_at: 3,
    tags: [
      ["d", "buzz:custom-emoji"],
      ["emoji", code, url],
    ],
  });
const glyph = (pill: HTMLElement) => {
  const slot = pill.querySelector("[data-reaction-glyph]");
  if (!slot) throw new Error("Reaction glyph missing");
  return slot;
};
const showsPlaceholder = (slot: Element, shortcode: string) => {
  expect(slot.querySelector("svg")).not.toBeNull();
  expect(slot.querySelector("img")).toBeNull();
  expect(slot.textContent).not.toContain(shortcode);
};

it("draws a tagless shortcode from the community palette, once the palette arrives", async () => {
  const url = "https://a.test/approve.png";
  const h = harness([tagless(other, "approve")]);
  render(<h.Controls />);
  const pill = screen.getByRole("button", {
    name: `:approve:: ${other.pubkey.slice(0, 10)}`,
  });
  showsPlaceholder(glyph(pill), ":approve:");
  act(() => h.live.receive([palette("approve", url)]));
  await waitFor(() =>
    expect(pill.querySelector("img")?.getAttribute("src")).toBe(url),
  );
  expect(glyph(pill).textContent).toBe("");
  fireEvent.mouseEnter(pill);
  fireEvent.mouseMove(pill);
  const preview = await screen.findByRole("tooltip", {}, { timeout: 2500 });
  expect(preview.querySelector("img")?.getAttribute("src")).toBe(url);
});

it("shows a neutral glyph for an unknown shortcode, keeping it as the name", async () => {
  const h = harness([tagless(other, "mystery")]);
  render(<h.Controls />);
  const pill = screen.getByRole("button", {
    name: `:mystery:: ${other.pubkey.slice(0, 10)}`,
  });
  showsPlaceholder(glyph(pill), ":mystery:");
  fireEvent.mouseEnter(pill);
  fireEvent.mouseMove(pill);
  const preview = await screen.findByRole("tooltip", {}, { timeout: 2500 });
  expect(preview.querySelector("svg")).not.toBeNull();
  expect(preview.querySelector("img")).toBeNull();
});

it("shows a neutral glyph in pills and previews when media is refused or fails", async () => {
  const h = harness(
    [
      customReaction(other, "denied", "https://a.test/denied.png"),
      customReaction(other, "broken", "https://a.test/broken.png"),
      tagless(other, "refused"),
    ],
    undefined,
    tools,
    (url) =>
      url.includes("denied") || url.includes("refused") ? undefined : url,
  );
  h.live.receive([palette("refused", "https://a.test/refused.png")]);
  render(<h.Controls />);
  const pillFor = (code: string) =>
    screen.getByRole("button", {
      name: `:${code}:: ${other.pubkey.slice(0, 10)}`,
    });
  const denied = pillFor("denied");
  const broken = pillFor("broken");
  showsPlaceholder(glyph(denied), ":denied:");
  showsPlaceholder(glyph(pillFor("refused")), ":refused:");
  const image = broken.querySelector("img");
  if (!image) throw new Error("Custom reaction image missing");
  fireEvent.error(image);
  showsPlaceholder(glyph(broken), ":broken:");
  fireEvent.mouseEnter(denied);
  fireEvent.mouseMove(denied);
  const preview = await screen.findByRole("tooltip", {}, { timeout: 2500 });
  expect(preview.querySelector("svg")).not.toBeNull();
  fireEvent.mouseLeave(denied, { relatedTarget: broken });
  fireEvent.mouseEnter(broken, { relatedTarget: denied });
  fireEvent.mouseMove(broken);
  const brokenPreview = () =>
    screen
      .queryAllByRole("tooltip")
      .find((item) => item.textContent?.includes(":broken:"));
  await waitFor(() => expect(brokenPreview()).toBeDefined(), {
    timeout: 2500,
  });
  const previewImage = brokenPreview()?.querySelector("img");
  if (!previewImage) throw new Error("Preview image missing");
  fireEvent.error(previewImage);
  expect(brokenPreview()?.querySelector("svg")).not.toBeNull();
  expect(brokenPreview()?.querySelector("img")).toBeNull();
});

it("forwards the contributed picker into true toggles and releases confirmed writes without an echo", async () => {
  const pickerTools = registry<ComposerTool>([
    {
      key: "picker",
      pluginId: "picker",
      revision: "one",
      id: "picker",
      title: "Picker",
      component: () => null,
      reactionComponent: ({ select, disabled }: ReactionToolProps) => (
        <button type="button" disabled={disabled} onClick={() => select("👍")}>
          Choose from picker
        </button>
      ),
    },
  ]);
  const h = harness([react()], undefined, pickerTools);
  render(<h.Controls />);
  const picker = screen.getAllByRole("button", {
    name: "Choose from picker",
  })[0];
  if (!picker) throw new Error("Picker control missing");
  fireEvent.click(picker);
  expect(h.session.outbox?.snapshot()[0]?.event.kind).toBe(5);
  await act(async () => {
    await flush();
    await flush();
  });
  expect(h.session.outbox?.snapshot()[0]?.delivery).toBe("accepted");
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
  fireEvent.click(picker);
  expect(h.session.outbox?.snapshot().map((item) => item.event.kind)).toEqual([
    5, 7,
  ]);
  await act(async () => {
    await flush();
    await flush();
  });
});

it("rolls back a failed last-reaction removal and retries it after remount", async () => {
  const publish = vi.fn(async (_event: RelayEvent) => {
    throw new PublishRejected("Nope");
  });
  const h = harness([react()], publish);
  const view = render(<h.Controls />);
  fireEvent.click(screen.getByRole("button", { name: "👍: You" }));
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
  await act(async () => {
    await flush();
    await flush();
  });
  expect(screen.getByRole("button", { name: "👍: You" })).toBeTruthy();
  view.unmount();
  render(<h.Controls />);
  expect(
    screen.getAllByRole("button", { name: "Retry reaction" }),
  ).toHaveLength(1);
  const original = publish.mock.calls[0]?.[0];
  publish.mockImplementation(async () => undefined as never);
  fireEvent.click(screen.getByRole("button", { name: "Retry reaction" }));
  await act(async () => {
    await flush();
    await flush();
  });
  expect(publish.mock.calls[1]?.[0]).toEqual(original);
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
});

it("leaves a refused reaction past the relay's window only a Discard, which lets the person react again", async () => {
  const publish = vi.fn(intake(refused));
  const h = harness([], publish);
  render(<h.Controls />);
  fireEvent.click(picker());
  await settle();
  expire();
  fireEvent.click(retry() as HTMLElement);
  await settle();
  // The retry reproduced the dead end: refused, never sent, still blocking.
  const [stuck] = h.session.outbox?.snapshot() ?? [];
  expect(stuck?.delivery).toBe("failed");
  expect(stuck?.error).toBe(TOO_OLD);
  expect(picker().disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(
    "Couldn’t update reaction, and it is too old to retry.",
  );
  expect(retry()).toBeNull();
  fireEvent.click(discard() as HTMLElement);
  await settle();
  expect(h.session.outbox?.snapshot()).toEqual([]);
  // Known not to have been sent, so the relay is not asked.
  expect(h.check.asked).toEqual([]);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
  // The person reacts again with a new event.
  publish.mockImplementation(async () => {});
  expect(picker().disabled).toBe(false);
  fireEvent.click(picker());
  await settle();
  const sent = publish.mock.calls.at(-1)?.[0];
  expect(sent?.kind).toBe(7);
  expect(sent?.id).not.toBe(stuck?.event.id);
  expect(screen.getByRole("button", { name: "👍: You" })).toBeTruthy();
});

it("says how long an unconfirmed reaction must wait before it can be discarded", async () => {
  const h = harness([], vi.fn(intake(unanswered)));
  render(<h.Controls />);
  fireEvent.click(picker());
  await settle();
  expect(screen.getByRole("status").textContent).toContain(
    "Reaction delivery not confirmed. Retry it, or discard it once it is 15 minutes old.",
  );
  // The rule holds for a caller that does not go through the button.
  const [sent] = h.session.outbox?.snapshot() ?? [];
  await expect(
    discardReaction(h.session, sent?.event.id ?? ""),
  ).rejects.toThrow(
    "This reaction update may still be delivered. Retry it, or discard it once it is 15 minutes old.",
  );
  expect(h.session.outbox?.snapshot()).toHaveLength(1);
  expect(h.check.asked).toEqual([]);
});

it("discards a refused reaction inside the window without asking the relay", async () => {
  const h = harness([react(other)], vi.fn(intake(refused)));
  render(<h.Controls />);
  fireEvent.click(picker());
  await settle();
  expect(screen.getByRole("status").textContent).toContain(
    "Couldn’t update reaction.",
  );
  expect(retry()).toBeTruthy();
  fireEvent.click(discard() as HTMLElement);
  await settle();
  expect(h.session.outbox?.snapshot()).toEqual([]);
  expect(h.check.asked).toEqual([]);
  // What the relay has is what shows: their reaction, not mine.
  expect(
    screen.getByRole("button", { name: `👍: ${other.pubkey.slice(0, 10)}` }),
  ).toBeTruthy();
  expect(picker().disabled).toBe(false);
});

it("keeps an unconfirmed reaction that may still arrive, and discards it once the relay never can receive it", async () => {
  const publish = vi.fn(intake(unanswered));
  const h = harness([], publish);
  render(<h.Controls />);
  fireEvent.click(picker());
  await settle();
  const [sent] = h.session.outbox?.snapshot() ?? [];
  expect(sent?.delivery).toBe("unknown");
  // It may still reach the relay: shown as mine, with Retry and no Discard.
  expect(screen.getByRole("button", { name: "👍: You" })).toBeTruthy();
  expect(retry()).toBeTruthy();
  expect(discard()).toBeNull();
  expire();
  fireEvent.click(retry() as HTMLElement);
  await settle();
  // The dead end: the same event can never be sent, and nothing confirms it.
  expect(h.session.outbox?.snapshot()[0]?.delivery).toBe("unknown");
  expect(h.session.outbox?.snapshot()[0]?.error).toBe(
    `Retry blocked: ${TOO_OLD}`,
  );
  expect(picker().disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(
    "Reaction delivery not confirmed, and it is too old to retry.",
  );
  expect(retry()).toBeNull();
  // A relay that cannot be asked keeps it.
  h.check.fail = new Error("Relay unavailable");
  h.idle();
  fireEvent.click(discard() as HTMLElement);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Couldn’t check whether this reaction update was delivered, so it was kept. Try Discard again.",
  );
  expect(h.session.outbox?.snapshot()).toHaveLength(1);
  expect(screen.getByRole("button", { name: "👍: You" })).toBeTruthy();
  // The relay never received it: given up, and no longer shown as mine.
  delete h.check.fail;
  h.check.asked.length = 0;
  fireEvent.click(discard() as HTMLElement);
  await waitFor(() => expect(h.session.outbox?.snapshot()).toEqual([]));
  expect(h.check.asked).toEqual([
    {
      kinds: [7],
      ids: [sent?.event.id],
      authors: [viewer.pubkey],
      limit: 1,
      consistency: "strong",
    },
  ]);
  expect(h.session.outbox?.snapshot()).toEqual([]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
  publish.mockImplementation(async () => {});
  fireEvent.click(picker());
  await settle();
  expect(publish.mock.calls.at(-1)?.[0].id).not.toBe(sent?.event.id);
  expect(screen.getByRole("button", { name: "👍: You" })).toBeTruthy();
});

it("keeps an unconfirmed reaction the relay did receive, and says so", async () => {
  const publish = vi.fn(intake(unanswered));
  const h = harness([], publish);
  const view = render(<h.Controls />);
  fireEvent.click(picker());
  await settle();
  const sent = publish.mock.calls[0]?.[0];
  if (!sent) throw new Error("Reaction was not published");
  // Opened again after the window: Discard stands alone.
  view.unmount();
  expire();
  render(<h.Controls />);
  expect(retry()).toBeNull();
  h.check.has.push(sent);
  h.idle();
  fireEvent.click(discard() as HTMLElement);
  // Settled as delivered: nothing is left to retry or discard.
  await waitFor(() => expect(h.session.outbox?.snapshot()).toEqual([]));
  expect(
    (
      await screen.findByText(
        "This reaction update had already been delivered, so it was kept.",
      )
    ).getAttribute("role"),
  ).toBe("status");
  expect(publish).toHaveBeenCalledTimes(1);
  expect(retry()).toBeNull();
  expect(discard()).toBeNull();
  // The reaction the relay has stays mine, and can be removed as usual.
  publish.mockImplementation(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "👍: You" }));
  await settle();
  const removal = publish.mock.calls.at(-1)?.[0];
  expect(removal?.kind).toBe(5);
  expect(removal?.tags).toContainEqual(["e", sent.id]);
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
});

it("restores my reaction when an unconfirmed removal never reached the relay", async () => {
  const publish = vi.fn(intake(unanswered));
  const mine = react();
  const h = harness([mine], publish);
  render(<h.Controls />);
  fireEvent.click(screen.getByRole("button", { name: "👍: You" }));
  await settle();
  const [removal] = h.session.outbox?.snapshot() ?? [];
  expect(removal?.event.kind).toBe(5);
  expect(removal?.delivery).toBe("unknown");
  // Shown as removed while the removal may still arrive.
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
  expect(discard()).toBeNull();
  expire();
  fireEvent.click(retry() as HTMLElement);
  await settle();
  expect(picker().disabled).toBe(true);
  h.idle();
  fireEvent.click(discard() as HTMLElement);
  await waitFor(() => expect(h.session.outbox?.snapshot()).toEqual([]));
  expect(h.check.asked.at(-1)).toMatchObject({
    kinds: [5],
    ids: [removal?.event.id],
  });
  // The relay still has the reaction, so it is mine again and can be removed.
  const pill = screen.getByRole("button", { name: "👍: You" });
  publish.mockImplementation(async () => {});
  fireEvent.click(pill);
  await settle();
  const again = publish.mock.calls.at(-1)?.[0];
  expect(again?.kind).toBe(5);
  expect(again?.id).not.toBe(removal?.event.id);
  expect(again?.tags).toContainEqual(["e", mine.id]);
});

it("keeps an unconfirmed removal the relay did receive", async () => {
  const publish = vi.fn(intake(unanswered));
  const h = harness([react()], publish);
  const view = render(<h.Controls />);
  fireEvent.click(screen.getByRole("button", { name: "👍: You" }));
  await settle();
  const sent = publish.mock.calls[0]?.[0];
  if (!sent) throw new Error("Removal was not published");
  view.unmount();
  expire();
  render(<h.Controls />);
  h.check.has.push(sent);
  h.idle();
  fireEvent.click(discard() as HTMLElement);
  await waitFor(() => expect(h.session.outbox?.snapshot()).toEqual([]));
  expect(
    (
      await screen.findByText(
        "This reaction update had already been delivered, so it was kept.",
      )
    ).getAttribute("role"),
  ).toBe("status");
  // Removed on the relay, so removed here, and the person can react again.
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
  publish.mockImplementation(async () => {});
  fireEvent.click(picker());
  await settle();
  expect(publish.mock.calls.at(-1)?.[0].kind).toBe(7);
  expect(screen.getByRole("button", { name: "👍: You" })).toBeTruthy();
});

it("retires reaction previews while retaining the reaction delivery owner", async () => {
  const h = harness([react(other)]);
  vi.useFakeTimers();
  try {
    const tree = (active: boolean) => (
      <ConversationPresentation value={active}>
        <div hidden={!active} inert={!active}>
          <h.Controls />
        </div>
      </ConversationPresentation>
    );
    const view = render(tree(true));
    const pill = screen.getByRole("button", {
      name: `👍: ${other.pubkey.slice(0, 10)}`,
    });
    fireEvent.mouseEnter(pill);
    fireEvent.mouseMove(pill);
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_REST_MS - 1));
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("tooltip")).toBeTruthy();
    const reactions = screen.getByTestId("reaction-row");
    view.rerender(tree(false));
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(screen.getByTestId("reaction-row")).toBe(reactions);
    view.rerender(tree(true));
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(h.publish).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps focus on the bubble when my reaction is removed and another person remains", async () => {
  const h = harness([react(), react(other)]);
  const onFocusedRemoval = vi.fn();
  render(<h.Controls onFocusedRemoval={onFocusedRemoval} />);
  const own = screen.getByRole("button", { name: "👍: 2 people" });
  act(() => own.focus());
  fireEvent.click(own);
  expect(onFocusedRemoval).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(own);
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
  expect(
    screen.getByRole("button", { name: `👍: ${other.pubkey.slice(0, 10)}` }),
  ).toBeTruthy();
  await act(async () => {
    await flush();
    await flush();
  });
});
it("hands focus back when the last reaction is removed", async () => {
  const h = harness([react()]);
  const onFocusedRemoval = vi.fn();
  render(<h.Controls onFocusedRemoval={onFocusedRemoval} />);
  const own = screen.getByRole("button", { name: "👍: You" });
  act(() => own.focus());
  fireEvent.click(own);
  expect(onFocusedRemoval).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "👍: You" })).toBeNull();
  await act(async () => {
    await flush();
    await flush();
  });
});
it.each([false, true])(
  "hides inline add on coordination while retaining existing reactions (%s)",
  (populated) => {
    const pickerTools = registry<ComposerTool>([
      {
        key: "picker",
        pluginId: "picker",
        revision: "one",
        id: "picker",
        title: "Picker",
        component: () => null,
        reactionComponent: ({ select }: ReactionToolProps) => (
          <button type="button" onClick={() => select("👍")}>
            Choose reaction
          </button>
        ),
      },
    ]);
    const h = harness(populated ? [react(other)] : [], undefined, pickerTools);
    const view = render(<h.Controls audience="agents" />);
    expect(screen.queryByTestId("inline-add-reaction")).toBeNull();
    if (populated)
      expect(
        screen.getByRole("button", {
          name: `👍: ${other.pubkey.slice(0, 10)}`,
        }),
      ).toBeTruthy();
    view.rerender(<h.Controls audience="agents" disabled />);
    expect(screen.queryByTestId("inline-add-reaction")).toBeNull();
    view.rerender(<h.Controls />);
    if (populated)
      expect(
        within(screen.getByTestId("inline-add-reaction")).getByRole("button", {
          name: "Choose reaction",
        }),
      ).toBeTruthy();
    else expect(screen.queryByTestId("inline-add-reaction")).toBeNull();
  },
);
it("keeps the raw emoji when the name table fails to load, and the next reveal retries", async () => {
  const h = harness([react(other)]);
  render(<h.Controls />);
  const pill = screen.getByRole("button", {
    name: `👍: ${other.pubkey.slice(0, 10)}`,
  });
  // A navigation cancels the chunk in flight, so the import rejects.
  vi.doMock("./reaction-name", () =>
    Promise.reject(new TypeError("Importing a module script failed.")),
  );
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    fireEvent.mouseEnter(pill);
    fireEvent.mouseMove(pill);
    const preview = await screen.findByRole("tooltip", {}, { timeout: 2500 });
    // The mocked import rejects after one tick or several; wait for its handler.
    await waitFor(() =>
      expect(warned).toHaveBeenCalledWith(
        "The reaction name table didn't load",
        expect.any(Error),
      ),
    );
    await act(flush);
    expect(preview.textContent).not.toContain(":+1:");
    expect(unhandled).not.toHaveBeenCalled();
    vi.doUnmock("./reaction-name");
    act(() => pill.focus());
    await waitFor(() => expect(preview.textContent).toContain(":+1:"));
  } finally {
    vi.doUnmock("./reaction-name");
    process.off("unhandledRejection", unhandled);
    warned.mockRestore();
  }
});
