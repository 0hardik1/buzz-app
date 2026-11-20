// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { Field } from "./Field";
import { Radio, RadioGroup } from "./RadioGroup";

afterEach(cleanup);

it("keeps text-only tiles keyboard-selectable, labelled and form-associated", async () => {
  const user = userEvent.setup();
  render(
    <form aria-label="Choices">
      <Field label="Delivery" nativeLabel={false}>
        <RadioGroup name="delivery" defaultValue="all">
          <Radio value="all" label="All updates" variant="tile" />
          <Radio value="mentions" label="Mentions only" variant="tile" />
          <Radio value="none" label="Unavailable" variant="tile" disabled />
        </RadioGroup>
      </Field>
    </form>,
  );
  await user.tab();
  expect(screen.getByRole("radio", { name: "All updates" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("radio", { name: "Mentions only" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Mentions only" })).toHaveFocus();
  expect(
    new FormData(screen.getByRole("form") as HTMLFormElement).get("delivery"),
  ).toBe("mentions");
  await user.click(screen.getByText("All updates"));
  expect(screen.getByRole("radio", { name: "All updates" })).toBeChecked();
  await user.click(screen.getByText("Unavailable"));
  expect(screen.getByRole("radio", { name: "All updates" })).toBeChecked();
});

it("wraps chip choices that select with arrows and show no indicator", async () => {
  const user = userEvent.setup();
  render(
    <Field label="Show" nativeLabel={false}>
      <RadioGroup layout="wrap" defaultValue="all" aria-label="Show">
        <Radio value="all" label="All" variant="chip" />
        <Radio value="unreads" label="Unreads" variant="chip" />
        <Radio value="today" label="Today" variant="chip" />
      </RadioGroup>
    </Field>,
  );
  const group = screen.getByRole("radiogroup", { name: "Show" });
  expect(group).toHaveAttribute("data-layout", "wrap");
  expect(group.querySelector(".buzz-radio-indicator")).toBeNull();
  await user.tab();
  expect(screen.getByRole("radio", { name: "All" })).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "Unreads" })).toBeChecked();
  await user.click(screen.getByText("Today"));
  expect(screen.getByRole("radio", { name: "Today" })).toBeChecked();
});
