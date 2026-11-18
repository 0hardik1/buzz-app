import { agentUnavailable } from "../agents/choices";
import {
  creationDestinationKey,
  readCreationDestination,
  saveCreationDestination,
  type CreationDestination,
} from "./creation-destination";
import { SoloDraft } from "../solo/SoloDraft";
import type { ComponentProps } from "react";
import { AvatarStack } from "../../shared/design-system/ui/AvatarStack";
import { createPortal } from "react-dom";
import { canMessageAgent } from "../agents/choices";
import { useAgentChoices } from "../agents/use-choices";
import { avatarMedia } from "../../shared/avatar-source";
import type { ChannelSummary } from "../relay/contracts";
import type { ConversationHostServices } from "../conversation/ConversationHost";
import { composerMarkdown } from "../messages/composer-markdown";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RelaySession } from "../relay/session";
import type { ConversationExtensions } from "../conversation/contracts";
import { DraftMentionRoster } from "../messages/draft-mention-roster";
import {
  clearAttachmentDraft,
  type AttachmentDraft,
} from "../messages/attachment-draft";
import { MessageComposer } from "../messages/MessageComposer";
import type { MentionDraft, MentionRecipient } from "../messages/mention-draft";
import { directMessageWith } from "../relay/direct-message-policy";
import { clearView, readView, writeView } from "../../shared/view-state";
import {
  useVerifiedNames,
  withVerifiedNames,
} from "../profiles/useVerifiedNames";
import { addressableChannels, RecipientPicker } from "./RecipientPicker";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { PlusIcon, UsersIcon } from "../../shared/design-system/icons";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { relativeTimestamp } from "../../shared/relative-timestamp";
import type { Recipient } from "./usePeople";
import { usePassThroughUntilDrafted } from "../messages/draft-visit";
import type { PageNavigation } from "../navigation/service";
import styles from "./NewMessage.module.css";
import { ExistingDiscussion } from "./ExistingDiscussion";
import type { MessageIntent } from "../channel-navigation/routes";
import { abbreviatedPublicKey } from "../../shared/identity/public-key";
import { ownSolo } from "../solo/labels";

const draftKey = "direct-message:new-draft";
const channelViewKey = "direct-message:channel";
const teamViewKey = "direct-message:team-for";
type Kind = "solo" | "team";
// Earlier versions held a first message here until the relay confirmed it.
const heldMessageKey = "direct-message:new";

/** Recipient-first start of a conversation: it chooses where the first message
 * goes and queues it there. Delivery and Retry belong to that conversation. */
export function NewMessage({
  session,
  scope,
  extensions,
  channels,
  onPreparing,
  host,
  onOpenThread,
  onStarted,
  visit,
  intent,
  allowChannels = false,
  autoFocus = true,
  expanded = false,
  contentContainer,
  solo,
  onOpenChat,
  presentation = "page",
  recipientPresentation = "expanded",
}: {
  /** Home combines conversation discovery and first-message composition. */
  presentation?: "page" | "discovery";
  /** Embedded Home can reveal the recipient picker from its composer toolbar. */
  recipientPresentation?: "expanded" | "on-demand";
  expanded?: boolean;
  /** Open and focus To on entry; embedded composers can wait for interaction. */
  autoFocus?: boolean;
  /** Move the presentation into the host's expanded surface; this owner stays mounted. */
  contentContainer?: HTMLElement | null;
  /** To may also name a channel: Send posts a new message there. */
  allowChannels?: boolean;
  /** Solo uses the same creation draft and parent lock as Team. */
  solo?:
    | Pick<ComponentProps<typeof SoloDraft>, "onStarted" | "onFailed">
    | undefined;
  /** Continue an existing conversation. */
  onOpenChat?: ((channelId: string) => void) | undefined;
  session: RelaySession;
  scope: string;
  intent?: MessageIntent | undefined;
  /** The visit presenting this composer, a Back stop only once drafted. */
  visit?: PageNavigation | undefined;
  extensions?: ConversationExtensions | undefined;
  channels: readonly ChannelSummary[];
  host: ConversationHostServices;
  onPreparing?(pubkeys: readonly string[]): void;
  onOpenThread(
    channelId: string,
    messageId: string,
    threadRootId: string,
    intent?: "reply",
  ): void;
  onStarted(channelId: string, messageId: string): void;
}) {
  const draftEdited = usePassThroughUntilDrafted(
    visit,
    session,
    scope,
    draftKey,
  );
  const [destination, setDestination] = useState(() =>
    readCreationDestination(scope, session.viewer, allowChannels),
  );
  const recipients =
    destination.kind === "people" ? destination.people : emptyRecipients;
  const channelId =
    destination.kind === "channel" ? destination.channelId : undefined;
  // A lone agent starts a Solo chat unless Team was picked for it.
  const [teamFor, setTeamFor] = useState(() => {
    const saved = readView<unknown>(scope, teamViewKey, null);
    return typeof saved === "string" ? saved : undefined;
  });
  const discovery = presentation === "discovery";
  const [choosingRecipient, setChoosingRecipient] = useState(false);
  const showRecipients =
    recipientPresentation === "expanded" ||
    choosingRecipient ||
    recipients.length > 0 ||
    !!channelId;
  const [searchKind, setSearchKind] = useState<Kind>(() => {
    const person = recipients.length === 1 ? recipients[0] : undefined;
    return solo && person?.isAgent && teamFor !== person.pubkey
      ? "solo"
      : "team";
  });
  // Recipients keep the facts they were chosen with; their labels follow the
  // current verification and otherwise the current profile name, falling back
  // to those facts.
  const verified = useVerifiedNames(session, recipients);
  const profiles = useSyncExternalStore(
    session.profiles.subscribe,
    session.profiles.snapshot,
  );
  const agents = useAgentChoices(session, false, false);
  const named = useMemo(
    () =>
      withVerifiedNames(
        recipients.map((person) => {
          const current = profiles.get(person.pubkey);
          const picture =
            current?.picture ??
            person.picture ??
            agents.identities.find((agent) => agent.pubkey === person.pubkey)
              ?.avatar;
          return {
            ...person,
            ...(current && !current.verified ? { name: current.name } : {}),
            ...(picture ? { picture } : {}),
          };
        }),
        verified,
        profiles,
      ),
    [recipients, verified, profiles, agents.identities],
  );
  const recipientNames = named.map((person) => person.name).join(", ");
  const roster = useMemo(() => ({ recipients }), [recipients]);
  // Text still in the To field may be a recipient not chosen yet, so Send
  // waits for it to become one or be cleared.
  const [typed, setTyped] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [composerFocus, setComposerFocus] = useState(0);
  const focusComposer = useCallback(() => {
    setComposerFocus((request) => request + 1);
  }, []);
  const previousContainer = useRef(contentContainer);
  useLayoutEffect(() => {
    if (previousContainer.current === contentContainer) return;
    previousContainer.current = contentContainer;
    focusComposer();
  }, [contentContainer, focusComposer]);
  const [busy, setBusy] = useState<"uploading" | "opening" | undefined>();
  const [error, setError] = useState("");
  const [uploadFailed, setUploadFailed] = useState(false);
  const [draftChannel] = useState(() => crypto.randomUUID());
  const attempt = useRef<AbortController | null>(null);
  const [soloBusy, setSoloBusy] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const locked = soloBusy || !!busy;
  const destinationLocked = locked || (discovery && unsaved);
  useEffect(() => () => attempt.current?.abort(), []);
  useEffect(() => {
    // Release a message an earlier version still holds to its conversation.
    const outbox = session.outbox;
    void outbox?.ready().then(() => {
      for (const item of outbox.snapshot())
        if (item.recovery?.key === heldMessageKey)
          void outbox.acknowledge(item.event.id).catch(() => {});
    });
  }, [session.outbox]);
  function validateAgents() {
    const controlled = new Set(
      session.agentChoices
        .snapshot()
        // Forward-looking: neither archived nor being deleted.
        .selectable.filter(canMessageAgent)
        .map((agent) => agent.pubkey),
    );
    if (
      recipients.some(
        (person) =>
          // By key, whatever its profile says.
          agentUnavailable(session, person.pubkey) ||
          ((person.isAgent ||
            session.profiles.snapshot().get(person.pubkey)?.isAgent) &&
            !controlled.has(person.pubkey)),
      )
    )
      throw new Error(
        "A selected agent is no longer available. Remove it or refresh its details and try again.",
      );
  }
  function change(people: Recipient[]) {
    if (destinationLocked || attempt.current) return;
    const next: CreationDestination = { kind: "people", people };
    setDestination(next);
    saveCreationDestination(scope, next);
    if (discovery) {
      const choice =
        searchKind === "team" && people.length === 1 && people[0]?.isAgent
          ? people[0].pubkey
          : undefined;
      setTeamFor(choice);
      writeView(scope, teamViewKey, choice ?? null);
    }
    setError("");
    setUploadFailed(false);
  }
  function chooseChannel(channel: ChannelSummary | undefined) {
    if (destinationLocked || attempt.current) return;
    if (discovery && channel && onOpenChat) {
      onOpenChat(channel.id);
      return;
    }
    const next: CreationDestination = channel
      ? { kind: "channel", channelId: channel.id }
      : { kind: "people", people: [] };
    setDestination(next);
    saveCreationDestination(scope, next);
    setError("");
    setUploadFailed(false);
  }
  // A newer profile Message choice addresses this shared creation draft once.
  // An in-flight send keeps its recipients until it settles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: consume each explicit intent once, after the send unlocks.
  useEffect(() => {
    if (!intent || destinationLocked || attempt.current) return;
    const taken = readView<unknown>(scope, "direct-message:addressed-at", 0);
    if (typeof taken === "number" && intent.at <= taken) return;
    writeView(scope, "direct-message:addressed-at", intent.at);
    if (intent.to === session.viewer) return;
    const profile = session.profiles.snapshot().get(intent.to);
    void session.profiles.ensure([intent.to]).catch(() => {});
    change([
      {
        pubkey: intent.to,
        name: profile?.name ?? abbreviatedPublicKey(intent.to) ?? "",
        ...(profile?.isAgent ? { isAgent: true } : {}),
      },
    ]);
  }, [destinationLocked, intent?.to, intent?.at]);
  async function send(
    draft: MentionDraft,
    files?: AttachmentDraft,
    addressed?: readonly MentionRecipient[],
    references: readonly string[] = [],
  ) {
    const content = composerMarkdown(draft);
    if (
      attempt.current ||
      (!target && !recipients.length) ||
      (!content.trim() && !files?.snapshot().length) ||
      (!target && !session.directMessages.available)
    )
      return;
    const controller = new AbortController();
    attempt.current = controller;
    setError("");
    setUploadFailed(false);
    let uploading = !!files?.snapshot().some((file) => !file.uploaded);
    if (uploading) setBusy("uploading");
    try {
      const uploaded = files
        ? await files.prepareForSend(controller.signal)
        : [];
      controller.signal.throwIfAborted();
      uploading = false;
      let channelId = target?.id;
      if (!channelId) {
        validateAgents();
        const pubkeys = recipients.map((person) => person.pubkey);
        // The relay owns current people/agent membership and history admission.
        onPreparing?.(pubkeys);
        setBusy("opening");
        channelId = await session.directMessages.open(
          pubkeys,
          controller.signal,
          true,
        );
        controller.signal.throwIfAborted();
        validateAgents();
      }
      const messageId = session.messages.send(
        channelId,
        content,
        (addressed ?? draft.recipients).map((person) => person.pubkey),
        uploaded,
        undefined,
        references,
      );
      // The message is its conversation's now. The page can stay mounted
      // (Settings open), so it must not remain a draft to send again.
      clearView(
        scope,
        draftKey,
        "direct-message:pending",
        "direct-message:recipients",
        channelViewKey,
        creationDestinationKey,
        teamViewKey,
      );
      clearAttachmentDraft(session, `${scope}:${draftKey}`);
      draftEdited(undefined);
      setDestination({ kind: "people", people: [] });
      setTeamFor(undefined);
      setDraftRevision((revision) => revision + 1);
      setUnsaved(false);
      onStarted(channelId, messageId);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (uploading) setUploadFailed(true);
      else
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not send your message. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(undefined);
      if (attempt.current === controller) attempt.current = null;
    }
  }
  const existing = useMemo(
    () =>
      directMessageWith(
        channels,
        session.viewer,
        recipients.map((person) => person.pubkey),
        (key) =>
          recipients.some(
            (person) => person.pubkey === key && person.isAgent,
          ) || !!profiles.get(key)?.isAgent,
      ),
    [channels, recipients, session.viewer, profiles],
  );
  const joining = existing
    ? named.filter((person) => !existing.members?.includes(person.pubkey))
    : [];
  const channelChoices = useMemo(
    () => (allowChannels ? addressableChannels(channels) : []),
    [allowChannels, channels],
  );
  const discoveryChannels = useMemo(
    () =>
      channels.filter(
        (channel) =>
          !channel.cached &&
          !channel.archived &&
          !channel.pending &&
          !!session.viewer &&
          channel.members?.includes(session.viewer) &&
          (searchKind === "solo"
            ? ownSolo(channel, session.viewer)
            : !ownSolo(channel, session.viewer)) &&
          !channel.huddle,
      ),
    [channels, session.viewer, searchKind],
  );
  const target = channelId
    ? channelChoices.find((channel) => channel.id === channelId)
    : undefined;
  const lone = recipients.length === 1 ? recipients[0] : undefined;
  const loneAgent =
    solo &&
    !target &&
    lone &&
    (lone.isAgent || profiles.get(lone.pubkey)?.isAgent)
      ? lone.pubkey
      : undefined;
  const kind: Kind | null = discovery
    ? searchKind
    : solo && loneAgent && teamFor !== loneAgent
      ? "solo"
      : target || recipients.length || !solo
        ? "team"
        : null;
  const soloAgent = kind === "solo" ? loneAgent : undefined;
  const agentLabel = soloAgent ? named[0]?.name : undefined;
  const recent = useMemo(
    () =>
      soloAgent
        ? channels
            .filter(
              (channel) =>
                channel.channelType === "solo" &&
                !channel.archived &&
                !channel.pending &&
                channel.members?.includes(soloAgent),
            )
            .sort(
              (left, right) =>
                (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0),
            )
            .slice(0, 3)
        : [],
    [channels, soloAgent],
  );
  const kindControl =
    solo || allowChannels ? (
      <div className={styles.kind}>
        <Tabs<Kind>
          variant="segmented"
          size="sm"
          label="Conversation"
          value={kind}
          showSelection={kind !== null}
          items={[
            {
              value: "solo",
              label: "Solo",
              disabled:
                destinationLocked || !solo || (!discovery && !loneAgent),
            },
            {
              value: "team",
              label: "Team",
              disabled: destinationLocked || (!discovery && kind === null),
            },
          ]}
          onValueChange={(next) => {
            if (discovery) {
              if (destinationLocked || next === searchKind) return;
              change([]);
              setSearchKind(next);
              return;
            }
            if (locked || !loneAgent) return;
            const choice = next === "team" ? loneAgent : undefined;
            setTeamFor(choice);
            writeView(scope, teamViewKey, choice ?? null);
          }}
        />
      </div>
    ) : undefined;
  const displayed = target ?? existing;
  const composerName = target ? `#${target.name}` : recipientNames;
  const recipientArtwork = (solo: boolean) => (
    <AvatarStack
      animateEntrance
      size="hero-large"
      max={solo ? 1 : 5}
      items={named.map((person) => ({
        id: person.pubkey,
        name: person.name,
        src: avatarMedia(person.picture, session.media),
        shape: solo || person.isAgent ? "squircle" : "circle",
      }))}
    />
  );
  const content = (
    <section
      className={styles.page}
      data-layout="page"
      data-expanded={expanded || undefined}
      data-presentation={presentation}
      aria-label="New message"
      data-attachment-drop-zone
    >
      {showRecipients && (
        <RecipientPicker
          discovery={discovery ? searchKind : undefined}
          session={session}
          scope={scope}
          initiallyOpen={autoFocus || choosingRecipient}
          selected={recipients}
          labels={named}
          disabled={destinationLocked}
          maxRecipients={discovery && searchKind === "solo" ? 1 : 8}
          onChange={change}
          onComplete={focusComposer}
          onTyped={setTyped}
          channelOptions={discovery ? discoveryChannels : channelChoices}
          selectedChannel={target}
          onChooseChannel={
            allowChannels || discovery ? chooseChannel : undefined
          }
          trailing={kindControl}
        />
      )}
      {discovery && unsaved && (
        <p className={styles.feedback} role="status">
          Your draft couldn’t save on this device. Keep editing here or send it
          before switching conversations.
        </p>
      )}
      {soloAgent && solo ? (
        <>
          {!discovery && (
            <div className={styles.solo} data-new-message-body="">
              {recipientArtwork(true)}
              {recent.length > 0 && (
                <nav
                  className={styles.recent}
                  aria-label={`Recent chats with ${agentLabel}`}
                >
                  <h3>Recent with {agentLabel}</h3>
                  <NavigationItem
                    selected
                    aria-current="true"
                    icon={<PlusIcon size={16} aria-hidden="true" />}
                    label="New chat"
                    onClick={focusComposer}
                  />
                  {recent.map((chat) => (
                    <NavigationItem
                      key={chat.id}
                      label={chat.name}
                      trailing={
                        chat.lastActivityAt ? (
                          <span className={styles.agent}>
                            {relativeTimestamp(chat.lastActivityAt)}
                          </span>
                        ) : undefined
                      }
                      onClick={() => onOpenChat?.(chat.id)}
                    />
                  ))}
                </nav>
              )}
            </div>
          )}
          <div className={styles.soloComposer}>
            <SoloDraft
              key={soloAgent}
              embedded
              draftPrefix="direct-message"
              session={session}
              scope={scope}
              extensions={extensions}
              agent={soloAgent}
              focusRequest={composerFocus}
              onBusyChange={setSoloBusy}
              onUnsavedChange={setUnsaved}
              {...solo}
              onStarted={(channelId) => {
                setUnsaved(false);
                solo.onStarted(channelId);
              }}
            />
          </div>
        </>
      ) : (
        <>
          {!discovery && (
            <div className={styles.blank} data-new-message-body="">
              {displayed ? (
                <ExistingDiscussion
                  key={displayed.id}
                  session={session}
                  scope={scope}
                  channel={displayed}
                  extensions={extensions}
                  host={host}
                  onRecovered={focusComposer}
                  onOpen={(messageId, threadRootId, intent) =>
                    onOpenThread(displayed.id, messageId, threadRootId, intent)
                  }
                />
              ) : recipients.length > 0 ? (
                <div className={styles.introduction}>
                  {recipientArtwork(false)}
                </div>
              ) : null}
            </div>
          )}
          <div className={styles.feedback}>
            {joining.length > 0 && (
              <p role="status">
                Sending adds{" "}
                {new Intl.ListFormat(undefined, { type: "conjunction" }).format(
                  joining.map((person) => person.name),
                )}{" "}
                to this DM. {joining.length === 1 ? "It" : "They"} can read its
                earlier messages.
              </p>
            )}
            {busy && (
              <p role="status">
                {busy === "uploading" ? "Uploading files…" : "Sending message…"}
              </p>
            )}
            {uploadFailed && (
              <p role="status">
                A file couldn’t upload. Retry or remove it, then send again.
              </p>
            )}
            {!target && !session.directMessages.available && (
              <p role="status">
                Starting direct messages is unavailable on this connection.
              </p>
            )}
            {error && (
              <div role="alert">
                <p>{error}</p>
              </div>
            )}
          </div>
          <DraftMentionRoster.Provider value={target ? undefined : roster}>
            <MessageComposer
              key={draftRevision}
              session={session}
              scope={scope}
              extensions={extensions}
              channelId={target?.id ?? draftChannel}
              focusRequest={composerFocus}
              channelName={composerName || "new message"}
              label={composerName ? `Message ${composerName}` : "New message"}
              placeholder={composerName ? undefined : ""}
              disabled={!recipients.length && !target}
              trailingTool={
                !showRecipients ? (
                  <IconButton
                    aria-label="Choose recipient"
                    icon={<UsersIcon />}
                    onClick={() => setChoosingRecipient(true)}
                  />
                ) : undefined
              }
              submission={{
                channel: target ? true : undefined,
                draftKey,
                attachments: true,
                allowAttachmentOnly: true,
                onDraftChange: draftEdited,
                unsaved: setUnsaved,
                locked,
                disabled:
                  !!busy ||
                  (target
                    ? false
                    : !recipients.length ||
                      !session.directMessages.available) ||
                  typed,
                submit: (
                  draft,
                  files,
                  addressed,
                  _picks,
                  _draftPicks,
                  _revision,
                  references,
                ) => void send(draft, files, addressed, references),
              }}
            />
          </DraftMentionRoster.Provider>
        </>
      )}
    </section>
  );
  return contentContainer ? createPortal(content, contentContainer) : content;
}

const emptyRecipients: Recipient[] = [];
