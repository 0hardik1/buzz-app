// Generated from squareup/agents buzz-plugins/plugins/to-do via pnpm build.
// ../../shared/channel-artifacts/src/relay.ts
function refusalOf(error) {
  const message = error instanceof Error ? error.message : String(error);
  const own = error?.reason;
  const reason = typeof own === "string" ? own : message;
  const prefix = /^([a-z-]+):/.exec(reason)?.[1];
  if (
    prefix === "conflict" ||
    prefix === "duplicate" ||
    prefix === "rate-limited"
  )
    return { definite: true, refusal: prefix, message: reason };
  if (/archived/i.test(reason))
    return { definite: true, refusal: "archived", message: reason };
  if (
    prefix === "restricted" ||
    prefix === "auth-required" ||
    prefix === "blocked"
  )
    return { definite: true, refusal: "permission", message: reason };
  if (prefix === "invalid")
    return {
      definite: true,
      refusal: /too large|too big|size/i.test(reason) ? "too-large" : "invalid",
      message: reason,
    };
  return { definite: false, refusal: "unknown", message: reason };
}
function isReadDenied(error) {
  const e = error;
  return (
    e?.kind === "denied" ||
    e?.status === 401 ||
    e?.status === 403 ||
    (typeof e?.message === "string" &&
      /^Relay read failed \((401|403)\)$/.test(e.message))
  );
}

// plugin.js
var inject = ["react", "pages", "panels", "relay"];
var TYPE = "com.squareup.task-list.task";
var LABEL = "com.squareup.task-list.personal";
var tag = (event, name) => event.tags.find(([key]) => key === name)?.[1];
var uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
var pubkey = /^[0-9a-f]{64}$/;
function matchesAssignee(profile, search) {
  const query = search.trim().replace(/^@/, "").toLocaleLowerCase();
  if (!query) return true;
  return [
    profile?.name,
    profile?.username,
    profile?.verified?.displayName,
    profile?.verified?.fullName,
    profile?.verified?.username,
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}
var validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
  /* @__PURE__ */ new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) ===
    value;
var validTime = (value) =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
var validDue = ({ dueDate, dueAt, dueTime }) =>
  (!dueTime || (validTime(dueTime) && !dueDate && !dueAt)) &&
  (!dueDate || validDate(dueDate)) &&
  (!dueAt ||
    (typeof dueAt === "string" &&
      Number.isFinite(Date.parse(dueAt)) &&
      new Date(dueAt).toISOString() === dueAt)) &&
  !(dueDate && dueAt);
function dueValue(date, time) {
  if (time && !validTime(time)) throw new Error("Choose a valid time.");
  if (!date && time)
    date = dueInputs({ dueAt: /* @__PURE__ */ new Date().toISOString() }).date;
  if (!date) return { dueDate: null, dueAt: null, dueTime: null };
  if (!validDate(date)) throw new Error("Choose a valid due date.");
  if (!time) return { dueDate: date, dueAt: null, dueTime: null };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Choose a valid time.");
  const value = /* @__PURE__ */ new Date(`${date}T${time}:00`);
  const parts = dueInputs({ dueAt: value.toISOString() });
  if (parts.date !== date || parts.time !== time)
    throw new Error(
      "That time does not exist in your time zone. Choose another time.",
    );
  return { dueDate: null, dueAt: value.toISOString(), dueTime: null };
}
function dueInputs(task) {
  if (!task.dueAt)
    return { date: task.dueDate || "", time: task.dueTime || "" };
  const value = new Date(task.dueAt),
    pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}
function parseTask(event) {
  if (
    event.kind !== 45010 ||
    tag(event, "type") !== TYPE ||
    tag(event, "ar") !== "1" ||
    tag(event, "op") === "delete"
  )
    return null;
  try {
    const body = JSON.parse(event.content);
    const id = tag(event, "d"),
      channel = tag(event, "h");
    if (
      !uuid.test(id) ||
      !uuid.test(channel) ||
      body.version !== 1 ||
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.length > 500 ||
      typeof body.done !== "boolean" ||
      !Array.isArray(body.assignees) ||
      body.assignees.length > 32 ||
      body.assignees.some((key) => !pubkey.test(key)) ||
      !validDue(body)
    )
      return null;
    return {
      id,
      channel,
      title: body.title,
      done: body.done,
      dueDate: body.dueDate || null,
      dueAt: body.dueAt || null,
      dueTime: body.dueTime || null,
      assignees: [...new Set(body.assignees)],
      createdAt:
        Number.isSafeInteger(body.createdAt) && body.createdAt >= 0
          ? body.createdAt
          : event.created_at * 1e3,
      event,
    };
  } catch {
    return null;
  }
}
function taskTemplate({
  id,
  channel,
  title,
  done,
  assignees,
  event,
  createdAt = event ? parseTask(event)?.createdAt : Date.now(),
  dueDate = null,
  dueAt = null,
  dueTime = null,
}) {
  if (!validDue({ dueDate, dueAt, dueTime }))
    throw new Error("Choose a valid due date and time.");
  title = title.trim();
  if (new TextEncoder().encode(title).length > 512)
    throw new Error(
      "This title is too long to save. Shorten it and try again.",
    );
  if (
    !uuid.test(id) ||
    !uuid.test(channel) ||
    !title ||
    title.length > 500 ||
    typeof done !== "boolean" ||
    assignees.length > 32 ||
    assignees.some((key) => !pubkey.test(key))
  )
    throw new Error(
      "Enter a task of up to 500 characters and choose channel members.",
    );
  assignees = [...new Set(assignees)];
  return {
    kind: 45010,
    created_at: Math.floor(Date.now() / 1e3),
    content: JSON.stringify({
      version: 1,
      createdAt,
      title,
      done,
      assignees,
      dueDate,
      dueAt,
      dueTime,
    }),
    tags: [
      ["ar", "1"],
      ["d", id],
      ["h", channel],
      ["type", TYPE],
      ["title", title],
      ["op", event ? "update" : "create"],
      ...(event ? [["prev", event.id]] : []),
      ...assignees.map((key) => ["p", key]),
    ],
  };
}
function compatibilityError(ui, locks = globalThis.navigator?.locks) {
  if (
    !["Calendar", "PopoverRoot", "PopoverTrigger", "PopoverPopup"].every(
      (name) => ui?.[name],
    )
  )
    return "Update Buzz to use To-do. This version is missing the date and time controls.";
  if (typeof locks?.request !== "function")
    return "Update Buzz to use To-do. This version cannot safely coordinate task saves across windows.";
  return "";
}
function createModel(
  session,
  storage,
  changed,
  locks = globalThis.navigator?.locks,
) {
  const controller = new AbortController();
  const signal = controller.signal;
  const key = `buzz-task-list-pending:${session.scope}`;
  let state = {
    tasks: [],
    personal: [],
    loading: true,
    saving: false,
    error: "",
    partial: false,
    pending: null,
    queuePaused: false,
    asideCount: 0,
  };
  let confirmedTasks = [];
  const acceptedWrites = /* @__PURE__ */ new Map();
  let optimisticTask = null;
  let saveQueue = [];
  let aside = [];
  let recoveryError = "";
  let damagedJournal = null;
  const unverified = /* @__PURE__ */ new Set();
  let ownsJournal = false;
  let releaseJournal;
  const journalReleased = new Promise((resolve) => {
    releaseJournal = resolve;
  });
  const persist = (pending, queue, retained = aside) => {
    if (pending || queue.length || retained.length)
      storage.setItem(
        key,
        JSON.stringify({
          version: 1,
          pending,
          aside: retained,
          queue: queue.map(({ input }) => input),
        }),
      );
    else storage.removeItem(key);
  };
  let draining = false;
  let lastCreatedAt = 0;
  const openChannels = /* @__PURE__ */ new Map();
  let running,
    again = false,
    disposed = false;
  const withTask = (tasks, next) =>
    tasks.some((task) => task.id === next.id)
      ? tasks.map((task) => (task.id === next.id ? next : task))
      : [...tasks, next];
  const emit = (patch) => {
    if (!disposed) {
      if (patch.tasks) confirmedTasks = patch.tasks;
      state = { ...state, ...patch };
      const pendingTask =
        optimisticTask ?? (state.pending && parseTask(state.pending));
      let baseTasks = confirmedTasks;
      for (const task of acceptedWrites.values()) {
        if (
          !openChannels.has(task.channel) &&
          !state.personal.includes(task.channel) &&
          !task.assignees.includes(session.viewer)
        ) {
          baseTasks = baseTasks.filter((item) => item.id !== task.id);
        } else baseTasks = withTask(baseTasks, task);
      }
      state.tasks =
        pendingTask && !unverified.has(pendingTask.channel)
          ? withTask(baseTasks, pendingTask)
          : baseTasks;
      for (const entry of saveQueue)
        if (!unverified.has(entry.input.channel))
          state.tasks = withTask(state.tasks, entry.input);
      state.tasks = state.tasks.filter((task) => !revoked.has(task.channel));
      state.tasks = [...state.tasks].sort(
        (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
      );
      state.asideCount = aside.length;
      state.asideIds = aside.map((event) => tag(event, "d"));
      state.readOnly = !ownsJournal || !!recoveryError;
      state.canResetJournal = ownsJournal && damagedJournal !== null;
      state.recoveryBlocked = !!recoveryError;
      state.canRetryRecovery = ownsJournal && !!recoveryError;
      state.queuedTitle =
        revoked.has(saveQueue[0]?.input.channel) ||
        unverified.has(saveQueue[0]?.input.channel)
          ? "Task from an unavailable channel"
          : saveQueue[0]?.input.title || "Task";
      state.savingIds = saveQueue.map((entry) => entry.input.id);
      changed();
    }
  };
  const read = (filters) => session.snapshotRead(filters, { signal });
  const channel = (id) =>
    session.channels.get?.(id) ??
    session.channels.list().channels.find((item) => item.id === id);
  const privateHome = (home) =>
    home.channelType === "system" &&
    home.visibility === "private" &&
    !home.cached &&
    !home.metadataCached &&
    !home.archived &&
    home.creator === session.viewer &&
    home.members?.length === 1 &&
    home.members[0] === session.viewer;
  function restoreJournal() {
    damagedJournal = null;
    try {
      const raw = storage.getItem(key);
      damagedJournal = raw ?? null;
      const saved = raw == null ? null : JSON.parse(raw);
      const validAttempt = (event) =>
        event &&
        typeof event.id === "string" &&
        pubkey.test(event.id) &&
        typeof event.sig === "string" &&
        /^[0-9a-f]{128}$/.test(event.sig) &&
        Number.isSafeInteger(event.created_at) &&
        event.created_at >= 0 &&
        typeof event.content === "string" &&
        Array.isArray(event.tags) &&
        event.tags.every(
          (item) =>
            Array.isArray(item) &&
            item.every((value) => typeof value === "string"),
        ) &&
        event.pubkey === session.viewer &&
        parseTask(event);
      if (
        raw != null &&
        (!saved || (saved.version !== 1 && !validAttempt(saved)))
      )
        throw new Error("Invalid task journal");
      if (saved?.version === 1) {
        if (
          !Array.isArray(saved.queue) ||
          (saved.pending != null && !validAttempt(saved.pending))
        )
          throw new Error("Invalid task journal");
        const restored = saved.queue.map((input) => {
          if (!input || !Number.isFinite(input.createdAt))
            throw new Error("Invalid saved task");
          taskTemplate({ ...input, channel: input.channel || input.id });
          return { input, resolve() {}, reject() {} };
        });
        if (
          saved.aside != null &&
          (!Array.isArray(saved.aside) ||
            saved.aside.some((event) => !validAttempt(event)))
        )
          throw new Error("Invalid retained attempts");
        aside = saved.aside ?? [];
        state.pending = saved.pending;
        saveQueue = restored;
        state.queuePaused = saveQueue.length > 0 && !state.pending;
        lastCreatedAt = Math.max(
          0,
          ...restored.map(({ input }) => input.createdAt),
        );
      } else state.pending = saved;
      for (const entry of saveQueue)
        if (entry.input.channel) unverified.add(entry.input.channel);
      if (state.pending) unverified.add(tag(state.pending, "h"));
      damagedJournal = null;
    } catch {
      state.pending = null;
      saveQueue = [];
      aside = [];
      recoveryError = state.error =
        "Saved task recovery could not be read. Your local data has been left untouched.";
    }
  }
  const lockRequest =
    typeof locks?.request === "function"
      ? Promise.resolve().then(() =>
          locks.request(key, { signal }, async () => {
            if (disposed) return;
            ownsJournal = true;
            restoreJournal();
            emit({});
            void refresh();
            await journalReleased;
            ownsJournal = false;
          }),
        )
      : null;
  if (!lockRequest)
    recoveryError =
      "This Buzz version cannot safely coordinate task saves. Update Buzz to continue.";
  else
    void lockRequest.catch(() => {
      if (!disposed) {
        recoveryError =
          "Task save coordination failed. Reload Buzz to try again.";
        emit({ error: recoveryError });
      }
    });
  async function discover() {
    if (!session.channels.findLabeled)
      throw new Error(
        "This Buzz version cannot open a private task list. Update Buzz to continue.",
      );
    const homes = await session.channels.findLabeled(
      { creator: session.viewer, label: LABEL },
      { signal, consistency: "strong" },
    );
    return homes.filter(privateHome).map((home) => home.id);
  }
  async function current(extra = {}) {
    const result = await read([
      {
        artifact: "current",
        consistency: "strong",
        kinds: [45010],
        "#type": [TYPE],
        ...extra,
        limit: 500,
      },
    ]);
    return {
      tasks: result.map(parseTask).filter(Boolean),
      partial: result.length >= 500,
    };
  }
  async function recover() {
    if (!ownsJournal || !state.pending) return;
    const event = state.pending;
    const found = await read([
      {
        ids: [event.id],
        kinds: [45010],
        "#h": [tag(event, "h")],
        limit: 1,
        consistency: "strong",
      },
    ]);
    if (found.some((item) => item.id === event.id)) {
      signal.throwIfAborted();
      if (state.pending?.id !== event.id) return;
      const head = saveQueue[0];
      const remaining =
        head?.input.id === tag(event, "d") ? saveQueue.slice(1) : saveQueue;
      persist(null, remaining);
      saveQueue = remaining;
      if (!draining && head && !remaining.includes(head)) head.resolve();
      const task = parseTask(event);
      const known = task && confirmedTasks.find((item) => item.id === task.id);
      const advancesKnown =
        task &&
        (!known ||
          known.event?.id === event.id ||
          known.event?.id === tag(event, "prev"));
      if (advancesKnown && !revoked.has(task.channel))
        acceptedWrites.set(task.id, task);
      emit({
        pending: null,
        tasks: advancesKnown ? withTask(confirmedTasks, task) : confirmedTasks,
      });
    }
  }
  const readSets = /* @__PURE__ */ new Map();
  const readEpochs = /* @__PURE__ */ new Map();
  const verifying = /* @__PURE__ */ new Set();
  const revoked = /* @__PURE__ */ new Map();
  let unfollow = () => {};
  let followed = "";
  function revoke(ids) {
    for (const id of ids) revoked.set(id, (revoked.get(id) ?? 0) + 1);
    for (const [id, task] of acceptedWrites)
      if (ids.includes(task.channel)) acceptedWrites.delete(id);
    for (const [key2, result] of readSets)
      readSets.set(key2, {
        ...result,
        tasks: result.tasks.filter((task) => !revoked.has(task.channel)),
      });
    emit({
      tasks: confirmedTasks.filter((task) => !revoked.has(task.channel)),
    });
  }
  function followAccess() {
    if (disposed || !session.artifacts?.follow) return;
    const ids = [
      ...new Set(
        [
          ...openChannels.keys(),
          ...unverified,
          ...(state.pending ? [tag(state.pending, "h")] : []),
          ...confirmedTasks.map((task) => task.channel),
          ...saveQueue.map(({ input }) => input.channel),
        ].filter(Boolean),
      ),
    ].sort();
    const next = ids.join(",");
    if (next === followed) return;
    followed = next;
    unfollow();
    unfollow = session.artifacts.follow(ids, () => {}, revoke);
  }
  async function refresh() {
    if (disposed) return;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        const errors = [];
        followAccess();
        for (const id of unverified) {
          const task =
            saveQueue.find(({ input }) => input.channel === id)?.input ??
            (state.pending && tag(state.pending, "h") === id
              ? parseTask(state.pending)
              : void 0);
          if (!task) {
            unverified.delete(id);
            continue;
          }
          if (verifying.has(id)) continue;
          verifying.add(id);
          const epoch = revoked.get(id) ?? 0;
          void authorize(task)
            .then(() => {
              if (!disposed && (revoked.get(id) ?? 0) === epoch) {
                unverified.delete(id);
                emit({});
              }
            })
            .catch(() => {})
            .finally(() => verifying.delete(id));
        }
        try {
          if (!state.saving) await recover();
        } catch (error) {
          errors.push(String(error.message || error));
        }
        const sources = [
          { key: "assigned", read: () => current({ "#p": [session.viewer] }) },
          ...[...openChannels.keys()].map((id) => ({
            key: `channel:${id}`,
            channel: id,
            read: () => current({ "#h": [id] }),
          })),
          {
            key: "personal",
            read: async () => {
              const personal = await discover();
              if (!disposed) emit({ personal });
              return personal.length
                ? current({ "#h": personal })
                : { tasks: [], partial: false };
            },
          },
        ];
        const freshSources = /* @__PURE__ */ new Set();
        const retireWrites = /* @__PURE__ */ new Map();
        await Promise.all(
          sources.map(async (source) => {
            const writesAtStart = new Map(acceptedWrites);
            const accessEpochs = new Map(revoked);
            const epoch = source.channel
              ? (revoked.get(source.channel) ?? 0)
              : 0;
            const readEpoch = source.channel
              ? (readEpochs.get(source.channel) ?? 0)
              : 0;
            try {
              const result = await source.read();
              if (disposed) return;
              if (source.channel) {
                if ((revoked.get(source.channel) ?? 0) !== epoch) return;
                if (
                  !openChannels.has(source.channel) ||
                  (readEpochs.get(source.channel) ?? 0) !== readEpoch
                )
                  return;
                if (result.tasks.length) revoked.delete(source.channel);
              }
              for (const task of result.tasks) {
                if (
                  (revoked.get(task.channel) ?? 0) ===
                  (accessEpochs.get(task.channel) ?? 0)
                )
                  revoked.delete(task.channel);
              }
              for (const [id, task] of writesAtStart) {
                const covers =
                  result.tasks.some((item) => item.id === id) ||
                  (!result.partial &&
                    (source.channel === task.channel ||
                      (source.key === "personal" &&
                        state.personal.includes(task.channel)) ||
                      (source.key === "assigned" &&
                        task.assignees.includes(session.viewer))));
                if (covers && acceptedWrites.get(id) === task)
                  retireWrites.set(id, { task });
              }
              readSets.set(source.key, result);
              freshSources.add(source.key);
            } catch (error) {
              errors.push(String(error.message || error));
              if (isReadDenied(error)) {
                readSets.delete(source.key);
                if (source.channel) revoke([source.channel]);
              }
            }
          }),
        );
        if (disposed) return;
        const assigned = freshSources.has("assigned")
          ? readSets.get("assigned")
          : null;
        const assignedIds =
          assigned && !assigned.partial
            ? new Set(assigned.tasks.map((task) => task.id))
            : null;
        const results = [...sources]
          .sort(
            (a, b) =>
              Number(freshSources.has(a.key)) - Number(freshSources.has(b.key)),
          )
          .map(({ key: key2 }) => {
            const result = readSets.get(key2);
            if (!result || freshSources.has(key2) || !assignedIds)
              return result;
            return {
              ...result,
              tasks: result.tasks.filter(
                (task) =>
                  !task.assignees.includes(session.viewer) ||
                  assignedIds.has(task.id),
              ),
            };
          })
          .filter(Boolean);
        let tasks = [
          ...new Map(
            results
              .flatMap((result) => result.tasks)
              .filter((task) => !revoked.has(task.channel))
              .map((task) => [task.id, task]),
          ).values(),
        ].filter(
          (task) =>
            openChannels.has(task.channel) ||
            state.personal.includes(task.channel) ||
            task.assignees.includes(session.viewer),
        );
        try {
          await session.channels.resolve?.(
            [...new Set(tasks.map((task) => task.channel))],
            { signal },
          );
        } catch (error) {
          errors.push(String(error.message || error));
        }
        for (const [id, { task }] of retireWrites) {
          if (acceptedWrites.get(id) !== task) continue;
          const head = [...freshSources]
            .flatMap((key2) => readSets.get(key2)?.tasks ?? [])
            .find((item) => item.id === id);
          const replace = (items, assignedOnly = false) =>
            items.flatMap((item) =>
              item.id !== id
                ? [item]
                : head &&
                    (!assignedOnly || head.assignees.includes(session.viewer))
                  ? [head]
                  : [],
            );
          for (const [key2, result] of readSets)
            readSets.set(key2, {
              ...result,
              tasks: replace(result.tasks, key2 === "assigned"),
            });
          tasks = replace(tasks);
          acceptedWrites.delete(id);
        }
        emit({
          tasks: tasks.filter(
            (task) =>
              !revoked.has(task.channel) &&
              (openChannels.has(task.channel) ||
                state.personal.includes(task.channel) ||
                task.assignees.includes(session.viewer)),
          ),
          partial: results.some((result) => result.partial),
          loading: false,
          error: recoveryError || errors.join(" "),
        });
        followAccess();
      } while (again && !disposed);
    })().finally(() => {
      running = void 0;
      void drainSaves();
    });
    return running;
  }
  async function authorize(task) {
    await session.channels.resolve?.([task.channel], {
      signal,
      consistency: "strong",
    });
    if (
      session.channels
        .list()
        .channels.some((item) => item.id === task.channel) &&
      !(await session.channels.refreshRoster?.(task.channel, {
        signal,
        consistency: "strong",
      }))
    )
      throw new Error(
        "Channel membership could not be confirmed. Refresh and retry.",
      );
    const home = channel(task.channel);
    if (
      !home ||
      home.cached ||
      home.metadataCached ||
      home.readOnly ||
      home.archived ||
      !home.members?.includes(session.viewer)
    )
      throw new Error("Refresh channel access before saving this task.");
    if (home.channelType === "system" && !privateHome(home))
      throw new Error(
        "The personal list is no longer private. No task was saved.",
      );
    if (task.assignees.some((member) => !home.members.includes(member)))
      throw new Error(
        "An assignee is no longer in this channel. Choose a current member.",
      );
    if (
      home.channelType === "system" &&
      !(await discover()).includes(task.channel)
    )
      throw new Error(
        "The personal list is no longer private. No task was saved.",
      );
  }
  async function writeTask(input) {
    if (state.pending || state.loading)
      throw new Error(
        "Wait for the current task save or check its outcome first.",
      );
    if (aside.some((event) => tag(event, "d") === input.id))
      throw new Error(
        "This task has an unconfirmed save set aside. Check set-aside saves before editing it.",
      );
    if (!session.configArtifactWriter)
      throw new Error("Task writes are unavailable in this Buzz session.");
    optimisticTask = { ...input, title: input.title.trim() };
    emit({ saving: true, error: "" });
    try {
      const task = { ...input };
      if (!task.channel) {
        let homes = await discover();
        if (!homes.length) {
          await session.channelCreation.create({
            name: "Personal tasks",
            visibility: "private",
            system: true,
            labels: [LABEL],
          });
          signal.throwIfAborted();
          homes = await discover();
        }
        if (!homes.length)
          throw new Error(
            "Your private list could not be confirmed. Refresh before trying again.",
          );
        task.channel = homes[0];
        task.assignees = [];
      }
      await authorize(task);
      if (task.event) {
        const heads = await current({ "#h": [task.channel], "#d": [task.id] });
        if (
          heads.tasks.length !== 1 ||
          heads.tasks[0].event.id !== task.event.id
        )
          throw new Error(
            "This task changed elsewhere. Refresh and try your edit again.",
          );
      }
      const writer = session.configArtifactWriter;
      const signed = await writer.sign(taskTemplate(task), signal);
      signal.throwIfAborted();
      persist(signed, saveQueue);
      emit({ pending: signed });
      try {
        await writer.publish(signed, signal);
      } catch (error) {
        const refusal = refusalOf(error);
        if (
          writer.isNotSent?.(error) ||
          (refusal.definite &&
            !["duplicate", "archived"].includes(refusal.refusal))
        ) {
          signal.throwIfAborted();
          persist(null, saveQueue);
          emit({ pending: null });
          await refresh();
        }
        throw error;
      }
      await recover();
      if (state.pending)
        throw new Error(
          "The save was accepted but could not be read back yet. Check save before adding another task.",
        );
      await refresh();
    } catch (error) {
      if (!signal.aborted) emit({ error: String(error.message || error) });
      throw error;
    } finally {
      optimisticTask = null;
      emit({ saving: false });
    }
  }
  async function drainSaves() {
    if (
      !ownsJournal ||
      draining ||
      state.saving ||
      state.pending ||
      state.queuePaused ||
      recoveryError ||
      disposed
    )
      return;
    draining = true;
    try {
      while (saveQueue.length && !state.pending && !disposed) {
        const nextIndex = saveQueue.findIndex(
          (entry2) =>
            !aside.some((event) => tag(event, "d") === entry2.input.id),
        );
        if (nextIndex < 0) break;
        const entry = saveQueue[nextIndex];
        if (nextIndex > 0) {
          const reordered = [
            entry,
            ...saveQueue.filter((item) => item !== entry),
          ];
          try {
            persist(null, reordered);
          } catch (error) {
            emit({ error: String(error.message || error) });
            return;
          }
          saveQueue = reordered;
        }
        try {
          await writeTask(entry.input);
          entry.resolve();
        } catch (error) {
          entry.reject(error);
          emit({ queuePaused: !state.pending });
          break;
        }
        emit({});
      }
    } finally {
      draining = false;
    }
  }
  function save(input) {
    signal.throwIfAborted();
    if (!ownsJournal)
      throw new Error(
        "To-do is being edited in another Buzz window. Close that window to edit here.",
      );
    if (recoveryError) throw new Error(recoveryError);
    if (aside.some((event) => tag(event, "d") === input.id))
      throw new Error(
        "This task has an unconfirmed save set aside. Check set-aside saves before editing it.",
      );
    if (state.queuePaused)
      throw new Error("Retry the saved tasks before adding another task.");
    if (state.loading || (state.pending && !state.saving))
      throw new Error(
        "Check the previous save outcome before adding another task.",
      );
    taskTemplate({ ...input, channel: input.channel || input.id });
    const createdAt = input.event
      ? parseTask(input.event).createdAt
      : Math.max(Date.now(), lastCreatedAt + 1);
    if (!input.event) lastCreatedAt = createdAt;
    let entry;
    const result = new Promise((resolve, reject) => {
      entry = {
        input: { ...input, createdAt, title: input.title.trim() },
        resolve,
        reject,
      };
    });
    const next = [...saveQueue, entry];
    persist(state.pending, next);
    saveQueue = next;
    emit({});
    void drainSaves();
    return result;
  }
  async function retrySaved() {
    if (!ownsJournal || state.saving || recoveryError) return;
    if (!state.pending) {
      emit({ queuePaused: false, error: "" });
      await drainSaves();
      return;
    }
    emit({ saving: true, error: "" });
    try {
      await recover();
      if (state.pending) {
        const event = state.pending,
          task = parseTask(event);
        if (!task || event.pubkey !== session.viewer)
          throw new Error("The saved attempt does not belong to this account.");
        await authorize(task);
        signal.throwIfAborted();
        await session.configArtifactWriter.publish(event, signal);
        await recover();
      }
      await refresh();
    } catch (error) {
      if (!signal.aborted) emit({ error: String(error.message || error) });
    } finally {
      emit({ saving: false });
      void drainSaves();
    }
  }
  const unsubscribe = session.subscribeLive(({ events }) => {
    if (
      events.some(
        (event) =>
          (event.kind === 45010 && tag(event, "type") === TYPE) ||
          event.kind === 45011 ||
          ([39e3, 39002].includes(event.kind) &&
            state.tasks.some((task) => task.channel === tag(event, "d"))),
      )
    )
      void refresh();
  });
  return {
    snapshot: () => state,
    channel,
    refresh,
    save,
    retrySaved,
    setAside() {
      if (
        disposed ||
        !ownsJournal ||
        state.saving ||
        state.loading ||
        !state.pending ||
        recoveryError
      )
        return;
      const event = state.pending;
      const remaining =
        saveQueue[0]?.input.id === tag(event, "d")
          ? saveQueue.slice(1)
          : saveQueue;
      const retained = [...aside, event];
      try {
        persist(null, remaining, retained);
        aside = retained;
        saveQueue = remaining;
        emit({ pending: null, queuePaused: false, error: "" });
        void drainSaves();
      } catch (error) {
        emit({ error: String(error.message || error) });
      }
    },
    async checkAside() {
      if (
        disposed ||
        !ownsJournal ||
        state.saving ||
        state.loading ||
        recoveryError
      )
        return;
      emit({ saving: true, error: "" });
      const errors = [];
      for (const event of [...aside]) {
        try {
          const found = await read([
            {
              ids: [event.id],
              kinds: [45010],
              "#h": [tag(event, "h")],
              limit: 1,
              consistency: "strong",
            },
          ]);
          signal.throwIfAborted();
          if (!found.some((item) => item.id === event.id)) continue;
          const retained = aside.filter((item) => item.id !== event.id);
          persist(state.pending, saveQueue, retained);
          aside = retained;
        } catch (error) {
          if (signal.aborted) return;
          errors.push(String(error.message || error));
        }
      }
      emit({ saving: false });
      await refresh();
      if (errors.length) emit({ error: errors.join("; ") });
      void drainSaves();
    },
    retryRecovery() {
      if (disposed || !ownsJournal || !recoveryError) return;
      recoveryError = "";
      restoreJournal();
      emit({ error: recoveryError });
      void refresh();
    },
    damagedJournalText() {
      return ownsJournal ? damagedJournal : null;
    },
    resetDamagedJournal() {
      if (disposed || !ownsJournal || damagedJournal === null || state.saving)
        return false;
      try {
        if (storage.getItem(key) !== damagedJournal)
          throw new Error(
            "Saved tasks changed. Reload before recovering them.",
          );
        const backupKey = `${key}:recovery:${crypto.randomUUID()}`;
        storage.setItem(backupKey, damagedJournal);
        if (storage.getItem(backupKey) !== damagedJournal)
          throw new Error("Could not preserve the saved task backup.");
        storage.removeItem(key);
        damagedJournal = null;
        recoveryError = "";
        saveQueue = [];
        aside = [];
        optimisticTask = null;
        emit({ pending: null, queuePaused: false, error: "" });
        void refresh();
        return true;
      } catch (error) {
        emit({ error: String(error.message || error) });
        return false;
      }
    },
    discardUnsent() {
      if (disposed || !ownsJournal) return;
      if (!state.queuePaused || state.pending || state.saving || recoveryError)
        return;
      const remaining = saveQueue.slice(1);
      try {
        persist(null, remaining);
        saveQueue = remaining;
        emit({ queuePaused: false, error: "" });
        void refresh();
        void drainSaves();
      } catch (error) {
        emit({ error: String(error.message || error) });
      }
    },
    followChannel(id) {
      openChannels.set(id, (openChannels.get(id) ?? 0) + 1);
      void refresh();
      return () => {
        const remaining = openChannels.get(id) - 1;
        if (remaining) openChannels.set(id, remaining);
        else {
          openChannels.delete(id);
          readSets.delete(`channel:${id}`);
          readEpochs.set(id, (readEpochs.get(id) ?? 0) + 1);
        }
      };
    },
    dispose() {
      disposed = true;
      controller.abort();
      releaseJournal();
      unfollow();
      unsubscribe();
    },
  };
}
function apply(ctx) {
  const R = ctx.react,
    h = R.createElement;
  const iconPath =
    "M9 12l2 2l4 -4 M12 3c7.2 0 9 1.8 9 9c0 7.2 -1.8 9 -9 9c-7.2 0 -9 -1.8 -9 -9c0 -7.2 1.8 -9 9 -9";
  const icon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPath}"/></svg>`)}`;
  const Icon = ({ size = "1.25rem" } = {}) =>
    h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: size,
        height: size,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        "aria-hidden": true,
      },
      h("path", {
        d: iconPath,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }),
    );
  const button = (label, onClick, props = {}) =>
    h(
      "button",
      {
        type: "button",
        className: "buzz-button",
        "data-buzz-ui": "",
        "data-variant": "ghost",
        "data-size": "sm",
        "data-disabled": props.disabled ? "" : void 0,
        onClick,
        ...props,
      },
      h("span", { className: "buzz-button-label" }, label),
    );
  const ui = typeof ctx.get === "function" ? ctx.get("ui", false) : ctx.ui;
  const hostError = compatibilityError(ui);
  const listeners = /* @__PURE__ */ new Set();
  let model, relayState, stopChannels;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const bind = () => {
    const next = ctx.relay.snapshot();
    if (
      next.session === relayState?.session &&
      next.status === relayState?.status &&
      next.cached === relayState?.cached
    )
      return;
    model?.dispose();
    stopChannels?.();
    model = void 0;
    relayState = next;
    if (
      !hostError &&
      next.status === "ready" &&
      !next.cached &&
      next.viewer &&
      next.session.snapshotRead
    ) {
      model = createModel(next.session, localStorage, notify);
      stopChannels = next.session.channels.subscribeList(notify);
      void model.refresh();
    }
    notify();
  };
  ctx.effect(() => {
    const stop = ctx.relay.subscribe(bind);
    const focus = () => {
      if (document.visibilityState === "visible") void model?.refresh();
    };
    document.addEventListener("visibilitychange", focus);
    bind();
    return () => {
      stop();
      stopChannels?.();
      model?.dispose();
      document.removeEventListener("visibilitychange", focus);
      listeners.clear();
    };
  });
  function useTasks() {
    R.useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => model?.snapshot() ?? relayState,
    );
    return model;
  }
  const name = (key) => {
    const profile = relayState?.session.profiles.snapshot().get(key);
    return (
      profile?.verified?.fullName?.trim() ||
      profile?.name ||
      `${key.slice(0, 8)}\u2026`
    );
  };
  const chipStyle = {
    background: "var(--accent-3)",
    color: "var(--accent-11)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "2px var(--space-2)",
    fontSize: "14px",
    lineHeight: "20px",
    height: "24px",
    minHeight: 0,
    minWidth: 0,
    width: "auto",
    flex: "0 0 auto",
  };
  function Person({ person, size = 18 }) {
    const [failed, setFailed] = R.useState(false);
    const picture = relayState?.session.profiles
      .snapshot()
      .get(person)?.picture;
    const source =
      typeof picture === "string" && picture.startsWith("https://")
        ? relayState.session.media?.(picture, "small")
        : void 0;
    return h(
      "span",
      {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
        },
      },
      h(
        "span",
        {
          "aria-hidden": true,
          style: {
            width: size,
            height: size,
            borderRadius: "50%",
            overflow: "hidden",
            background: "var(--accent-4)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: 11,
          },
        },
        source && !failed
          ? h("img", {
              src: source,
              alt: "",
              onError: () => setFailed(true),
              style: { width: "100%", height: "100%", objectFit: "cover" },
            })
          : name(person).slice(0, 1),
      ),
      name(person),
    );
  }
  function AssigneePicker({
    value,
    members,
    onChange,
    disabled,
    label,
    placeholder = "Assign\u2026",
  }) {
    const [search, setSearch] = R.useState("");
    const [active, setActive] = R.useState(null);
    const matches = [...new Set(members)].filter((key) =>
      matchesAssignee(relayState?.session.profiles.snapshot().get(key), search),
    );
    const [, refreshProfiles] = R.useReducer((n) => n + 1, 0);
    const memberKey = [...new Set([...members, value].filter(Boolean))].join(
      ":",
    );
    R.useEffect(() => {
      const profiles = relayState?.session.profiles;
      const stop = profiles?.subscribe?.(() => refreshProfiles());
      void profiles
        ?.ensure?.(memberKey.split(":").filter(Boolean), "background")
        ?.catch(() => {});
      return stop;
    }, [memberKey]);
    const id = R.useId(),
      menu = R.useRef(null),
      trigger = R.useRef(null);
    const choose = (key) => {
      onChange(key);
      trigger.current.focus();
      menu.current.hidePopover();
    };
    return h(
      "span",
      { style: { display: "inline-flex" } },
      button(
        value ? h(Person, { key: value, person: value }) : placeholder,
        () => {
          setSearch("");
          setActive(null);
          const rect = trigger.current.getBoundingClientRect();
          menu.current.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 280)}px`;
          menu.current.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 288))}px`;
        },
        {
          ref: trigger,
          popoverTarget: id,
          style: value
            ? { ...chipStyle, paddingLeft: "3px" }
            : {
                ...chipStyle,
                background: "var(--surface-hover)",
                color: "var(--text-muted)",
              },
          disabled,
          "aria-label": label,
        },
      ),
      h(
        "div",
        {
          id,
          ref: menu,
          popover: "auto",
          className: "buzz-popover-popup",
          "data-buzz-ui": "",
          "data-padding": "list",
          "aria-label": "Assign to",
          style: {
            position: "fixed",
            inset: "auto",
            margin: 0,
            width: "280px",
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "260px",
            overflowY: "auto",
          },
          onKeyDown: (event) => {
            if (event.isComposing || event.target.tagName !== "INPUT") return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              event.stopPropagation();
              if (!matches.length) return;
              const index = matches.indexOf(active);
              const next =
                index < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : matches.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      matches.length) %
                    matches.length;
              setActive(matches[next]);
              document
                .getElementById(`${id}-${matches[next]}`)
                ?.scrollIntoView({ block: "nearest" });
            } else if (
              event.key === "Enter" &&
              event.target.tagName === "INPUT"
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (matches.includes(active)) choose(active);
            }
          },
        },
        h("input", {
          className: "buzz-input",
          "data-buzz-ui": "",
          "data-size": "sm",
          "aria-label": "Search people",
          placeholder: "Search people\u2026",
          value: search,
          autoFocus: true,
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": true,
          "aria-controls": `${id}-results`,
          "aria-activedescendant": matches.includes(active)
            ? `${id}-${active}`
            : void 0,
          onChange: (event) => {
            setSearch(event.target.value);
            setActive(null);
          },
          style: { width: "100%" },
        }),
        h(
          "div",
          { id: `${id}-results`, role: "listbox", "aria-label": "People" },
          matches.map((key) =>
            button(h(Person, { person: key, size: 24 }), () => choose(key), {
              key,
              id: `${id}-${key}`,
              role: "option",
              "aria-label": `Assign to ${name(key)}`,
              "aria-selected": active === key,
              "data-variant": active === key ? "subtle" : "ghost",
              style: { width: "100%", justifyContent: "flex-start" },
            }),
          ),
        ),
        !matches.length &&
          h("p", { className: "text-body-sm" }, "No people found"),
      ),
    );
  }
  function DatePicker({ label, value, onChange, triggerProps }) {
    const [open, setOpen] = R.useState(false);
    const popup = R.useRef(null);
    const selected = value
      ? /* @__PURE__ */ new Date(`${value}T12:00:00`)
      : void 0;
    return h(
      "span",
      {
        style: { display: "inline-flex" },
        onBlur: (event) => {
          if (popup.current?.contains(event.relatedTarget))
            event.stopPropagation();
        },
      },
      h(
        ui.PopoverRoot,
        { open, onOpenChange: setOpen },
        h(ui.PopoverTrigger, {
          render: button(label, void 0, triggerProps),
        }),
        h(
          ui.PopoverPopup,
          {
            ref: popup,
            "aria-label": "Choose due date",
            style: { width: "max-content" },
            padding: "list",
            onPointerDown: (event) => event.stopPropagation(),
            onKeyDown: (event) => event.stopPropagation(),
          },
          h(ui.Calendar, {
            mode: "single",
            required: true,
            autoFocus: true,
            selected,
            defaultMonth: selected,
            onSelect: (day) => {
              onChange(
                `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
              );
              setOpen(false);
            },
          }),
        ),
      ),
    );
  }
  function picker(label, type, value, onChange, props = {}) {
    if (type === "date")
      return h(DatePicker, {
        key: props.key,
        label,
        value,
        onChange,
        triggerProps: props,
      });
    return h(TimePicker, {
      key: props.key,
      label,
      value,
      onChange,
      triggerProps: props,
    });
  }
  function TimeColumn({ name: name2, value, count, onChange }) {
    const list = R.useRef(null);
    R.useLayoutEffect(() => {
      const selected = list.current?.querySelector('[aria-selected="true"]');
      if (selected)
        list.current.scrollTop =
          selected.offsetTop -
          (list.current.clientHeight - selected.offsetHeight) / 2;
    }, []);
    return h(
      "div",
      {
        ref: list,
        role: "listbox",
        "aria-label": name2,
        style: {
          height: "10rem",
          width: "5rem",
          overflowY: "auto",
          overscrollBehavior: "contain",
          position: "relative",
        },
        onKeyDown: (event) => {
          const index = Number(event.target.dataset.value);
          const next =
            event.key === "ArrowDown"
              ? Math.min(count - 1, index + 1)
              : event.key === "ArrowUp"
                ? Math.max(0, index - 1)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? count - 1
                    : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          onChange(String(next).padStart(2, "0"));
          const option = list.current.children[next];
          option.focus({ preventScroll: true });
          option.scrollIntoView({ block: "nearest" });
        },
      },
      ...Array.from({ length: count }, (_, index) => {
        const text = String(index).padStart(2, "0");
        return button(text, () => onChange(text), {
          key: text,
          role: "option",
          "aria-selected": value === text,
          "data-value": index,
          tabIndex: value === text ? 0 : -1,
          "data-variant": value === text ? "subtle" : "ghost",
          style: {
            width: "100%",
            minHeight: "2rem",
            fontVariantNumeric: "tabular-nums",
          },
        });
      }),
    );
  }
  function TimePicker({ label, value, onChange, triggerProps }) {
    const [open, setOpen] = R.useState(false);
    const [hour, setHour] = R.useState("09");
    const [minute, setMinute] = R.useState("00");
    const popup = R.useRef(null);
    const valid =
      /^\d{1,2}$/.test(hour) &&
      Number(hour) < 24 &&
      /^\d{1,2}$/.test(minute) &&
      Number(minute) < 60;
    const commit = () => {
      if (!valid) return;
      onChange(`${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`);
      setOpen(false);
    };
    return h(
      "span",
      {
        style: { display: "inline-flex" },
        onBlur: (event) => {
          if (popup.current?.contains(event.relatedTarget))
            event.stopPropagation();
        },
      },
      h(
        ui.PopoverRoot,
        {
          open,
          onOpenChange: (next) => {
            if (next) {
              const parts = (value || "09:00").split(":");
              setHour(parts[0]);
              setMinute(parts[1]);
            }
            setOpen(next);
          },
        },
        h(ui.PopoverTrigger, {
          render: button(label, void 0, triggerProps),
        }),
        h(
          ui.PopoverPopup,
          {
            ref: popup,
            "aria-label": "Choose time",
            style: { width: "max-content" },
            onPointerDown: (event) => event.stopPropagation(),
            onKeyDown: (event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            },
          },
          h(
            "div",
            { style: { display: "flex", gap: "var(--space-3)" } },
            h(TimeColumn, {
              name: "Hours",
              value: hour,
              count: 24,
              onChange: setHour,
            }),
            h(TimeColumn, {
              name: "Minutes",
              value: minute,
              count: 60,
              onChange: setMinute,
            }),
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "var(--space-4)",
              },
            },
            button("Set time", commit, {
              disabled: !valid,
              "data-variant": "prominent",
            }),
          ),
        ),
      ),
    );
  }
  function TaskRow({
    task: savedTask,
    showAssignee,
    owner,
    disabled,
    retainCompleted,
    removeCompleted,
  }) {
    const [draft, setDraft] = R.useState(null);
    const draftRef = R.useRef(null);
    const task = draft ?? savedTask;
    const beginEdit = () => {
      if (!draftRef.current && !disabled) {
        draftRef.current = { ...savedTask };
        setDraft(draftRef.current);
      }
    };
    const finishEdit = async (patch = {}) => {
      const original = draftRef.current;
      const next = original && { ...original, ...patch };
      if (!next) return;
      draftRef.current = null;
      const title = titleElement.current.textContent.trim() || savedTask.title;
      setDraft(null);
      let admitted = false;
      try {
        if (JSON.stringify({ ...next, title }) !== JSON.stringify(savedTask)) {
          const saving = owner.save({ ...next, title });
          admitted = true;
          await saving;
        }
        if (titleElement.current && !draftRef.current)
          titleElement.current.textContent = title;
      } catch (error2) {
        if (!admitted) {
          if (!draftRef.current) {
            draftRef.current = { ...original, title };
            setDraft(draftRef.current);
          }
          setError(error2.message);
        }
      }
    };
    const [error, setError] = R.useState("");
    const titleElement = R.useRef(null);
    R.useEffect(() => {
      if (
        titleElement.current &&
        document.activeElement !== titleElement.current
      )
        titleElement.current.textContent = task.title;
    }, [task.title]);
    const metadataChip = (label, patch, control, removable = true) =>
      h(
        "span",
        {
          className: draft && removable ? "task-edit-chip" : void 0,
          style: { display: "inline-flex", alignItems: "center" },
        },
        control,
        draft &&
          removable &&
          button(
            h(
              "svg",
              {
                width: 14,
                height: 14,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "aria-hidden": true,
              },
              h("path", { d: "M18 6l-12 12M6 6l12 12" }),
            ),
            () => {
              titleElement.current?.focus();
              void save(patch);
            },
            {
              "aria-label": label,
              disabled,
              style: {
                ...chipStyle,
                paddingLeft: "calc(var(--space-2) - 2px)",
              },
            },
          ),
      );
    const titleStyle = {
      fontSize: "var(--text-label)",
      fontWeight: "var(--text-label--font-weight)",
      letterSpacing: "var(--text-label--letter-spacing)",
      lineHeight: "24px",
      padding: 0,
      border: 0,
      background: "transparent",
      color: "var(--text-standard)",
      width: "100%",
      minHeight: 0,
      borderRadius: 0,
      textAlign: "left",
    };
    const row = R.useRef(null);
    R.useEffect(() => {
      if (!draft) return;
      const leaveRow = (event) => {
        if (!row.current?.contains(event.target)) void finishEdit();
      };
      document.addEventListener("pointerdown", leaveRow);
      return () => document.removeEventListener("pointerdown", leaveRow);
    });
    const rowHeight = R.useRef(null);
    const resizeAnimation = R.useRef(null);
    R.useLayoutEffect(() => {
      const element = row.current;
      const from =
        resizeAnimation.current?.playState === "running"
          ? element.getBoundingClientRect().height
          : rowHeight.current;
      resizeAnimation.current?.cancel();
      const to = element.getBoundingClientRect().height;
      rowHeight.current = to;
      if (
        from !== null &&
        from !== to &&
        !task.done &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        resizeAnimation.current = element.animate(
          [{ height: `${from}px` }, { height: `${to}px` }],
          { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
        );
      }
    });
    R.useEffect(() => () => resizeAnimation.current?.cancel(), []);
    R.useEffect(() => {
      if (!task.done) return;
      let animation;
      const timer = setTimeout(() => {
        const element = row.current;
        if (!element) return;
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        animation = element.animate(
          [
            {
              height: `${element.getBoundingClientRect().height}px`,
              opacity: 1,
              transform: "scale(1)",
            },
            {
              height: "0px",
              paddingTop: "0px",
              paddingBottom: "0px",
              opacity: 0,
              transform: reduced ? "none" : "scale(.95)",
            },
          ],
          {
            duration: reduced ? 0 : 220,
            easing: "cubic-bezier(0.23, 1, 0.32, 1)",
            fill: "forwards",
          },
        );
        animation.finished.then(() => removeCompleted(task.id)).catch(() => {});
      }, 3e3);
      return () => {
        clearTimeout(timer);
        animation?.cancel();
      };
    }, [task.done, task.id, removeCompleted]);
    const save = async (patch) => {
      if (!("done" in patch)) {
        draftRef.current = { ...(draftRef.current ?? task), ...patch };
        setDraft(draftRef.current);
        return;
      }
      if (draftRef.current) {
        await finishEdit(patch);
        return;
      }
      setError("");
      try {
        await owner.save({ ...task, ...patch });
        titleElement.current.textContent = patch.title ?? task.title;
      } catch (error2) {
        setError(error2.message);
      }
    };
    const saveDue = (date, time) => {
      try {
        setError("");
        void save(dueValue(date, time));
      } catch (error2) {
        setError(error2.message);
      }
    };
    const members = owner.channel(task.channel)?.members ?? [relayState.viewer];
    const due = task.dueAt
      ? new Date(task.dueAt)
      : task.dueDate
        ? /* @__PURE__ */ new Date(`${task.dueDate}T12:00:00`)
        : null;
    const today = dueInputs({
      dueAt: /* @__PURE__ */ new Date().toISOString(),
    }).date;
    const overdue =
      !task.done &&
      (task.dueAt
        ? Date.parse(task.dueAt) < Date.now()
        : task.dueDate && task.dueDate < today);
    return h(
      "li",
      {
        ref: row,
        className: `task-row${task.done ? " task-row-completed" : ""}${draft ? " task-row-editing" : ""}`,
        onFocusCapture: (event) => {
          if (event.target.type !== "checkbox") beginEdit();
        },
        onPointerDown: (event) => {
          const target = event.target.closest("button");
          if (target) {
            event.preventDefault();
            target.focus();
          }
        },
        onBlur: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            void finishEdit();
        },
        style: {
          boxSizing: "border-box",
          overflow: "hidden",
          transformOrigin: "top left",
          listStyle: "none",
          padding: "var(--space-3) 0",
          display: "flex",
          gap: "var(--space-3)",
          alignItems: "flex-start",
        },
      },
      h(
        "span",
        {
          style: {
            position: "relative",
            width: "1.5rem",
            height: "1.5rem",
            flexShrink: 0,
            marginTop: 0,
          },
        },
        h("input", {
          type: "checkbox",
          className: "buzz-checkbox",
          "data-buzz-ui": "",
          "data-checked": task.done ? "" : void 0,
          "data-disabled": disabled ? "" : void 0,
          checked: task.done,
          disabled,
          "aria-label": `${task.done ? "Reopen" : "Complete"} ${task.title}`,
          onChange: (e) => {
            if (e.target.checked) retainCompleted(task.id);
            void save({ done: e.target.checked });
          },
          style: {
            appearance: "none",
            width: "1.5rem",
            height: "1.5rem",
            margin: 0,
            borderRadius: "0.5rem",
            cornerShape: "round",
            borderWidth: "2px",
          },
        }),
        task.done &&
          h("span", {
            className: "task-check-fill",
            "aria-hidden": true,
            style: {
              position: "absolute",
              inset: 0,
              borderRadius: "0.5rem",
              background: "var(--accent-9)",
              pointerEvents: "none",
            },
          }),
        task.done &&
          h(
            "svg",
            {
              className: "task-check-mark",
              viewBox: "0 0 24 24",
              "aria-hidden": true,
              style: {
                position: "absolute",
                inset: "0.25rem",
                width: "1rem",
                height: "1rem",
                pointerEvents: "none",
                color: "var(--text-on-prominent)",
              },
              fill: "none",
              stroke: "currentColor",
              strokeWidth: 2,
            },
            h("path", {
              d: "M5 12l4 4L19 6",
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }),
          ),
      ),
      h(
        "div",
        { style: { flex: 1, minWidth: 0 } },
        h("span", {
          ref: titleElement,
          className: "text-label",
          role: "textbox",
          "aria-label": `Edit title: ${task.title}`,
          "aria-readonly": disabled,
          contentEditable: disabled ? false : "plaintext-only",
          suppressContentEditableWarning: true,
          onKeyDown: (event) => {
            if (event.isComposing || event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              draftRef.current = null;
              setDraft(null);
              event.currentTarget.textContent = savedTask.title;
              event.currentTarget.blur();
            }
          },
          style: {
            ...titleStyle,
            display: "block",
            outline: "none",
            cursor: "text",
            overflowWrap: "anywhere",
            textDecoration: task.done ? "line-through" : void 0,
            color: task.done ? "var(--text-muted)" : "var(--text-standard)",
          },
        }),
        (draft ||
          due ||
          task.dueTime ||
          (showAssignee && task.assignees.length > 0)) &&
          h(
            "div",
            {
              className: "text-body-sm task-metadata",
              style: {
                display: "flex",
                gap: "var(--space-2)",
                alignItems: "center",
                flexWrap: "wrap",
                color: "var(--text-muted)",
                marginTop: "var(--space-1)",
                minHeight: "24px",
              },
            },
            ["date", "time"].map((kind) => {
              const selected =
                kind === "date" ? due : task.dueAt || task.dueTime;
              if (!selected && !draft) return null;
              return h(
                "span",
                { key: kind, style: { display: "inline-flex" } },
                (() => {
                  if (selected)
                    return kind === "date"
                      ? metadataChip(
                          "Remove date",
                          dueValue("", ""),
                          picker(
                            h(
                              "span",
                              {
                                style: {
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "var(--space-1)",
                                },
                              },
                              h(
                                "svg",
                                {
                                  width: 14,
                                  height: 14,
                                  viewBox: "0 0 24 24",
                                  fill: "none",
                                  stroke: "currentColor",
                                  strokeWidth: 2,
                                  strokeLinecap: "round",
                                  strokeLinejoin: "round",
                                  "aria-hidden": true,
                                },
                                h("path", {
                                  d: "M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12M16 3v4M8 3v4M4 11h16",
                                }),
                              ),
                              h(
                                "time",
                                { dateTime: task.dueAt || task.dueDate },
                                `${due.getDate()} ${due.toLocaleDateString("en-GB", { month: "short" })}${due.getFullYear() !== /* @__PURE__ */ new Date().getFullYear() ? ` ${due.getFullYear()}` : ""}, ${due.toLocaleDateString("en-GB", { weekday: "short" })}`,
                              ),
                            ),
                            "date",
                            dueInputs(task).date,
                            (value) => saveDue(value, dueInputs(task).time),
                            {
                              style: draft
                                ? chipStyle
                                : {
                                    ...chipStyle,
                                    background: "transparent",
                                    color: "var(--text-muted)",
                                    padding: 0,
                                    height: "20px",
                                    borderRadius: 0,
                                  },
                              disabled,
                              "aria-label": `Change date for ${task.title}`,
                              title: overdue ? "Overdue" : "Due date",
                            },
                          ),
                        )
                      : metadataChip(
                          "Remove time",
                          dueValue(dueInputs(task).date, ""),
                          picker(
                            h(
                              "span",
                              {
                                style: {
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "var(--space-1)",
                                },
                              },
                              h(
                                "svg",
                                {
                                  width: 14,
                                  height: 14,
                                  viewBox: "0 0 24 24",
                                  fill: "none",
                                  stroke: "currentColor",
                                  strokeWidth: 2,
                                  strokeLinecap: "round",
                                  strokeLinejoin: "round",
                                  "aria-hidden": true,
                                },
                                h("circle", { cx: 12, cy: 12, r: 9 }),
                                h("path", { d: "M12 7v5l3 3" }),
                              ),
                              !draft && "at ",
                              (
                                due ||
                                /* @__PURE__ */ new Date(
                                  `2000-01-01T${task.dueTime}:00`,
                                )
                              ).toLocaleTimeString(void 0, {
                                hour: "numeric",
                                minute: "2-digit",
                              }),
                            ),
                            "time",
                            dueInputs(task).time,
                            (value) => saveDue(dueInputs(task).date, value),
                            {
                              style: draft
                                ? chipStyle
                                : {
                                    ...chipStyle,
                                    background: "transparent",
                                    color: "var(--text-muted)",
                                    padding: 0,
                                    height: "20px",
                                    borderRadius: 0,
                                  },
                              disabled,
                              "aria-label": `Change time for ${task.title}`,
                              title:
                                Intl.DateTimeFormat().resolvedOptions()
                                  .timeZone,
                            },
                          ),
                        );
                  return picker(
                    h(
                      "span",
                      {
                        style: {
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "var(--space-1)",
                        },
                      },
                      h(
                        "svg",
                        {
                          width: 14,
                          height: 14,
                          viewBox: "0 0 24 24",
                          fill: "none",
                          stroke: "currentColor",
                          strokeWidth: 2,
                          strokeLinecap: "round",
                          strokeLinejoin: "round",
                          "aria-hidden": true,
                        },
                        h("path", {
                          d:
                            kind === "date"
                              ? "M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12M16 3v4M8 3v4M4 11h16"
                              : "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0 -18M12 7v5l3 3",
                        }),
                      ),
                      `Add ${kind}`,
                    ),
                    kind,
                    "",
                    (value) => {
                      saveDue(
                        kind === "date" ? value : dueInputs(task).date,
                        kind === "time" ? value : dueInputs(task).time,
                      );
                    },
                    {
                      key: kind,
                      disabled,
                      "aria-label": `Add ${kind} for ${task.title}`,
                      style: {
                        ...chipStyle,
                        background: "var(--surface-hover)",
                        color: "var(--text-muted)",
                      },
                    },
                  );
                })(),
              );
            }),
            showAssignee &&
              !owner.snapshot().personal.includes(task.channel) &&
              (draft || task.assignees.length > 0) &&
              metadataChip(
                "Remove assignee",
                { assignees: [] },
                h(AssigneePicker, {
                  label: `Assign ${task.title}`,
                  placeholder: "Assign to someone",
                  value: task.assignees[0] ?? "",
                  members,
                  disabled,
                  onChange: (key) => void save({ assignees: key ? [key] : [] }),
                }),
                task.assignees.length > 0,
              ),
          ),
        error && h("p", { role: "alert", className: "text-body-sm" }, error),
      ),
    );
  }
  function AddTask({ owner, channelId, autoFocus = false, onDraftChange }) {
    const [focused, setFocused] = R.useState(false);
    const [destination, setDestination] = R.useState(channelId ?? "");
    const [date, setDate] = R.useState(""),
      [time, setTime] = R.useState("");
    const [title, setTitle] = R.useState(""),
      [assignee, setAssignee] = R.useState(""),
      [error, setError] = R.useState("");
    const id = R.useId(),
      state = owner.snapshot();
    R.useEffect(() => {
      onDraftChange?.(
        !!(
          title ||
          date ||
          time ||
          assignee ||
          destination !== (channelId ?? "")
        ),
      );
    }, [title, date, time, assignee, destination, channelId, onDraftChange]);
    const destinationMenu = R.useRef(null);
    const disabled =
      state.loading || state.readOnly || (!!state.pending && !state.saving);
    const channel = destination ? owner.channel(destination) : void 0;
    const saving = R.useRef(false);
    const removableChip = (kind, selected, clear, control) =>
      h(
        "span",
        {
          key: kind,
          className: selected ? "task-edit-chip" : void 0,
          style: { display: "inline-flex", alignItems: "center" },
        },
        control,
        selected &&
          button(
            h(
              "svg",
              {
                width: 14,
                height: 14,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2,
                strokeLinecap: "round",
                "aria-hidden": true,
              },
              h("path", { d: "M18 6l-12 12M6 6l12 12" }),
            ),
            () => {
              document.getElementById(id)?.focus();
              clear();
            },
            {
              "aria-label": `Remove ${kind}`,
              disabled,
              style: {
                ...chipStyle,
                paddingLeft: "calc(var(--space-2) - 2px)",
              },
            },
          ),
      );
    const submit = async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        if (!title.trim() || disabled) return;
        setError("");
        let admitted = false;
        try {
          const savingTask = owner.save({
            id: crypto.randomUUID(),
            channel: destination || void 0,
            title,
            done: false,
            ...dueValue(date, time),
            assignees: assignee ? [assignee] : [],
          });
          admitted = true;
          setTitle("");
          setDate("");
          setTime("");
          setAssignee("");
          setFocused(false);
          saving.current = false;
          await savingTask;
        } catch (error2) {
          if (!admitted) setError(error2.message);
        }
      } finally {
        saving.current = false;
      }
    };
    return h(
      "form",
      {
        onPointerDown: (event) => {
          const target = event.target.closest("button");
          if (target) {
            event.preventDefault();
            target.focus();
          }
        },
        onSubmit: (event) => {
          event.preventDefault();
          void submit();
        },
        onFocusCapture: () => setFocused(true),
        onBlur: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(false);
            void submit();
          }
        },
        style: {
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "var(--space-3)",
          marginBottom: "var(--space-6)",
        },
      },
      h("input", {
        type: "checkbox",
        className: "buzz-checkbox",
        "data-buzz-ui": "",
        "aria-label": "New task checkbox",
        checked: false,
        disabled: true,
        style: {
          appearance: "none",
          width: "1.5rem",
          height: "1.5rem",
          margin: 0,
          borderRadius: "0.5rem",
          borderWidth: "2px",
          flexShrink: 0,
        },
      }),
      h("input", {
        id,
        className: "buzz-input",
        "data-buzz-ui": "",
        "data-size": "md",
        value: title,
        maxLength: 500,
        "aria-label": destination ? "New channel task" : "New personal task",
        placeholder: "New task",
        autoFocus,
        disabled,
        onChange: (event) => setTitle(event.target.value),
        style: {
          flex: "1 1 14rem",
          minWidth: 0,
          background: "transparent",
          border: "none",
          padding: 0,
          height: "24px",
          minHeight: 0,
          lineHeight: "24px",
          borderRadius: 0,
          fontSize: "var(--text-label)",
          fontWeight: "var(--text-label--font-weight)",
          letterSpacing: "var(--text-label--letter-spacing)",
        },
      }),
      h("button", { type: "submit", hidden: true }, "Save task"),
      (focused || title.trim() || date || time) &&
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "var(--space-2)",
              flexWrap: "wrap",
              width: "100%",
              marginLeft: "calc(1.5rem + var(--space-3))",
            },
          },
          h(
            "span",
            { style: { display: "inline-flex" } },
            button(
              destination ? `# ${channel?.name ?? "Channel"}` : "Personal",
              (event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                destinationMenu.current.style.top = `${rect.bottom + 6}px`;
                destinationMenu.current.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;
              },
              {
                "aria-label": "Task destination",
                popoverTarget: `${id}-destination`,
                disabled,
                style: chipStyle,
              },
            ),
            h(
              "div",
              {
                id: `${id}-destination`,
                ref: destinationMenu,
                popover: "auto",
                className: "buzz-popover-popup",
                "data-buzz-ui": "",
                "data-padding": "list",
                "aria-label": "Choose task destination",
                style: {
                  position: "fixed",
                  inset: "auto",
                  margin: 0,
                  width: "232px",
                  maxHeight: "260px",
                  overflowY: "auto",
                },
              },
              [
                { id: "", name: "Personal" },
                ...relayState.session.channels
                  .list()
                  .channels.filter(
                    (item) =>
                      !item.readOnly && !state.personal.includes(item.id),
                  ),
              ].map((item) =>
                button(
                  item.id ? `# ${item.name ?? "Channel"}` : "Personal",
                  () => {
                    setDestination(item.id);
                    setAssignee("");
                    document
                      .querySelector(`[popoverTarget="${id}-destination"]`)
                      ?.focus();
                    destinationMenu.current.hidePopover();
                  },
                  {
                    key: item.id,
                    "aria-pressed": destination === item.id,
                    style: { width: "100%", justifyContent: "flex-start" },
                  },
                ),
              ),
            ),
          ),
          ...["date", "time"].map((kind) =>
            removableChip(
              kind,
              kind === "date" ? date : time,
              () => {
                if (kind === "date") {
                  setDate("");
                  setTime("");
                } else setTime("");
              },
              picker(
                h(
                  "span",
                  {
                    style: {
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                    },
                  },
                  h(
                    "svg",
                    {
                      width: 14,
                      height: 14,
                      viewBox: "0 0 24 24",
                      fill: "none",
                      stroke: "currentColor",
                      strokeWidth: 2,
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      "aria-hidden": true,
                    },
                    h("path", {
                      d:
                        kind === "date"
                          ? "M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12M16 3v4M8 3v4M4 11h16"
                          : "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0 -18M12 7v5l3 3",
                    }),
                  ),
                  (kind === "date"
                    ? date
                    : time &&
                      /* @__PURE__ */ new Date(
                        `2000-01-01T${time}:00`,
                      ).toLocaleTimeString(void 0, {
                        hour: "numeric",
                        minute: "2-digit",
                      })) || `Add ${kind}`,
                ),
                kind,
                kind === "date" ? date : time,
                (value) => {
                  if (kind === "date") {
                    setDate(value);
                    if (!value) setTime("");
                  } else {
                    setTime(value);
                    if (value && !date)
                      setDate(
                        dueInputs({
                          dueAt: /* @__PURE__ */ new Date().toISOString(),
                        }).date,
                      );
                  }
                },
                {
                  key: kind,
                  style: (kind === "date" ? date : time)
                    ? chipStyle
                    : {
                        ...chipStyle,
                        background: "var(--surface-hover)",
                        color: "var(--text-muted)",
                      },
                },
              ),
            ),
          ),
          destination &&
            removableChip(
              "assignee",
              assignee,
              () => setAssignee(""),
              h(AssigneePicker, {
                label: "Assign new task",
                placeholder: "Assign to someone",
                value: assignee,
                members: channel?.members ?? [relayState.viewer],
                disabled,
                onChange: setAssignee,
              }),
            ),
        ),
      error &&
        h(
          "p",
          {
            role: "alert",
            className: "text-body-sm",
            style: { flexBasis: "100%" },
          },
          error,
        ),
    );
  }
  function Tasks({ channelId, scope }) {
    const owner = useTasks();
    R.useEffect(
      () =>
        channelId && owner && (!scope || scope === relayState.scope)
          ? owner.followChannel(channelId)
          : void 0,
      [owner, channelId, scope],
    );
    const [completed, setCompleted] = R.useState(
      () => /* @__PURE__ */ new Set(),
    );
    const retainCompleted = R.useCallback(
      (id) =>
        setCompleted((previous) => /* @__PURE__ */ new Set([...previous, id])),
      [],
    );
    const removeCompleted = R.useCallback(
      (id) =>
        setCompleted((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        }),
      [],
    );
    const [creating, setCreating] = R.useState(false);
    const [hasDraft, setHasDraft] = R.useState(false);
    const [confirmReset, setConfirmReset] = R.useState(false);
    const [showBackup, setShowBackup] = R.useState(false);
    if (hostError)
      return h(
        "section",
        {
          "aria-label": "To-do",
          style: { padding: "var(--space-panel-inset)" },
        },
        h("p", { role: "alert" }, hostError),
      );
    if (!owner || (scope && scope !== relayState.scope))
      return h(
        "p",
        { role: "status", style: { padding: "var(--space-panel-inset)" } },
        "Connect to this community to see your tasks.",
      );
    const state = owner.snapshot(),
      personal = new Set(state.personal);
    const selected = state.tasks.filter((task) =>
      channelId
        ? task.channel === channelId
        : !task.channel ||
          personal.has(task.channel) ||
          task.assignees.includes(relayState.session.viewer),
    );
    const visible = selected.filter(
      (task) => !task.done || completed.has(task.id),
    );
    const groups = /* @__PURE__ */ new Map();
    if (!channelId) groups.set("personal", []);
    for (const task of visible) {
      const group =
        !task.channel || personal.has(task.channel) ? "personal" : task.channel;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(task);
    }
    const disabled = state.loading || state.readOnly;
    if (
      !visible.length &&
      !creating &&
      !hasDraft &&
      !state.loading &&
      !state.error &&
      !state.pending &&
      !state.asideCount &&
      !state.queuePaused &&
      !state.readOnly &&
      !state.partial
    ) {
      return h(
        "section",
        {
          "aria-label": "To-do",
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            minHeight: 0,
            padding: "var(--space-panel-inset)",
          },
        },
        h(
          "div",
          {
            className: "buzz-empty-state",
            "data-buzz-ui": "",
            "data-frame": "none",
          },
          h(
            "div",
            { className: "buzz-empty-state-content" },
            h(
              "span",
              { className: "buzz-empty-state-icon", "aria-hidden": true },
              h(Icon),
            ),
            h(
              "div",
              { className: "buzz-empty-state-copy" },
              h(
                "h3",
                { className: "buzz-empty-state-title" },
                "You don't have anything to do.",
              ),
            ),
            h(
              "div",
              { className: "buzz-empty-state-action" },
              button("New task", () => setCreating(true), {
                "data-variant": "prominent",
              }),
            ),
          ),
        ),
      );
    }
    return h(
      "section",
      {
        className: "panel",
        "data-buzz-surface": "",
        "data-shape": "panel",
        "aria-label": "To-do",
        style: {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          color: "var(--text-standard)",
        },
      },
      h(
        "style",
        null,
        ".task-row { position: relative; } .task-row:not(:last-child)::after { content: ''; position: absolute; bottom: 0; left: calc(1.5rem + var(--space-3)); right: calc(1.5rem + var(--space-3)); height: 1px; background: var(--border-standard); opacity: .5; pointer-events: none; transition: opacity var(--duration-fast) ease-out; } .task-row.task-row-editing::after, .task-row:has(+ .task-row-editing)::after { opacity: 0; } @media (prefers-reduced-motion: reduce) { .task-row:not(:last-child)::after { transition: none; } } .task-edit-chip { background: var(--accent-3); border-radius: var(--radius-sm); } .task-edit-chip > .buzz-button, .task-edit-chip > span > .buzz-button { background: transparent !important; } .task-edit-chip > span > .buzz-button { padding-right: 0 !important; } .task-row:not(.task-row-editing) .task-metadata .buzz-button { background: transparent !important; color: var(--text-muted) !important; font-size: 14px !important; height: 20px !important; padding: 0 !important; } .task-row:not(.task-row-editing) .task-metadata svg { display: none; } @keyframes task-check-in { from { transform: scale(.5); opacity: 0; } to { transform: scale(1); opacity: 1; } } .task-check-fill, .task-check-mark { animation: task-check-in 220ms cubic-bezier(0.23, 1, 0.32, 1); transform-origin: center; } .task-row-completed .buzz-checkbox { background: transparent; } @media (prefers-reduced-motion: reduce) { .task-check-fill, .task-check-mark { animation: none; } } .tasks-group > summary::-webkit-details-marker { display: none; } .tasks-group[open] > summary .tasks-section-chevron { transform: rotate(90deg); }",
      ),
      h(
        "div",
        {
          style: {
            overflowY: "auto",
            paddingTop: "var(--space-6)",
            paddingBottom: "var(--space-panel-inset)",
            paddingInline: "calc(var(--space-1) + var(--space-2))",
            flex: 1,
          },
        },
        h(
          "div",
          { style: { marginRight: "max(0px, (100% - 52rem) / 2)" } },
          state.pending &&
            !state.saving &&
            !state.loading &&
            h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-3)",
                  flexWrap: "wrap",
                  marginBottom: "var(--space-5)",
                },
              },
              state.pending &&
                !state.saving &&
                button("Check save", () => void owner.refresh(), {
                  disabled: state.saving,
                }),
            ),
          state.readOnly &&
            !state.error &&
            !state.loading &&
            h(
              "p",
              { role: "status" },
              "To-do is open in another Buzz window. Close that window to edit here.",
            ),
          state.error &&
            h(
              "div",
              null,
              h("p", { role: "alert" }, state.error),
              (!state.recoveryBlocked || state.canRetryRecovery) &&
                button(
                  "Retry",
                  () =>
                    void (state.recoveryBlocked
                      ? owner.retryRecovery()
                      : state.queuePaused
                        ? owner.retrySaved()
                        : owner.refresh()),
                  {
                    disabled: state.saving,
                  },
                ),
            ),
          state.canResetJournal &&
            h(
              "div",
              null,
              h(
                "p",
                null,
                "Back up the unreadable local journal and start a new one. Unsent drafts will leave this list but remain in the backup on this device. Previously sent tasks may still arrive; check the list before recreating them.",
              ),
              button("Show saved task backup", () => setShowBackup(true)),
              showBackup &&
                h(
                  "label",
                  null,
                  "Copy this plaintext backup to a safe location. It may include tasks from channels you can no longer access.",
                  h("textarea", {
                    "aria-label": "Saved task backup",
                    readOnly: true,
                    value: owner.damagedJournalText() ?? "",
                    onFocus: (event) => event.currentTarget.select(),
                    style: {
                      display: "block",
                      width: "100%",
                      boxSizing: "border-box",
                    },
                  }),
                ),
              confirmReset
                ? h(
                    "div",
                    null,
                    button("Back up and reset saved tasks", () => {
                      if (owner.resetDamagedJournal()) setConfirmReset(false);
                    }),
                    button("Cancel", () => setConfirmReset(false)),
                  )
                : button("Recover saved tasks", () => setConfirmReset(true)),
            ),
          state.pending &&
            !state.saving &&
            !state.loading &&
            h(
              "p",
              { role: "status" },
              "A task save is still unconfirmed. Check its outcome or retry the same saved task.",
            ),
          state.pending &&
            !state.saving &&
            !state.loading &&
            h(
              "div",
              null,
              h(
                "p",
                null,
                "Set this save aside to continue with other tasks. It may still arrive. Its saved attempt is kept on this device; this task cannot be edited until delivery is confirmed.",
              ),
              button("Set aside and continue", () => owner.setAside()),
            ),
          state.asideCount > 0 &&
            h(
              "div",
              null,
              h(
                "p",
                { role: "status" },
                `${state.asideCount} unconfirmed save(s) set aside. They may still arrive; avoid creating replacement tasks.`,
              ),
              button("Check set-aside saves", () => void owner.checkAside(), {
                disabled: state.saving || state.loading || state.readOnly,
              }),
            ),
          (state.pending || state.queuePaused) &&
            !state.saving &&
            !state.loading &&
            button("Retry saved task", () => void owner.retrySaved(), {
              disabled: state.saving,
            }),
          state.queuePaused &&
            !state.saving &&
            h(
              "div",
              null,
              h(
                "p",
                { role: "status" },
                `\u201C${state.queuedTitle}\u201D is saved on this device but has not been sent.`,
              ),
              button("Discard unsent task", () => owner.discardUnsent()),
            ),
          state.partial &&
            h(
              "p",
              { role: "status" },
              "Showing up to 500 tasks per list. Some tasks may be missing from this first version.",
            ),
          h(AddTask, {
            key: channelId || "personal",
            autoFocus: creating,
            onDraftChange: setHasDraft,
            owner,
            channelId,
          }),
          [...groups]
            .filter(([, tasks]) => tasks.length)
            .map(([id, tasks]) =>
              h(
                channelId ? "div" : "details",
                {
                  open: channelId ? void 0 : true,
                  className: "tasks-group",
                  key: id,
                  style: {
                    marginBottom: "var(--space-6)",
                  },
                  "aria-label":
                    id === "personal"
                      ? "Personal tasks"
                      : (owner.channel(id)?.name ?? "To-do"),
                },
                channelId &&
                  h(
                    "h3",
                    {
                      className: "navigation-section-label",
                      style: { margin: 0 },
                    },
                    `# ${owner.channel(channelId)?.name ?? "Channel"}`,
                  ),
                !channelId &&
                  h(
                    "summary",
                    {
                      style: {
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        listStyle: "none",
                        color: "var(--text-subtle)",
                      },
                    },
                    h(
                      "span",
                      {
                        className: "navigation-section-label",
                        style: { margin: 0 },
                      },
                      id === "personal"
                        ? "Personal"
                        : `# ${owner.channel(id)?.name ?? "Channel"}`,
                    ),
                    h(
                      "svg",
                      {
                        className: "tasks-section-chevron",
                        width: 16,
                        height: 16,
                        viewBox: "0 0 24 24",
                        fill: "none",
                        stroke: "currentColor",
                        strokeWidth: 2,
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                        "aria-hidden": true,
                      },
                      h("path", { d: "M9 6l6 6l-6 6" }),
                    ),
                  ),
                h(
                  "ul",
                  { style: { padding: 0, margin: 0 } },
                  tasks.map((task) =>
                    h(TaskRow, {
                      key: task.id,
                      task,
                      showAssignee: Boolean(channelId),
                      owner,
                      retainCompleted,
                      removeCompleted,
                      disabled:
                        disabled ||
                        state.savingIds?.includes(task.id) ||
                        state.asideIds?.includes(task.id) ||
                        (!!state.pending &&
                          parseTask(state.pending)?.id === task.id) ||
                        !!owner.channel(task.channel)?.readOnly,
                    }),
                  ),
                ),
                !tasks.length &&
                  !state.loading &&
                  h(
                    "p",
                    {
                      className: "text-body-sm",
                      style: {
                        color: "var(--text-muted)",
                        margin: "var(--space-3) 0",
                      },
                    },
                    "Nothing to do here yet.",
                  ),
              ),
            ),
        ),
      ),
    );
  }
  ctx.pages.register({
    id: "personal",
    title: "To-do",
    icon,
    primary: true,
    placement: "sidebar",
    conversationNavigation: true,
    layout: "workspace",
    component: () =>
      h(
        "section",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: 0,
          },
        },
        h(
          "header",
          {
            className: "panel-header",
            "data-buzz-ui": "",
            "data-variant": "default",
          },
          h(
            "div",
            { className: "panel-header-title" },
            h(
              "div",
              { className: "panel-header-label" },
              h(
                "span",
                { className: "panel-header-label-icon" },
                h(Icon, { size: "1rem" }),
              ),
              h("h2", null, "To-do"),
            ),
          ),
        ),
        h(
          "div",
          {
            style: {
              flex: 1,
              minHeight: 0,
              width: "100%",
              maxWidth: "52rem",
              marginInline: "auto",
            },
          },
          h(Tasks, { key: relayState?.scope }),
        ),
      ),
  });
  ctx.panels.register({
    id: "channel",
    title: "To-do",
    matches: (target) => target.startsWith("buzz-tasks:"),
    channelPlacement: "tab",
    tabIcon: Icon,
    channelLauncher: ({ context, pressed, available, toggle }) =>
      button(
        h(Icon),
        () => {
          if (available()) toggle(`buzz-tasks:${context.channelId}`);
        },
        {
          "aria-label": "To-do",
          title: "To-do",
          "data-icon-variant": "ghost",
          "data-icon-size": "toolbar",
          "data-icon-shape": "control",
          "aria-expanded": pressed,
        },
      ),
    component: ({ target, channelContext }) =>
      target === "buzz-tasks:personal"
        ? h(Tasks, { key: relayState?.scope })
        : channelContext
          ? h(Tasks, {
              key: `${channelContext.scope}:${channelContext.channelId}`,
              channelId: channelContext.channelId,
              scope: channelContext.scope,
            })
          : h("p", null, "Open To-do from a channel toolbar."),
  });
}
export {
  apply,
  compatibilityError,
  createModel,
  dueInputs,
  dueValue,
  inject,
  matchesAssignee,
  parseTask,
  taskTemplate,
};
