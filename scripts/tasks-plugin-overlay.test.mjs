import { it } from "vitest";
import assert from "node:assert/strict";
import { createModel, taskTemplate } from "../examples/plugins/tasks/plugin.js";
const viewer = "a".repeat(64),
  channel = "10000000-0000-4000-8000-000000000002",
  taskId = "20000000-0000-4000-8000-000000000001";
const input = {
  id: taskId,
  channel,
  title: "old task",
  done: false,
  assignees: [viewer],
};
const lock = { request: (_key, _opts, run) => Promise.resolve().then(run) };
function fixture({ locks = lock, onChange = () => {} } = {}) {
  let record,
    wireAttempt,
    assignedFailure = false,
    failAfterPublish = false,
    publishUncertain = false,
    holdResolve,
    holdAssigned,
    sequence = 0,
    readExact;
  const session = {
    viewer,
    scope: "review",
    subscribeLive: () => () => {},
    channels: {
      findLabeled: async () => [],
      resolve: async (ids, options) => {
        if (!options.consistency && holdResolve) await holdResolve(ids);
      },
      refreshRoster: async () => true,
      get: () => ({ id: channel, channelType: "stream", members: [viewer] }),
      list: () => ({ channels: [{ id: channel }] }),
    },
    snapshotRead: async ([filter]) => {
      if (filter.artifact === "current" && filter.consistency)
        throw Error("invalid: consistency is not accepted on artifact reads");
      if (filter["#p"] && holdAssigned) await holdAssigned();
      if (filter.ids && readExact) return readExact(filter.ids);
      if (filter["#p"] && assignedFailure) throw Error("assigned read failed");
      if (filter.ids && (!record || !filter.ids.includes(record.id))) return [];
      return record &&
        (!filter["#p"] ||
          record.tags.some(([k, v]) => k === "p" && v === viewer))
        ? [record]
        : [];
    },
    configArtifactWriter: {
      sign: async (template) => ({
        ...template,
        id: (++sequence).toString(16).padStart(64, "0"),
        pubkey: viewer,
        sig: "d".repeat(128),
      }),
      publish: async (event) => {
        wireAttempt = event;
        if (publishUncertain) throw Error("uncertain");
        record = event;
        assignedFailure = failAfterPublish;
      },
    },
  };
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k),
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  const model = createModel(session, storage, onChange, locks);
  return {
    model,
    storage,
    holdResolve(fn) {
      holdResolve = fn;
    },
    holdAssigned(fn) {
      holdAssigned = fn;
    },
    confirmAttempt() {
      record = wireAttempt;
    },
    failAfterPublish(value) {
      failAfterPublish = value;
    },
    publishUncertain(value) {
      publishUncertain = value;
    },
    failAssigned(value) {
      assignedFailure = value;
    },
    record(value) {
      record = value;
    },
    exact(fn) {
      readExact = fn;
    },
  };
}
it("keeps unassigned cached tasks hidden after channel close", async () => {
  const f = fixture(),
    { model } = f;
  await model.refresh();
  await model.save(input);
  const unfollow = model.followChannel(channel);
  await model.refresh();
  f.failAfterPublish(true);
  await model.save({ ...model.snapshot().tasks[0], assignees: [] });
  unfollow();
  await model.refresh();
  assert.deepEqual(model.snapshot().tasks, []);
  model.dispose();
});

it("keeps confirmed retries visible throughout concurrent refresh", async () => {
  const seen = [];
  const f = fixture({
    onChange: () => {
      const { tasks, pending } = f.model.snapshot();
      seen.push({ count: tasks.length, pending: Boolean(pending) });
    },
  });
  const { model } = f;
  await model.refresh();
  f.publishUncertain(true);
  await model.save(input).catch(() => {});
  let releaseResolve, resolveStarted;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  f.holdResolve(() => {
    f.holdResolve(undefined);
    resolveStarted();
    return new Promise((resolve) => {
      releaseResolve = resolve;
    });
  });
  const refreshing = model.refresh();
  await started;
  seen.length = 0;
  f.confirmAttempt();
  const retry = model.retrySaved();
  while (model.snapshot().pending)
    await new Promise((resolve) => setImmediate(resolve));
  releaseResolve();
  await Promise.all([retry, refreshing]);
  assert.ok(seen.some(({ pending }) => !pending));
  assert.ok(
    seen.filter(({ pending }) => !pending).every(({ count }) => count === 1),
  );
  model.dispose();
});

it("preserves a newer known head when an older attempt is confirmed", async () => {
  let grantLock;
  const delayedLock = {
    request: (_key, _opts, run) =>
      new Promise((resolve) => {
        grantLock = () => resolve(run());
      }),
  };
  const f = fixture({ locks: delayedLock }),
    { model } = f;
  const signed = (template, hex) => ({
    ...template,
    id: hex.repeat(64),
    pubkey: viewer,
    sig: "d".repeat(128),
  });
  const old = signed(taskTemplate(input), "1");
  const current = signed(
    taskTemplate({ ...input, title: "new revision", event: old }),
    "2",
  );
  f.storage.setItem(
    "buzz-task-list-pending:review",
    JSON.stringify({ version: 1, pending: old, queue: [], aside: [] }),
  );
  f.record(current);
  f.exact((ids) => (ids.includes(old.id) ? [old] : []));
  await model.refresh();
  assert.deepEqual(
    model.snapshot().tasks.map((task) => task.title),
    ["new revision"],
  );
  f.failAssigned(true);
  grantLock();
  await model.refresh();
  assert.deepEqual(
    model.snapshot().tasks.map((task) => task.title),
    ["new revision"],
  );
  model.dispose();
});

it("prefers a channel head over delayed assigned absence", async () => {
  const f = fixture(),
    { model } = f;
  await model.refresh();
  f.failAfterPublish(true);
  await model.save(input);
  const old = model.snapshot().tasks[0];
  assert.equal(model.snapshot().tasks.length, 1);
  f.record({
    ...taskTemplate({ ...old, title: "remote reassignment", assignees: [] }),
    id: "6".repeat(64),
    pubkey: viewer,
    sig: "d".repeat(128),
  });
  f.failAssigned(false);
  let resolveAssigned;
  f.holdAssigned(() => {
    f.holdAssigned(undefined);
    return new Promise((resolve) => {
      resolveAssigned = resolve;
    });
  });
  model.followChannel(channel);
  await new Promise((resolve) => setImmediate(resolve));
  resolveAssigned();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    model.snapshot().tasks.map((task) => task.title),
    ["remote reassignment"],
  );
  model.dispose();
});

it("keeps consecutive confirmed edits visible while list reads fail", async () => {
  const f = fixture(),
    { model } = f;
  try {
    await model.refresh();
    await model.save(input);
    f.failAfterPublish(true);
    for (const title of ["first edit", "second edit", "third edit"]) {
      await model.save({ ...model.snapshot().tasks[0], title });
      assert.equal(model.snapshot().tasks[0].title, title);
      assert.equal(model.snapshot().pending, null);
      await model.refresh();
      assert.equal(model.snapshot().tasks[0].title, title);
    }
    f.failAssigned(false);
    await model.refresh();
    assert.equal(model.snapshot().tasks[0].title, "third edit");
  } finally {
    model.dispose();
  }
});
