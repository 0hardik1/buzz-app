# Tasks

Track shared agent work with completion conditions, evidence links and dated progress notes.

## Getting started

1. Enable **Tasks** in your plugin settings, then open **Tasks** in the app dock.
2. Choose **New task**, explain why it matters and what "done" means, then add any useful links.
3. Ask your agent to find, update or add progress to a task. Its latest log note is the summary.

---

## Details

Tasks are **NIP-AR artifacts**,
not process-local todos or a new SQL table. The page reads the plugin's durable
IndexedDB artifact collection; the host synchronizes that collection with the
relay. Where incremental sync is unavailable, the table makes a bounded current
relay read instead. A task inherits read/write access from its home channel or
Solo chat.

## Record

- Artifact: kind `45010`, type `buzz.task`, content version `4`.
- Content: `title`, `why`, `done_when`, `state`, `links`, `log`.
- States: `open`, `waiting`, `done`, `dropped`.
- Links have `kind` (`pr`, `issue`, `thread`, `doc`, `session`, `other`), a URL
  (`https:` or `buzz:`), and an optional label. Unknown keys survive edits.
- Log entries have Unix `at`, nonempty `note`, and optional `state`. The log is
  append-only. The latest note is the task's summary line.
- `title` and `state` are duplicated in tags for relay queries. All Task v2
  fields are in content so the artifact stands on its own.
- The `d` UUID identifies the work wherever its author appears. `h` is its
  access-owning home. `prev` is the current revision id on an update.

Same-version unknown content keys and unowned tags survive edits. Readers skip
unknown content versions rather than destructively migrating them. Oversized
logs are linked to a follow-up task, never truncated.

## Semantics

Creation starts `open`; there is no proposal or approval queue. Set `waiting`
when the task already needs input, or `dropped` when it is unwanted. Agents check
for an active exact-title duplicate in the same home first. Every update has a
dated note; closing evidence belongs in that note and supporting URLs in
`links`. Agents may mark `done`/`dropped` from observed evidence, not from a
watchdog or CI inference. This plugin deliberately has no assignee, mandate,
priority, project-group, or automatic status system.

After a conflict, the UI keeps the draft and rebases onto the current record;
only fields the person changed from the revision they opened are reapplied, so
other field edits and log notes survive. Agent updates likewise re-read and
reapply intent up to three times. Creates choose their UUID before publication
so an uncertain result can be checked without making a duplicate task.

## Agent tools

- `tasks_find`: active tasks by default, or one full record by id.
- `tasks_create`: title, why and done condition; optional links/first note/home.
- `tasks_update`: field update plus required note; links replace the list.
- `tasks_note`: append a progress/evidence note and optional links.

Agent reads use the agent's own relay connection. Saves use the session's narrow
artifact writer only when the owner's current channel entry is writable, the
home is an unarchived channel or Solo chat, and the agent's signed roster entry
has a non-guest member role. The relay still enforces current write access.

## Limits

A finite agent list reads at most 500 matching relay rows and explicitly says
when it may be incomplete; its output is capped at 50. Task content is checked
against 120 KB, below the shared artifact limit. There is no background refresh
timer: the host's artifact sync and collection notifications keep the table
current; the current-read fallback runs when the table opens or refreshes.
