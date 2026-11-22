# Vim keys

Move around Buzz and act on what you select with Vim-style keys. Keys never
fire while you type in a field or a terminal.

## Getting started

1. Turn on **Vim keys** in **Settings → Plugins**.
2. Each conversation always has one selected message, starting with the
   newest. Press `j` and `k` to move it, or click a message. The view follows
   the selection.
3. Press `go` to open the selected item's actions. Each action shows its key;
   press it to run the action.
4. Press Space to see the leader keys, such as `Space /` to search where you
   are and `Space Space` to switch conversation.
5. Press `i` to type a message and Escape to stop typing.

---

## Keys

| Keys | Action |
| --- | --- |
| `j` / `k` | Next / previous message, sidebar conversation or item |
| `h` / `l` | Left / right in lists; `l` on a message opens its thread |
| `gg` / `G` | Oldest loaded / newest message; first / last sidebar conversation or menu item |
| `Ctrl-d` / `Ctrl-u` | The message or sidebar conversation half a page down / up, centred |
| `go` | Actions for the selected message, person or conversation |
| `Tab` / `Shift-Tab` | Switch between the selected message and its parts: its author, links, files and reactions |
| `]b` / `[b` | Next / previous conversation |
| `]u` / `[u` | Next / previous unread conversation |
| `H` / `L` | Back / forward |
| `\` | Show the open conversation in the sidebar |
| `i` | Type a message |
| `Escape` (`Ctrl-[` on Mac) | Back to the selected message, from the message box, the sidebar or a part; on the message, mark the conversation read |
| `Ctrl-h` / `Ctrl-l` | Pane to the left / right |
| `Ctrl-j` / `Ctrl-k` | Message box / messages |
| `Space /` | Search where you are: the sidebar's conversations, or this conversation |
| `Space Space` | Switch conversation |
| `Space s /` | Search Buzz |
| `Space s c` | Search this conversation |
| `Space s k` | Keyboard shortcuts |
| `Space ,` | Settings |
| `Space h` | Home |

On Windows and Linux, `Alt` replaces `Ctrl` for the pane keys, since Buzz uses
`Ctrl` with `h`, `j`, `k` and `l`, and `Ctrl-d` / `Ctrl-u` stay as they are.

The first key of each sequence (`g`, `]`, `[`, Space) and every single key is
listed in **Settings → Shortcuts**, where you can change it. After a short
pause in a sequence, a menu shows the keys that can follow; Escape cancels.
While Vim keys is on, every menu shows a key beside each item. `j`, `k`, `h`
and `l` keep moving in menus, and `gg` / `G` reach their ends.

Space on a focused button starts the leader instead of pressing it; press
Enter to press the button. Checkboxes, switches and options keep Space. When
another shortcut uses the same key, Settings → Shortcuts marks it "Also
used by"; change one to choose. Escape in a field always returns to the
selected message first, after the field's own use of Escape, such as closing
a suggestion list. `j`, `k`, `h`, `l` and `g` are never a menu item's key.

The selected message keeps focus except while you type after `i`, or while
you use the sidebar, a menu or a dialog; it stays marked meanwhile.
Opening a conversation focuses its selected message, not the message box,
and each conversation remembers its selection. Scrolling with a mouse or
trackpad moves the view but not the selection; the next move brings the view
back. If the selected message is deleted, the next one is selected. The
plugin marks the selected message with `data-message-cursor`, which Buzz
paints like a selected message.

Tab and Shift-Tab switch between the selected message and its parts,
wrapping back to the message. They never move into a part's card or menu:
use `go` for a part's actions and Escape to return to the message. Tab and
Escape on a message are not listed in Settings → Shortcuts.

Buzz's own message keys still act on the selected message: `e` edits, `r`
reacts, `t` replies in thread, `u` marks unread and Delete deletes your own
message.
