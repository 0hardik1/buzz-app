# Home

Home is a bundled workspace destination using the active community session.

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
