// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { createRelaySession } from "../../features/relay/session";
import type {
  Decisions,
  DecisionResult,
} from "../../features/decisions/service";
import type { Profile, ChannelSummary } from "../../features/relay/contracts";
import { NewRailSection } from "./NewRailSection";
import type { RelaySession } from "../../features/relay/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => false }));
const owners: ReturnType<typeof createRelaySession>[] = [];
afterEach(() => {
  cleanup();
  for (const owner of owners.splice(0)) owner.dispose();
  localStorage.clear();
  vi.useRealTimers();
});

test("typing updates the preview after a pause without Enter, and announces the pending interpretation", async () => {
  vi.useFakeTimers();
  let release!: (value: DecisionResult) => void;
  const gate = new Promise<DecisionResult>((resolve) => {
    release = resolve;
  });
  const fixture = setup(vi.fn(() => gate));
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    { target: { value: "show all DMs" } },
  );
  await act(() => vi.advanceTimersByTimeAsync(299));
  expect(fixture.decide).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(fixture.decide).toHaveBeenCalledOnce();
  expect(screen.queryByRole("status")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(screen.getByRole("status")).toHaveTextContent("Updating preview");
  expect(screen.getByRole("button", { name: "Create section" })).toBeDisabled();
  await act(async () => {
    release(answer);
    await gate;
  });
  expect(screen.getByRole("button", { name: "Create section" })).toBeEnabled();
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(fixture.decide).toHaveBeenCalledOnce();
});

test("clearing a live query allows a named empty section without a scheduled preview", async () => {
  vi.useFakeTimers();
  const fixture = setup();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    { target: { value: "show all DMs" } },
  );
  fireEvent.change(screen.getByRole("textbox", { name: /^Section name/ }), {
    target: { value: "Projects" },
  });
  expect(screen.getByRole("button", { name: "Create section" })).toBeDisabled();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    {
      target: { value: "" },
    },
  );
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(fixture.decide).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Create section" })).toBeEnabled();
});

test.each([
  [
    "dms with baxen, wesb, and morgan",
    "DMs with Brad Axen, Wes Park, Morgan Lee",
  ],
  ['"navigation" with baxen, wesb, and morgan', "navigation"],
  ["“navigation” with baxen, wesb, and morgan", "navigation"],
])("known people preview immediately for %s", (description, title) => {
  vi.useFakeTimers();
  const keys = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  const fixture = setup(
    vi.fn(async () => answer),
    new Map([
      [keys[0] ?? "", { name: "Brad Axen", username: "baxen" }],
      [keys[1] ?? "", { name: "Wes Park", username: "wesb" }],
      [keys[2] ?? "", { name: "Morgan Lee" }],
    ]),
    [
      {
        id: "dm-baxen",
        name: "Brad",
        channelType: "dm",
        hidden: true,
        participants: [keys[0] ?? ""],
      },
    ],
  );
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    { target: { value: description } },
  );
  expect(
    screen.getByRole("heading", {
      name: title,
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Brad Axen" })).toBeInTheDocument();
  expect(screen.queryByText("No matching DMs yet.")).toBeNull();
  expect(screen.getByRole("button", { name: "Create section" })).toBeEnabled();
  expect(fixture.decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Create section" }));
  expect(fixture.create).toHaveBeenCalledWith(title, {
    version: 1,
    dms: true,
    people: keys,
  });
});
const answer: DecisionResult = {
  outcome: "answered",
  backend: "fixture",
  model: "fixture",
  answers: {
    kind: { type: "choice", choice: "dms", confidence: 1, probabilities: {} },
    allDms: { type: "yes_no", probability: 1 },
    allPeople: { type: "yes_no", probability: 1 },
  },
};
function setup(
  decide = vi.fn(async () => answer),
  profiles: ReadonlyMap<string, Profile> = new Map(),
  channels: readonly ChannelSummary[] = [],
  lookup?: RelaySession["directMessages"]["people"],
) {
  const owner = createRelaySession(null);
  owners.push(owner);
  const create = vi.fn(() => true);
  const close = vi.fn();
  const listing = { status: "ready" as const, channels };
  const session = {
    ...owner.session,
    profiles: { ...owner.session.profiles, snapshot: () => profiles },
    directMessages: {
      ...owner.session.directMessages,
      people: lookup ?? (async () => ({ people: [], hasMore: false })),
    },
    channels: {
      ...owner.session.channels,
      list: () => listing,
      get: (id: string) => channels.find((channel) => channel.id === id),
    },
    scope: `https://relay.example:${"c".repeat(64)}`,
    viewer: "c".repeat(64),
  };
  const view = render(
    <NewRailSection
      session={session}
      community="https://relay.example"
      decisions={{ decide } as unknown as Decisions}
      create={create}
      close={close}
      finalFocus={false}
    />,
  );
  return { create, close, decide, ...view, user: userEvent.setup() };
}

test("editing a description or failing to regenerate cannot save the previous preview", async () => {
  const fixture = setup();
  const input = screen.getByRole("searchbox", { name: "Describe a section" });
  await fixture.user.type(input, "show all DMs{Enter}");
  expect(
    await screen.findByRole("button", { name: "Create section" }),
  ).toBeEnabled();
  await fixture.user.clear(input);
  await fixture.user.type(input, "DMs with Casey");
  expect(screen.getByRole("button", { name: "Create section" })).toBeDisabled();
  expect(screen.queryByText("Everyone")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Direct messages" })).toBeNull();
  fixture.decide.mockRejectedValueOnce(new Error("Provider offline"));
  await fixture.user.keyboard("{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Provider offline",
  );
  expect(screen.getByRole("button", { name: "Create section" })).toBeDisabled();
  expect(fixture.create).not.toHaveBeenCalled();
});

test("clearing a query retires its in-flight interpretation, and named empty saves remain retryable", async () => {
  let release!: (value: DecisionResult) => void;
  const gate = new Promise<DecisionResult>((resolve) => {
    release = resolve;
  });
  const fixture = setup(vi.fn(() => gate));
  await fixture.user.type(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    "show all DMs{Enter}",
  );
  expect(fixture.decide).toHaveBeenCalledTimes(1);
  await fixture.user.clear(
    screen.getByRole("searchbox", { name: "Describe a section" }),
  );
  await fixture.user.type(
    screen.getByRole("textbox", { name: /^Section name/ }),
    "My work",
  );
  await act(async () => {
    release(answer);
    await gate;
  });
  fixture.create.mockReturnValueOnce(false);
  await fixture.user.click(
    screen.getByRole("button", { name: "Create section" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save");
  expect(fixture.close).not.toHaveBeenCalled();
  await fixture.user.click(
    screen.getByRole("button", { name: "Create section" }),
  );
  expect(fixture.create).toHaveBeenLastCalledWith("My work", undefined);
  expect(fixture.close).toHaveBeenCalledOnce();
});

test("quoted names stay out of interpretation, allow overrides, and reset when removed", async () => {
  const fixture = setup();
  const input = screen.getByRole("searchbox", { name: "Describe a section" });
  const name = screen.getByRole("textbox", { name: /^Section name/ });
  fireEvent.change(input, { target: { value: '"navigation" show all DMs' } });
  await fixture.user.keyboard("{Enter}");
  expect(
    await screen.findByRole("heading", { name: "navigation" }),
  ).toBeInTheDocument();
  expect(name).toHaveValue("navigation");
  expect(fixture.decide).toHaveBeenCalledWith(
    expect.objectContaining({
      state: expect.stringContaining('"request":"show all DMs"'),
    }),
  );
  fireEvent.change(name, { target: { value: "My navigation" } });
  fireEvent.change(input, { target: { value: '"navigation" all DMs' } });
  expect(
    screen.getByRole("heading", { name: "My navigation" }),
  ).toBeInTheDocument();
  fireEvent.change(input, { target: { value: '"inbox" all DMs' } });
  expect(name).toHaveValue("inbox");
  fireEvent.change(input, { target: { value: "all DMs" } });
  expect(name).toHaveValue("");
  expect(
    screen.getByRole("heading", { name: "Direct messages" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create section" }));
  expect(fixture.create).toHaveBeenCalledWith("Direct messages", {
    version: 1,
    dms: true,
    people: [],
  });
});

test("widget selection preserves the custom draft and creates the chosen preview without interpretation", async () => {
  const fixture = setup();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    {
      target: { value: '"My notes"' },
    },
  );
  await fixture.user.click(screen.getByRole("button", { name: "Sticky note" }));
  expect(
    screen.getByRole("region", { name: "Widget preview" }),
  ).toHaveTextContent("Demo data");
  await fixture.user.click(
    screen.getByRole("button", { name: "Custom section" }),
  );
  expect(
    screen.getByRole("searchbox", { name: "Describe a section" }),
  ).toHaveValue('"My notes"');
  await fixture.user.click(screen.getByRole("button", { name: "Sticky note" }));
  fireEvent.change(screen.getByRole("textbox", { name: /^Section name/ }), {
    target: { value: "Scratchpad" },
  });
  await fixture.user.click(
    screen.getByRole("button", { name: "Create section" }),
  );
  expect(fixture.create).toHaveBeenCalledWith(
    "Scratchpad",
    undefined,
    "sticky-note",
  );
  expect(fixture.close).toHaveBeenCalledOnce();
  expect(fixture.decide).not.toHaveBeenCalled();
});

test("switching to a widget retires pending interpretation and cancel does not create a section", async () => {
  let release!: (value: DecisionResult) => void;
  const gate = new Promise<DecisionResult>((resolve) => {
    release = resolve;
  });
  const fixture = setup(vi.fn(() => gate));
  await fixture.user.type(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    "show all DMs{Enter}",
  );
  expect(fixture.decide).toHaveBeenCalledOnce();
  try {
    await fixture.user.click(
      screen.getByRole("button", { name: "Sticky note" }),
    );
    expect(
      screen.getByRole("button", { name: "Create section" }),
    ).toBeEnabled();
  } finally {
    await act(async () => {
      release(answer);
      await gate;
    });
  }
  expect(
    screen.getByRole("region", { name: "Widget preview" }),
  ).toHaveTextContent("Sticky note");
  await fixture.user.keyboard("{Escape}");
  expect(fixture.close).toHaveBeenCalledOnce();
  expect(fixture.create).not.toHaveBeenCalled();
});

test.each(["field", "quoted title"])(
  "a name alone creates an empty section via %s",
  (method) => {
    const fixture = setup();
    expect(
      screen.getByRole("button", { name: "Create section" }),
    ).toBeDisabled();
    const field =
      method === "field"
        ? screen.getByRole("textbox", { name: /^Section name/ })
        : screen.getByRole("searchbox", { name: "Describe a section" });
    fireEvent.change(field, {
      target: { value: method === "field" ? "  Projects  " : '"Projects"' },
    });
    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create section" }));
    expect(fixture.create).toHaveBeenCalledWith("Projects", undefined);
    expect(fixture.decide).not.toHaveBeenCalled();
  },
);

test("returning from a widget resumes an interrupted custom preview without editing the draft", async () => {
  vi.useFakeTimers();
  let release!: (value: DecisionResult) => void;
  const gate = new Promise<DecisionResult>((resolve) => {
    release = resolve;
  });
  const decide = vi
    .fn(async (): Promise<DecisionResult> => answer)
    .mockImplementationOnce(() => gate);
  const fixture = setup(decide);
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    { target: { value: "show all DMs" } },
  );
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(decide).toHaveBeenCalledOnce();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Sticky note" }));
    fireEvent.click(screen.getByRole("button", { name: "Custom section" }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(decide).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Create section" }),
    ).toBeEnabled();
    expect(fixture.create).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      release(answer);
      await gate;
    });
  }
});

test("DM descriptions find a verified full name while the app displays a handle", () => {
  const key = "a".repeat(64);
  const fixture = setup(
    vi.fn(async () => answer),
    new Map([
      [
        key,
        {
          name: "baxen",
          username: "baxen",
          verified: {
            displayName: "baxen",
            username: "baxen",
            fullName: "Brad Axen",
            issuerLabel: "Block",
            verifiedAt: 1,
            status: "checked",
            multipleIssuers: false,
          },
        },
      ],
    ]),
    [
      {
        id: "brad",
        name: "Brad",
        channelType: "dm",
        hidden: true,
        participants: [key],
      },
    ],
  );
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    { target: { value: "dms with brad axen" } },
  );
  expect(screen.getByRole("button", { name: "baxen" })).toBeInTheDocument();
  expect(screen.queryByText("Everyone")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create section" }));
  expect(fixture.create).toHaveBeenCalledWith("DMs with baxen", {
    version: 1,
    dms: true,
    people: [key],
  });
  expect(fixture.decide).not.toHaveBeenCalled();
});

test("plain name search discovers uncached people and previews their DMs alongside matching channels", async () => {
  vi.useFakeTimers();
  const key = "b".repeat(64);
  let release!: (
    value: Awaited<ReturnType<RelaySession["directMessages"]["people"]>>,
  ) => void;
  const gate = new Promise<
    Awaited<ReturnType<RelaySession["directMessages"]["people"]>>
  >((resolve) => {
    release = resolve;
  });
  const lookup = vi.fn(() => gate);
  const fixture = setup(
    vi.fn(async () => answer),
    new Map(),
    [
      {
        id: "dm",
        name: "Private DM",
        channelType: "dm",
        hidden: true,
        participants: [key],
      },
      { id: "channel", name: "morgan-design", channelType: "stream" },
      { id: "other", name: "Unrelated", channelType: "stream" },
    ],
    lookup,
  );
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Describe a section" }),
    { target: { value: "morg" } },
  );
  expect(
    screen.getByRole("button", { name: "morgan-design" }),
  ).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(lookup).toHaveBeenCalledWith("morg", 1, expect.any(AbortSignal));
  try {
    await act(async () => {
      release({
        people: [{ pubkey: key, name: "Morgan Lee", username: "morgan" }],
        hasMore: false,
      });
      await gate;
    });
    expect(
      screen
        .getByRole("region", { name: "Section preview" })
        .querySelectorAll("button"),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Create section" }));
    expect(fixture.create).toHaveBeenCalledWith("morg", {
      version: 1,
      dms: false,
      people: [key],
      search: "morg",
    });
    expect(fixture.decide).not.toHaveBeenCalled();
  } finally {
    release({ people: [], hasMore: false });
  }
});

test("multiple uncached DM participants resolve before inference, including an early Enter", async () => {
  vi.useFakeTimers();
  const morgan = {
    pubkey: "a".repeat(64),
    name: "Morgan Lee",
    username: "morgan",
  };
  const brad = { pubkey: "b".repeat(64), name: "Brad Axen", username: "baxen" };
  type Page = Awaited<ReturnType<RelaySession["directMessages"]["people"]>>;
  let releaseMorgan!: (page: Page) => void;
  let releaseBrad!: (page: Page) => void;
  const morganPage = new Promise<Page>((resolve) => {
    releaseMorgan = resolve;
  });
  const bradPage = new Promise<Page>((resolve) => {
    releaseBrad = resolve;
  });
  const lookup = vi.fn((text: string) =>
    text === "morgan" ? morganPage : bradPage,
  );
  const fixture = setup(
    vi.fn(async () => answer),
    new Map(),
    [],
    lookup,
  );
  const input = screen.getByRole("searchbox", { name: "Describe a section" });
  fireEvent.change(input, { target: { value: "dms with morgan and baxen" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await act(() => vi.advanceTimersByTimeAsync(300));
  try {
    expect(lookup.mock.calls.map(([query]) => query)).toEqual([
      "morgan",
      "baxen",
    ]);
    await act(async () => {
      releaseBrad({ people: [brad], hasMore: false });
      await bradPage;
    });
    expect(
      screen.getByRole("button", { name: "Create section" }),
    ).toBeDisabled();
    await act(async () => {
      releaseMorgan({ people: [morgan], hasMore: false });
      await morganPage;
    });
    fireEvent.click(screen.getByRole("button", { name: "Create section" }));
    expect(fixture.create).toHaveBeenCalledWith(
      "DMs with Morgan Lee, Brad Axen",
      { version: 1, dms: true, people: [morgan.pubkey, brad.pubkey] },
    );
    expect(fixture.decide).not.toHaveBeenCalled();
  } finally {
    releaseMorgan({ people: [], hasMore: false });
    releaseBrad({ people: [], hasMore: false });
  }
});
