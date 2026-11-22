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

## Moving

The same keys move the focus everywhere: messages, the sidebar, menus,
Settings and other dialogs. The focus ring shows what is selected, and the
view follows it.

| Keys | Action |
| --- | --- |
| `j` / `k` | Down / up: the next message, row, menu item or control |
| `h` / `l` | Left / right: in lists and tabs, or to the next control on the same line |
| `gg` / `G` | The first / last item; the oldest loaded / newest message |
| `Ctrl-d` / `Ctrl-u` | Half a page down / up, centred |
| `Ctrl-h` / `Ctrl-l` | Pane to the left / right |
| `Ctrl-j` / `Ctrl-k` | Message box / messages |
| `H` / `L` | Back / forward |

Where a list, menu or tab bar has arrow keys of its own, `j` and `k` are those
arrows. Elsewhere, such as the sidebar and Settings, `j` and `k` go to the
first control on the next line, so they skip a heading's buttons; `h` and `l`
reach them. `j` and `k` pass over text fields, so they never start typing:
use Tab or a click to reach a field. They also pass over choice menus and
radio buttons without opening or changing them; `h` and `l` change a radio
button, as the arrow keys do. When the next control is more than a line out
of view, `j` and `k` scroll a line instead, so text between controls stays
readable.

## Messages

| Keys | Action |
| --- | --- |
| `Enter` | Open the selected message's thread, if it has one |
| `l` | Reply in a thread |
| `go` | The selected message's actions |
| `Tab` / `Shift-Tab` | Switch between the message and its author, links, files and reactions |
| `i` | Type a message |
| `Escape` (`Ctrl-[` on Mac) | Back to the selected message; on the message, mark the conversation read |

The selected message keeps focus except while you type after `i`, or while
you use the sidebar, a menu or a dialog; it stays marked meanwhile. Opening a
conversation focuses its selected message, not the message box, and each
conversation remembers its selection. Scrolling with a mouse or trackpad moves
the view but not the selection; the next move brings the view back. If the
selected message is deleted, the next one is selected.

Tab and Shift-Tab never move into a part's card or menu: use `go` for a part's
actions and Escape to return to the message.

Buzz's own message keys still act on the selected message: `e` edits, `r`
reacts, `t` replies in thread, `u` marks unread and Delete deletes your own
message.

## Conversations and the sidebar

| Keys | Action |
| --- | --- |
| `]b` / `[b` | Next / previous conversation |
| `]u` / `[u` | Next / previous unread conversation |
| `\` | Show the open conversation in the sidebar |
| `go` | Actions for the focused conversation |

In the sidebar, `j` and `k` reach Activity, section headings and
conversations. Enter opens a conversation or collapses a section, and Escape
returns to the selected message.

## Menus

Every menu shows a key beside each item; press it to run the item. `j`, `k`,
`h`, `l` and `g` are never an item's key: `j` and `k` move, `h` and `l` close
or open a submenu, and `gg` / `G` reach the first and last item. Escape closes
the menu.

## Leader keys

| Keys | Action |
| --- | --- |
| `Space /` | Search where you are: the sidebar's conversations, or this conversation |
| `Space Space` | Switch conversation |
| `Space ,` | Settings |
| `Space h` | Home |

After a short pause in a sequence, a menu shows the keys that can follow;
Escape cancels. Space on a focused button starts the leader instead of
pressing it; press Enter to press the button. Checkboxes, switches and options
keep Space.

## Changing keys

On Windows and Linux, `Alt` replaces `Ctrl` for the pane keys, since Buzz uses
`Ctrl` with `h`, `j`, `k` and `l`, and `Ctrl-d` / `Ctrl-u` stay as they are.

The first key of each sequence (`g`, `]`, `[`, Space) and every single key is
listed in **Settings → Shortcuts**, where you can change it. When another
shortcut uses the same key, Settings → Shortcuts marks it "Also used by";
change one to choose. Tab and Escape on a message are not listed there.

Escape in a field always returns to the selected message first, after the
field's own use of Escape, such as closing a suggestion list. An open tooltip
takes the first Escape.

The plugin marks the selected message with `data-message-cursor`, which Buzz
paints like a selected message.
