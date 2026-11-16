import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createAdmissionReader } from "../admission";
import { createPullReader, createPullStatusReader } from "../pull-facts";
import type { GitHubCli } from "../../github/gh";
import { TOOLS } from "../../../buzz-mcp/tools";
import { reviewTransport, boundedJson } from "./transport";
import { reviewStorage } from "./storage";
import { serverReviewSession } from "./session";
import { reviewTick } from "./worker";

/** Explicit operator configuration, never desktop credentials or key discovery. */
async function main() {
  const configPath = process.argv[2];
  if (!configPath)
    throw new Error("Usage: node review-worker.mjs /path/to/worker.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    relay: string;
    channels: string[];
    storage: string;
    keyFile: string;
    githubTokenFile: string;
  };
  if (
    ![
      config.relay,
      config.storage,
      config.keyFile,
      config.githubTokenFile,
    ].every((value) => typeof value === "string" && value.length) ||
    !Array.isArray(config.channels) ||
    !config.channels.length ||
    config.channels.length > 100 ||
    new Set(config.channels).size !== config.channels.length ||
    config.channels.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          id,
        ),
    )
  )
    throw new Error(
      "Provide relay, storage, keyFile, githubTokenFile and 1–100 unique channel UUIDs.",
    );
  const lifetime = new AbortController();
  const stop = () => lifetime.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const token = (await readFile(config.githubTokenFile, "utf8")).trim();
  if (!token) throw new Error("GitHub read token is empty.");
  const transport = reviewTransport({
    relay: config.relay,
    key: (await readFile(config.keyFile, "utf8")).trim(),
    signal: lifetime.signal,
  });
  const storage = reviewStorage(
    config.storage,
    `${transport.base}:${transport.viewer}`,
  );
  let host: Awaited<ReturnType<typeof serverReviewSession>> | undefined;
  try {
    host = await serverReviewSession(
      transport,
      storage,
      config.channels,
      lifetime.signal,
    );
    const gh: GitHubCli = async <T>(
      query: string,
      variables: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      const response = (await boundedJson(
        await fetch("https://api.github.com/graphql", {
          method: "POST",
          redirect: "error",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          signal: AbortSignal.any([
            lifetime.signal,
            AbortSignal.timeout(20_000),
            ...(signal ? [signal] : []),
          ]),
          body: JSON.stringify({ query, variables }),
        }),
      )) as { data?: T; errors?: unknown[] };
      if (response.errors?.length || !response.data)
        throw new Error("GitHub read failed; no review action was authorized.");
      return response.data;
    };
    const recent = new Map<string, number>();
    const worker = {
      state: storage,
      session: host.session,
      refresh: host.refresh,
      channels: config.channels,
      readPull: createPullReader(gh),
      readStatus: createPullStatusReader(gh),
      readAdmission: createAdmissionReader(gh),
      reviewDocumentation:
        TOOLS.find((tool) => tool.name === "pr_review_status_update")
          ?.description ?? "",
      triageDocumentation:
        TOOLS.find((tool) => tool.name === "pr_triage_decision")?.description ??
        "",
      report(event: {
        channel: string;
        pr?: number;
        action: string;
        error?: string;
      }) {
        const key = JSON.stringify(event),
          now = Date.now();
        // Repeated exhaustion/error is observable without emitting it every tick.
        if ((recent.get(key) ?? 0) > now - 300_000) return;
        recent.set(key, now);
        for (const [id, at] of recent)
          if (at < now - 300_000) recent.delete(id);
        console.log(
          JSON.stringify({ time: new Date().toISOString(), ...event }),
        );
      },
    };
    let failures = 0;
    await delay(Math.random() * 30_000, undefined, { signal: lifetime.signal });
    while (!lifetime.signal.aborted) {
      const start = Date.now();
      try {
        const success = await reviewTick(
          worker,
          AbortSignal.any([lifetime.signal, AbortSignal.timeout(120_000)]),
        );
        failures = 0;
        if (!success)
          worker.report({
            channel: "",
            action: "partial",
            error: "Some channels are backing off independently.",
          });
      } catch (error) {
        if (lifetime.signal.aborted) break;
        failures = Math.min(failures + 1, 4);
        worker.report({
          channel: "",
          action: "error",
          error: error instanceof Error ? error.message : "Polling failed.",
        });
      }
      const interval = Math.min(300_000, 30_000 * 2 ** failures);
      await delay(
        Math.max(1000, interval - (Date.now() - start)) + Math.random() * 1000,
        undefined,
        { signal: lifetime.signal },
      );
    }
  } catch (error) {
    if (!lifetime.signal.aborted) throw error;
  } finally {
    lifetime.abort();
    if (host) {
      host.close();
      await storage.deliveryClosed;
    }
    storage.close();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Review worker failed.",
  );
  process.exitCode = 1;
});
