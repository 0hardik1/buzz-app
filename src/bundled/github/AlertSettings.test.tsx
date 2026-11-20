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

it("matches GitHub's Slack defaults, and saves each choice", async () => {
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
    ["Your review is requested", "true"],
    ["Your team's review is requested", "false"],
    ["Your review is requested because you're a code owner", "false"],
    ["Your pull request is approved or has changes requested", "true"],
    ["You're assigned to a pull request", "true"],
    ["Someone comments on your pull request", "true"],
    ["Someone comments on a pull request you're in", "false"],
    ["You're mentioned on a pull request", "true"],
    ["Your pull request is merged", "false"],
    ["Your pull request has failed checks", "false"],
  ]);
  await user.click(
    screen.getByRole("switch", { name: "Your team's review is requested" }),
  );
  await user.click(
    screen.getByRole("switch", { name: "You're mentioned on a pull request" }),
  );
  expect(alertChoices()).toMatchObject({
    review: true,
    teamReview: true,
    mention: false,
    merged: false,
  });
  view.unmount();
  render(<AlertSettings active={() => true} />);
  expect(
    screen.getByRole("switch", { name: "Your team's review is requested" }),
  ).toBeChecked();
  expect(
    screen.getByRole("switch", { name: "You're mentioned on a pull request" }),
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
    screen.getByRole("switch", { name: "You're mentioned on a pull request" });
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
