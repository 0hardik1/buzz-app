// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { alertChoices } from "./alert-preferences";
import { AlertSettings } from "./AlertSettings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("alerts for reviews requested from the person and their mentions by default, and saves each choice", async () => {
  const user = userEvent.setup();
  const view = render(<AlertSettings active={() => true} />);
  const checked = () =>
    screen
      .getAllByRole("switch")
      .map((toggle) => [
        toggle.getAttribute("aria-label"),
        toggle.getAttribute("aria-checked"),
      ]);
  expect(checked()).toEqual([
    ["Reviews requested from you", "true"],
    ["Reviews requested from your teams", "false"],
    ["Reviews requested because you're a code owner", "false"],
    ["Mentions of you", "true"],
    ["Mentions of your teams", "false"],
  ]);
  await user.click(
    screen.getByRole("switch", { name: "Reviews requested from your teams" }),
  );
  await user.click(screen.getByRole("switch", { name: "Mentions of you" }));
  expect(alertChoices()).toEqual({
    review: true,
    teamReview: true,
    codeOwnerReview: false,
    mention: false,
    teamMention: false,
  });
  view.unmount();
  render(<AlertSettings active={() => true} />);
  expect(
    screen.getByRole("switch", { name: "Reviews requested from your teams" }),
  ).toBeChecked();
  expect(
    screen.getByRole("switch", { name: "Mentions of you" }),
  ).not.toBeChecked();
});

it("keeps the saved choice when it cannot be saved, and saves nothing while inactive", async () => {
  const view = render(<AlertSettings active={() => true} />);
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
  const mentions = () =>
    screen.getByRole("switch", { name: "Mentions of you" });
  await userEvent.click(mentions());
  expect(mentions()).toBeChecked();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your choice could not be saved",
  );
  write.mockRestore();
  view.unmount();

  render(<AlertSettings active={() => false} />);
  await userEvent.click(mentions());
  expect(mentions()).toBeChecked();
  expect(localStorage.length).toBe(0);
});
