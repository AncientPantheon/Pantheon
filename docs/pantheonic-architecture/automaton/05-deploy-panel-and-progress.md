# 05 · The Deploy Panel — status readout + always-moving progress

**Status:** canonical standard. Applies to **every** Pantheon automaton/constructor that has an
on-box (blue-green) Deploy — Pythia, Mnemosyne, Caduceus, Aletheia, and every future one.

**Reference implementation:** Pythia (`constructors/Pythia`) — vanilla JS + Hono.
**To align:** Mnemosyne (`automatons/Mnemosyne`) — Next.js + React.

This document is deliberately **framework-agnostic**: it specifies *contracts and behaviour*, not
JSX or DOM. Two implementations may share no code and still both be conformant.

---

## 0 · Why this exists

A blue-green rebuild spends minutes inside single silent steps — a native addon compile, a
`chown -R` over `node_modules`, an image export. Docker prints **nothing** during those steps, so a
streamed build log sits motionless. The operator cannot distinguish *"working, just slow"* from
*"wedged"*, and starts killing healthy deploys.

### The canonical rule

> **At any instant while a deploy is running, something in the deploy box must be visibly moving.
> If motion stops, the deploy is stuck.**

A silent terminal is a UX failure. The rule is only meaningful if motion is *caused by the deploy
being alive* — a decorative animation that keeps spinning through a dead deployer is a lie. §3
therefore makes the **server** guarantee the motion, and §5 makes the client detect its absence.

---

## 1 · The panel has two halves

Both live in **one framed card** in the admin content pane (see `design/` — the card, tokens and
sidebar layout are already standard).

```
┌─ Live version ──────────────────────────────────────────────┐
│  PYTHIA                                                     │
│   Pythia · the read gateway            [v2.2.0] [up to date]│
│  CONSTRUCTORS                                               │
│   Codex · @ancientpantheon/codex       [v0.6.0] → [v0.6.1]  │
│   Khronoton · @ancientpantheon/…-core  [v0.4.0] → [v0.4.2]  │
│ ─────────────────────────────────────────────────────────── │
│  On-box deploy                                              │
│   Mode: bundle · Live color: green · Loopback port: …:8081  │
│   Container: pythia-green · Version: 2.2.0                  │
│   (blue-green port-juggle explainer)                        │
│   [ Deploy ]                                                │
│   ── progress (only while/after a deploy) ──                │
│   (RUNNING) Step 32/35                              8m18s   │
│   · · · · · · · ᗧ · · · · · · · · · · · · · · · · · · · ·   │
│   ┌ black box: streamed build log ─────────────────────────┐│
└─────────────────────────────────────────────────────────────┘
```

### 1a · Version readout (top half)

Two **groups**, each a list of framed rows:

| Group | Rows |
|---|---|
| *The entity* (e.g. `PYTHIA`, `MNEMOSYNE`) | one row: the app itself |
| `CONSTRUCTORS` | one row per consumed organ package (Codex, Khronoton, …) |

Each row: **name** + a dim monospace subtitle (the npm package name, or a role like
*"the read gateway"*) on the left; **version chips** on the right — `installed` chip, and when a
newer version exists an `→` plus a highlighted `available` chip. When current, show a green
**"up to date"** instead of the arrow.

- Entity "available" = the version on the deploy branch (what a deploy would build).
- Constructor "available" = the npm registry `dist-tags.latest` for that package.
- Every probe degrades **independently**: an unreachable registry renders `latest: unreachable`,
  never a crash and never a false "update available".

### 1b · On-box deploy readout (bottom half)

Always show, as plain labelled lines:

| Field | Meaning |
|---|---|
| **Mode** | `bundle` (real on-box deploy) or `dev` (localhost — see §6) |
| **Live color** | which side of the pair is serving: `blue` / `green` |
| **Loopback port** | the loopback address that color binds (e.g. `127.0.0.1:8081`) |
| **Container** | the exact container name the deployer manages (e.g. `pythia-green`) |
| **Version** | the version this running container reports |

Plus one explainer sentence naming both loopback ports and stating that the public ports (80/443,
terminated by the reverse proxy) never change. **Rationale:** blue-green incidents are debugged by
knowing *which color is live on which port* — the panel must answer that without an SSH session.

### 1c · Constructor adoption policy — "available" MUST mean *what Deploy installs*

> **The rule: an automaton declares ONE constructor-adoption policy, the deployer implements it,
> and the panel's "available" reports it. Advertising a version Deploy cannot install is a lie the
> operator pays for in wasted rebuilds.**

This is the single most expensive mistake to make here, and it is invisible until someone deploys.

**The failure, concretely.** Pythia's image built with `npm ci`, which installs the lockfile
*exactly*; her deployer never touched the constructor pins. Her panel meanwhile computed
"available" from the **npm registry** (`dist-tags.latest`). So when Codex `0.6.1` was published the
panel showed `0.6.0 → 0.6.1`, the operator hit Deploy, waited **11m20s** for a full rebuild
(including a native addon compile) — and the panel came back **identical**, because `npm ci` had
faithfully reinstalled `0.6.0` from the lock. Nothing was broken; the panel had simply promised
something the build was structurally incapable of delivering. The operator reasonably concluded the
deploy was broken.

Note the two rows were also **mutually inconsistent**: the entity's "available" came from the deploy
branch (genuinely what a deploy builds), while the constructors' came from npm (not what a deploy
builds). Same visual grammar, two different meanings.

**The two legitimate policies** — pick one, per automaton, explicitly:

| Policy | Deployer does | "available" means | Trade-off |
|---|---|---|---|
| **Auto-adopt** *(canonical)* | `npm install <organ>@latest` for every organ **before** the build | npm `dist-tags.latest` | Newly published organs land on the next deploy with no consumer commit — but an organ regression ships unreviewed |
| **Pinned** | nothing; build installs the lockfile | the version pinned **on the deploy branch** | Fully reproducible from git — but adopting an organ needs a dependency-bump commit, and the panel must **not** show npm-latest as "available" |

**Canonical default: auto-adopt.** Constructors are first-party Pantheon organs, published by us;
an automaton should track them without a hand-written bump commit per release. Mnemosyne implemented
this from the start — its deployer discards the previous deploy's pin bumps (so `git reset`/`pull`
stays clean), then re-bumps to `@latest` before building. That is precisely why Mnemosyne picked up
Codex 0.6.1 / Khronoton 0.4.2 on its next deploy while Pythia could not.

```bash
# In the deployer, immediately AFTER the source reset and BEFORE the image build:
git reset --hard origin/main            # also discards the last deploy's pin bumps
npm install @ancientpantheon/codex@latest @ancientpantheon/khronoton-core@latest \
  -w <consuming-workspace> --no-audit --no-fund
# ...then build; `npm ci` inside the image now resolves the freshly-bumped lockfile.
```

If an automaton instead chooses **pinned**, it MUST change the panel: read the constructor
"available" from the deploy branch's manifest, and demote npm-latest to a separate, clearly
non-deployable hint (*"npm has 0.6.1 — bump the dependency to adopt"*).

### 1d · Reading the installed organ version — the layout trap

npm decides **per dependency** whether to hoist a package to the workspace root
(`/app/node_modules/<pkg>`) or leave it nested under the consuming workspace
(`/app/apps/<app>/node_modules/<pkg>`); a version conflict anywhere in the tree flips it. Both
layouts are normal and can change between installs without any consumer edit.

An organ's version therefore **must not** be read by walking up from `process.cwd()`. In a container
the cwd is the workspace **root**, and an upward walk only ever goes *further up* — it can never see
a package nested *below*. The reader silently returns `unknown` and the panel shows `vunknown` for
every constructor, with nothing in the logs.

**Resolve from the reading module's own location first** (`import.meta.url` / `__dirname`), falling
back to cwd. From `/app/apps/<app>/dist/...` the upward walk passes through
`/app/apps/<app>/node_modules` **and** `/app/node_modules`, so it finds the package under either
layout. (The packages' `exports` maps typically don't expose `./package.json`, which is why this is
a path walk rather than a `require.resolve`.)

---

## 2 · The API contract (three endpoints)

Paths are per-implementation (`/api/admin/deploy…`); the **shapes** are fixed. All three are
`ancient`-gated and `Cache-Control: no-store`.

### `GET …/deploy/status`

```jsonc
{
  "mode": "bundle" | "dev",
  "color": "blue" | "green" | null,
  "port": "8081" | null,
  "container": "pythia-green" | null,
  "version": "2.2.0",
  "active": null | { "id": "<uuid>", "status": "running", "startedAt": "<ISO>" }
}
```

**`active`** is the newest deploy whose status is **not terminal**. It is what makes a running
deploy observable by *anyone* (§5d). `startedAt` is the deploy's real start (the log file's creation
time) so a late-joining browser shows the true elapsed time, not time-since-I-opened-the-page.

### `POST …/deploy`

Returns `{ "id": "<uuid>", "mode": "bundle" | "dev" }`.

- **bundle** — mint an id and drop a request file in the deploy spool. The container **never**
  touches git, docker, or the reverse proxy; a root-owned host unit picks the request up.
- **dev** — see §6. Must **not** 409; localhost gets a useful action instead.

### `GET …/deploy/stream/:id` — SSE

| Event | Payload | Meaning |
|---|---|---|
| *(default, unnamed)* | raw log bytes since the last offset | append verbatim to the terminal |
| `status` | `running` / … | status transitions |
| `done` | `success` / `failed` | terminal; server closes the stream |

Rules:
- Tail the log **by byte offset**, polling ~500ms. A missing log file is *not* an error (the host
  unit may not have started yet) — keep polling.
- Chunks already contain their own newlines: append verbatim, never add one.
- **Survive the swap.** Mid-deploy the color flip kills the container serving this very stream. The
  log must live on the **shared data volume**, not in the container, so the browser's `EventSource`
  auto-reconnects to the *new* container and keeps tailing the same file. On every (re)connect the
  client **clears its buffer** before the replay, because the server re-sends from offset 0.
- Hard-cap the stream lifetime (Pythia: 20 min) so a wedged deployer cannot pin a connection.

---

## 3 · The server heartbeat — the load-bearing guarantee

**The host deployer MUST emit a heartbeat line into the deploy log on a fixed interval for the whole
run.** This is what makes the rule in §0 true rather than decorative.

```bash
HEARTBEAT_PID=""
start_heartbeat() {
  ( while true; do sleep 6; printf '  · still working · elapsed %s\n' "$(elapsed)" >>"$LOG"; done ) &
  HEARTBEAT_PID=$!
}
stop_heartbeat() { [ -n "$HEARTBEAT_PID" ] && kill "$HEARTBEAT_PID" 2>/dev/null; HEARTBEAT_PID=""; }
trap 'stop_heartbeat' EXIT
```

- Start it immediately after the log is created and the status is set `running`.
- Interval **~6s**. Must be comfortably below the client stall threshold (§5c).
- Kill it on **every** exit path — an `EXIT` trap covers success, failure, and the error/TERM traps.
- The final success line states the **total**: `✓ deploy complete in 8m41s`.

**What it proves:** the deployer *process* is alive. Combined with the advancing step counter (which
proves the builder is progressing), an operator can distinguish all three states:

| Heartbeat | Step counter | Diagnosis |
|---|---|---|
| ticking | advancing | healthy |
| ticking | frozen | on a long silent step — **fine, just slow** |
| **stopped** | frozen | deployer died — **genuinely stuck** |

---

## 4 · Phase headers

The deployer prints a phase banner with a running elapsed stamp, so the log is skimmable:

```
═══ [0m09s] 2/5 · Build image ═══
```

Five canonical phases: **1/5** refresh source → **2/5** build image → **3/5** start new container →
**4/5** health-check → **5/5** cut over + retire old. Health-check failure and reverse-proxy
validation failure both **abort without touching the live color** and say so.

---

## 5 · The progress display (client)

Shown while a deploy runs and after it ends. Four elements, above the log terminal.

### 5a · Status chip · step · timer

- **Chip** — `RUNNING` (accent) → `SUCCESS` (green) / `FAILED` (red).
- **Step** — parse the builder's `Step N/M` out of the streamed chunks and show the **latest** match.
  This is real progress; it is not synthesized.
- **Timer** — ticks every **1s** from `startedAt`, formatted `8m18s`. Client-driven, so it moves even
  if the network stalls (that alone tells you the page is alive).

### 5b · The heartbeat animation ("pacman")

A looping animation modelled on the CachyOS/pacman package updater: a muncher glyph travels across a
field of dots on a continuous loop while the deploy runs.

- Pure CSS keyframes, `infinite` — no JS timer, no data dependency, always smooth.
- On **done**: stop the animation and park the muncher at the end.
- On **stall** (§5c): **pause** the animation and turn it red — this is the moment the operator
  learns the deploy is stuck.

*Its honesty comes from §5c: it is not merely decorative, because the stall watchdog stops it.*

### 5c · Stall watchdog

Track the timestamp of the last received chunk. With a ~6s server heartbeat, a healthy deploy never
exceeds it. If **> 20s** elapses with no chunk:

- add a stalled state (red border, paused animation), and
- show: `⚠ no output for Ns — the host deployer may have stopped.`

Clear it the moment a chunk arrives. **Threshold must be ≥ 3× the heartbeat interval** so ordinary
scheduling jitter never produces a false alarm.

### 5d · Auto-attach

On opening the panel, read `active` from the status endpoint. If a deploy is **running**, open the
stream for `active.id` and start the timer from `active.startedAt` — **even though this browser did
not trigger it.**

This is required, not optional: deploys are triggered by another operator, by an agent dropping a
spool request, or by a previous session. A running deploy must always be observable. Guard against
double-attaching while a stream is already open.

### 5e · Auto-reload on success

When `done: success` arrives, the new container is already live behind the reverse proxy. Show a
short countdown (~3s) — *"✓ New version is now live — reloading this page in 3…"* — then reload, so
the operator lands on the freshly-deployed version without a manual refresh.

- **Success only.** A failed deploy must stay on screen with its log.
- Serve admin static assets with `Cache-Control: no-cache` so the reload **revalidates** and actually
  fetches the new bundle. Without this the auto-reload silently shows the old UI.
- Scope it to operators actually watching the deploy panel, so it never interrupts unrelated work.

---

## 6 · Dev mode — localhost gets a real action

Localhost has no docker, no reverse proxy, no host deployer, so blue-green cannot run — but the
Deploy control must **not** be a dead, disabled button. In `dev` mode Deploy instead **pulls the
automaton constructors at `@latest` and rebuilds**, which is the update a developer actually needs.

- `POST …/deploy` in dev starts the constructor update and returns `{ id, mode: "dev" }`.
- The update writes `<id>.log` + `<id>.status` in the **same contract** as the host deployer —
  including its own ~6s heartbeat — so the SSE stream and the entire progress display work unchanged.
- The readout explains the difference: *"dev mode — no blue-green on this box. Deploy pulls the
  constructors at @latest and rebuilds; the page reloads to pick up the new UIs (restart the dev
  server for server-side organ changes)."*
- The confirm wording changes with the mode; the Deploy button is enabled in **both** modes and
  disabled only while a deploy is in flight.

---

## 7 · Confirmation

Deploy is confirmed **inline, in the same card** — never a modal popup. Clicking Deploy reveals a
framed *"Yes, deploy / Cancel"* row a short gap **below** the button (the button stays put); Cancel
hides it again.

> **Implementation trap:** giving the confirm block a `display:` value in a class defeats the
> `hidden` attribute, so it renders permanently. Always pair it with an explicit
> `[hidden] { display: none }` override.

---

## 8 · Conformance checklist

An implementation is conformant when:

- [ ] Version readout groups the **entity** and its **CONSTRUCTORS**, each row framed, with
      installed → available chips and independent per-probe degradation.
- [ ] Deploy readout shows **Mode · Live color · Loopback port · Container · Version** + the
      blue-green explainer.
- [ ] The **constructor-adoption policy is explicit** (§1c), the deployer implements it, and
      "available" reports *what Deploy will install* — verified by actually deploying a newly
      published organ and watching the row go green.
- [ ] Installed organ versions resolve from the **module's own location**, so they survive npm
      hoisting the package **or** nesting it (§1d) — never `unknown`.
- [ ] `status` returns the documented shape **including `active`**.
- [ ] The stream survives the color swap (log on the shared volume; client clears on reconnect).
- [ ] The host deployer **heartbeats ~6s** and kills the ticker on every exit path.
- [ ] Success states the **total elapsed**.
- [ ] The panel shows **chip + Step N/M + ticking timer + looping heartbeat animation**.
- [ ] A **>20s** output silence visibly stalls the display with an explanatory line.
- [ ] The panel **auto-attaches** to a running deploy it did not trigger.
- [ ] Success **auto-reloads** (with `no-cache` static assets); failure does not.
- [ ] **Dev mode** pulls constructors at `@latest` instead of disabling Deploy.
- [ ] Confirmation is **inline**, below the button, and genuinely hidden until requested.

---

## 9 · Reference files (Pythia)

| Concern | File |
|---|---|
| Host deployer + heartbeat + phases | `deploy/host/pythia-deploy.sh` |
| Spool contract · `latestDeploy()` (the `active` source) | `apps/pythia/src/deploy/spool.ts` |
| Dev-mode constructor update | `apps/pythia/src/deploy/devUpdate.ts` |
| The three endpoints + SSE tail | `apps/pythia/src/routes/adminDeploy.ts` |
| Version + constructor probes | `apps/pythia/src/admin/{versionInfo,organVersions}.ts` |
| Panel markup / progress logic / styles | `apps/pythia/public/{admin.html,admin.js,styles.css}` |
