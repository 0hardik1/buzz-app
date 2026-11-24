// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import type { BuzzClient } from "../../buzz-mcp/client";
import { CanvasPanel } from "./CanvasPanel";
import { createCanvasChannel } from "./store";
import { memoryCanvasRelay } from "./testing";
import { canvasTools } from "./tools";
import { createCanvasViews } from "./view";

afterEach(cleanup);

const ADA = "a".repeat(64);
const BEN = "b".repeat(64);
const AGENT = "c".repeat(64);
const CHANNEL = "11111111-1111-4111-8111-111111111111";

/** A view with one value, which its own button raises. */
function setup() {
  const views = createCanvasViews();
  views.register<{ count: number }>({
    type: "counter",
    title: "Counter",
    initial: { count: 0 },
    parse: (input) =>
      typeof (input as { count?: unknown })?.count === "number"
        ? { count: (input as { count: number }).count }
        : undefined,
    describe: (state) => `Counts ${state.count}.`,
    component: ({ state, update }) => (
      <button type="button" onClick={() => update({ count: state.count + 1 })}>
        Count {state.count}
      </button>
    ),
  });
  const relay = memoryCanvasRelay();
  const seat = (viewer: string, label: string) => {
    const channel = createCanvasChannel({
      channelId: CHANNEL,
      views,
      ...relay,
    });
    render(
      <section aria-label={label}>
        <CanvasPanel
          channel={channel}
          views={views}
          viewer={viewer}
          name={(pubkey) => (pubkey === ADA ? "Ada" : "Ben")}
        />
      </section>,
    );
    return within(screen.getByRole("region", { name: label }));
  };
  return { views, relay, seat };
}

it("a follower sees what the driver does and can look around alone without changing it", async () => {
  const user = userEvent.setup();
  const { seat } = setup();
  const ada = seat(ADA, "Ada's screen");
  const ben = seat(BEN, "Ben's screen");

  await user.click(await ada.findByRole("button", { name: "Take control" }));
  await user.click(ada.getByRole("button", { name: "Counter" }));
  await user.click(await ada.findByRole("button", { name: "Count 0" }));
  expect(await ben.findByRole("button", { name: "Count 1" })).toBeVisible();
  expect(ben.getByRole("status")).toHaveTextContent("Following Ada.");

  // On his own, Ben's change stays his.
  await user.click(ben.getByRole("button", { name: "Stop following" }));
  await user.click(ben.getByRole("button", { name: "Count 1" }));
  expect(ben.getByRole("button", { name: "Count 2" })).toBeVisible();
  expect(ada.getByRole("button", { name: "Count 1" })).toBeVisible();

  // Following again shows the driver's view, not his.
  await user.click(ben.getByRole("button", { name: "Follow Ada" }));
  expect(ben.getByRole("button", { name: "Count 1" })).toBeVisible();

  // Taking control makes Ada the follower.
  await user.click(ben.getByRole("button", { name: "Take control" }));
  expect(await ada.findByRole("status")).toHaveTextContent("Following Ben.");
});

it("an agent opens and reads views, and waits its turn while a person drives", async () => {
  const { views, relay, seat } = setup();
  const shown: string[] = [];
  const tools = canvasTools(views, (channelId) => {
    shown.push(channelId);
    return true;
  });
  const client = {
    pubkey: AGENT,
    query: relay.read,
    publish: relay.publish,
  } as unknown as BuzzClient;
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No tool ${name}`);
    return JSON.parse(
      (await tool.call(client, { channel: CHANNEL } as never, args)) as string,
    );
  };

  const opened = await call("canvas_open", {
    type: "counter",
    state: { count: 7 },
    title: "Votes",
  });
  expect(opened.views).toEqual([
    {
      id: "counter-1",
      type: "counter",
      title: "Votes",
      shows: "Counts 7.",
      state: { count: 7 },
    },
  ]);
  expect(shown).toEqual([CHANNEL]);
  await expect(
    call("canvas_open", { type: "counter", state: { count: "many" } }),
  ).rejects.toThrow("not a valid state");

  const ada = seat(ADA, "Ada's screen");
  expect(await ada.findByRole("tab", { name: "Votes" })).toBeVisible();
  await userEvent.click(ada.getByRole("button", { name: "Take control" }));
  await expect(
    call("canvas_update", { id: "counter-1", state: { count: 8 } }),
  ).rejects.toThrow("Someone else is driving");
  expect((await call("canvas_drive", { drive: true })).driver).toBe(AGENT);
  await call("canvas_update", { id: "counter-1", state: { count: 8 } });
  expect(await ada.findByRole("button", { name: "Count 8" })).toBeVisible();
});
