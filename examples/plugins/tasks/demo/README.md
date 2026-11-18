# To-do marketplace demo

This 26-second scene shows creating personal tasks, choosing a deadline, and
completing a task in the real Buzz web shell. All people and content are fictional.

The demo host does not expose task artifact writes. `mocks.mjs` supplies an
in-memory artifact writer and personal home only to this plugin. The production
plugin runs unchanged; this recording demonstrates UI behavior, not live relay
delivery or save-rejection recovery. Never package the demo adapter for installation.

From the repository root, with the `buzz-plugin-demos` skill installed:

```sh
. ./bin/activate-hermit
node examples/plugins/tasks/demo/prepare.mjs
node --experimental-transform-types --no-warnings \
  "$HOME/.codex/skills/buzz-plugin-demos/scripts/record.mjs" \
  --app "$PWD" --plugin .scratch/tasks-demo-plugin \
  --seed examples/plugins/tasks/demo/seed.json \
  --scene examples/plugins/tasks/demo/scene.mjs \
  --out .scratch/tasks-demo --scale 1
```

Keep `demo.mp4`, `demo.webp`, `poster.png`, and `demo.json` together for marketplace
evidence. Check that `blockedRequests` and `pageErrors` are empty and inspect the
rendered frames before publication. Media belongs with the marketplace listing,
not in the application source repository. Publication still depends on the host
support and release limitations documented in the parent README.
