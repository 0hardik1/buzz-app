import { useCallback, useEffect, useRef, useState } from "react";
import type { RelaySession } from "../../features/relay/session";
import { useChannelList } from "../../features/relay/react";
import { Button } from "../../shared/design-system/ui/Button";
import { Select } from "../../shared/design-system/ui/Select";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { Header, InlineHeader } from "../../shared/design-system/ui/Header";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { reviewChannelMember } from "./access";
import {
  deleteConfiguration,
  loadRepositoryDirectory,
  type SavedReviewConfig,
} from "./configuration";
import {
  useRepositoryDefault,
  useReviewRepository,
  useReviewChannel,
} from "./submission-updates";
import { ChannelConfiguration } from "./ReviewConfigurationPage";

export function useReviewRepositories(session: RelaySession) {
  const list = useChannelList(session.channels);
  const channels =
    list.status === "ready"
      ? list.channels.filter((channel) =>
          reviewChannelMember(channel, session.viewer),
        )
      : [];
  const signature = channels
    .map((channel) => channel.id)
    .sort()
    .join(":");
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    signature: string;
    rows: (SavedReviewConfig & { channel: string })[];
    loading: boolean;
    error: string;
    incomplete: boolean;
  }>({ signature: "", rows: [], loading: true, error: "", incomplete: false });
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit Reload requests a fresh bounded snapshot.
  useEffect(() => {
    const controller = new AbortController();
    setState({
      signature,
      rows: [],
      loading: true,
      error: "",
      incomplete: false,
    });
    void loadRepositoryDirectory(
      session,
      signature ? signature.split(":") : [],
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((next) => {
        if (!controller.signal.aborted)
          setState({ ...next, signature, loading: false, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            signature,
            rows: [],
            loading: false,
            incomplete: false,
            error: String(error),
          });
      });
    return () => controller.abort();
  }, [session, signature, reload]);
  return {
    ...state,
    error:
      list.status === "error"
        ? "Channel membership could not be loaded. Reconnect and retry."
        : state.error,
    channels,
    rows: state.signature === signature ? state.rows : [],
    loading:
      state.loading ||
      state.signature !== signature ||
      list.status === "loading",
    refresh: () => setReload((value) => value + 1),
  };
}

function RepositoryRow({
  session,
  repository,
  rows,
  channels,
  onOpen,
  onDelete,
}: {
  session: RelaySession;
  repository: string;
  rows: (SavedReviewConfig & { channel: string })[];
  channels: ReturnType<typeof useReviewRepositories>["channels"];
  onOpen(channel: string, repository: string): void;
  onDelete(
    row: SavedReviewConfig & { channel: string },
    trigger: HTMLElement,
  ): void;
}) {
  const [preferred, setPreferred] = useRepositoryDefault(
    session.scope,
    repository,
  );
  return (
    <section
      className="review-config-repository"
      aria-label={`${repository} configurations`}
    >
      <Header level={3} title={repository} eyebrow="Repository" />
      <SettingsGroup>
        {rows.length > 1 ||
        (preferred && !rows.some((row) => row.channel === preferred)) ? (
          <Select
            label={`Default channel for ${repository}`}
            variant="preference"
            value={
              rows.some((row) => row.channel === preferred) ? preferred : ""
            }
            placeholder="Choose your default"
            onValueChange={setPreferred}
            description="Your default for new submissions to this repository."
            groups={[
              {
                label: "Your configurations",
                options: rows.map((row) => ({
                  value: row.channel,
                  label:
                    channels.find((channel) => channel.id === row.channel)
                      ?.name ?? row.channel,
                })),
              },
            ]}
          />
        ) : (
          <p className="review-config-single-channel text-caption text-subtle">
            New reviews use this channel automatically.
          </p>
        )}
        {rows.map((row) => {
          const channel = channels.find(
            (channel) => channel.id === row.channel,
          );
          const name = channel?.name ?? row.channel;
          return (
            <div className="review-config-channel-row" key={row.artifactId}>
              <NavigationItem
                aria-label={`Open ${repository} in ${name}`}
                multiline
                label={
                  <span className="review-config-repository-label">
                    <span className="text-label-sm">{name}</span>
                    <span className="text-caption text-subtle">
                      {row.config.lanes.map((lane) => lane.name).join(" · ")}
                    </span>
                  </span>
                }
                trailing={`${row.config.lanes.length} ${row.config.lanes.length === 1 ? "lane" : "lanes"}`}
                onClick={() => onOpen(row.channel, repository)}
              />
              <Button
                variant="outline"
                size="sm"
                aria-label={`Delete ${repository} in ${name}`}
                disabled={!session.configArtifactWriter || channel?.readOnly}
                onClick={(event) => onDelete(row, event.currentTarget)}
              >
                Delete
              </Button>
            </div>
          );
        })}
      </SettingsGroup>
    </section>
  );
}

function DeleteConfigurationDialog({
  session,
  row,
  channelName,
  onClose,
  onDeleted,
  onEditingChange,
  finalFocus,
}: {
  session: RelaySession;
  row: SavedReviewConfig & { channel: string };
  channelName: string;
  onClose(): void;
  onDeleted(): void;
  onEditingChange(editing: boolean): void;
  finalFocus(deleted: boolean): HTMLElement | null;
}) {
  const operation = useRef<AbortController | null>(null);
  const deleted = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    onEditingChange(true);
    return () => {
      operation.current?.abort();
      onEditingChange(false);
    };
  }, [onEditingChange]);
  const remove = async () => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError("");
    try {
      await deleteConfiguration(
        session,
        row.channel,
        row,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      if (!controller.signal.aborted) {
        deleted.current = true;
        onDeleted();
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(String(error));
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setPending(false);
      }
    }
  };
  return (
    <AlertDialog
      title={`Delete ${row.config.repository} in ${channelName}?`}
      description="This removes this channel’s configuration for new reviews. Submitted PRs and conversations are kept. You can register the repository again later."
      pending={pending}
      initialFocus={cancel}
      finalFocus={() => finalFocus(deleted.current)}
      onClose={onClose}
      actions={
        <>
          <Button ref={cancel} disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={pending}
            onClick={() => void remove()}
          >
            Delete configuration
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert">
          {error} Reload configurations before retrying a conflict.
        </p>
      )}
    </AlertDialog>
  );
}

export function RepositoryConfigurations({
  session,
  onSubmit,
  onShowPulls,
  onEditingChange,
}: {
  session: RelaySession;
  onSubmit?: (() => void) | undefined;
  onShowPulls?: (() => void) | undefined;
  onEditingChange(editing: boolean): void;
}) {
  const directory = useReviewRepositories(session);
  const heading = useRef<HTMLHeadingElement>(null);
  const [deleting, setDeleting] = useState<{
    row: SavedReviewConfig & { channel: string };
    trigger: HTMLElement;
    session: RelaySession;
  }>();
  const deleteChannel =
    deleting?.session === session
      ? directory.channels.find(
          (channel) => channel.id === deleting.row.channel && !channel.readOnly,
        )
      : undefined;
  useEffect(() => {
    if (!deleteChannel) setDeleting(undefined);
  }, [deleteChannel]);
  const [, setRepository] = useReviewRepository(session.scope);
  const [, setChannel] = useReviewChannel(session.scope);
  const [editing, setEditing] = useState(false);
  const editingChanged = useCallback(
    (value: boolean) => {
      setEditing(value);
      onEditingChange(value);
    },
    [onEditingChange],
  );
  const [target, setTarget] = useState<{
    channel: string;
    repository: string;
    create?: true;
  }>();
  const selected = directory.channels.find(
    (channel) => channel.id === target?.channel,
  );
  const open = (channel: string, repository: string) => {
    setRepository(repository);
    setChannel(channel);
    setTarget({ channel, repository });
  };
  const back = () => {
    setTarget(undefined);
    directory.refresh();
  };
  if (target)
    return (
      <>
        {target.create && (
          <Select
            label="Review channel"
            variant="field"
            value={target.channel}
            placeholder="Choose a private channel"
            disabled={editing}
            onValueChange={(channel) => setTarget({ ...target, channel })}
            groups={[
              {
                label: "Your private channels",
                options: directory.channels
                  .filter((channel) => !channel.readOnly)
                  .map((channel) => ({
                    value: channel.id,
                    label: channel.name,
                  })),
              },
            ]}
          />
        )}
        {selected ? (
          <ChannelConfiguration
            key={target.channel}
            session={session}
            channel={target.channel}
            writable={!selected.readOnly && !!session.configArtifactWriter}
            initialRepository={target.repository}
            initiallyCreating={!!target.create}
            onBack={back}
            onDelete={(row, trigger) => {
              setTarget(undefined);
              setDeleting({
                row: { ...row, channel: target.channel },
                trigger,
                session,
              });
            }}
            onRegistered={(repository) => open(target.channel, repository)}
            onEditingChange={editingChanged}
            channelSelector={
              <p>
                Review channel: <strong>{selected.name}</strong>
              </p>
            }
            onSubmit={onSubmit}
            onShowPulls={onShowPulls}
          />
        ) : (
          <>
            <p>
              Choose a private channel you belong to. Access to a previous
              selection may have changed.
            </p>
            <Button onClick={back}>Back to repositories</Button>
          </>
        )}
      </>
    );
  const repositories = [
    ...new Set(directory.rows.map((row) => row.config.repository)),
  ].sort();
  return (
    <>
      <div className="review-config-actions">
        <Button
          disabled={!directory.channels.some((channel) => !channel.readOnly)}
          onClick={() =>
            setTarget({ channel: "", repository: "", create: true })
          }
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
      <InlineHeader
        ref={heading}
        tabIndex={-1}
        title="Repositories"
        subtitle="Configurations in your private review channels. Each channel has its own lanes and agents."
        actions={
          <Button disabled={directory.loading} onClick={directory.refresh}>
            Reload
          </Button>
        }
      />
      {directory.loading ? (
        <p role="status">Loading configurations…</p>
      ) : directory.error ? (
        <p role="alert">{directory.error}</p>
      ) : repositories.length ? (
        repositories.map((repository) => (
          <RepositoryRow
            key={repository}
            session={session}
            repository={repository}
            rows={directory.rows.filter(
              (row) => row.config.repository === repository,
            )}
            channels={directory.channels}
            onOpen={open}
            onDelete={(row, trigger) => setDeleting({ row, trigger, session })}
          />
        ))
      ) : (
        <p>
          No repositories configured in your private channels. Register one to
          save its review lanes.
        </p>
      )}
      {deleting && deleteChannel && (
        <DeleteConfigurationDialog
          session={session}
          row={deleting.row}
          channelName={deleteChannel.name}
          onEditingChange={onEditingChange}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDeleting(undefined);
            directory.refresh();
          }}
          finalFocus={(deleted) =>
            !deleted && deleting.trigger.isConnected
              ? deleting.trigger
              : heading.current
          }
        />
      )}
      {directory.incomplete && (
        <p role="alert">
          Some configurations could not be loaded, or the 500-configuration
          limit was reached. Reload or open a known configuration.
        </p>
      )}
    </>
  );
}

export function SubmissionRepository({
  session,
  disabled,
  onSelection,
}: {
  session: RelaySession;
  disabled: boolean;
  onSelection(repository: string, channel: string): void;
}) {
  const directory = useReviewRepositories(session);
  const [repository, setRepository] = useReviewRepository(session.scope);
  const [preferred] = useRepositoryDefault(session.scope, repository);
  const [override, setOverride] = useState<{
    repository: string;
    channel: string;
  }>();
  const rows = directory.rows.filter(
    (row) => row.config.repository === repository,
  );
  const requested =
    override?.repository === repository ? override.channel : preferred;
  const channel = rows.some((row) => row.channel === requested)
    ? requested
    : !requested && rows.length === 1
      ? (rows[0]?.channel ?? "")
      : "";
  useEffect(() => {
    onSelection(repository, channel);
  }, [repository, channel, onSelection]);
  return (
    <>
      <Select
        label="Repository"
        variant="field"
        value={repository}
        disabled={disabled || directory.loading}
        placeholder="Choose a repository"
        onValueChange={setRepository}
        groups={[
          {
            label: "Repositories",
            options: [
              ...new Set(directory.rows.map((row) => row.config.repository)),
            ]
              .sort()
              .map((value) => ({ value, label: value })),
          },
        ]}
      />
      <Select
        label="Review channel"
        variant="field"
        value={channel}
        disabled={disabled || !rows.length}
        placeholder="Choose a channel"
        onValueChange={(channel) => setOverride({ repository, channel })}
        description="The PR and its review threads stay in this channel."
        groups={[
          {
            label: "Your configurations",
            options: rows.map((row) => ({
              value: row.channel,
              label:
                directory.channels.find((item) => item.id === row.channel)
                  ?.name ?? row.channel,
            })),
          },
        ]}
      />
      {directory.error && <p role="alert">{directory.error}</p>}
      {directory.incomplete && (
        <p role="alert">
          Some configurations are unavailable. Reload Review Configuration to
          check them.
        </p>
      )}
      {requested && !channel && !directory.loading && (
        <p role="alert">
          Your previous channel is unavailable. Choose another configuration.
        </p>
      )}
    </>
  );
}
