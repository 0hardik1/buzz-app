export default async function ({ page, demo }) {
  await demo.captionPosition("bottom");
  await demo.title(
    "To-do",
    "Personal tasks and shared channel checklists",
    2200,
  );
  demo.chapter("Your personal list");
  await demo.openPage("To-do");
  await demo.click(page.getByRole("button", { name: "New task", exact: true }));
  await page.getByPlaceholder("New task", { exact: true }).waitFor();
  await demo.type(
    page.getByPlaceholder("New task", { exact: true }),
    "Prepare the launch checklist",
    { submit: true },
  );
  await page
    .getByText("Prepare the launch checklist", { exact: true })
    .waitFor();
  demo.poster();
  await demo.caption("Keep personal work in one place", 2000);
  await demo.type(
    page.getByPlaceholder("New task", { exact: true }),
    "Review the release notes",
    { submit: true },
  );
  await demo.pause(1200);
  demo.chapter("Set a deadline");
  await demo.click(
    page.getByText("Prepare the launch checklist", { exact: true }),
  );
  await demo.click(
    page.getByRole("button", {
      name: "Add time for Prepare the launch checklist",
      exact: true,
    }),
  );
  const popup = page.getByRole("dialog", { name: "Choose time" });
  await demo.click(
    popup
      .getByRole("listbox", { name: "Hours", exact: true })
      .getByRole("option", { name: "16", exact: true }),
  );
  await demo.click(popup.getByRole("button", { name: "Set time" }));
  await demo.click(page.getByPlaceholder("New task", { exact: true }));
  await demo.caption("Choose a time. Today is added automatically.", 2400);
  await demo.click(page.getByRole("heading", { name: "To-do", exact: true }));
  demo.chapter("Complete a task");
  await demo.click(
    page.getByRole("checkbox", {
      name: "Complete Review the release notes",
      exact: true,
    }),
  );
  await page
    .getByRole("checkbox", {
      name: "Complete Review the release notes",
      exact: true,
    })
    .waitFor({ state: "hidden" });
  await demo.pause(1800);
  await demo.caption("Stay focused on what’s next", 2500);
}
