// Self-contained v1 demo: host React and page registration only.
export const inject = ["react", "pages"];
export function apply(ctx) {
  const h = ctx.react.createElement;
  const body = (title, description) => () =>
    h(
      "section",
      { style: { padding: "var(--space-panel-inset)" } },
      h("h1", null, title),
      h("p", null, description),
    );
  ctx.pages.register({
    id: "replacement",
    title: "Sidebar host demo",
    primary: true,
    component: body(
      "Sidebar host demo",
      "Use the Messages dock button to return to your saved view.",
    ),
    sidebar: function Replacement({ children }) {
      const [count, setCount] = ctx.react.useState(0);
      return h(
        "div",
        { className: "shell-sidebar-default" },
        h(
          "aside",
          {
            "aria-label": "Demo replacement sidebar",
            className:
              "flex h-full min-h-0 flex-1 flex-col gap-3 bg-surface-panel p-3 text-standard",
          },
          h("h2", null, "Replacement navigation"),
          h("p", null, "This page replaces the Messages sidebar."),
          h(
            "button",
            { type: "button", onClick: () => setCount(count + 1) },
            `Demo clicks: ${count}`,
          ),
          children,
        ),
      );
    },
  });
  ctx.pages.register({
    id: "standalone",
    title: "Sidebar demo standalone",
    primary: true,
    placement: "dock",
    component: body(
      "Sidebar demo standalone",
      "This page has no sidebar. Return to Messages using its dock button.",
    ),
  });
}
