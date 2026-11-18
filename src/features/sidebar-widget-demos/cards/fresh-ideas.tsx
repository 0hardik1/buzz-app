import { useState, type ReactNode } from "react";
import { Button } from "../../../shared/design-system/ui/Button";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import { Checkbox } from "../../../shared/design-system/ui/Checkbox";
import {
  ArrowRightIcon,
  ArrowClockwiseIcon,
  BellIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  FileTextIcon,
  GitBranchIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  XCircleIcon,
} from "../../../shared/design-system/icons";
import type { CardDefinition, CardProps } from "../card-types";
import "./fresh-ideas.css";

function Body({
  variant,
  kind,
  children,
}: CardProps & { kind: string; children: ReactNode }) {
  return (
    <div
      className={`fresh-widget fresh-${kind} text-body-sm`}
      data-variant={variant}
    >
      {children}
    </div>
  );
}

function FocusAperture({ variant }: CardProps) {
  const [running, setRunning] = useState(false);
  return (
    <Body variant={variant} kind="focus">
      <div className="fresh-main-row">
        <svg className="fresh-dial" viewBox="0 0 44 44" aria-hidden="true">
          {Array.from({ length: 12 }, (_, step) => step).map((tick) => (
            <line
              key={tick}
              x1="22"
              y1="2"
              x2="22"
              y2={tick % 3 === 0 ? "6" : "4"}
              transform={`rotate(${tick * 30} 22 22)`}
            />
          ))}
          <circle cx="22" cy="22" r="14" className="fresh-dial-track" />
          <circle
            cx="22"
            cy="22"
            r="14"
            className="fresh-dial-value"
            data-running={running || undefined}
            strokeDasharray="76 88"
          />
        </svg>
        <span className="text-heading fresh-number">25:00</span>
        <IconButton
          size="sm"
          variant="subtle"
          aria-label={running ? "Pause focus" : "Start focus"}
          aria-pressed={running}
          icon={running ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          onClick={() => setRunning(!running)}
        />
      </div>
      <span className="text-caption fresh-muted">
        {running ? "Focusing on empty states" : "One thing: empty states"}
      </span>
    </Body>
  );
}

function GoldenHour({ variant }: CardProps) {
  const [saved, setSaved] = useState(false);
  return (
    <Body variant={variant} kind="overlap">
      <div className="fresh-three">
        {[
          { city: "NYC", time: "10:00" },
          { city: "London", time: "15:00" },
          { city: "Lisbon", time: "15:00" },
        ].map(({ city, time }) => (
          <div className="fresh-time" key={city}>
            <span className="text-caption fresh-muted">{city}</span>
            <span className="text-label-sm fresh-number">{time}</span>
          </div>
        ))}
      </div>
      <div
        className="fresh-overlap-band"
        role="img"
        aria-label="Shared working overlap: 09:00 to 11:00 in New York, 14:00 to 16:00 in London and Lisbon"
      >
        {Array.from({ length: 12 }, (_, step) => step + 7).map((hour) => (
          <span
            key={hour}
            data-overlap={(hour >= 9 && hour <= 11) || undefined}
            data-current={hour === 10 || undefined}
          />
        ))}
      </div>
      <div data-widget-secondary>
        <IconButton
          variant="ghost"
          aria-label={saved ? "Unsave 09–11 overlap" : "Save 09–11 overlap"}
          aria-pressed={saved}
          icon={saved ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
          onClick={() => setSaved(!saved)}
        />
      </div>
    </Body>
  );
}

function BuildDepartures({ variant }: CardProps) {
  const [passed, setPassed] = useState(false);
  return (
    <Body variant={variant} kind="build">
      <div className="fresh-three">
        {[
          { name: "Desktop", okay: true },
          { name: "Web", okay: passed },
          { name: "Relay", okay: true },
        ].map(({ name, okay }) => (
          <div
            className="fresh-build-status"
            data-issue={!okay || undefined}
            key={name}
          >
            <span className="text-caption fresh-muted">{name}</span>
            <span
              className="fresh-build-result text-caption"
              data-okay={okay || undefined}
            >
              {okay ? <CheckCircleIcon size={16} /> : <XCircleIcon size={16} />}
              {okay ? "Pass" : "Fail"}
            </span>
          </div>
        ))}
      </div>
      <div data-widget-secondary>
        <IconButton
          variant="ghost"
          aria-label={passed ? "Reset builds" : "Replay web"}
          icon={<ArrowClockwiseIcon size={16} />}
          onClick={() => setPassed(!passed)}
        />
      </div>
    </Body>
  );
}

const snippets = [
  "Here’s where I landed. Here’s the next useful step.",
  "What would make this feel a little simpler?",
  "First pass is ready. I’d love a second pair of eyes.",
];
function SnippetShelf({ variant }: CardProps) {
  const [index, setIndex] = useState(0);
  return (
    <Body variant={variant} kind="snippet">
      <p className="fresh-quote text-body-sm">“{snippets[index]}”</p>
      <div className="fresh-main-row">
        <span className="text-caption fresh-muted">0{index + 1} / 03</span>
        <span data-widget-secondary>
          <IconButton
            size="xs"
            aria-label="Next snippet"
            icon={<ArrowRightIcon size={12} />}
            onClick={() => setIndex((index + 1) % snippets.length)}
          />
        </span>
      </div>
    </Body>
  );
}

function DecisionDesk({ variant }: CardProps) {
  const [choice, setChoice] = useState("Rough cut");
  return (
    <Body variant={variant} kind="decision">
      <span className="text-caption fresh-muted">How to get feedback?</span>
      <div className="fresh-decision-options">
        {["Rough cut", "Pair up"].map((label) => (
          <div className="fresh-decision-option" key={label}>
            <Button
              size="inline"
              variant={choice === label ? "prominent" : "subtle"}
              aria-pressed={choice === label}
              onClick={() => setChoice(label)}
            >
              {label}
            </Button>
            <span className="text-caption fresh-muted">
              {label === "Rough cut" ? "Faster" : "Deeper"}
            </span>
          </div>
        ))}
      </div>
    </Body>
  );
}

function ContextCapsule({ variant }: CardProps) {
  const [opened, setOpened] = useState(false);
  return (
    <Body variant={variant} kind="capsule">
      <div className="fresh-main-row">
        <div className="fresh-context-lines">
          <span className="fresh-inline text-caption">
            <GitBranchIcon size={14} />
            empty-state
          </span>
          <span className="fresh-inline text-caption fresh-muted">
            <FileTextIcon size={14} />
            {opened ? "Check narrow layout" : "EmptyState.tsx"}
          </span>
        </div>
        <span data-widget-secondary>
          <IconButton
            size="sm"
            variant="subtle"
            aria-label={
              opened ? "Close context capsule" : "Resume context capsule"
            }
            aria-pressed={opened}
            icon={
              opened ? <CheckIcon size={16} /> : <ArrowRightIcon size={16} />
            }
            onClick={() => setOpened(!opened)}
          />
        </span>
      </div>
      <span className="text-caption fresh-muted">
        {opened ? "Your next step, remembered." : "Right where you left off."}
      </span>
    </Body>
  );
}

function MeetingRunway({ variant }: CardProps) {
  const [ready, setReady] = useState(false);
  return (
    <Body variant={variant} kind="meeting">
      <div className="fresh-main-row">
        <span className="text-label-sm">Design pairing</span>
        <span className="text-caption fresh-muted">14:30</span>
      </div>
      <Checkbox
        label={ready ? "Question ready" : "Pick one question"}
        checked={ready}
        onCheckedChange={setReady}
      />
      <div className="fresh-readiness" aria-hidden="true">
        <span data-ready={ready || undefined} />
      </div>
    </Body>
  );
}

const reading = [
  { title: "The art of defaults", time: 6 },
  { title: "Room for the in-between", time: 9 },
  { title: "Quieter software", time: 4 },
];
function ReadLater({ variant }: CardProps) {
  const [index, setIndex] = useState(0);
  const article = reading[index] ?? reading[0];
  return (
    <Body variant={variant} kind="reading">
      <div className="fresh-main-row">
        <div className="fresh-book" aria-hidden="true">
          <span className="text-caption">0{index + 1}</span>
        </div>
        <div className="fresh-reading-copy">
          <span className="text-body-sm">{article?.title}</span>
          <span className="text-caption fresh-muted">
            {article?.time} min read
          </span>
        </div>
        <span data-widget-secondary>
          <IconButton
            size="xs"
            aria-label="Mark read and show next article"
            icon={<CheckIcon size={12} />}
            onClick={() => setIndex((index + 1) % reading.length)}
          />
        </span>
      </div>
    </Body>
  );
}

const channels = [
  { label: "Mentions", Icon: BellIcon },
  { label: "Replies", Icon: ChatCircleIcon },
  { label: "Reactions", Icon: CheckCircleIcon },
];
function SignalTuner({ variant }: CardProps) {
  const [enabled, setEnabled] = useState([true, true, false]);
  return (
    <Body variant={variant} kind="signal">
      <div className="fresh-three">
        {channels.map(({ label, Icon }, index) => (
          <div className="fresh-channel" key={label}>
            <Button
              size="inline"
              variant={enabled[index] ? "subtle" : "ghost"}
              aria-label={`${label}, ${[3, 2, 1][index]} signals, ${enabled[index] ? "on" : "off"}`}
              aria-pressed={enabled[index]}
              onClick={() =>
                setEnabled(
                  enabled.map((value, i) => (i === index ? !value : value)),
                )
              }
            >
              <Icon size={12} />
              {[3, 2, 1][index]}
            </Button>
            <span className="text-caption fresh-muted">{label}</span>
            <div className="fresh-signal-meter" aria-hidden="true">
              {[1, 2, 3].map((level) => (
                <span
                  key={level}
                  data-on={
                    (enabled[index] && level <= ([3, 2, 1][index] ?? 0)) ||
                    undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Body>
  );
}

function TinyWins({ variant }: CardProps) {
  const [extra, setExtra] = useState(false);
  return (
    <Body variant={variant} kind="wins">
      <div className="fresh-main-row">
        <div className="fresh-win-count">
          <span className="text-heading">{extra ? 4 : 3}</span>
          <span className="text-body-sm">small wins</span>
        </div>
        <span data-widget-secondary>
          <IconButton
            size="sm"
            variant="subtle"
            aria-label={extra ? "Undo little win" : "Count a little win"}
            aria-pressed={extra}
            icon={extra ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
            onClick={() => setExtra(!extra)}
          />
        </span>
      </div>
      <div className="fresh-win-dots" aria-hidden="true">
        {["layout", "helped", "simplified", ...(extra ? ["noticed"] : [])].map(
          (win) => (
            <span key={win} />
          ),
        )}
      </div>
    </Body>
  );
}
export const freshIdeas: CardDefinition[] = [
  {
    id: "focus-aperture",
    title: "Focus aperture",
    subtitle: "Make room for one good thing",
    category: "Fresh ideas",
    purpose:
      "Protect a short block of attention without leaving your workspace.",
    how: "Start or pause a fixed 25-minute local focus scene. No timer runs.",
    source: "Proposed local focus session · synthetic task",
    component: FocusAperture,
  },
  {
    id: "golden-hour",
    title: "Golden hour",
    subtitle: "A considerate time to connect",
    category: "Fresh ideas",
    purpose: "Find a friendly overlap across a distributed team.",
    how: "Compare three fixed city times on one shared overlap band and save the 09–11 New York window locally.",
    source:
      "Synthetic teammates and fixed UTC offsets · no calendar connection",
    component: GoldenHour,
  },
  {
    id: "build-departures",
    title: "Build departures",
    subtitle: "The branch departure board",
    category: "Fresh ideas",
    purpose: "See which builds landed safely and which need attention.",
    how: "Replay the failed synthetic web build; click again to restore the starting scene.",
    source: "Synthetic CI runs · no CI connection",
    component: BuildDepartures,
  },
  {
    id: "snippet-shelf",
    title: "Snippet shelf",
    subtitle: "Good words, within reach",
    category: "Fresh ideas",
    purpose: "Keep thoughtful reusable text beside your conversations.",
    how: "Use the arrow to cycle through three compact reusable snippets.",
    source: "Handwritten example snippets · no clipboard access",
    component: SnippetShelf,
  },
  {
    id: "decision-desk",
    title: "Decision desk",
    subtitle: "Give a small decision a home",
    category: "Fresh ideas",
    purpose: "Make a lightweight tradeoff explicit before moving on.",
    how: "Choose a rough cut for faster feedback or pairing for deeper feedback.",
    source: "Synthetic feedback choices · local preference",
    component: DecisionDesk,
  },
  {
    id: "context-capsule",
    title: "Context capsule",
    subtitle: "Pick up the thread of your work",
    category: "Fresh ideas",
    purpose: "Remember why a task stopped and the next useful step.",
    how: "Resume the local capsule to reveal the remembered next step.",
    source: "Synthetic branch, file, and handoff note · no filesystem access",
    component: ContextCapsule,
  },
  {
    id: "meeting-runway",
    title: "Meeting runway",
    subtitle: "A thoughtful little preflight",
    category: "Fresh ideas",
    purpose: "Arrive at a conversation with one useful question.",
    how: "Check your one preparation item to light the readiness strip.",
    source: "Synthetic pairing session · local checklist",
    component: MeetingRunway,
  },
  {
    id: "read-later",
    title: "Read later",
    subtitle: "A small shelf for a slower moment",
    category: "Fresh ideas",
    purpose: "Keep a manageable reading queue close at hand.",
    how: "Mark the current fictional article read and cycle to the next one.",
    source: "Fictional articles and authors · no external navigation",
    component: ReadLater,
  },
  {
    id: "signal-tuner",
    title: "Signal tuner",
    subtitle: "Find your level of Buzz",
    category: "Fresh ideas",
    purpose: "Set an intentional mix of conversation signals.",
    how: "Toggle mentions, replies, and reactions independently. Fixed counts show example signal volume; the miniature meters show which channels are enabled.",
    source:
      "Local notification preference concept · no actual settings changes",
    component: SignalTuner,
  },
  {
    id: "tiny-wins",
    title: "Tiny wins",
    subtitle: "Notice the things that moved",
    category: "Fresh ideas",
    purpose: "Make everyday progress visible without a productivity score.",
    how: "Count one additional little win, then undo it.",
    source: "Synthetic accomplishments · local demo state",
    component: TinyWins,
  },
];
