import { Select } from "../../shared/design-system/ui/Select";
import { HumanReviewers } from "./HumanReviewers";
import { reviewChannelMember, reviewHistoryMember } from "./access";
import {
  RepositoryConfigurations,
  SubmissionRepository,
} from "./RepositoryConfigurations";
import { submissionRoute } from "./submission-route";
import { useReviewChannel } from "./submission-updates";
import { Checkbox } from "../../shared/design-system/ui/Checkbox";
import { createAdmissionReader, type ReadAdmission } from "./admission";
import { AdmissionEditor } from "./AdmissionEditor";
import type { ToolDescription } from "../../buzz-mcp/session-tools";
import {
  createPullReader,
  createPullStatusReader,
  type ReadPull,
  type ReadPullStatus,
} from "./pull-facts";
const publicPullReader = createPullReader();
const publicStatusReader = createPullStatusReader();
const publicAdmissionReader = createAdmissionReader();
import { LaneRules, ruleDescription } from "./LaneRules";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useReviewAgents } from "./use-review-agents";
import type { PageNavigation } from "../../features/navigation/service";
import { messageRoute, ReviewMessageDialog } from "./ReviewMessageDialog";
import { ReviewSubmissions } from "./ReviewSubmissions";
import type { Navigation } from "../../features/navigation/controller";
import { splitPartition } from "../../features/relay/partition";
import { LaneReviewers, ReviewerIdentity } from "./LaneReviewers";
import { useChannelList, useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import {
  ArrowLeftIcon,
  ListChecksIcon,
  GitPullRequestIcon,
} from "../../shared/design-system/icons";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Input } from "../../shared/design-system/ui/Input";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import {
  loadConfigurations,
  repositoryName,
  saveConfiguration,
  type ReviewConfig,
  type ReviewLane,
  type SavedReviewConfig,
} from "./configuration";
import "./review-configuration.css";

export type ReviewPage = "configuration" | "submit" | "all";
export const reviewPageTitle = (page: ReviewPage) =>
  page === "submit"
    ? "Submit PR"
    : page === "all"
      ? "Pull requests"
      : "Review Configuration";

function Frame({
  children,
  page = "configuration",
}: {
  children: ReactNode;
  page?: ReviewPage;
}) {
  const title = reviewPageTitle(page);
  return (
    <FullPageSurface aria-label={title}>
      <div className="review-config-page text-body">
        <PanelHeader
          title={
            <PanelHeaderLabel
              title={title}
              icon={
                page === "all" ? <GitPullRequestIcon /> : <ListChecksIcon />
              }
            />
          }
        />
        <div className="review-config-scroll">
          <div className="review-config-content" data-review-page={page}>
            {children}
          </div>
        </div>
      </div>
    </FullPageSurface>
  );
}

export function ReviewConfigurationPage({
  relay,
  navigator,
  navigation,
  readPull = publicPullReader,
  readStatus = publicStatusReader,
  readAdmission = publicAdmissionReader,
  describeTool,
  page = "configuration",
}: {
  page?: ReviewPage;
  relay: RelayData;
  navigator?: Navigation;
  navigation?: PageNavigation | undefined;
  readPull?: ReadPull;
  readStatus?: ReadPullStatus;
  readAdmission?: ReadAdmission;
  describeTool?: ((name: string) => ToolDescription | undefined) | undefined;
}) {
  const connection = useRelayConnection(relay);
  const messageTrigger = useRef<HTMLElement | null>(null);
  // The host briefly withdraws the presentation while resolving a new visit.
  // Retain only its address in the same scope so the underlying detail does not
  // flash the list, acknowledge unrelated updates, or discard the popup trigger.
  const presented = useRef<{
    scope: string | undefined;
    page: ReviewPage;
    target: PageNavigation["target"];
  }>(undefined);
  useLayoutEffect(() => {
    if (navigation)
      presented.current = {
        scope: connection.scope,
        page,
        target: navigation.target,
      };
  }, [navigation, connection.scope, page]);
  const target =
    navigation?.target ??
    (presented.current?.scope === connection.scope &&
    presented.current?.page === page
      ? presented.current.target
      : undefined);
  const preview =
    target?.kind === "page" ? messageRoute(target.route?.params) : undefined;
  const detail =
    page === "all" && target?.kind === "page"
      ? submissionRoute(target.route?.params)
      : undefined;
  const scope = splitPartition(connection.scope ?? "");
  const base = {
    version: 1 as const,
    kind: "page" as const,
    pluginId: "buzz.review-configuration",
    pageId: page,
    ...(scope ? { scope } : {}),
  };
  const closeMessage = () =>
    navigator?.dismiss(
      (visit) => {
        if (
          visit.kind !== "page" ||
          visit.pluginId !== base.pluginId ||
          visit.pageId !== page ||
          visit.scope?.viewer !== scope?.viewer ||
          visit.scope?.communityOrigin !== scope?.communityOrigin
        )
          return false;
        const route = messageRoute(visit.route?.params);
        return (
          !!route &&
          route.channel === preview?.channel &&
          route.message === preview?.message
        );
      },
      detail ? { ...base, route: { version: 1, params: detail } } : base,
    );
  if (connection.status === "ready")
    return (
      <>
        <ReviewConfigurationCommunity
          key={`${connection.scope}:${connection.generation}`}
          session={connection.session}
          messageChannel={detail?.channel ?? preview?.channel}
          submission={detail?.submission}
          onOpenSubmission={
            navigator
              ? async (channel, submission) => {
                  const result = await navigator.open(
                    {
                      ...base,
                      ...(submission
                        ? {
                            route: {
                              version: 1,
                              params: { channel, submission },
                            },
                          }
                        : {}),
                    },
                    { focus: "preserve" },
                  );
                  if (result.status === "failed")
                    throw new Error("Could not open the pull request.");
                }
              : undefined
          }
          onOpenMessage={
            navigator
              ? async (channel, message, trigger) => {
                  messageTrigger.current = trigger;
                  const result = await navigator.open(
                    {
                      ...base,
                      route: {
                        version: 1,
                        params: { ...detail, channel, message },
                      },
                    },
                    { focus: "preserve" },
                  );
                  if (result.status === "failed")
                    throw new Error("Could not open the message.");
                }
              : undefined
          }
          page={page}
          readPull={readPull}
          readStatus={readStatus}
          readAdmission={readAdmission}
          describeTool={describeTool}
          onNavigate={
            navigator
              ? async (page) => {
                  const result = await navigator.open({
                    version: 1,
                    kind: "page",
                    pluginId: "buzz.review-configuration",
                    pageId: page,
                  });
                  if (result.status === "failed")
                    throw new Error("Could not open review page.");
                }
              : undefined
          }
          onOpenThread={async (channelId, id) => {
            const scope = splitPartition(connection.scope ?? "");
            if (!navigator || !scope)
              throw new Error("Thread navigation is unavailable.");
            const result = await navigator.open({
              version: 1,
              kind: "conversation",
              scope,
              channelId,
              messageId: id,
              threadRootId: id,
            });
            if (result.status === "failed")
              throw new Error("Could not open the review thread.");
          }}
        />
        {preview && navigator && (
          <ReviewMessageDialog
            key={`${preview.channel}:${preview.message}`}
            session={connection.session}
            target={preview}
            onClose={closeMessage}
            finalFocus={() =>
              messageTrigger.current?.isConnected
                ? messageTrigger.current
                : null
            }
          />
        )}
      </>
    );
  return (
    <Frame page={page}>
      <p>
        {connection.status === "connecting"
          ? "Connecting to your community…"
          : page !== "configuration"
            ? "Connect to a community to submit PRs."
            : "Connect to a community to configure reviews."}
      </p>
      {connection.status === "error" && (
        <>
          <p role="alert">{connection.error}</p>
          <Button onClick={() => relay.retry()}>Retry connection</Button>
        </>
      )}
    </Frame>
  );
}

export function ReviewConfigurationCommunity({
  session,
  messageChannel,
  submission,
  onOpenSubmission,
  onOpenMessage,
  onOpenThread,
  onNavigate,
  readPull = publicPullReader,
  readStatus = publicStatusReader,
  readAdmission = publicAdmissionReader,
  describeTool,
  page = "configuration",
}: {
  session: RelaySession;
  messageChannel?: string | undefined;
  submission?: string | undefined;
  onOpenSubmission?:
    | ((channel: string, submission?: string) => Promise<void>)
    | undefined;
  onOpenMessage?:
    | ((channel: string, id: string, trigger: HTMLElement) => Promise<void>)
    | undefined;
  page?: ReviewPage;
  readPull?: ReadPull;
  readStatus?: ReadPullStatus;
  readAdmission?: ReadAdmission;
  describeTool?: ((name: string) => ToolDescription | undefined) | undefined;
  onNavigate?: ((page: ReviewPage) => Promise<void>) | undefined;
  onOpenThread?: ((channel: string, id: string) => Promise<void>) | undefined;
}) {
  const list = useChannelList(session.channels);
  const [savedChannel, setChannel] = useReviewChannel(session.scope);
  const [submitSelection, setSubmitSelection] = useState({
    repository: "",
    channel: "",
  });
  const selectSubmission = useCallback(
    (repository: string, channel: string) => {
      setSubmitSelection((previous) =>
        previous.repository === repository && previous.channel === channel
          ? previous
          : { repository, channel },
      );
      if (channel) setChannel(channel);
    },
    [setChannel],
  );
  const channel =
    messageChannel ??
    (page === "submit" ? submitSelection.channel : savedChannel);
  useEffect(() => {
    if (messageChannel) setChannel(messageChannel);
  }, [messageChannel, setChannel]);
  const [editing, setEditing] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  async function navigate(destination: ReviewPage) {
    try {
      await onNavigate?.(destination);
    } catch (reason) {
      setNavigationError(
        reason instanceof Error
          ? reason.message
          : "Could not open review page.",
      );
    }
  }
  const historyChannels =
    list.status === "ready"
      ? list.channels
          .filter((item) => reviewHistoryMember(item, session.viewer))
          .map((item) => item.id)
      : [];
  const selected = list.channels.find((item) => item.id === channel);
  const readable =
    page === "all"
      ? list.status === "ready" &&
        (!submission || historyChannels.includes(channel))
      : !!selected && reviewChannelMember(selected, session.viewer);
  const writable =
    !!selected &&
    list.status === "ready" &&
    reviewChannelMember(selected, session.viewer) &&
    !selected.readOnly &&
    !!session.configArtifactWriter;
  return (
    <Frame page={page}>
      {page !== "configuration" && (
        <div className="review-config-actions">
          <Button
            disabled={editing || !(submission ? onOpenSubmission : onNavigate)}
            onClick={() => {
              if (submission)
                void onOpenSubmission?.(channel).catch((reason) =>
                  setNavigationError(String(reason)),
                );
              else void navigate("configuration");
            }}
          >
            <ArrowLeftIcon />{" "}
            {submission
              ? "Back to Pull requests"
              : "Back to Review Configuration"}
          </Button>
          {page === "all" && (
            <Button
              variant="prominent"
              disabled={editing || !onNavigate}
              onClick={() => void navigate("submit")}
            >
              Submit PR
            </Button>
          )}
        </div>
      )}
      {navigationError && <p role="alert">{navigationError}</p>}
      {page === "configuration" && (
        <RepositoryConfigurations
          session={session}
          onEditingChange={setEditing}
          onSubmit={onNavigate ? () => void navigate("submit") : undefined}
          onShowPulls={onNavigate ? () => void navigate("all") : undefined}
        />
      )}
      {page === "submit" && (
        <SubmissionRepository
          session={session}
          disabled={editing}
          onSelection={selectSubmission}
        />
      )}
      {page === "all" && list.status === "loading" && (
        <p role="status">Loading your review channels…</p>
      )}
      {page === "all" && list.status === "error" && (
        <p role="alert">Could not load channels. Reconnect to try again.</p>
      )}
      {submission && !readable && (
        <p role="status">
          Pull request details are unavailable until access to the review
          channel is confirmed.
        </p>
      )}
      {(page === "all" || (channel && page === "submit")) && (
        <ReviewSubmissions
          key={
            page === "all"
              ? "all"
              : `${channel}:${page}:${submitSelection.repository}`
          }
          historyChannels={page === "all" ? historyChannels : undefined}
          mode={page}
          repository={
            page === "submit" ? submitSelection.repository : undefined
          }
          submission={submission}
          onOpenSubmission={onOpenSubmission}
          readable={readable}
          session={session}
          channel={channel}
          writable={writable}
          onEditingChange={setEditing}
          onOpenThread={onOpenThread}
          onOpenMessage={onOpenMessage}
          readPull={readPull}
          readStatus={readStatus}
          readAdmission={readAdmission}
          describeTool={describeTool}
        />
      )}
    </Frame>
  );
}

export function ChannelConfiguration({
  session,
  channel,
  writable,
  onEditingChange,
  channelSelector,
  onSubmit,
  onShowPulls,
  initialRepository = "",
  initiallyCreating = false,
  onBack,
  onRegistered,
  onDelete,
}: {
  initialRepository?: string;
  initiallyCreating?: boolean;
  onBack?: () => void;
  onRegistered?: (repository: string) => void;
  onDelete?: (row: SavedReviewConfig, trigger: HTMLElement) => void;
  channelSelector: ReactNode;
  onSubmit?: (() => void) | undefined;
  onShowPulls?: (() => void) | undefined;
  session: RelaySession;
  channel: string;
  writable: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const choices = useReviewAgents(session, channel);
  const [admissionEditing, setAdmissionEditing] = useState(false);
  const [laneId, setLaneId] = useState<string>();
  const [deletingLane, setDeletingLane] = useState(false);
  const [rows, setRows] = useState<SavedReviewConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<SavedReviewConfig | "new" | undefined>(
    initiallyCreating ? "new" : undefined,
  );
  const [repository, setRepository] = useState(initialRepository);
  const selected = rows.find((row) => row.config.repository === repository);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const lanesRegion = useRef<HTMLElement | null>(null);
  useEffect(() => {
    onEditingChange(editor !== undefined || admissionEditing);
    return () => onEditingChange(false);
  }, [editor, admissionEditing, onEditingChange]);
  useEffect(() => {
    if (editor === undefined) {
      const trigger = editorTrigger.current;
      if (trigger?.isConnected && !trigger.matches(":disabled"))
        trigger.focus();
      else lanesRegion.current?.focus();
    }
  }, [editor]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload explicitly requests a fresh snapshot.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadConfigurations(
      session,
      channel,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((next) => {
        if (!controller.signal.aborted) {
          setRows(next.rows);
          setRemaining(
            next.truncated ? 0 : 100 - next.rows.length - next.unreadable,
          );
          setWarning(
            [
              next.unreadable
                ? `${next.unreadable} saved configuration(s) could not be read. They may use a newer format or contain invalid data; other repositories remain editable.`
                : "",
              next.truncated
                ? "Showing the first 100 configurations. Use another review channel for additional repositories."
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load configurations.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, channel, reload]);
  function saved(next: SavedReviewConfig) {
    if (editor === "new") {
      setRemaining((value) => value - 1);
      onRegistered?.(next.config.repository);
    }
    setRows((current) =>
      [
        ...current.filter((row) => row.artifactId !== next.artifactId),
        next,
      ].sort((a, b) => a.config.repository.localeCompare(b.config.repository)),
    );
    setRepository(next.config.repository);
    setEditor(undefined);
    setNotice(`Saved ${next.config.repository}.`);
  }
  if (initialRepository && !selected && editor !== "new")
    return (
      <>
        <Button onClick={onBack}>Back to repositories</Button>
        <p role="status">
          {loading
            ? "Loading configuration…"
            : error ||
              "This configuration is unavailable. Return to repositories and reload."}
        </p>
      </>
    );
  return (
    <>
      {!selected && editor !== "new" ? (
        <>
          <div className="review-config-actions">
            <Button
              ref={editorTrigger}
              disabled={loading || !!error || !writable || remaining <= 0}
              onClick={(event) => {
                editorTrigger.current = event.currentTarget;
                setNotice("");
                setEditor("new");
              }}
            >
              Register repository
            </Button>
            <Button disabled={!onSubmit} onClick={onSubmit}>
              Submit PR
            </Button>
            <Button disabled={!onShowPulls} onClick={onShowPulls}>
              Pull requests
            </Button>
          </div>
          {channelSelector}
          <InlineHeader
            title="Repositories"
            actions={
              <Button
                disabled={loading || admissionEditing}
                onClick={() => setReload((value) => value + 1)}
              >
                Reload
              </Button>
            }
          />
          {loading ? (
            <p role="status">Loading configurations…</p>
          ) : error ? (
            <p role="alert">{error} Use Reload to try again.</p>
          ) : rows.length ? (
            <div className="review-config-repositories">
              {rows.map((row) => (
                <NavigationItem
                  key={row.artifactId}
                  aria-label={`Open ${row.config.repository}`}
                  multiline
                  label={
                    <span className="review-config-repository-label">
                      <span>{row.config.repository}</span>
                      <span className="text-caption text-subtle">
                        {row.config.lanes.map((lane) => lane.name).join(" · ")}
                      </span>
                    </span>
                  }
                  trailing="Open"
                  onClick={() => {
                    setRepository(row.config.repository);
                    setNotice("");
                  }}
                />
              ))}
            </div>
          ) : (
            <p>
              {warning
                ? "No readable configurations in this channel."
                : "No repositories configured in this channel. Register one to save its review lanes."}
            </p>
          )}
          {warning && <p role="alert">{warning}</p>}
        </>
      ) : (
        <>
          {channelSelector}
          {!editor && (
            <div>
              <Button
                disabled={admissionEditing}
                onClick={() => {
                  if (onBack) onBack();
                  else setRepository("");
                  setNotice("");
                }}
              >
                <ArrowLeftIcon /> Back to repositories
              </Button>
            </div>
          )}
          {selected && (
            <>
              <InlineHeader title={selected.config.repository} />
              <section
                className="review-config-form"
                aria-label="Repository configuration"
                ref={lanesRegion}
                tabIndex={-1}
              >
                {editor ? (
                  <ConfigurationEditor
                    key={editor === "new" ? "new" : editor.revision}
                    session={session}
                    channel={channel}
                    writable={writable}
                    previous={editor === "new" ? undefined : editor}
                    laneId={laneId}
                    initiallyRemoving={deletingLane}
                    existing={rows}
                    onCancel={() =>
                      initiallyCreating && onBack
                        ? onBack()
                        : setEditor(undefined)
                    }
                    onSaved={saved}
                  />
                ) : (
                  <>
                    <AdmissionEditor
                      session={session}
                      channel={channel}
                      previous={selected}
                      writable={writable && !loading && !error}
                      onSaved={saved}
                      onEditingChange={setAdmissionEditing}
                    />
                    <InlineHeader
                      title="Lanes"
                      subtitle="Each lane has its own agents, instructions, and routing rules."
                      actions={
                        <Button
                          disabled={loading || admissionEditing}
                          onClick={() => {
                            setNotice("");
                            setReload((value) => value + 1);
                          }}
                        >
                          Reload
                        </Button>
                      }
                    />
                    {error && <p role="alert">{error}</p>}
                    <SettingsGroup layout="cards">
                      {selected.config.lanes.map((lane) => (
                        <section
                          key={lane.id}
                          aria-label={`${lane.name} lane`}
                          className="review-config-lane-card"
                        >
                          <InlineHeader
                            title={lane.name}
                            actions={
                              <div className="review-config-actions">
                                <Button
                                  ref={(node) => {
                                    if (laneId === lane.id)
                                      editorTrigger.current = node;
                                  }}
                                  disabled={
                                    !writable ||
                                    loading ||
                                    !!error ||
                                    admissionEditing
                                  }
                                  aria-label={`Edit ${lane.name} lane`}
                                  onClick={() => {
                                    setDeletingLane(false);
                                    setLaneId(lane.id);
                                    setNotice("");
                                    setEditor(selected);
                                  }}
                                >
                                  Edit lane
                                </Button>
                                <Button
                                  disabled={
                                    !writable ||
                                    loading ||
                                    !!error ||
                                    admissionEditing ||
                                    (selected.config.lanes.length === 1 &&
                                      !onDelete)
                                  }
                                  aria-label={`Delete ${lane.name} lane`}
                                  onClick={(event) => {
                                    if (selected.config.lanes.length === 1) {
                                      onDelete?.(selected, event.currentTarget);
                                    } else {
                                      editorTrigger.current =
                                        event.currentTarget;
                                      setDeletingLane(true);
                                      setLaneId(lane.id);
                                      setNotice("");
                                      setEditor(selected);
                                    }
                                  }}
                                >
                                  Delete lane
                                </Button>
                              </div>
                            }
                          />
                          <div className="review-config-reviewers">
                            <span className="text-caption text-subtle">
                              Reviewers
                            </span>
                            {lane.reviewers.length ? (
                              lane.reviewers.map((pubkey) => (
                                <ReviewerIdentity
                                  key={pubkey}
                                  pubkey={pubkey}
                                  session={session}
                                  choices={choices}
                                />
                              ))
                            ) : (
                              <p>No agents assigned.</p>
                            )}
                          </div>
                          <div className="review-config-summary-section">
                            <span className="text-caption text-subtle">
                              Routing rules ·{" "}
                              {lane.routing?.mode === "any"
                                ? "Match any"
                                : "Match all"}
                            </span>
                            {lane.routing?.rules.length ? (
                              <ul>
                                {lane.routing.rules.map((rule) => (
                                  <li key={rule.id}>{ruleDescription(rule)}</li>
                                ))}
                              </ul>
                            ) : (
                              <p>
                                All PRs · Add a routing rule when editing this
                                lane.
                              </p>
                            )}
                          </div>
                          <div className="review-config-summary-section">
                            <span className="text-caption text-subtle">
                              Instructions
                            </span>
                            <p className="review-config-instructions">
                              {lane.instructions}
                            </p>
                            <p>
                              Minimum reviewers: {lane.minimumReviewers ?? 1}
                            </p>
                            <p>
                              Human review:{" "}
                              {lane.requireHuman ? "Required" : "Optional"}
                            </p>
                            <p>
                              Automatic approval:{" "}
                              {lane.autoApprove ? "Allowed" : "Not allowed"}
                            </p>
                          </div>
                        </section>
                      ))}
                    </SettingsGroup>
                    <div>
                      <Button
                        ref={(node) => {
                          if (!laneId) editorTrigger.current = node;
                        }}
                        variant="prominent"
                        disabled={
                          !writable ||
                          loading ||
                          !!error ||
                          admissionEditing ||
                          selected.config.lanes.length >= 12
                        }
                        onClick={() => {
                          setDeletingLane(false);
                          setLaneId(undefined);
                          setNotice("");
                          setEditor(selected);
                        }}
                      >
                        Add lane
                      </Button>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
          {editor === "new" && !loading && remaining <= 0 && (
            <p role="alert">
              This channel has reached its configuration limit. Choose another
              channel.
            </p>
          )}
          {editor === "new" && (
            <ConfigurationEditor
              session={session}
              channel={channel}
              writable={writable && !loading && !error && remaining > 0}
              previous={undefined}
              existing={rows}
              onCancel={() =>
                initiallyCreating && onBack ? onBack() : setEditor(undefined)
              }
              onSaved={saved}
            />
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}

function ConfigurationEditor({
  session,
  channel,
  writable,
  previous,
  laneId,
  initiallyRemoving = false,
  existing,
  onCancel,
  onSaved,
}: {
  session: RelaySession;
  channel: string;
  writable: boolean;
  previous: SavedReviewConfig | undefined;
  laneId?: string | undefined;
  initiallyRemoving?: boolean;
  existing: readonly SavedReviewConfig[];
  onCancel: () => void;
  onSaved: (saved: SavedReviewConfig) => void;
}) {
  const choices = useReviewAgents(session, channel);
  const [refreshingAgents, setRefreshingAgents] = useState(false);
  const [agentRefreshError, setAgentRefreshError] = useState("");
  const original = previous?.config.lanes.find((lane) => lane.id === laneId);
  const [repository, setRepository] = useState(
    previous?.config.repository ?? "",
  );
  const [lane, setLane] = useState<ReviewLane>(() => ({
    ...(original ?? {
      id: crypto.randomUUID(),
      name: previous ? "" : "General",
      instructions: "",
      reviewers: [],
    }),
    routing: original?.routing?.rules.length
      ? original.routing
      : {
          mode: "all",
          rules: [
            {
              id: crypto.randomUUID(),
              field: "title",
              operator: "contains",
              value: "",
            },
          ],
        },
  }));
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(initiallyRemoving);
  const [error, setError] = useState("");
  const editorRegion = useRef<HTMLElement>(null);
  useEffect(() => {
    editorRegion.current?.focus();
  }, []);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  async function save(remove = false) {
    if (operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      if (
        !previous &&
        existing.some(
          (row) => row.config.repository === repositoryName(repository),
        )
      )
        throw new Error(
          "This repository is already configured in this channel. Cancel and edit its saved settings.",
        );
      if (!remove && !lane.routing?.rules.length)
        throw new Error(
          "Add at least one routing rule before saving this lane.",
        );
      const lanes = previous?.config.lanes ?? [];
      const draft: ReviewConfig = {
        ...previous?.config,
        version: 1,
        reminderMinutes: 15,
        ...(previous?.config.admission
          ? { admission: previous.config.admission }
          : {}),
        repository,
        lanes: remove
          ? lanes.filter((item) => item.id !== lane.id)
          : original
            ? lanes.map((item) => (item.id === lane.id ? lane : item))
            : [...lanes, lane],
      };
      const result = await saveConfiguration(
        session,
        channel,
        draft,
        previous,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      if (!controller.signal.aborted) onSaved(result);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          `${reason instanceof Error ? reason.message : "Could not save lane."} Your draft is still here. If settings changed elsewhere or the save timed out, copy your changes, then Cancel and Reload before retrying.`,
        );
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (initiallyRemoving && removing)
    return (
      <section
        className="review-config-form"
        ref={editorRegion}
        tabIndex={-1}
        aria-label="Delete lane"
      >
        <InlineHeader title={`Delete ${original?.name} lane?`} />
        <p>
          Remove this lane and its routing rules from future reviews? Existing
          review results and conversations are kept.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="review-config-actions">
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!writable}
            loading={busy}
            onClick={() => void save(true)}
          >
            Delete lane
          </Button>
        </div>
      </section>
    );
  return (
    <form
      ref={(node) => {
        editorRegion.current = node;
      }}
      tabIndex={-1}
      aria-label="Edit lane"
      noValidate
      className="review-config-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <Button disabled={busy} onClick={onCancel}>
          <ArrowLeftIcon />{" "}
          {previous ? "Back to lanes" : "Back to repositories"}
        </Button>
      </div>
      <InlineHeader
        title={
          original
            ? `Edit ${original.name}`
            : previous
              ? "Add lane"
              : "Register repository"
        }
        subtitle="Save this lane before adding another."
      />
      {!previous && (
        <SettingsGroup layout="form">
          <Field
            label="GitHub repository"
            description="Use owner/repository or the full repository URL."
          >
            <Input
              required
              value={repository}
              disabled={busy}
              maxLength={250}
              placeholder="example-org/project"
              onValueChange={setRepository}
            />
          </Field>
        </SettingsGroup>
      )}
      <SettingsGroup layout="form">
        <Field label="Lane name">
          <Input
            required
            maxLength={80}
            disabled={busy}
            value={lane.name}
            onValueChange={(name) => setLane({ ...lane, name })}
          />
        </Field>
        <LaneReviewers
          lane={1}
          reviewers={lane.reviewers.filter(
            (key) => !lane.humanReviewers?.includes(key),
          )}
          choices={choices}
          disabled={busy}
          onChange={(reviewers) =>
            setLane({
              ...lane,
              reviewers: [...reviewers, ...(lane.humanReviewers ?? [])],
              minimumReviewers: Math.min(
                lane.minimumReviewers ?? 1,
                Math.max(
                  1,
                  reviewers.length + (lane.humanReviewers?.length ?? 0),
                ),
              ),
            })
          }
        />
        <Select
          label="Minimum reviewers"
          variant="field"
          value={String(lane.minimumReviewers ?? 1)}
          disabled={busy || !lane.reviewers.length}
          groups={[
            {
              label: "Reviewers required",
              options: Array.from(
                { length: Math.max(1, lane.reviewers.length) },
                (_, index) => ({
                  value: String(index + 1),
                  label: String(index + 1),
                }),
              ),
            },
          ]}
          onValueChange={(value) =>
            setLane({ ...lane, minimumReviewers: Number(value) })
          }
          description="Each assigned reviewer gets a separate row and thread. All rows must approve for the PR to be Approved."
        />
        <HumanReviewers
          session={session}
          channel={channel}
          lane={lane}
          disabled={busy}
          onChange={setLane}
        />
        {choices.pending && <p role="status">Loading reviewer agents…</p>}
        {!choices.pending && !choices.selectable.length && (
          <p>
            No reviewer agents are available. Create or connect an agent, then
            refresh.
          </p>
        )}
        {choices.error && (
          <p role="alert">Some agents could not be loaded: {choices.error}</p>
        )}
        {choices.archives.error && (
          <p role="alert">
            Archived agents could not be checked: {choices.archives.error}
          </p>
        )}
        {agentRefreshError && <p role="alert">{agentRefreshError}</p>}
        <div>
          <Button
            disabled={busy || refreshingAgents}
            loading={refreshingAgents}
            onClick={async () => {
              setRefreshingAgents(true);
              setAgentRefreshError("");
              try {
                await session.agentChoices.refresh(true);
              } catch (reason) {
                setAgentRefreshError(
                  reason instanceof Error
                    ? reason.message
                    : "Could not refresh agents.",
                );
              } finally {
                setRefreshingAgents(false);
              }
            }}
          >
            Refresh agents
          </Button>
        </div>
        <Field
          label="Instructions"
          description="What should the agents review in this lane?"
        >
          <Textarea
            required
            rows={3}
            maxLength={8000}
            disabled={busy}
            value={lane.instructions}
            onChange={(event) =>
              setLane({ ...lane, instructions: event.target.value })
            }
          />
        </Field>
        <section className="review-config-form" aria-label="Lane routing rules">
          <Checkbox
            label="Allow automatic approval"
            checked={lane.autoApprove ?? false}
            disabled={busy}
            onCheckedChange={(checked) =>
              setLane({ ...lane, autoApprove: checked })
            }
          />
          <p className="text-caption text-subtle">
            Off by default. When off, reviewers must not approve on GitHub. When
            on, they may approve only after reviewing and finding no issues.
            Applies to new submissions.
          </p>
          <LaneRules
            lane={1}
            value={lane.routing}
            disabled={busy}
            onChange={(routing) => setLane({ ...lane, routing })}
          />
        </section>
      </SettingsGroup>
      {error && <p role="alert">{error}</p>}
      {removing ? (
        <div className="review-config-form">
          <p>
            Remove {original?.name} and its routing rules? Existing review
            threads are kept.
          </p>
          <div className="review-config-actions">
            <Button disabled={busy} onClick={() => setRemoving(false)}>
              Keep lane
            </Button>
            <Button
              disabled={busy || !writable}
              onClick={() => void save(true)}
            >
              Confirm remove lane
            </Button>
          </div>
        </div>
      ) : (
        <div className="review-config-actions">
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="prominent"
            loading={busy}
            disabled={!writable}
          >
            Save lane
          </Button>
          {original && previous && previous.config.lanes.length > 1 && (
            <Button
              disabled={busy || !writable}
              onClick={() => setRemoving(true)}
            >
              Remove lane
            </Button>
          )}
        </div>
      )}
      <div>
        <Button disabled>Add lane</Button>
        <p className="text-caption text-subtle">
          Save or cancel this lane first.
        </p>
      </div>
    </form>
  );
}
