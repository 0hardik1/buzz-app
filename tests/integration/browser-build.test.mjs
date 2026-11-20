import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { prepareAppBuilds } from "../browser/build.mjs";

const buildUrl = new URL("../browser/build.mjs", import.meta.url).href;
const options = {
  developmentReact: false,
  builderlabLogin: false,
  federatedIdentity: false,
  pluginFixtures: false,
  companionFixture: false,
  localAgentActivity: false,
  pairingFixture: false,
  startupFailureFixture: false,
};

function worker(variant = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { buildApp } from ${JSON.stringify(buildUrl)};
       await buildApp(${JSON.stringify({ ...options, ...variant })}, async (result) => {
         console.log(JSON.stringify({ directory: result.config.build.outDir, reused: result.reused }));
       });`,
      ],
      { env: process.env },
    );
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(`Build worker exited ${code}: ${errors}`));
      try {
        resolve(JSON.parse(output));
      } catch (error) {
        reject(error);
      }
    });
  });
}

test("workers reuse complete app builds, separate variants, and discard them between runs", async () => {
  let release = await prepareAppBuilds();
  let firstDirectory;
  try {
    const pair = await Promise.all([worker(), worker()]);
    assert.equal(pair[0].directory, pair[1].directory);
    assert.ok(pair.some((result) => !result.reused));
    firstDirectory = pair[0].directory;
    // Both processes have exited: their teardown must leave the published assets.
    assert.match(
      await readFile(join(firstDirectory, "index.html"), "utf8"),
      /<script/,
    );
    assert.ok((await readdir(join(firstDirectory, "assets"))).length > 0);
    const reused = await worker();
    assert.equal(reused.reused, true);
    assert.equal(reused.directory, firstDirectory);

    const variant = await worker({ startupFailureFixture: true });
    assert.equal(variant.reused, false);
    assert.notEqual(variant.directory, firstDirectory);
    const scripts = await readdir(join(variant.directory, "assets"));
    const source = (
      await Promise.all(
        scripts
          .filter((name) => name.endsWith(".js"))
          .map((name) =>
            readFile(join(variant.directory, "assets", name), "utf8"),
          ),
      )
    ).join("\n");
    assert.match(source, /Fixture startup failure: storage unavailable/);
    assert.equal((await worker({ startupFailureFixture: true })).reused, true);
  } finally {
    await release();
  }
  await assert.rejects(access(firstDirectory), { code: "ENOENT" });

  release = await prepareAppBuilds();
  try {
    const fresh = await worker();
    assert.equal(fresh.reused, false);
    assert.notEqual(fresh.directory, firstDirectory);
  } finally {
    await release();
  }
});
