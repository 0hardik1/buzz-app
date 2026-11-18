import {
  useEffect,
  useEffectEvent,
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import type { Decisions } from "../../features/decisions/service";
import type { RelaySession } from "../../features/relay/session";
import { useRailModel } from "./rail-model";
import { useSectionPeople } from "./useSectionPeople";
import { useIdentityNames } from "../../features/identity-names/react";
import { useSavedHiddenDmIds } from "../../bundled/channels/useHiddenDms";
import { splitPartition } from "../../features/relay/partition";
import type { SidebarSections } from "../../features/channel-navigation/sidebar-sections-service";
import { liveSectionMatches } from "../../features/sidebar-sections/live-section";
import { RailEntryArtwork } from "./RailEntryArtwork";
import { LiveGitHubRows } from "./LiveGitHubRows";
import {
  describeSection,
  localSectionRule,
  parseLiveSection,
  sectionDescription,
  sectionSearch,
  type LiveSectionRule,
} from "../../features/sidebar-sections/live-section";
import {
  useVoiceDictation,
  useVoiceSearchAvailable,
  prepareVoice,
} from "../../features/search/voice-dictation";
import { matchPerson } from "../../features/search/person-match";
import { searchDebounce } from "../../shared/search-debounce";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { SearchField } from "../../shared/design-system/ui/SearchField";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Field } from "../../shared/design-system/ui/Field";
import { Input } from "../../shared/design-system/ui/Input";
import { Checkbox } from "../../shared/design-system/ui/Checkbox";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { NavigationSection } from "../../shared/design-system/ui/NavigationSection";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import {
  ChatCircleIcon,
  MicrophoneIcon,
  StopIcon,
} from "../../shared/design-system/icons";
import {
  demoWidgets,
  getDemoWidget,
  DemoWidgetPreview,
  type DemoWidgetKind,
} from "../../features/sidebar-widget-demos";
import styles from "./NewRailSection.module.css";

/** The global New menu is rendered by AppShell's creation slot. */
export const RailSectionServices = createContext<{
  decisions?: Decisions | undefined;
  sidebarSections?: SidebarSections | undefined;
  created?: (id: string, widget?: DemoWidgetKind) => void;
}>({});
export function NewRailSection({
  session,
  community,
  decisions: suppliedDecisions,
  create,
  close,
  finalFocus,
  sidebarSections: suppliedSections,
}: {
  session: RelaySession;
  community: string;
  decisions?: Decisions | undefined;
  sidebarSections?: SidebarSections | undefined;
  create(
    title: string,
    rule?: LiveSectionRule,
    widget?: DemoWidgetKind,
  ): boolean;
  close(): void;
  finalFocus: ComponentProps<typeof Dialog>["finalFocus"];
}) {
  const services = useContext(RailSectionServices);
  const decisions = suppliedDecisions ?? services.decisions;
  const sidebarSections = suppliedSections ?? services.sidebarSections;
  const [widget, setWidget] = useState<DemoWidgetKind>();
  const [widgetName, setWidgetName] = useState("");
  const card = widget ? getDemoWidget(widget) : undefined;
  const [description, setDescription] = useState("");
  const [savedRule, setRule] = useState<LiveSectionRule>();
  const [name, setName] = useState<string>();
  const described = sectionDescription(description);
  const sectionName = (name ?? described.name ?? "").trim();
  const [peopleQuery, setPeopleQuery] = useState("");
  const [addingPeople, setAddingPeople] = useState(false);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");
  const run = useRef<AbortController>(undefined);
  const attempted = useRef<string>(undefined);
  const input = useRef<HTMLElement>(null);
  const search = sectionSearch(description);
  const directory = useSectionPeople(session, search.terms, !widget);
  const { people } = directory;
  const rule = savedRule?.search
    ? {
        ...savedRule,
        people: directory
          .rank(savedRule.search)
          .slice(0, 16)
          .map((person) => person.pubkey),
      }
    : savedRule;
  const empty = !described.query && !rule && !!sectionName;
  const localRule = (text: string) => {
    const query = sectionSearch(text);
    return query.plain
      ? { version: 1 as const, dms: false, people: [], search: query.query }
      : localSectionRule(text, people);
  };
  useEffect(
    () => () => {
      run.current?.abort();
    },
    [],
  );
  const available = useVoiceSearchAvailable(true);
  const cancelGeneration = () => {
    run.current?.abort();
    setPending(false);
    setError("");
  };
  const edit = (next: LiveSectionRule) => {
    cancelGeneration();
    setRule(next);
    setDirty(false);
  };
  const describe = async (text = description) => {
    if (!decisions || !sectionDescription(text).query) return;
    attempted.current = text;
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setPending(true);
    setError("");
    try {
      const next = await describeSection(
        decisions,
        text,
        people,
        community,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setRule(next);
      setDirty(false);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t create a preview. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };
  const changeDescription = (text: string) => {
    cancelGeneration();
    if (sectionDescription(text).name !== described.name) setName(undefined);
    setDescription(text);
    attempted.current = undefined;
    const local = composing ? undefined : localRule(text);
    setDirty(!!sectionDescription(text).query && !local);
    if (local) {
      setRule(local);
      attempted.current = text;
    } else {
      setRule(undefined);
    }
    return local;
  };
  const dictation = useVoiceDictation({
    onText: changeDescription,
    onEnd: (text) => {
      if (!changeDescription(text)) void describe(text);
    },
    onError: setError,
  });
  const dismiss = () => {
    run.current?.abort();
    dictation.cancel();
    close();
  };
  const names = (rule?.people ?? []).map(
    (key) =>
      people.find((person) => person.pubkey === key)?.name ?? "Unknown person",
  );
  const title =
    sectionName ||
    (empty || !rule
      ? "New section"
      : rule.search
        ? rule.search
        : rule?.github && rule.dms
          ? "DMs & pull requests"
          : rule?.github
            ? "Pull requests"
            : names.length
              ? `DMs with ${names.join(", ")}`
              : "Direct messages");
  const selected = new Set(rule?.people);
  const visiblePeople = [
    ...people.filter((person) => selected.has(person.pubkey)),
    ...people
      .filter(
        (person) =>
          addingPeople &&
          !selected.has(person.pubkey) &&
          (!peopleQuery ||
            [person.name, ...person.aliases].some((name) =>
              matchPerson(name, peopleQuery),
            )),
      )
      .slice(0, 6),
  ];
  const canCreate = !!card || (!dirty && !!(empty || parseLiveSection(rule)));
  const suggestions = search.query
    ? directory.rank(search.query).slice(0, 6)
    : [];
  const previewDescription = () => {
    const local = localRule(description);
    if (local) {
      attempted.current = description;
      edit(local);
    } else if (!directory.loading) void describe();
  };
  const automaticPreview = useEffectEvent(previewDescription);
  const knownRule = JSON.stringify(localRule(description));
  const applyKnownPeople = useEffectEvent(() => {
    if (!dirty) return;
    const local = localRule(description);
    if (local) {
      attempted.current = description;
      edit(local);
    }
  });
  useEffect(() => {
    if (knownRule) applyKnownPeople();
  }, [knownRule]);
  useEffect(() => {
    if (
      widget ||
      !dirty ||
      !description.trim() ||
      directory.loading ||
      composing ||
      dictation.state !== "idle"
    )
      return;
    return searchDebounce(() => {
      if (attempted.current !== description) automaticPreview();
    });
  }, [
    description,
    dirty,
    composing,
    dictation.state,
    widget,
    directory.loading,
  ]);
  return (
    <Dialog
      open
      size="wide"
      presentation="search"
      height="stable"
      bodyLayout="flex"
      title="Create section"
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      navigation={{
        label: "Section types",
        content: (
          <>
            <NavigationSection label="Sections">
              <NavigationItem
                label="Custom section"
                selected={!widget}
                onClick={() => {
                  setWidget(undefined);
                  setError("");
                }}
              />
            </NavigationSection>
            <NavigationSection label="Widget previews">
              {demoWidgets.map((item) => (
                <NavigationItem
                  key={item.id}
                  label={item.title}
                  selected={widget === item.id}
                  onClick={() => {
                    if (widget === item.id) return;
                    if (pending) attempted.current = undefined;
                    cancelGeneration();
                    dictation.cancel();
                    setWidget(item.id);
                    setWidgetName("");
                  }}
                />
              ))}
            </NavigationSection>
          </>
        ),
      }}
      initialFocus={input}
      finalFocus={finalFocus}
      actions={
        <>
          <Button onClick={dismiss}>Cancel</Button>
          <Button
            variant="prominent"
            disabled={!canCreate || pending || dictation.state !== "idle"}
            onClick={() => {
              dictation.cancel();
              const saved = card
                ? create(
                    (widgetName.trim() || card.title).slice(0, 256),
                    undefined,
                    card.id,
                  )
                : create(
                    title.slice(0, 256),
                    empty ? undefined : parseLiveSection(rule),
                  );
              if (saved) dismiss();
              else
                setError(
                  "Couldn’t save this section on this device. Try again.",
                );
            }}
          >
            Create section
          </Button>
        </>
      }
    >
      {card ? (
        <section className={styles.widgetDetail} aria-label="Widget preview">
          <div className={styles.widgetIntro}>
            <h2 className="text-heading-sm">{card.title}</h2>
            <p className="text-body-sm text-secondary">{card.purpose}</p>
          </div>
          <div className={styles.widgetStage}>
            <DemoWidgetPreview
              key={card.id}
              kind={card.id}
              title={widgetName.trim() || card.title}
            />
          </div>
          <p className="text-caption text-secondary">
            Demo data · Added to your sidebar on this device
          </p>
          <Field label="Section name" optional>
            <Input
              aria-label="Section name"
              value={widgetName}
              placeholder={card.title}
              maxLength={256}
              onChange={(event) => setWidgetName(event.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="text-body-sm text-secondary">
              {error}
            </p>
          )}
        </section>
      ) : (
        <div className={styles.customDetail}>
          <div className={styles.controls}>
            <SearchField
              inputRef={input}
              variant="palette"
              label="Describe a section"
              placeholder="Search or describe a section…"
              value={description}
              maxLength={512}
              onValueChange={changeDescription}
              onCompositionStart={() => {
                cancelGeneration();
                setComposing(true);
              }}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  dictation.cancel();
                  previewDescription();
                }
              }}
              trailing={
                available && (
                  <IconButton
                    aria-label={
                      dictation.state === "idle"
                        ? "Describe section by voice"
                        : "Stop listening"
                    }
                    icon={
                      dictation.state === "idle" ? (
                        <MicrophoneIcon size={20} />
                      ) : (
                        <StopIcon size={20} />
                      )
                    }
                    onPointerEnter={prepareVoice}
                    onClick={() => {
                      if (dictation.state === "idle") {
                        cancelGeneration();
                        void dictation.start();
                      } else dictation.stop();
                    }}
                  />
                )
              }
            />
          </div>
          <div className={styles.builder}>
            <div className={styles.options}>
              <Field label="Section name">
                <Input
                  aria-label="Section name"
                  value={name ?? described.name ?? ""}
                  placeholder={title}
                  maxLength={256}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              {(error || directory.error) && (
                <div role="alert">
                  <p className="text-body-sm text-secondary">
                    {error || "People search couldn’t finish. Try again."}
                  </p>
                  <Button
                    size="sm"
                    variant="plain"
                    disabled={pending}
                    onClick={() => {
                      if (directory.error) {
                        setError("");
                        directory.retry();
                      } else previewDescription();
                    }}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {!rule && !empty && !!suggestions.length && (
                <NavigationSection label="Matches">
                  {suggestions.map((person) => (
                    <NavigationItem
                      key={person.pubkey}
                      label={`DMs with ${person.name}`}
                      icon={<ChatCircleIcon size={20} />}
                      onClick={() =>
                        edit({ version: 1, dms: true, people: [person.pubkey] })
                      }
                    />
                  ))}
                </NavigationSection>
              )}
              {!empty && rule?.dms && (
                <div>
                  <NavigationSection label="People">
                    <div className={styles.people}>
                      {!selected.size && (
                        <p className="text-body-sm text-secondary">Everyone</p>
                      )}
                      {addingPeople && (
                        <SearchField
                          autoFocus
                          variant="capsule"
                          label="Find DM participants"
                          placeholder="Find people…"
                          value={peopleQuery}
                          onValueChange={setPeopleQuery}
                        />
                      )}
                      {visiblePeople.map((person) => (
                        <Checkbox
                          size="sm"
                          key={person.pubkey}
                          label={person.name}
                          checked={selected.has(person.pubkey)}
                          disabled={
                            !selected.has(person.pubkey) && selected.size >= 16
                          }
                          onCheckedChange={(checked) =>
                            edit({
                              ...rule,
                              people: checked
                                ? [...selected, person.pubkey]
                                : [...selected].filter(
                                    (key) => key !== person.pubkey,
                                  ),
                            })
                          }
                        />
                      ))}
                      {addingPeople && peopleQuery && !visiblePeople.length && (
                        <p className="text-caption text-secondary">
                          No people found in this community.
                        </p>
                      )}
                      <div>
                        <Button
                          size="sm"
                          variant="plain"
                          onClick={() => {
                            setAddingPeople(!addingPeople);
                            setPeopleQuery("");
                          }}
                        >
                          {addingPeople ? "Done" : "Add people"}
                        </Button>
                      </div>
                    </div>
                  </NavigationSection>
                </div>
              )}
              {!empty && rule?.github !== undefined && (
                <Field
                  label="GitHub search"
                  description="Use a GitHub login with author:."
                >
                  <Input
                    aria-label="GitHub search"
                    value={rule.github}
                    maxLength={512}
                    onChange={(event) =>
                      edit({ ...rule, github: event.target.value })
                    }
                  />
                </Field>
              )}
            </div>
            <section className={styles.preview} aria-label="Section preview">
              <div className={styles.previewLabel}>
                <p className="text-label text-secondary">Preview</p>
              </div>
              <LoadingRegion
                pending={pending || directory.loading}
                label="Updating preview…"
                statusVisibility="screen-reader"
              >
                <NavigationSection
                  label={rule || empty ? title : "Your section"}
                >
                  {rule ? (
                    <LiveSectionPreview
                      session={session}
                      rule={rule}
                      sidebarSections={sidebarSections}
                    />
                  ) : (
                    <div className={styles.previewEmpty}>
                      <p className="text-body-sm text-secondary">
                        {empty
                          ? "Add conversations after creating this section."
                          : pending || directory.loading
                            ? "Finding matching conversations…"
                            : "Name your section, or describe what belongs here."}
                      </p>
                    </div>
                  )}
                </NavigationSection>
              </LoadingRegion>
              {rule && (
                <div className={styles.previewLabel}>
                  <p className="text-caption text-secondary">
                    {dirty
                      ? "Preview will update as you type."
                      : "Live · Saved on this device"}
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function LiveSectionPreview({
  session,
  rule,
  sidebarSections,
}: {
  session: RelaySession;
  rule: LiveSectionRule;
  sidebarSections: SidebarSections | undefined;
}) {
  const { channels, channelsById, byId, agents, agentEntries } =
    useRailModel(session);
  const hidden = useSavedHiddenDmIds(session.scope);
  const resolveName = useIdentityNames(session.names);
  const matches = liveSectionMatches(
    rule,
    channels.filter((channel) => !hidden.has(channel.id)),
    (channel) => byId.get(`channel:${channel.id}`)?.label ?? channel.name,
    session.profiles.snapshot(),
  );
  const scope = splitPartition(session.scope);
  return (
    <>
      {matches.slice(0, 4).map((channel) => {
        const entry = byId.get(`channel:${channel.id}`);
        return entry ? (
          <NavigationItem
            key={entry.id}
            label={entry.label}
            disabled
            icon={
              <RailEntryArtwork
                entry={entry}
                selected={false}
                session={session}
                channelsById={channelsById}
                resolveName={resolveName}
                identities={agents.identities}
                agentEntries={agentEntries}
              />
            }
          />
        ) : null;
      })}
      {(rule.dms || rule.search) && !matches.length && (
        <p className="text-caption text-secondary">
          {rule.search
            ? "No matching conversations yet."
            : "No matching DMs yet."}
        </p>
      )}
      {rule.github && scope && (
        <LiveGitHubRows
          registry={sidebarSections}
          scope={scope}
          query={rule.github}
          editing
        />
      )}
    </>
  );
}
