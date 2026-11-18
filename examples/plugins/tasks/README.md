# To-do

A first iteration of personal tasks and shared channel checklists for Buzz desktop.

## Try it

In Settings → Plugins → Manage plugins, choose Add → Browse and select this
folder. Review and install To-do. Use Browse rather than dragging the folder,
so changes can be reloaded during iteration.

Open **To-do** in navigation to add personal tasks and see tasks assigned to you,
grouped by channel. Open the checkmark in a channel header to add tasks to that
channel, assign a member, edit titles, complete tasks.
Completed tasks are hidden from this view. Assignment is an explicit member
selection; typing a name into an ordinary message does not create a task.

Type in **New task** to reveal date, time, and person controls. Press Enter or
leave the row to save. Click an existing title or its metadata to edit; click
outside the row to save and return to plain metadata. Saves run in the background.
Use each selected control's × button to clear it. Adding a time without a date
selects today; removing a date clears its time. Dates retain their calendar day,
and timed deadlines display in your local timezone. The time picker uses 24-hour
columns. Assignment search matches full names and usernames; use Up/Down and
Enter to select a person. Tasks stay newest-first within each group.

## Data and access

Channel tasks are shared with their channel. A single assignee can be selected
in this first UI. Personal tasks use a private, self-only system channel in the
selected community, created on the first addition. It stays out of the ordinary
channel list. Personal lists are discovered by signed creator/label metadata
and checked for private visibility and a self-only roster before use.

Tasks are NIP-AR kind 45010 artifacts with type `com.squareup.task-list.task`.
The version-1 body contains `title`, `done`, and `assignees`, with optional
`createdAt` (creation milliseconds), `dueDate` (calendar date) or `dueAt` (UTC timestamp); revisions carry `prev`
and assignment `p` tags. A stale edit is rejected instead of overwriting changes.
The plugin does not migrate records from earlier Tasks plugins.

Shared writes use the host's signing/publication capability. Each complete task
is saved in a local queue before the composer clears, including its destination,
deadline and assignee. The queue and exact signed attempt share one durable
record, so queued tasks survive reload. A failure never overwrites the next draft.
Proven-unsent tasks remain available to retry or explicitly discard; discarding
one lets the remaining queue continue. Unconfirmed delivery blocks further writes. **Check save** reads its outcome. **Retry saved task** validates current access and retries the queued task. For
an unconfirmed signed attempt it resends only that exact event, never a new task
ID; a proven-unsent draft is signed when retried. This recovery record is isolated by the host's account/community
scope and survives reload. No external service or host command grants are needed.

## First-version limits

This is a desktop plugin, not a mobile screen. Lists cover the selected community.
Tasks from all dates appear together, newest first. Personal and channel section
headings expand and collapse their lists.
Each current-head query is bounded to 500 records and displays a partial-results
notice at that limit. Return to the app to discover tasks
outside the current live channel coverage. Incoming task events on the host's
live routes refresh the list. Channel follows track access revocation; revoked
channel data is hidden. The plugin does not poll. Personal-home lookup, the
assigned-task query, and open channel queries fail independently, so a personal
lookup failure does not prevent a channel checklist from loading. Each query is
bounded; channel metadata is resolved in a batch.

No reminders, deletion, task threads or agent tools are included.

Recognized refusals on the first publication keep the unsigned task recoverable
without retaining a rejected signed attempt. A conflict refreshes current task
state; discard the unsent edit to work from that state. Unknown delivery retains
the exact signed event, including when a later replay is refused.

Only one Buzz window may edit To-do for an account/community at a time. Other
windows remain readable; close the owning Buzz window to hand over the save
journal. Web Locks are required so windows cannot overwrite one another's queued
work. Restored private drafts stay hidden until fresh access is verified.

## Host requirements and packaging

This version needs a Buzz desktop host exposing the plugin `ui` capability
(Calendar and Popover components). Install that host support before this plugin.
The folder is directly installable. To create a single-file artifact from the
repository root:

```sh
buzzodz plugin pack examples/plugins/tasks /tmp/to-do.plugin.json
```

The command prints the artifact SHA-256. The package includes the manifest,
module, README, and icon. It is unsigned; publication/signing is a separate step.

## Validation

Model coverage lives in `scripts/tasks-plugin.test.mjs`. The browser fixture at
`/tests/fixtures/tasks-plugin.html` uses sample data without connecting to a relay.
Browser checks cover editing, pickers, assignment, background saves, and ordering;
they do not establish production relay delivery or cross-device behavior.
