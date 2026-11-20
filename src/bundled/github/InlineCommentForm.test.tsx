// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InlineCommentForm } from "./InlineCommentForm";

afterEach(cleanup);

it("focuses its labelled field and delegates Escape dismissal", () => {
  const onCancel = vi.fn();
  render(
    <InlineCommentForm
      draft={{ body: "" }}
      busy={false}
      blocked={false}
      onSubmit={vi.fn()}
      onCancel={onCancel}
    />,
  );
  const field = screen.getByRole("textbox", { name: "Comment" });
  expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
});

it.each(["busy", "blocked"] as const)(
  "blocks form submission while %s",
  (state) => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const draft = { body: "" };
    const view = (blocked: boolean) => (
      <InlineCommentForm
        draft={draft}
        busy={blocked && state === "busy"}
        blocked={blocked && state === "blocked"}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
    const { container, rerender } = render(view(false));
    const field = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.change(field, { target: { value: "Keep me" } });
    rerender(view(true));
    expect(field).toHaveProperty("value", "Keep me");
    fireEvent.change(field, { target: { value: "Blocked edit" } });
    expect(field).toHaveProperty("value", "Keep me");
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(view(false));
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Keep me");
  },
);
