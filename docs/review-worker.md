# Continuous PR review worker

The optional Node worker polls every 30 seconds independently of the desktop app.
It discovers GitHub PR links from the last hour in explicitly assigned private
channels and submits configured repositories through the same admission, triage,
lane routing and signed delivery path as Submit PR.
The worker adds 👀 to the original PR-link message when it picks it up. This
acknowledges processing; admission and review outcomes remain in the PR details.
Repeated scans and restarts do not add duplicate pickup reactions.

It reassigns work that is not accepted within five minutes. Accepted reviews get
three reminders, five minutes apart, then another five minutes to respond before
reassignment. A signed reply from the assigned reviewer resets inactivity;
reminders retain the accepted request. Each assignment and reminder gets a full
response interval after confirmed delivery, including after an outage. Rotation
uses the current lane's ordered reviewer pool, preserves original lane instructions
and approval policy, and never revisits a previously attempted reviewer within
that submission. Exhausted pools appear as `exhausted` log events.

## Provisioning

Build with the repository's pinned environment:

```sh
bin/pnpm run review-worker:build
node dist-review-worker/review-worker.mjs /etc/buzz/review-worker.json
```

Deploy the resulting `review-worker.mjs` on a persistent server with Node 24 or
later. Run it under a process supervisor that restarts failures; send SIGTERM for
graceful shutdown. A laptop process stops when the laptop sleeps. Review agents
need their own available runtimes; this service coordinates reviews and does not
launch models or perform GitHub writes.

Example configuration (all paths are absolute):

```json
{
  "relay": "https://buzz.example.org",
  "channels": ["11111111-1111-4111-8111-111111111111"],
  "storage": "/var/lib/buzz-review",
  "keyFile": "/run/secrets/buzz-review-key",
  "githubTokenFile": "/run/secrets/github-read-token"
}
```

The key file contains the explicitly provisioned hex or nsec signing key. The
GitHub file contains a token with read access to the configured repositories,
including PR metadata, files and CI results. The worker does not discover desktop
credentials, change channel membership or create reviewer runtimes. Restrict the
configuration, secret mounts and data directory to the service account. HTTPS is
required except for loopback test relays. Private CAs use Node's normal CA setup.

The signing identity must already be a writable member of each channel. Reviewers
must be members with verified owners who are also channel members. Archive and
membership evidence is refreshed for actual message publication, including retries.
The relay remains the authorization boundary.

**Ownership:** the worker can update only submissions signed by its configured
identity. Provisioning that same identity supports its existing fully delivered
manual submissions. A separate service identity owns its discovered submissions;
those do not become the link poster's personal submissions. Cross-author takeover
requires a separate delegation protocol and is not implemented. Incomplete browser
submissions and pending browser notifications retain their original device/journal
ownership. They are not silently migrated to the server.

Use one worker and persistent storage directory per identity/community, with one
execution owner per configured channel. SQLite holds an exclusive process lock;
a second process using the same directory refuses to start. Do not deploy replicas
with separate volumes or share this SQLite directory across machines. Relay artifact
creation/CAS also guards concurrent submission mutations, but is not a distributed
scheduler lease. Back up the entire storage directory consistently. Losing its
device identity or outbox journal can leave pending work requiring manual recovery.

## Operation and limits

Logs are JSON on stdout: `submitted`, `reminded`, `assigned`, `exhausted`, `error`,
and `partial`. Repeated identical messages are suppressed for five minutes.
Monitor errors and exhaustion; there is no server-management UI. A removed config,
revoked membership, closed/merged PR, deleted submission, or final lane outcome
stops further actions. Discovery never resurrects a deleted submission. A running
old reviewer is not killed by reassignment.

A healthy tick runs at 30 seconds plus up to one second of jitter. Startup is
jittered across the first 30 seconds. Operations are serial, with bounded HTTP
reads (20-second deadlines, 8 MiB responses) and a two-minute tick deadline. Work
positions are checkpointed before actions so interrupted ticks continue fairly.
A blocked PR or channel backs off independently from 60 seconds to five minutes;
a tick-level failure also backs off with a five-minute cap. Busy workers may take
longer than 30 seconds; split channel ownership across distinct workers if needed.

Idle cost per configured channel per tick: one HTTP request containing three
signed metadata/permission filters, one config read, one to four message pages
for the one-hour window, and current submission pages (500 artifacts each), plus
one report read per 100 lane roots. Current-status fallback reads apply to long
histories. Each discovery candidate adds one exact artifact read; new PRs add
GitHub metadata and access checks. Due assignments add current artifact/config,
GitHub status and membership/profile/archive reads; accepted work adds one recent
reviewer-reply read. Actual sends repeat permission checks. This is an explicit
short-poll service, not a timer started on every desktop client.

The worker accepts 1–100 configured channels. A channel supports 100 repository
configurations, fewer than 2,000 recent messages per discovery pass, and the relay's
10,000 artifact offset limit. Full discovery pages beyond that bound are reported
without applying a partial scan. A tick services up to eight active PRs and eight
discovery candidates per channel, resuming the others later. Oversized or unreadable
configuration/report snapshots fail closed. Polling a link is not proof of current
GitHub state: unavailable GitHub reads never authorize reminders or reassignment.

## Verification

`server/worker.test.ts` exercises the real Node HTTP/signing/storage/outbox adapters
against an isolated signed relay fixture, including separate-session recovery,
uncertain delivery, timing, progress, rotation, ownership, routing and access loss.
Run the whole plugin suite and build before deploying:

```sh
bin/pnpm exec vitest run src/bundled/review-configuration
bin/pnpm typecheck
bin/pnpm run review-worker:build
```

For acceptance, use an isolated private channel and repository configuration.
With no Buzz session for the service identity, post a matching PR URL and verify
one submission and reviewer thread. Restart the process with the same storage;
verify no duplicate thread. Observe the five-minute acceptance/reminder intervals,
then remove channel access and confirm publication stops. Real reviewer execution
and production hosting are separate acceptance checks from the coordinator tests.
