import { isTauri } from "@tauri-apps/api/core";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { Button } from "../../shared/design-system/ui/Button";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { SearchField } from "../../shared/design-system/ui/SearchField";
import { ShimmerText } from "../../shared/design-system/ui/ShimmerText";
import { MicrophoneIcon } from "../../shared/design-system/icons/index";
import type { KeyBinding } from "../../features/shortcuts/bindings";
import { communityDestination } from "../../features/communities/destination";
import { useIdentityNames } from "../../features/identity-names/react";
import { sortParticipantNames } from "../../features/identity-names/participant-order";
import type { ChannelSummary } from "../../features/relay/contracts";
import type { RelaySession } from "../../features/relay/session";
import type { Decisions } from "../../features/decisions/service";
import {
  prepareVoice,
  useVoiceDictation,
  useVoiceSearchAvailable,
} from "../../features/search/voice-dictation";
import {
  type JumpPlace,
  jumpPlaces,
  pickPlace,
} from "../../features/search/voice-jump";
import type { AppServices } from "../services";
import { HOST_SHORTCUT_ORDER } from "../shortcuts";
import { conversationFocusTarget } from "../focus-navigation";
import styles from "./VoiceJump.module.css";

export type VoiceJumpServices = Pick<
  AppServices,
  "communities" | "shortcuts" | "navigation"
> &
  Partial<Pick<AppServices, "decisions">>;

const VOICE_JUMP_ID = "voice-jump";
const VOICE_JUMP_BINDING: KeyBinding = { key: "k", mod: true, shift: true };

type Phase =
  | { kind: "listening" }
  | { kind: "matching" }
  | { kind: "none"; text: string }
  | { kind: "failed"; message: string };

/** Say where to go: the mic opens live, and when you stop, the best match
 * among the conversations already in memory opens. */
export function VoiceJump({
  services,
}: {
  services?: VoiceJumpServices | undefined;
}) {
  const decisions = services?.decisions;
  const available = useVoiceSearchAvailable(!!decisions && isTauri());
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLElement>(null);
  const opened = useRef<string | undefined>(undefined);
  // The shortcut pressed while open hands off to the open box.
  const again = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (available) prepareVoice();
  }, [available]);
  useEffect(() => {
    if (!available || !services) return;
    return services.shortcuts.registerHost({
      id: VOICE_JUMP_ID,
      title: "Jump by voice",
      binding: VOICE_JUMP_BINDING,
      order: HOST_SHORTCUT_ORDER.search + 2,
      allowInEditable: true,
      allowInModal: true,
      run: () => {
        if (again.current) return again.current();
        opened.current = undefined;
        setOpen(true);
      },
    });
  }, [available, services]);
  const close = useCallback(() => {
    setOpen(false);
    // The next opening starts with a key already fetched.
    prepareVoice();
  }, []);
  if (!services || !decisions || !available) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title="Jump by voice"
      presentation="search"
      size="default"
      motion="none"
      dismissOnOutsideClick
      initialFocus={input}
      finalFocus={() =>
        opened.current ? conversationFocusTarget(opened.current) || false : true
      }
    >
      {open && (
        <VoiceJumpBody
          services={services}
          decisions={decisions}
          input={input}
          again={again}
          go={(place) => {
            opened.current = place.channelId;
            close();
          }}
        />
      )}
    </Dialog>
  );
}

function VoiceJumpBody({
  services,
  decisions,
  input,
  again,
  go,
}: {
  services: VoiceJumpServices;
  decisions: Decisions;
  input: RefObject<HTMLElement | null>;
  again: { current: (() => void) | undefined };
  go: (place: JumpPlace) => void;
}) {
  const relay = useSyncExternalStore(
    services.communities.relay.subscribe,
    services.communities.relay.snapshot,
  );
  const session = relay.session;
  const resolveName = useIdentityNames(session.names);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "listening" });
  // A newer utterance or edit retires the match still in flight.
  const attempt = useRef(0);
  const submit = (spoken: string) => {
    const said = spoken.trim();
    if (!said) return setPhase({ kind: "none", text: "" });
    const client = services.communities.snapshot();
    if (!client.selected || !client.viewer)
      return setPhase({
        kind: "failed",
        message: "Choose a community to jump to its conversations.",
      });
    const scope = {
      viewer: client.viewer,
      communityOrigin: communityDestination(client.selected).url,
    };
    const places = jumpPlaces(sources(session, resolveName));
    const current = ++attempt.current;
    setPhase({ kind: "matching" });
    void pickPlace(decisions, said, places, scope.communityOrigin).then(
      (result) => {
        if (current !== attempt.current) return;
        if (result.outcome === "found") {
          const { place } = result;
          go(place);
          void services.navigation.open({
            version: 1,
            kind: "conversation",
            scope,
            channelId: place.channelId,
            ...(place.rootId
              ? { messageId: place.rootId, threadRootId: place.rootId }
              : {}),
          });
        } else if (result.outcome === "none")
          setPhase({ kind: "none", text: said });
        else
          setPhase({
            kind: "failed",
            message:
              result.reason === "missing_credentials" ||
              result.reason === "unauthorized" ||
              result.reason === "unavailable"
                ? "Set up the Decisions API in Settings to jump by voice."
                : "Couldn't match that just now. Try again.",
          });
      },
    );
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const dictation = useVoiceDictation({
    onText: (next) => {
      attempt.current++;
      setPhase({ kind: "listening" });
      setText(next);
    },
    onEnd: (spoken) => submitRef.current(spoken),
    onError: (message) => setPhase({ kind: "failed", message }),
  });
  const { start, stop, cancel } = dictation;
  const listen = useCallback(() => {
    attempt.current++;
    setText("");
    setPhase({ kind: "listening" });
    void start();
  }, [start]);
  // Listening starts as the box opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Once per opening.
  useEffect(() => {
    listen();
  }, []);
  const listening = dictation.state !== "idle";
  useEffect(() => {
    again.current = () => (listening ? stop() : listen());
    return () => {
      again.current = undefined;
    };
  }, [again, listening, stop, listen]);
  const status =
    phase.kind === "matching" ? (
      <ShimmerText>Finding it…</ShimmerText>
    ) : phase.kind === "failed" ? (
      phase.message
    ) : dictation.state === "starting" ? (
      <ShimmerText>Starting the microphone…</ShimmerText>
    ) : listening ? (
      <ShimmerText>Listening. Say where to go.</ShimmerText>
    ) : (
      "Press Enter to go, or the microphone to speak again."
    );
  return (
    <div className={styles.body}>
      <SearchField
        variant="palette"
        label="Where to"
        placeholder="Say a channel, person, chat or thread"
        inputRef={input}
        value={text}
        onValueChange={(next) => {
          // Typing takes over from the microphone.
          cancel();
          attempt.current++;
          setPhase({ kind: "listening" });
          setText(next);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          cancel();
          submit(text);
        }}
        trailing={
          <IconButton
            variant={listening ? "tint" : "ghost"}
            aria-label={listening ? "Stop listening" : "Speak again"}
            aria-pressed={listening}
            title={listening ? "Stop listening" : "Speak again"}
            loading={dictation.state === "starting"}
            icon={<MicrophoneIcon size={16} aria-hidden="true" />}
            onClick={() => {
              if (listening) stop();
              else listen();
              input.current?.focus();
            }}
          />
        }
      />
      {phase.kind === "none" ? (
        <EmptyState
          frame="none"
          icon={<MicrophoneIcon size={20} />}
          title="Didn't find anything"
          description={
            phase.text
              ? `Nothing you have open matched “${phase.text}”. Try a channel, person or chat name.`
              : "Didn't catch that. Try saying a channel, person or chat name."
          }
          action={
            <Button size="sm" variant="subtle" onClick={listen}>
              Try again
            </Button>
          }
        />
      ) : (
        <p className={styles.status} aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}

/** Everything in memory voice jump may go to: never reads the relay. */
function sources(
  session: RelaySession,
  resolveName: ReturnType<typeof useIdentityNames>,
) {
  const profiles = session.profiles.snapshot();
  const person = (id: string, among?: readonly string[]) =>
    resolveName(id, profiles.get(id)?.name ?? id.slice(0, 10), among);
  const name = (channel: ChannelSummary) =>
    channel.channelType === "dm" && channel.participants
      ? sortParticipantNames(
          channel.participants.map((id) => person(id, channel.participants)),
        ).join(", ") || "Notes to self"
      : channel.name;
  return {
    channels: session.channels.list().channels,
    name,
    window: (channelId: string) => session.channels.window(channelId),
    activity: session.unread.inbox().items,
    author: (pubkey: string, channel: ChannelSummary) =>
      person(pubkey, channel.members),
  };
}
