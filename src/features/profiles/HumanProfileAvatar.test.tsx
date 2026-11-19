// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HumanProfileAvatar } from "./HumanProfileAvatar";
import { stubAvatarBrowserApis } from "../agents/avatar-testing";
stubAvatarBrowserApis();
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps the poster until the animation loads without leaking a referrer", () => {
  const images: {
    onload: (() => void) | null;
    src: string;
    referrerPolicy: string;
  }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      onload = null;
      src = "";
      referrerPolicy = "";
      constructor() {
        images.push(this);
      }
    },
  );
  const media = vi.fn(
    (url: string) => `/protected?url=${encodeURIComponent(url)}`,
  );
  render(
    <HumanProfileAvatar
      picture="https://relay.example/poster.png#buzz-anim=https%3A%2F%2Frelay.example%2Fanimation.png"
      media={media}
      name="Person"
      status={undefined}
    />,
  );
  const image = screen
    .getByRole("img", { name: "Person avatar" })
    .querySelector("img");
  const poster = image?.getAttribute("src");
  fireEvent.click(
    screen.getByRole("button", { name: "Play avatar animation" }),
  );
  expect(images[0]?.referrerPolicy).toBe("no-referrer");
  expect(image).toHaveAttribute("src", poster);
  act(() => images[0]?.onload?.());
  expect(
    screen.getByRole("img", { name: "Person avatar" }).querySelector("img"),
  ).toHaveAttribute(
    "src",
    "/protected?url=https%3A%2F%2Frelay.example%2Fanimation.png",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Pause avatar animation" }),
  );
  expect(
    screen.getByRole("img", { name: "Person avatar" }).querySelector("img"),
  ).toHaveAttribute("src", poster);
});
