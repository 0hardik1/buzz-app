import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";

export function NavigationSection({
  label,
  action,
  children,
}: {
  label?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-buzz-ui=""
      className="navigation-section"
      data-headingless={!label || undefined}
    >
      {(label || action) && (
        <NavigationSectionHeading actions={action}>
          {label && <h2 className="navigation-section-label">{label}</h2>}
        </NavigationSectionHeading>
      )}
      <div className="navigation-section-rows">{children}</div>
    </section>
  );
}

/**
 * One heading row: the label fills the available width and the actions hug the
 * trailing edge, so neither overlays nor reserves space for the other.
 *
 * `disclosure` headings collapse their section. Their label is the feature's
 * own disclosure trigger, which keeps the row's inset as its hit area and
 * focus ring. Quiet parts, `revealActions` or any descendant marked
 * `data-navigation-reveal` such as a chevron, appear on hover, keyboard focus,
 * while a menu or popover from the heading is open or one of them has focus, and always
 * on touch. Hidden
 * actions take no width, so the label uses that space until they appear. The
 * label keeps room for its title; actions that would cover it wrap below, and
 * keep that row while hidden, so revealing them never changes the height.
 */
export function NavigationSectionHeading({
  actions,
  disclosure = false,
  revealActions = false,
  children,
}: {
  actions?: ReactNode;
  disclosure?: boolean;
  revealActions?: boolean;
  children?: ReactNode;
}) {
  const heading = useRef<HTMLDivElement>(null);
  const actionsBox = useRef<HTMLDivElement>(null);
  useActionsRow(heading, actionsBox, revealActions && !!actions);
  return (
    <div
      ref={heading}
      className="navigation-section-heading"
      data-disclosure={disclosure || undefined}
    >
      <div className="navigation-section-heading-label">{children}</div>
      {actions && (
        <div
          ref={actionsBox}
          className="navigation-section-heading-actions"
          data-navigation-reveal={revealActions || undefined}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * Marks a heading whose revealed actions wrap below the label, so CSS keeps
 * their row while they are hidden. It asks layout itself: lay the actions out
 * as revealed, see whether they wrap, and restore it, all before paint.
 */
function useActionsRow(
  headingRef: RefObject<HTMLDivElement | null>,
  actionsRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const heading = headingRef.current;
    const actions = actionsRef.current;
    if (
      !enabled ||
      !heading ||
      !actions ||
      typeof ResizeObserver === "undefined"
    )
      return;
    const label = heading.firstElementChild as HTMLElement;
    const measure = () => {
      heading.setAttribute("data-actions-measure", "");
      const wraps =
        actions.getBoundingClientRect().top >=
        label.getBoundingClientRect().bottom - 0.5;
      heading.removeAttribute("data-actions-measure");
      heading.toggleAttribute("data-actions-row", wraps);
    };
    // Hidden buttons keep their size, so text scale reaches them too.
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      resize.observe(heading);
      for (const button of actions.children) resize.observe(button);
      measure();
    };
    const mutations = new MutationObserver(observe);
    mutations.observe(actions, { childList: true });
    observe();
    return () => {
      resize.disconnect();
      mutations.disconnect();
      heading.removeAttribute("data-actions-row");
    };
  }, [headingRef, actionsRef, enabled]);
}
