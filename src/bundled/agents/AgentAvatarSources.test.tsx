// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { stubAvatarBrowserApis } from "../../features/agents/avatar-testing";
stubAvatarBrowserApis();
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { type ComponentProps, createRef, useState } from "react";
import type {
  Agent,
  AgentAvatarSource,
  Agents,
  RegisteredAgentAvatarSource,
} from "../../features/agents/service";
import { uploadAvatar } from "../../features/profiles/avatar-upload";
import { AgentIdentityDialog } from "./AgentIdentityDialog";
import { AgentAvatarPicker, type AvatarSelection } from "./AgentAvatarPicker";

vi.mock("../../features/profiles/avatar-upload", async (actual) => ({
  ...(await actual<typeof import("../../features/profiles/avatar-upload")>()),
  uploadAvatar: vi.fn(),
}));

// A test may hold decodes to control the order picks finish in.
let hold: ((src: string) => Promise<void>) | undefined;
HTMLImageElement.prototype.decode = function () {
  return hold ? hold(this.src) : Promise.resolve();
};
afterEach(() => {
  cleanup();
  hold = undefined;
  vi.mocked(uploadAvatar).mockReset();
});
/** Holds every decode until released, in any order. */
function holdDecodes() {
  const waiting: { src: string; release(): void }[] = [];
  hold = (src) =>
    new Promise((release) => waiting.push({ src, release: () => release() }));
  return waiting;
}

const picture = "https://images.example/current.png";
const png = (bytes = "png") => new Blob([bytes], { type: "image/png" });
type Choose = ComponentProps<AgentAvatarSource["component"]>["choose"];

function setup() {
  let sources: readonly RegisteredAgentAvatarSource[] = [];
  const listeners = new Set<() => void>();
  let choose: Choose = () => {};
  const names: string[] = [];
  const source: RegisteredAgentAvatarSource = Object.freeze({
    id: "faces",
    key: "buzz.faces/faces",
    pluginId: "buzz.faces",
    revision: "bundled",
    title: "Faces",
    icon: <svg />,
    component: (props) => {
      choose = props.choose;
      names.push(props.name);
      return (
        <>
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => props.choose(png("red"), "red")}
          >
            Red face {props.seed ?? ""}
          </button>
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => props.choose(png("blue"), "blue")}
          >
            Blue face
          </button>
        </>
      );
    },
  });
  const setSources = (next: readonly RegisteredAgentAvatarSource[]) =>
    act(() => {
      sources = next;
      for (const listener of listeners) listener();
    });
  const agents = {
    save: vi.fn(async () => {}),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    avatarSources: () => sources,
    memberships: () => [],
  } as unknown as Agents & { save: ReturnType<typeof vi.fn> };
  sources = [source];
  const onClose = vi.fn();
  render(
    <AgentIdentityDialog
      agent={
        {
          key: "a".repeat(64),
          pubkey: "a".repeat(64),
          name: "  Ada　 Lovelace ",
          picture,
          relay: "https://a.example",
          place: "here",
        } as Agent
      }
      agents={agents}
      onClose={onClose}
      finalFocus={createRef()}
    />,
  );
  return {
    agents,
    onClose,
    source,
    setSources,
    names,
    choose: (...args: Parameters<Choose>) => choose(...args),
    user: userEvent.setup(),
    save: () => screen.getByRole("button", { name: "Save changes" }),
  };
}

it("shows a source as a tab and saves its pick as an ordinary uploaded image", async () => {
  const { agents, onClose, user, save, names } = setup();
  vi.mocked(uploadAvatar).mockResolvedValueOnce("https://images.example/face");
  expect(save()).toBeDisabled();
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  // The host normalizes the name the source sees.
  expect(names.at(-1)).toBe("Ada Lovelace");
  await user.click(screen.getByRole("button", { name: /Red face/ }));
  await screen.findByRole("button", { name: "Red face red" });
  expect(
    screen.getByRole("button", { name: "Red face red" }),
  ).toBeInTheDocument();
  await user.click(save());
  await waitFor(() =>
    expect(agents.save).toHaveBeenCalledExactlyOnceWith("a".repeat(64), {
      picture: "https://images.example/face",
    }),
  );
  const [file, community] = vi.mocked(uploadAvatar).mock.calls[0] ?? [];
  expect(file?.type).toBe("image/png");
  expect(community).toBe("https://a.example");
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps a pick through its source's removal, so Save retries the same bytes", async () => {
  const { agents, user, save, setSources } = setup();
  vi.mocked(uploadAvatar)
    .mockRejectedValueOnce(new Error("Upload failed"))
    .mockResolvedValueOnce("https://images.example/face");
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  await user.click(screen.getByRole("button", { name: /Red face/ }));
  await screen.findByRole("button", { name: "Red face red" });
  await user.click(save());
  expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed");
  setSources([]);
  // The tab, its icon and controls go; the failed Save's pick stays.
  expect(
    screen.queryByRole("button", { name: /Red face/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Faces" })).not.toBeInTheDocument();
  expect(screen.getByText(/source is off/)).toBeInTheDocument();
  await user.click(save());
  await waitFor(() =>
    expect(agents.save).toHaveBeenCalledExactlyOnceWith("a".repeat(64), {
      picture: "https://images.example/face",
    }),
  );
  const [first] = vi.mocked(uploadAvatar).mock.calls[0] ?? [];
  const [second] = vi.mocked(uploadAvatar).mock.calls[1] ?? [];
  expect(await second?.text()).toBe(await first?.text());
});

it("restores the saved avatar, Save off, when a source goes before a pick", async () => {
  const { user, save, setSources } = setup();
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  screen.getByRole("button", { name: /Red face/ }).focus();
  setSources([]);
  await waitFor(() =>
    expect(
      screen.queryByRole("tab", { name: "Faces" }),
    ).not.toBeInTheDocument(),
  );
  expect(save()).toBeDisabled();
  const selected = screen.getByRole("tab", { name: "Upload image" });
  expect(selected).toHaveAttribute("aria-selected", "true");
  // Focus inside the vanished tab returns to the selected tab.
  expect(selected).toHaveFocus();
});

it("ignores a late, invalid or locked pick", async () => {
  const { user, save, setSources, choose, source } = setup();
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  choose(new Blob(["text"], { type: "text/plain" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose a PNG, JPEG, GIF or WebP image under 380 KiB.",
  );
  choose(png(), "x".repeat(257));
  expect(await screen.findByRole("alert")).toHaveTextContent(/invalid seed/);
  const late = choose;
  setSources([]);
  await waitFor(() => expect(save()).toBeDisabled());
  late(png(), "red");
  // A re-enabled source is a fresh registration; the old one stays fenced.
  setSources([{ ...source }]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(save()).toBeDisabled();
});

it("restores the previous choice and moves focus when a picked source goes before Save", async () => {
  const { user, save, setSources } = setup();
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  await user.click(screen.getByRole("button", { name: /Red face/ }));
  await screen.findByRole("button", { name: "Red face red" });
  screen.getByRole("tab", { name: "Faces" }).focus();
  setSources([]);
  await waitFor(() => expect(save()).toBeDisabled());
  expect(screen.queryByRole("tab", { name: "Faces" })).not.toBeInTheDocument();
  expect(screen.queryByText(/source is off/)).not.toBeInTheDocument();
  const selected = screen.getByRole("tab", { name: "Upload image" });
  expect(selected).toHaveAttribute("aria-selected", "true");
  // The focused tab itself went away; focus returns to the selected tab.
  expect(selected).toHaveFocus();
});

it("lets only the newest pick land, whatever order decodes finish in", async () => {
  const { user, save, agents } = setup();
  vi.mocked(uploadAvatar).mockResolvedValueOnce("https://images.example/face");
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  const waiting = holdDecodes();
  await user.click(screen.getByRole("button", { name: /Red face/ }));
  await user.click(screen.getByRole("button", { name: "Blue face" }));
  await waitFor(() => expect(waiting).toHaveLength(2));
  await act(async () => waiting[1]?.release());
  await screen.findByRole("button", { name: "Red face blue" });
  await act(async () => waiting[0]?.release());
  await new Promise((resolve) => setTimeout(resolve, 20));
  hold = undefined;
  await user.click(save());
  await waitFor(() => expect(agents.save).toHaveBeenCalled());
  const [file] = vi.mocked(uploadAvatar).mock.calls[0] ?? [];
  expect(await file?.text()).toBe("blue");
});

it("never lets a pick from before Save replace the draft after Save fails", async () => {
  const { user, save, agents } = setup();
  vi.mocked(uploadAvatar)
    .mockRejectedValueOnce(new Error("Upload failed"))
    .mockResolvedValueOnce("https://images.example/face");
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  await user.click(screen.getByRole("button", { name: /Red face/ }));
  await screen.findByRole("button", { name: "Red face red" });
  const waiting = holdDecodes();
  await user.click(screen.getByRole("button", { name: "Blue face" }));
  await waitFor(() => expect(waiting).toHaveLength(1));
  await user.click(save());
  expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed");
  await act(async () => waiting[0]?.release());
  await new Promise((resolve) => setTimeout(resolve, 20));
  hold = undefined;
  await user.click(save());
  await waitFor(() => expect(agents.save).toHaveBeenCalled());
  const files = vi.mocked(uploadAvatar).mock.calls.map(([file]) => file);
  expect(await files[0]?.text()).toBe("red");
  expect(await files[1]?.text()).toBe("red");
});

it("rejects a pick the avatar previews could not show", async () => {
  const { user, choose } = setup();
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  choose(new Blob([new Uint8Array(381 * 1024)], { type: "image/png" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose a PNG, JPEG, GIF or WebP image under 380 KiB.",
  );
  choose(`data:image/png;base64,${"A".repeat(512 * 1024)}`);
  expect(await screen.findByRole("alert")).toHaveTextContent("under 380 KiB");
});

it("retries a failed upload only in the community it started in", async () => {
  vi.mocked(uploadAvatar)
    .mockRejectedValueOnce(new Error("Upload failed"))
    .mockResolvedValueOnce("https://images.example/face");
  const source: RegisteredAgentAvatarSource = Object.freeze({
    id: "faces",
    key: "buzz.faces/faces",
    pluginId: "buzz.faces",
    revision: "bundled",
    title: "Faces",
    icon: <svg />,
    component: (props) => (
      <button type="button" onClick={() => props.choose(png("red"))}>
        Red face
      </button>
    ),
  });
  const sources = [source];
  const avatarRef = createRef<{ prepare(): Promise<string> }>();
  function Harness({ community }: { community: string }) {
    const [selection, setSelection] = useState<AvatarSelection>({
      kind: "image",
      picture,
    });
    return (
      <>
        <output>
          {selection.kind === "source" && selection.file ? "picked" : ""}
        </output>
        <AgentAvatarPicker
          name="Ada"
          selection={selection}
          disabled={false}
          community={community}
          sources={sources}
          onChange={setSelection}
          onBusyChange={() => {}}
          avatarRef={avatarRef}
        />
      </>
    );
  }
  const view = render(<Harness community="https://a.example" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  await user.click(screen.getByRole("button", { name: "Red face" }));
  expect(await screen.findByText("picked")).toBeInTheDocument();
  const prepare = () => {
    const ref = avatarRef.current;
    if (!ref) throw new Error("no picker");
    return ref.prepare();
  };
  await expect(act(prepare)).rejects.toThrow("Upload failed");
  expect(uploadAvatar).toHaveBeenCalledOnce();
  // The community changes before the retry: Save refuses, uploads nothing.
  view.rerender(<Harness community="https://b.example" />);
  await expect(act(prepare)).rejects.toThrow(/another community/);
  expect(uploadAvatar).toHaveBeenCalledOnce();
  // Back in the first community, the retry sends the same bytes there.
  view.rerender(<Harness community="https://a.example" />);
  await expect(act(prepare)).resolves.toBe("https://images.example/face");
  const [first, second] = vi.mocked(uploadAvatar).mock.calls;
  expect(second?.[1]).toBe("https://a.example");
  expect(first?.[1]).toBe("https://a.example");
  expect(await second?.[0].text()).toBe(await first?.[0].text());
});

it("starts a same-id replacement empty, even after a failed Save", async () => {
  const { user, save, setSources, source } = setup();
  vi.mocked(uploadAvatar).mockRejectedValueOnce(new Error("Upload failed"));
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  await user.click(screen.getByRole("button", { name: /Red face/ }));
  await screen.findByRole("button", { name: "Red face red" });
  // An unsaved pick never passes to a new registration under the same id.
  setSources([{ ...source }]);
  await waitFor(() => expect(save()).toBeDisabled());
  expect(screen.getByRole("tab", { name: "Upload image" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  expect(screen.getByRole("button", { name: "Red face" })).toBeInTheDocument();
  // A failed Save's attempt stays, but never selects or seeds the replacement.
  await user.click(screen.getByRole("button", { name: /Red face/ }));
  await screen.findByRole("button", { name: "Red face red" });
  await user.click(save());
  expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed");
  setSources([{ ...source }]);
  expect(screen.getByRole("tab", { name: "Faces" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  expect(screen.getByText(/source is off/)).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  expect(screen.getByRole("button", { name: "Red face" })).toBeInTheDocument();
});

it("keeps the attempt's preview when its source goes during the upload", async () => {
  const { user, save, setSources, agents } = setup();
  let land: (url: string) => void = () => {};
  vi.mocked(uploadAvatar).mockImplementationOnce(
    () => new Promise<string>((resolve) => (land = resolve)),
  );
  await user.click(screen.getByRole("tab", { name: "Faces" }));
  await user.click(screen.getByRole("button", { name: /Red face/ }));
  await screen.findByRole("button", { name: "Red face red" });
  await user.click(save());
  await waitFor(() => expect(uploadAvatar).toHaveBeenCalledOnce());
  setSources([]);
  // The tab goes at once; the preview stays what Save is writing.
  expect(screen.queryByRole("tab", { name: "Faces" })).not.toBeInTheDocument();
  expect(
    document.querySelector('img[src^="data:image/png;base64,"]'),
  ).not.toBeNull();
  expect(document.querySelector(`img[src="${picture}"]`)).toBeNull();
  await act(async () => land("https://images.example/face"));
  await waitFor(() =>
    expect(agents.save).toHaveBeenCalledExactlyOnceWith("a".repeat(64), {
      picture: "https://images.example/face",
    }),
  );
});
