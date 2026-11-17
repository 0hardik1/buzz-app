import { expect, it } from "vitest";
import { parseManagedProfile } from "./managed-profile";

const valid = {
  version: 1,
  source_label: "Directory",
  source_url: "https://example.org/people/alice",
  fields: [{ key: "team", section: "team", label: "Team", value: "Design" }],
};
it("accepts bounded directory fields and rejects unsafe links and malformed snapshots", () => {
  expect(parseManagedProfile(JSON.stringify(valid))).toEqual(valid);
  for (const change of [
    { version: 2 },
    { source_url: "javascript:alert(1)" },
    { source_url: "https://user:pass@example.org" },
    { fields: [...valid.fields, ...valid.fields] },
    { fields: [{ ...valid.fields[0], value: "x".repeat(513) }] },
    { fields: [{ ...valid.fields[0], section: "unknown" }] },
    { picture: "http://example.org/photo.png" },
    { city: "London\n" },
  ])
    expect(
      parseManagedProfile(JSON.stringify({ ...valid, ...change })),
    ).toBeUndefined();
  expect(parseManagedProfile(" ".repeat(16385))).toBeUndefined();
});
