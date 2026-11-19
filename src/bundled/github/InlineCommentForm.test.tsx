// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { InlineCommentForm } from "./InlineCommentForm";

it("focuses its labelled field and delegates Escape dismissal", () => {
  const onCancel = vi.fn();
  const onChange = vi.fn();
  render(
    <InlineCommentForm
      body="Unsent comment"
      busy={false}
      blocked={false}
      onChange={onChange}
      onSubmit={vi.fn()}
      onCancel={onCancel}
    />,
  );
  const field = screen.getByRole("textbox", { name: "Comment" });
  expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
});

it.each(["busy", "blocked"] as const)(
  "blocks form submission while %s",
  (state) => {
    const onSubmit = vi.fn();
    const { container } = render(
      <InlineCommentForm
        body="Keep me"
        busy={state === "busy"}
        blocked={state === "blocked"}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
  },
);
