import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { ConversationPresentation } from "../../src/features/conversation/ConversationPresentation";
import { MessageActionBar } from "../../src/features/messages/MessageActionBar";
import { IconButton } from "../../src/shared/design-system/ui/IconButton";
import { MenuItem } from "../../src/shared/design-system/ui/Menu";
import { DotsThreeIcon } from "../../src/shared/design-system/icons";
import "../../src/shared/styles/globals.css";

document.documentElement.dataset.colorMode = "light";
document.documentElement.style.setProperty("--buzz-text-scale", "1");

const mode = new URLSearchParams(location.search).get("mode");
const context = mode === "context";
const refreshEvent = "action-menu-content-refresh";
const precedingMessages = Array.from({ length: 15 }, (_, index) =>
  index < 3
    ? `A channel message remains visible while the page text scales with the open action menu (${index + 1}).`
    : `Message text above the action menu ${index + 1}`,
);

function Fixture() {
  const rowRef = useRef<HTMLDivElement>(null);
  const [refreshed, setRefreshed] = useState(false);

  useEffect(() => {
    if (mode !== "refreshed") return;
    const refresh = () => setRefreshed(true);
    window.addEventListener(refreshEvent, refresh);
    return () => window.removeEventListener(refreshEvent, refresh);
  }, []);

  const actions = Array.from(
    { length: refreshed ? 9 : 7 },
    (_, index) =>
      `${refreshed ? "Updated" : "Extra"} message action ${index + 1}`,
  ).map((label) => <MenuItem key={label}>{label}</MenuItem>);
  const menuProps = {
    copyText: () =>
      refreshed ? "Refreshed synthetic message" : "Synthetic message",
    link: "https://example.org/messages/one",
    onForward: () => {},
    onReply: () => {},
    onSendToChannel: () => {},
    leadingItems: actions,
  };

  return (
    <ConversationPresentation.Provider value>
      <main style={{ minHeight: "180vh" }}>
        <div
          className="text-body-md"
          data-message-scroller=""
          style={{ height: 768, overflowY: "auto", width: "100%" }}
        >
          <div className="text-body-md" style={{ width: 700 }}>
            {precedingMessages.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
          {context ? (
            <MessageActionBar withToolbar {...menuProps}>
              <div data-message-id="synthetic-message">
                <p className="text-body-md" data-message-action-anchor="">
                  Synthetic message content
                </p>
                <IconButton
                  aria-label="Message action target"
                  data-action-trigger=""
                  icon={<DotsThreeIcon />}
                  size="sm"
                />
              </div>
            </MessageActionBar>
          ) : (
            <div
              ref={rowRef}
              className="text-body-md"
              data-message-id="synthetic-message"
            >
              <p data-message-action-anchor="">Synthetic message content</p>
              <MessageActionBar rowRef={rowRef} {...menuProps} />
            </div>
          )}
          <div aria-hidden="true" style={{ height: 1200 }} />
        </div>
      </main>
    </ConversationPresentation.Provider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Action menu fixture root unavailable");
createRoot(root).render(<Fixture />);
