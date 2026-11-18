// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Blob, File } from "node:buffer";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RelaySession } from "../relay/session";
import type { ChannelSummary } from "../relay/contracts";
import { BestieVoiceCommand } from "./BestieVoiceCommand";
import { pointedTarget } from "./pointing-context";
import {
  attachmentMessage,
  type UploadedAttachment,
} from "../relay/attachments";

const { snapshot } = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke: (command: string, args: unknown) =>
    command === "window_snapshot" ? snapshot(args) : Promise.resolve(undefined),
}));

const stopTrack = vi.fn();
const closeAudio = vi.fn(async () => {});
const microphone = vi.fn<() => Promise<MediaStream>>(
  async () =>
    ({
      getTracks: () => [{ stop: stopTrack }],
    }) as unknown as MediaStream,
);
class Recorder extends EventTarget {
  static isTypeSupported() {
    return true;
  }
  mimeType = "audio/webm";
  state = "inactive";
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.dispatchEvent(
      Object.assign(new Event("dataavailable"), {
        data: new Blob(["encoded audio"]),
      }),
    );
    this.dispatchEvent(new Event("stop"));
  }
}
class Audio {
  createAnalyser() {
    return {
      fftSize: 512,
      smoothingTimeConstant: 0,
      getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128),
    };
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  close = closeAudio;
  async decodeAudioData() {
    return {
      numberOfChannels: 1,
      sampleRate: 24000,
      duration: 3,
      getChannelData: () => new Float32Array(72000).fill(0.125),
    };
  }
}
let hit: Element | null;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "performance",
    ],
  });
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("File", File);
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("AudioContext", Audio);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "navigator",
    Object.create(navigator, {
      mediaDevices: { value: { getUserMedia: microphone } },
    }),
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:recorded-note");
      static revokeObjectURL = vi.fn();
    },
  );
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => hit,
  });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: vi.fn(() => ({ cancel() {} })),
  });
  let urlId = 0;
  vi.mocked(URL.createObjectURL).mockImplementation(
    () => `blob:note-${++urlId}`,
  );
  snapshot.mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 400, 200),
  );
  hit = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(Element.prototype, "animate");
});
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
function mount(existing = true) {
  const send = vi.fn(
    (
      _channel: string,
      content: string,
      _mentions: readonly string[],
      attachments: readonly UploadedAttachment[],
    ) => {
      attachmentMessage(content, attachments, "https://example.org");
      return "message-id";
    },
  );
  const upload = vi.fn(
    async (file: File, _channelId: string, _signal: AbortSignal) => {
      const image = file.type === "image/png";
      const hash = (image ? "b" : "a").repeat(64);
      return {
        name: image ? file.name : "voice-note.mp4",
        url: `https://example.org/media/${hash}.${image ? "png" : "mp4"}`,
        type: image ? "image/png" : "video/mp4",
        size: 100,
        sha256: hash,
      };
    },
  );
  const chat: ChannelSummary = {
    id: "bestie-dm",
    name: "Alex",
    channelType: "dm",
    members: ["viewer", "agent"],
  };
  const channels = { channels: existing ? [chat] : ([] as ChannelSummary[]) };
  const open = vi.fn(async () => {
    channels.channels = [chat];
    return chat.id;
  });
  const choices = { selectable: [{ pubkey: "agent", managed: true }] };
  render(
    <>
      <section>
        <h2>Team</h2>
        <p data-message-id="first" data-channel-id="design">
          Move this button
        </p>
        <p>Then look at this</p>
      </section>
      <BestieVoiceCommand
        session={
          {
            viewer: "viewer",
            channels: { list: () => channels },
            attachments: { upload },
            messages: { send },
            agentChoices: {
              snapshot: () => choices,
            },
            directMessages: { open },
          } as unknown as RelaySession
        }
        agentId="agent"
        name="Alex"
      />
    </>,
  );
  return { send, upload, open, choices, channels };
}
function point(element: Element) {
  hit = element;
  fireEvent.pointerMove(element, { clientX: 10, clientY: 10 });
}
const down = (optionFirst = false) => {
  if (optionFirst) {
    fireEvent.keyDown(document, { key: "Alt", altKey: true });
    fireEvent.keyDown(document, { key: "Meta", metaKey: true, altKey: true });
    return;
  }
  fireEvent.keyDown(document, { key: "Meta", metaKey: true });
  fireEvent.keyDown(document, { key: "Alt", metaKey: true, altKey: true });
};
const up = () => fireEvent.keyUp(document, { key: "Alt", metaKey: true });

it.each([true, false])(
  "records and delivers valid audio, retrying uploads with an existing DM: %s",
  async (existing) => {
    const { send, upload, open } = mount(existing);
    point(screen.getByText("Move this button"));
    down(!existing);
    await advance(249);
    expect(microphone).not.toHaveBeenCalled();
    await advance(1);
    expect(microphone).toHaveBeenCalledOnce();
    await advance(400);
    point(screen.getByText("Then look at this"));
    await advance(500);
    up();
    await advance(0);
    const review = screen.getByRole("dialog", { name: "Send message" });
    expect(
      screen.getByRole("button", { name: "Play voice note" }),
    ).toBeEnabled();
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("img", { name: /Pointed-at UI/ })).toHaveLength(
      2,
    );
    expect(review).not.toHaveTextContent("Move this button");
    expect(upload).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledOnce();
    upload.mockRejectedValueOnce(new Error("Upload unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
    await advance(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Upload unavailable");
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
    await advance(0);
    expect(send).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(existing ? 0 : 1);
    expect(screen.queryByRole("dialog")).toBeNull();
    const [channel, content, , attachments] = send.mock.calls[0] as unknown as [
      string,
      string,
      string[],
      { type: string; voice: { duration: number; waveform: number[] } }[],
    ];
    expect(channel).toBe("bestie-dm");
    expect(content).toContain("Image 1: 0.35s");
    expect(content).toContain("Image 2: 0.75s");
    expect(content).not.toMatch(
      /Move this button|Then look at this|messageId|channelId|\{/,
    );
    expect(attachments.map((attachment) => attachment.type)).toEqual([
      "video/mp4",
      "image/png",
      "image/png",
    ]);
    expect(attachments[0]?.voice.duration).toBe(3);
    expect(attachments[0]?.voice.waveform).toEqual(Array(48).fill(13));
  },
);

it.each([true, false])(
  "does not upload or send to a Bestie that became unavailable, existing DM: %s",
  async (existing) => {
    const { choices, send, upload, open } = mount(existing);
    down();
    await advance(650);
    up();
    await advance(0);
    expect(screen.getByRole("dialog", { name: "Send message" })).toBeVisible();
    choices.selectable = [];
    fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
    await advance(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bestie is no longer available",
    );
    expect(upload).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  },
);

it("resolves the current exact Bestie DM instead of a conversation whose audience grew", async () => {
  const { channels, send, upload, open } = mount();
  down();
  await advance(650);
  up();
  await advance(0);
  channels.channels = [
    {
      id: "bestie-dm",
      name: "Now a group",
      channelType: "dm",
      members: ["viewer", "agent", "other-person"],
    },
  ];
  open.mockImplementationOnce(async () => {
    channels.channels.push({
      id: "current-bestie-dm",
      name: "Alex",
      channelType: "dm",
      members: ["viewer", "agent"],
    });
    return "current-bestie-dm";
  });
  fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
  await advance(0);
  expect(upload.mock.calls[0]?.[1]).toBe("current-bestie-dm");
  expect(send.mock.calls[0]?.[0]).toBe("current-bestie-dm");
});

it.each(["audience", "agent"])(
  "holds review when the %s changes during upload and uploads again for a new DM",
  async (changed) => {
    const { channels, choices, send, upload } = mount();
    down();
    await advance(650);
    up();
    await advance(0);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    upload.mockImplementationOnce(async () => {
      await gate;
      return {
        name: "voice-note.mp4",
        url: `https://example.org/media/${"a".repeat(64)}.mp4`,
        type: "video/mp4",
        size: 100,
        sha256: "a".repeat(64),
      };
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
      await advance(0);
      expect(upload).toHaveBeenCalledOnce();
      if (changed === "agent") choices.selectable = [];
      else
        channels.channels = [
          {
            id: "bestie-dm",
            name: "Now a group",
            channelType: "dm",
            members: ["viewer", "agent", "other-person"],
          },
        ];
      await act(async () => {
        release();
        await gate;
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        changed === "agent"
          ? "Bestie is no longer available"
          : "participants changed",
      );
      expect(
        screen.getByRole("dialog", { name: "Send message" }),
      ).toBeVisible();
      expect(send).not.toHaveBeenCalled();
      choices.selectable = [{ pubkey: "agent", managed: true }];
      channels.channels = [
        {
          id: "replacement",
          name: "Alex",
          channelType: "dm",
          members: ["viewer", "agent"],
        },
      ];
      fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
      await advance(0);
      expect(upload).toHaveBeenCalledTimes(2);
      expect(upload.mock.calls[1]?.[1]).toBe("replacement");
      expect(send.mock.calls[0]?.[0]).toBe("replacement");
    } finally {
      release();
    }
  },
);

it("caps screenshots at four, removes unwanted images, and retries without uploading the audio again", async () => {
  const { send, upload } = mount();
  render(
    ["One", "Two", "Three", "Four", "Five"].map((name) => (
      <button type="button" key={name}>
        {name}
      </button>
    )),
  );
  point(screen.getByRole("button", { name: "One" }));
  down();
  await advance(250);
  for (const name of ["One", "Two", "Three", "Four", "Five"]) {
    point(screen.getByRole("button", { name }));
    await advance(400);
  }
  up();
  await advance(0);
  expect(snapshot).toHaveBeenCalledTimes(4);
  expect(screen.getAllByRole("img", { name: /Pointed-at UI/ })).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Remove image 2" }));
  expect(screen.getAllByRole("img", { name: /Pointed-at UI/ })).toHaveLength(3);
  upload.mockResolvedValueOnce({
    name: "voice-note.mp4",
    url: `https://example.org/media/${"a".repeat(64)}.mp4`,
    type: "video/mp4",
    size: 100,
    sha256: "a".repeat(64),
  });
  upload.mockRejectedValueOnce(new Error("Image upload failed"));
  fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
  await advance(0);
  expect(screen.getByRole("alert")).toHaveTextContent("Image upload failed");
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
  await advance(0);
  expect(send).toHaveBeenCalledOnce();
  expect(upload).toHaveBeenCalledTimes(5);
  expect(
    upload.mock.calls.filter(([file]) => file.type !== "image/png"),
  ).toHaveLength(1);
  expect(upload.mock.calls.map(([file]) => file.name)).not.toContain(
    "pointed-at-0.75s.png",
  );
  expect(send.mock.calls[0]?.[3]).toHaveLength(4);
});

it("drops a screenshot completing after capture was cancelled", async () => {
  const { send, upload } = mount();
  let finish: (bytes: ArrayBuffer) => void = () => {};
  snapshot.mockImplementationOnce(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  );
  point(screen.getByText("Move this button"));
  down();
  await advance(600);
  expect(snapshot).toHaveBeenCalledOnce();
  up();
  await advance(0);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  await act(async () => {
    finish(new ArrayBuffer(4));
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(upload).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("shows capture failures and sends audio without falling back to DOM text", async () => {
  const { send } = mount();
  snapshot.mockRejectedValueOnce(new Error("Snapshot unavailable"));
  point(screen.getByText("Move this button"));
  down();
  await advance(650);
  up();
  await advance(0);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "screenshot couldn’t be captured",
  );
  expect(screen.queryByRole("img", { name: /Pointed-at UI/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send to Bestie" }));
  await advance(0);
  expect(send.mock.calls[0]?.[1]).toBe("Voice note");
  expect(send.mock.calls[0]?.[3]).toHaveLength(1);
});

it("leaves Command shortcuts alone and releases a microphone grant arriving after key release", async () => {
  mount();
  fireEvent.keyDown(document, { key: "Meta", metaKey: true });
  await advance(300);
  expect(microphone).not.toHaveBeenCalled();
  expect(screen.queryByText("Talk to Alex")).toBeNull();
  fireEvent.keyUp(document, { key: "Meta" });
  down();
  up();
  expect(screen.queryByText("Talk to Alex")).toBeNull();
  down();
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  await advance(300);
  up();
  expect(microphone).not.toHaveBeenCalled();
  let grant: (stream: MediaStream) => void = () => {};
  microphone.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve as typeof grant;
      }),
  );
  down();
  await advance(250);
  up();
  let grantNext: (stream: MediaStream) => void = () => {};
  microphone.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grantNext = resolve;
      }),
  );
  down();
  await advance(250);
  await act(async () => {
    grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
  });
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    grantNext({
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream);
  });
  await advance(200);
  up();
  await advance(0);
  expect(screen.getByRole("dialog", { name: "Send message" })).toBeVisible();
});

it("discards on Escape or blur, including while encoding a note", async () => {
  mount();
  down();
  await advance(400);
  fireEvent.keyDown(document, { key: "Escape", metaKey: true });
  up();
  await advance(0);
  expect(screen.queryByRole("dialog")).toBeNull();
  down();
  await advance(400);
  fireEvent.blur(window);
  up();
  await advance(0);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(stopTrack).toHaveBeenCalledTimes(2);
});

it("targets visible UI without targeting editors or the capture UI", () => {
  const { container } = render(
    <section>
      <h2>Team</h2>
      <div data-message-id="message">
        <p>Visible text</p>
        <div style={{ display: "none" }}>
          <span>Hidden secret</span>
        </div>
        <input type="password" defaultValue="password" />
        <div contentEditable suppressContentEditableWarning>
          Unsent draft
        </div>
      </div>
      <div data-voice-command="">
        <button type="button">Send to Bestie</button>
      </div>
    </section>,
  );
  expect(pointedTarget(screen.getByText("Visible text"))).toBe(
    container.querySelector('[data-message-id="message"]'),
  );
  expect(pointedTarget(container.querySelector("input"))).toBeUndefined();
  expect(pointedTarget(screen.getByText("Unsent draft"))).toBeUndefined();
  expect(pointedTarget(screen.getByRole("button"))).toBeUndefined();
});
