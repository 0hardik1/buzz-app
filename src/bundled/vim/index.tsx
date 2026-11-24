import { createRoot } from "react-dom/client";
import {
  CONVERSATION_SEARCH_ID,
  SEARCH_ID,
} from "../../app/shell/search-shortcuts";
import { isApplePlatform } from "../../features/shortcuts/format";
import type {
  BundledShortcuts,
  KeyBinding,
  Shortcut,
} from "../../features/shortcuts/service";
import type { PluginModule } from "../../plugins/api";
import {
  focusTarget,
  messageListOf,
} from "../../features/messages/message-selection";
import { enableMenuLetters } from "../../shared/design-system/ui/menu-letters";
import { stepConversation } from "../channels/conversation-rows";
import {
  bottom,
  focusComposer,
  focusMessages,
  focusPane,
  halfPage,
  inSidebar,
  leave,
  openActions,
  press,
  revealConversation,
  sideways,
  step,
  top,
  focused,
  typing,
  POPUP_LIST,
  SIDEBAR,
  editField,
  selectedField,
  selectField,
  TEXT_FIELD,
  stepPart,
  threadSummary,
} from "./motion";
import { claim, newestRow, trackCursor } from "./cursor";
import { createPending, SHOW_AFTER_MS, WHICH_KEY } from "./pending";
import { LEADER, type Sequence, type SequenceGroup } from "./sequences";
import { WhichKey } from "./WhichKey";

export const inject = ["shortcuts", "navigation"];

/** Space selects these itself, so it stays theirs instead of the leader's. */
const SPACE_SELECTS =
  'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="switch"], [role="radio"], [role="option"], [role="menuitemcheckbox"], [role="menuitemradio"]';

export const apply: PluginModule["apply"] = (ctx) => {
  // A bundled plugin may run host shortcuts by id (BundledShortcuts).
  const shortcuts = ctx.shortcuts as BundledShortcuts;
  const navigation = ctx.navigation;
  const apple = isApplePlatform(globalThis.navigator?.platform ?? "");

  /** A polite live region, one per activation so a quick re-enable keeps it. */
  let status: HTMLElement | undefined;
  const announce = (text: string) => {
    const live = status;
    if (!live) return;
    live.textContent = "";
    requestAnimationFrame(() => {
      live.textContent = text;
    });
  };

  /** Escape on a message still marks the conversation read, as without Vim keys. */
  const markRead = () => {
    const entry = shortcuts
      .snapshot()
      .find(
        (shortcut) =>
          shortcut.pluginId === "buzz.channels" && shortcut.id === "mark-read",
      );
    if (entry && (!entry.when || entry.when())) void entry.run();
  };
  const searchHere = () => {
    if (inSidebar() || !shortcuts.runHost(CONVERSATION_SEARCH_ID))
      shortcuts.runHost(SEARCH_ID);
  };

  const sequences: readonly Sequence[] = [
    { keys: "gg", title: "Top", run: top },
    {
      keys: "go",
      title: "Actions for the focused item",
      run: () => {
        if (!openActions())
          announce("No actions here. Move to a message or conversation first.");
      },
    },
    {
      keys: "]b",
      title: "Next conversation",
      run: () => stepConversation("next", false),
    },
    {
      keys: "[b",
      title: "Previous conversation",
      run: () => stepConversation("previous", false),
    },
    {
      keys: "]u",
      title: "Next unread conversation",
      run: () => stepConversation("next", true),
    },
    {
      keys: "[u",
      title: "Previous unread conversation",
      run: () => stepConversation("previous", true),
    },
    { keys: `${LEADER}/`, title: "Search where you are", run: searchHere },
    {
      keys: `${LEADER}${LEADER}`,
      title: "Switch conversation",
      run: () => shortcuts.runHost(SEARCH_ID),
    },
    {
      keys: `${LEADER},`,
      title: "Settings",
      run: () => void navigation.open({ version: 1, kind: "settings" }),
    },
    {
      keys: `${LEADER}h`,
      title: "Home",
      run: () => void navigation.open({ version: 1, kind: "home" }),
    },
  ];
  const groups: readonly SequenceGroup[] = [
    { keys: LEADER, title: "Leader" },
    { keys: "g", title: "Go" },
    { keys: "]", title: "Next" },
    { keys: "[", title: "Previous" },
  ];
  // Neovim's which-key shows the leader at once (delay 0); others after a pause.
  const pending = createPending(
    () => sequences,
    (typed) => (typed.startsWith(LEADER) ? 0 : SHOW_AFTER_MS),
  );

  const menuMoves: Record<string, () => void> = {
    j: () => step(true),
    k: () => step(false),
    h: () => sideways(false),
    l: () => sideways(true),
    g: () => pending.start("g"),
    G: bottom,
  };

  ctx.effect(() => {
    // g is kept for gg and G, which reach a menu's first and last item.
    const release = enableMenuLetters("hjklg");
    const stopCursor = trackCursor();
    // A selected field takes Vim's keys instead of typing them. The shortcut
    // service skips fields, so their moves run here; i or Enter edits it.
    const fieldKeys = (event: KeyboardEvent) => {
      const field = selectedField();
      if (
        !field ||
        event.defaultPrevented ||
        event.isComposing ||
        pending.snapshot()
      )
        return;
      const text = field.matches(TEXT_FIELD);
      const only = (ctrl: boolean, alt: boolean) =>
        event.ctrlKey === ctrl && event.altKey === alt && !event.metaKey;
      const plain = only(false, false);
      const run = plain
        ? {
            j: () => step(true),
            k: () => step(false),
            h: () => sideways(false),
            l: () => sideways(true),
            g: () => pending.start("g"),
            G: bottom,
            ...(text && {
              i: editField,
              Enter: editField,
              " ": () => pending.start(LEADER),
            }),
          }[event.key]
        : // The pane and half-page keys, as registered below.
          (only(apple, !apple) &&
            {
              h: () => focusPane(false),
              l: () => focusPane(true),
              j: focusComposer,
              k: focusMessages,
            }[event.key]) ||
          (only(true, false) &&
            { d: () => halfPage(true), u: () => halfPage(false) }[event.key]) ||
          undefined;
      // Nothing else types into a selected text field.
      if (!run && !(text && plain && event.key.length === 1)) return;
      event.preventDefault();
      event.stopPropagation();
      run?.();
    };
    addEventListener("keydown", fieldKeys, true);
    // Tab and Escape on a message beat its parts' own handlers, such as a
    // preview card's Tab into the card and the list's Escape to the composer.
    const messageKeys = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const origin = focused();
      // A just-opened menu owns its keys before focus reaches it, so an
      // item's key typed at once (go, then r) runs that item.
      const opening = [
        ...document.querySelectorAll<HTMLElement>('[role="menu"][data-open]'),
      ].find((menu) => !menu.closest(`[${WHICH_KEY}]`));
      if (
        opening &&
        event.key.length === 1 &&
        !pending.snapshot() &&
        !typing() &&
        !opening.contains(origin ?? null)
      ) {
        opening.focus();
        const move = menuMoves[event.key];
        if (move) move();
        else press(opening, event.key);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // A menu's typeahead stops keys it does not use, so they start here.
      const menuMove = menuMoves[event.key];
      if (
        menuMove &&
        !pending.snapshot() &&
        !typing() &&
        origin?.closest(POPUP_LIST) &&
        !origin.closest(`[${WHICH_KEY}]`)
      ) {
        menuMove();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Escape in a field of a dialog, popover or the sidebar selects it
      // rather than leaving, as Vim's Escape ends insert mode, unless the
      // field's own list or completions has Escape.
      if (
        event.key === "Escape" &&
        !event.shiftKey &&
        !event.isComposing &&
        origin &&
        typing() &&
        origin.closest(`[aria-modal="true"], [role="dialog"], ${SIDEBAR}`) &&
        !origin.closest(
          '[data-composer-surface], [role="combobox"], [aria-expanded="true"], .xterm',
        )
      ) {
        selectField(origin);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Escape leaves a side panel's composer, whose tab closes on Escape,
      // unless a suggestion list or an edit has it; and leaves the sidebar
      // before marking the conversation read takes it.
      const leaves =
        event.key === "Escape" &&
        !event.shiftKey &&
        !event.isComposing &&
        (origin?.matches("[data-tab-focus]")
          ? !!origin.closest(
              "[data-panel-workspace] [data-composer-surface]",
            ) &&
            !origin.hasAttribute("aria-controls") &&
            !origin.closest("[data-editing]")
          : !!origin?.closest(SIDEBAR) && !typing() && !inMenu());
      if (leaves) {
        leave();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const row = origin?.closest<HTMLElement>("[data-message-id]");
      if (!origin || !row || typing() || !messageListOf(row)) return;
      if (event.key === "Tab") stepPart(!event.shiftKey);
      // A menu the message opened owns Escape, even before it takes focus.
      else if (
        event.key === "Escape" &&
        !inMenu() &&
        !origin.hasAttribute("data-menu-origin")
      ) {
        if (origin === focusTarget(row)) markRead();
        else leave();
      } else return;
      event.preventDefault();
      event.stopPropagation();
    };
    addEventListener("keydown", messageKeys, true);
    // Escape in a field leaves it for the selected message before any
    // shortcut on Escape, such as marking the conversation read, takes it;
    // the field's own Escape (closing a suggestion list) still comes first.
    const fieldEscape = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.key !== "Escape" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !typing() ||
        focused()?.closest('.xterm, [aria-modal="true"], dialog[open]')
      )
        return;
      event.preventDefault();
      leave();
    };
    document.addEventListener("keydown", fieldEscape);
    const host = document.createElement("div");
    const live = document.createElement("p");
    live.setAttribute("role", "status");
    live.className = "sr-only";
    status = live;
    document.body.append(host, live);
    const root = createRoot(host);
    root.render(
      <WhichKey
        pending={pending}
        sequences={() => sequences}
        groups={groups}
      />,
    );
    // Its own root: no host surface hosts a plugin's global menu. It renders
    // only the shared Menu, which needs no host provider.
    return () => {
      // Disabling can happen during a render; finish once it is done.
      queueMicrotask(() => {
        pending.cancel();
        release();
        stopCursor();
        removeEventListener("keydown", messageKeys, true);
        removeEventListener("keydown", fieldKeys, true);
        editField();
        document.removeEventListener("keydown", fieldEscape);
        root.unmount();
        host.remove();
        live.remove();
        if (status === live) status = undefined;
      });
    };
  });

  /** In an open menu, its own keys win; only j/k/h/l move there. */
  // Focus moves into a just-opened menu a frame later, so check the popup too.
  const inMenu = () =>
    !!document.activeElement?.closest('[role="menu"]') ||
    !!document.querySelector('[role="menu"][data-open]');
  let order = 0;
  const key = (
    id: string,
    title: string,
    binding: KeyBinding | readonly KeyBinding[],
    run: Shortcut["run"],
    { when, ...options }: Partial<Shortcut> = {},
    menus = false,
  ) =>
    ctx.shortcuts.register({
      id,
      title,
      binding,
      run,
      order: order++,
      ...options,
      when: () => (menus || !inMenu()) && (!when || when()),
    });
  // Movement also works in dialogs such as Settings; it never fires in a field.
  const moving = { allowInModal: true, repeat: true };
  // Control is Buzz's Mod key off macOS, where Mod+L and Mod+K are taken.
  const control = (letter: string): KeyBinding =>
    apple ? { key: letter, ctrl: true } : { key: letter, alt: true };

  key("down", "Move down", { key: "j" }, () => step(true), moving, true);
  key("up", "Move up", { key: "k" }, () => step(false), moving, true);
  key("left", "Move left", { key: "h" }, () => sideways(false), moving, true);
  key("right", "Move right", { key: "l" }, () => sideways(true), moving, true);
  key("bottom", "Go to bottom", { key: "g", shift: true }, bottom, {
    allowInModal: true,
  });
  key(
    "half-page-down",
    "Scroll half a page down",
    apple ? { key: "d", ctrl: true } : { key: "d", mod: true },
    () => halfPage(true),
    moving,
  );
  key(
    "half-page-up",
    "Scroll half a page up",
    apple ? { key: "u", ctrl: true } : { key: "u", mod: true },
    () => halfPage(false),
    moving,
  );
  // In a dialog, its panes: Settings' section list, section and details.
  key(
    "pane-left",
    "Focus the pane to the left",
    control("h"),
    () => focusPane(false),
    { allowInModal: true },
  );
  key(
    "pane-right",
    "Focus the pane to the right",
    control("l"),
    () => focusPane(true),
    { allowInModal: true },
  );
  key("pane-composer", "Focus the message box", control("j"), focusComposer);
  key("pane-messages", "Focus the messages", control("k"), focusMessages);
  key("insert", "Type a message", { key: "i" }, focusComposer);
  key(
    "open-thread",
    "Open the selected message's thread",
    { key: "Enter" },
    () => {
      threadSummary()?.click();
      // The thread's newest message, not its message box, takes focus, also
      // as its replies load.
      claim(() => newestRow(document.querySelector("[data-panel-workspace]")));
    },
    { when: () => !!threadSummary() },
  );
  key(
    "leave",
    "Leave the field or control",
    apple ? [{ key: "Escape" }, { key: "[", ctrl: true }] : { key: "Escape" },
    leave,
    {
      allowInEditable: true,
      // Escape in a terminal belongs to its shell.
      when: () =>
        !!document.activeElement &&
        document.activeElement !== document.body &&
        !document.activeElement.closest(".xterm"),
    },
  );
  key("back", "Go back", { key: "h", shift: true }, () => navigation.back(), {
    allowInVisit: true,
  });
  key(
    "forward",
    "Go forward",
    { key: "l", shift: true },
    () => navigation.forward(),
    {
      allowInVisit: true,
    },
  );
  key("reveal", "Show this conversation in the sidebar", { key: "\\" }, () => {
    if (!revealConversation()) announce("The sidebar is hidden.");
  });
  key(
    "go",
    "Go: top (gg) or actions (go)",
    { key: "g" },
    () => pending.start("g"),
    { allowInModal: true },
  );
  key("next", "Next: conversation (]b) or unread (]u)", { key: "]" }, () =>
    pending.start("]"),
  );
  key(
    "previous",
    "Previous: conversation ([b) or unread ([u)",
    { key: "[" },
    () => pending.start("["),
  );
  key("leader", "Leader", { key: LEADER }, () => pending.start(LEADER), {
    when: () => !typing() && !document.activeElement?.matches(SPACE_SELECTS),
  });
};
