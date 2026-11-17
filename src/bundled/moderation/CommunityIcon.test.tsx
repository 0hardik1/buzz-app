// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { RelayData } from "../../features/relay/service";
import { CommunityIcon } from "./CommunityIcon";

const published = vi.hoisted(() => ({
  icon: "" as string | undefined,
  readFails: false,
}));
vi.mock("../../features/communities/community-icon", () => ({
  fetchCommunityPresentation: async () => {
    if (published.readFails) throw new Error("offline");
    return { publishedIcon: published.icon };
  },
}));
const setCommunityIcon = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ setCommunityIcon }));

const connection = {
  status: "ready",
  generation: 1,
  scope: `https://primary.example:${"0".repeat(64)}`,
};
const relay = {
  snapshot: () => connection,
  subscribe: () => () => {},
} as unknown as RelayData;
const ICON = "data:image/png;base64,AAAA";

afterEach(() => {
  cleanup();
  setCommunityIcon.mockReset();
  published.readFails = false;
});

it("removes the icon and shows what the community now publishes", async () => {
  published.icon = ICON;
  setCommunityIcon.mockImplementation(async (_community, icon: string) => {
    published.icon = icon || undefined;
  });
  render(
    <CommunityIcon relay={relay} communityName="Hive" active={() => true} />,
  );
  expect(await screen.findByText("Icon set")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Remove icon" }));
  expect(await screen.findByText("Icon removed.")).toBeVisible();
  expect(setCommunityIcon).toHaveBeenCalledWith("https://primary.example", "");
  expect(screen.getByText("No icon")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Remove icon" })).toBeNull();
});

it("keeps the published icon when the relay refuses the change", async () => {
  published.icon = ICON;
  setCommunityIcon.mockRejectedValue(
    new Error("invalid: actor not authorized: must be admin or owner"),
  );
  render(
    <CommunityIcon relay={relay} communityName="Hive" active={() => true} />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Remove icon" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "invalid: actor not authorized: must be admin or owner",
  );
  expect(screen.getByText("Icon set")).toBeVisible();
});

it("reports an accepted change even when the readback fails", async () => {
  published.icon = ICON;
  setCommunityIcon.mockImplementation(async () => {
    published.readFails = true;
  });
  render(
    <CommunityIcon relay={relay} communityName="Hive" active={() => true} />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Remove icon" }),
  );
  expect(await screen.findByText("Icon removed.")).toBeVisible();
  expect(screen.getByText("No icon")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("offers a retry when the current icon can't be read", async () => {
  published.icon = ICON;
  published.readFails = true;
  render(
    <CommunityIcon relay={relay} communityName="Hive" active={() => true} />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't load the current icon.",
  );
  expect(screen.getByText("Icon unknown")).toBeVisible();
  published.readFails = false;
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Icon set")).toBeVisible();
});

it("starts no write when the card closes while an image decodes", async () => {
  let decoded = (_: unknown) => {};
  vi.stubGlobal(
    "createImageBitmap",
    () => new Promise((resolve) => (decoded = resolve)),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage() {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(ICON);
  let open = true;
  render(
    <CommunityIcon relay={relay} communityName="Hive" active={() => open} />,
  );
  await userEvent.upload(
    screen.getByLabelText("Community icon image"),
    new File(["x"], "icon.png", { type: "image/png" }),
  );
  open = false;
  decoded({ width: 1, height: 1 });
  await new Promise((resolve) => setTimeout(resolve));
  expect(setCommunityIcon).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
