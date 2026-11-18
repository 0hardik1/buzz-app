import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../../../../", import.meta.url);
const output = new URL(".scratch/tasks-demo-plugin/", root);
await mkdir(output, { recursive: true });
await copyFile(
  new URL("../manifest.json", import.meta.url),
  new URL("manifest.json", output),
);
await writeFile(
  new URL("plugin.js", output),
  `import { inject, apply as original } from "../../examples/plugins/tasks/plugin.js";
import { wrapRelay } from "../../examples/plugins/tasks/demo/mocks.mjs";
export { inject };
export function apply(ctx) {
  return original(new Proxy(ctx, { get(target, key, receiver) {
    if (key === "relay") return wrapRelay(target.relay);
    return Reflect.get(target, key, receiver);
  }}));
}
`,
);
console.log(fileURLToPath(output));
