# Home

Home is a bundled workspace destination using the active community session. It is an inbox that Jev keeps, ported from the Jev Inbox plugin (`inbox.mjs`, one plain module with injected styles).

- Jev judges every incoming conversation with one yes/no question, "should this be shown", against the reader's own description of what they need to see. The ones that reach the threshold land as cards in a centered column, newest on top. A card arriving while you read animates in; when the column is scrolled, a "new" pill counts what arrived above.
- A card appears only when it is complete: after Jev has judged it and, for a thread or channel Jev finds long enough, after its one-line summary is in. A summary that takes longer than 45 seconds is given up on and the card shows without it.
- Summaries are written by the saved Bestie: Home wakes it with up to six conversations as data, and it answers with the `home_inbox_summarize` tool. Without a Bestie, cards show the latest messages only.
- Click a card to read and reply in place; it is marked read and leaves the inbox. Chat opens a note to Bestie about that item, which Bestie can use to adjust the prompt (`home_inbox_get_prompt`, `home_inbox_update_prompt`).
- The prompt, threshold and the last few notes save in this installation's local storage. Reload replays the last hours of messages through Jev.

Jev and the summaries have not been run in a browser test: both need the hosted decision service and a live agent.

## Earlier canvas

The canvas Home (`HomeCanvas.tsx` and the files beside it, `src/features/home`, and the `home-canvas` browser fixture) is still in the tree and tested, but no page renders it. What follows describes it.

- Attention uses the existing verified inbox feed: mentions, DMs, and thread replies.
- Open/reply shows the shared thread or conversation reader on Home. The shared navigation controller owns Back, Forward, and dismissal. Previewing does not mark the entire channel read.
- Ask Bestie stages a source-message card in the saved Bestie's existing DM draft. Existing draft text is preserved; the user reviews and sends it with the ordinary composer/outbox.
- The floating NewMessage component uses real recipient search, channel selection, drafts, attachments, and delivery. Readers expand from its ordinary MessageComposer through the same DetailsSheet as channels. Ask Bestie opens just source context and a new message, with no history.
- Canvas positions, notes, and conversation pins save with the existing account/community view state. Files save as device-local IndexedDB blobs and never upload automatically. Images retain their aspect ratio and display without a title or action chrome; Save a copy and Remove are in the right-click menu. Removing a file card deletes its local blob. The per-file limit is 100 MiB.
- Clock uses local time. Calendar is the shared month calendar, without invented appointments or an external calendar integration.
- Drag blank space or scroll to pan; pinch/Control-scroll and zoom controls adjust scale. Recenter returns to the attention feed. Drag a card's header or use its arrow keys to arrange it. Images drag directly; right-click headers and images (or press Shift+F10) for actions. Drag tilt follows horizontal velocity and is disabled with reduced motion.

Canvas files are local to this installation. They do not sync to another device.
Native Finder file-drop behavior must be checked in the desktop app; the file picker is also available.

## Personalizing Home

The image action in the Home header chooses a device-local background (JPEG, PNG, WebP, AVIF, or GIF, up to 20 MiB); the same menu can remove it. Background bytes use the canvas file owner and are included in exact-community device cleanup.

For you is a regular canvas card: it moves and scales with the canvas, stays open while exploring, and uses the same draggable header and right-click actions as the other cards. Its saved position uses the canvas object store. Add to canvas can restore it after removal; existing arrangements gain the card without moving their other objects.

Add to canvas includes a 25-minute focus timer, a checklist (up to 12 items), and an Elsewhere clock with selectable cities. Timer deadlines and paused time, checklist state, and the selected time zone save with the existing canvas objects. The focus timer has no notification or sound integration.
