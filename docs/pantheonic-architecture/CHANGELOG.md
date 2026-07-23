# Pantheonic Architecture — Changelog

Human-readable log of what the library gains or changes, on top of git history. Newest first.

## 2026-07-22 — `organs/ORGAN-DEPENDENCY-CONTRACT.md` (NEW) — publishing organs, and adopting them safely

Codex 0.6.1 / Khronoton 0.4.2 were **patch** releases with a byte-identical public API that
nevertheless **renamed their required peer dependencies** (`@stoachain/{ouronet-core,dalos-crypto}`
→ `@ouronet/*`). A consumer diffing only exports would have concluded "nothing changed." New
two-audience contract so organ upgrades stop breaking consumers in ways the version number hides.

- **Consumer rules.** **R1 — declare every REQUIRED peer of every organ you consume**, even one you
  never import: npm ≥7 auto-installs peers, so omitting the declaration *appears* to work and the
  lockfile even pins it — but the dependency then exists only as a side effect of one resolver's
  default, and vanishes under pnpm-strict or `--legacy-peer-deps` ("the lockfile makes an install
  reproducible; the declaration makes it intentional"). **R2 — diff the PEERS on every bump, not
  just the exports.** **R3 — verify against the published tarball, not the source repo.**
  **R4 — every declared `exports` subpath must resolve to a real file** (a dangling subpath installs
  fine and breaks the consumer's *bundler* later). **R5 — adopting an organ is install → rebuild →
  restart**, never install alone, for any automaton that bundles organ UIs into browser islands.
- **Author rules.** **A1 — `peerDependenciesMeta` keys must exactly match `peerDependencies` keys**
  (0.4.1 renamed a peer but left the meta under the old name, silently dropping `optional: true` and
  warning every consumer; fixed in 0.4.2). **A2 — be explicit about required vs optional.**
  **A3 — never drop or re-point an `exports` subpath in a patch**; the exports map is public API.
  **A4 — ship the CHANGELOG inside the tarball**, plus a git tag and GitHub Release per version.
- A copy-paste **organ-bump checklist** (peer/exports/tarball commands + consumer verification),
  the Codex 0.6.1 / Khronoton 0.4.2 **worked example**, and six invariants — closing with: the proof
  an organ was adopted is the **deployed** panel row turning green, not a local install.

## 2026-07-22 — `automaton/05` — constructor-adoption policy + the organ-version layout trap

Two hard-won additions after a Pythia deploy advertised a constructor update it was structurally
incapable of installing, costing an 11m20s rebuild that changed nothing.

- **`automaton/05` → new §1c — "available" MUST mean *what Deploy installs*.** An automaton declares
  **one** constructor-adoption policy, the deployer implements it, and the panel reports it.
  Documents the concrete failure (image builds with `npm ci` = lockfile-exact, deployer never bumped
  the pins, panel computed "available" from npm `dist-tags.latest` → a promise the build could not
  keep), and notes the two rows were mutually inconsistent (entity "available" = deploy branch,
  constructor "available" = npm). Specifies the two legitimate policies —
  **auto-adopt** (deployer `npm install <organ>@latest` before the build; "available" = npm latest)
  and **pinned** (build installs the lockfile; "available" = the deploy branch's pin, with npm-latest
  demoted to a non-deployable *"bump the dependency to adopt"* hint) — and sets **auto-adopt as the
  canonical default**, since constructors are first-party organs that should not need a bump commit
  per release. Mnemosyne implemented auto-adopt from the start, which is exactly why it picked up
  Codex 0.6.1 / Khronoton 0.4.2 while Pythia could not.
- **`automaton/05` → new §1d — the organ-version layout trap.** npm decides *per dependency* whether
  to hoist an organ to the workspace root or leave it nested under the consuming workspace, and a
  version conflict anywhere flips it between installs. Reading the installed version by walking up
  from `process.cwd()` therefore breaks: in a container the cwd is the workspace **root**, and an
  upward walk can never see a package nested *below* it — the panel silently shows `vunknown` for
  every constructor. Resolve from the **reading module's own location** first (`import.meta.url`),
  which passes through both `apps/<app>/node_modules` and the root on the way up.
- Two new conformance-checklist items covering both, including *verify by actually deploying a newly
  published organ and watching the row go green*.
- Reference implementation: **Pythia v2.2.1**.

## 2026-07-21 — `automaton/05` (NEW) — the Deploy Panel: status readout + always-moving progress

A blue-green rebuild sits inside single silent steps for minutes (native addon compile, `chown -R`),
so a streamed build log goes motionless and a healthy deploy is indistinguishable from a wedged one.
Operators were killing good deploys. New canonical standard for every automaton/constructor with an
on-box deploy.

- **`automaton/05-deploy-panel-and-progress.md`.** The canonical rule: **at any instant while a deploy
  runs, something in the deploy box must be visibly moving; if motion stops, the deploy is stuck.**
  Specifies both halves of the panel and the machinery behind them, framework-agnostically:
  - **Status readout** — the entity + `CONSTRUCTORS` version groups (framed rows, installed → available
    chips, independent per-probe degradation), and the deploy readout **Mode · Live color · Loopback
    port · Container · Version** plus the blue-green explainer, so a colour/port incident is
    diagnosable without SSH.
  - **API contract** — the three endpoints and their fixed shapes, including the new **`active`** field
    (newest non-terminal deploy + its real `startedAt`) and the SSE event set; plus the
    survive-the-swap requirement (log on the shared volume, client clears buffer on reconnect).
  - **Server heartbeat (load-bearing)** — the host deployer emits a log line every ~6s for the whole
    run, killed on every exit path. This is what makes the rule true instead of decorative, and yields
    the three-state diagnosis (ticking+advancing = healthy · ticking+frozen = slow but fine ·
    **stopped** = genuinely stuck).
  - **Progress display** — status chip, real `Step N/M` parsed from the log, a 1s ticking timer, a
    looping pacman heartbeat animation, a **>20s stall watchdog** that pauses + reddens it, **auto-attach**
    to a running deploy this browser did not trigger, and **auto-reload on success** (requires
    `Cache-Control: no-cache` on admin assets or the reload silently shows the old UI).
  - **Dev mode** — localhost has no docker/proxy, so Deploy must not be a dead button: it pulls the
    constructors at `@latest` and rebuilds, writing the *same* log/status contract so the whole
    progress display works locally too.
  - **Inline confirmation** (never a modal), with the `[hidden] { display: none }` trap called out.
  - Closes with a **12-point conformance checklist** and a Pythia reference-file map.
- Reference implementation: **Pythia v2.2.0** (vanilla JS + Hono). **Mnemosyne** is the alignment
  target — it needs both the full status readout (Mode/Live color/Loopback port/Container/Version) and
  the progress machinery.

## 2026-07-21 — `automaton/02` — codex mount shows one lock control (no duplicate top-bar Lock)

Settled how automatons mount the codex UI, so the server-sealed operator codex stops carrying two
Lock buttons.

- **`automaton/02-automaton-master-key-codex-protection.md`.** New **§6b — codex-mount UI convention:
  a single lock control.** Because the automaton's codex is server-held auto-unlock, the lock/unlock
  affordance needs no password field and there must be exactly one of it — the codex package's
  **identity-row** control. An automaton wrapping the mounted codex gives its top-bar action slot
  **portability only** (Download/Load, the server-custody equivalents of the standalone's Export/Load)
  and must **not** add a second Lock button. Added the matching **§7 checklist item**.
- Reference implementation: Mnemosyne `app/admin/codex/MnemosyneCodex.tsx` now mounts
  `topbarActions={<CodexPortabilityControls />}` (no wrapper Lock button).

## 2026-07-19 — `design/` v1.3 — every navigable view has its own URL (no single opaque link)

Made addressability a Pantheon-wide law, not just an admin detail.

- **`design/PANTHEONIC-DESIGN-ARCHITECTURE.md` → v1.3.** New **§3.7 — every navigable view has its own
  URL.** Every view reachable by a Tier-1/Tier-2 button, and every page of a Pantheonic site, has its
  **own distinct URL** (path or `#hash`) — deep-linkable, shareable, back-navigable. A single URL that
  swaps content underneath it with no address change is forbidden: **there is never "one link" for the
  whole surface.** The URL is the source of truth (render from the hash on load / `popstate` /
  `hashchange`), generalizing the admin routing model (§5.1) to every surface.
- Both landing forms are bound to it (§4): Form B's anchored sections are addressable by construction;
  **§4.A.3** now states Form A drives its work-area panels from the hash, so every section/sub-view is
  deep-linkable even though the fixed page doesn't scroll between them.
- Added the matching **§7 conformance item**.

## 2026-07-18 — `design/` v1.2 — the landing has two sanctioned forms; the hero portrait is optional

Clarified that the fixed single-screen stage is **one** valid landing, not the only one, so v1.1 is
not read as mandating it.

- **`design/PANTHEONIC-DESIGN-ARCHITECTURE.md` → v1.2.** Rewrote §4 (the Landing) to open with the
  choice between **two sanctioned forms**, equal in standing: **Form A** — the single-screen fixed
  page (the former §4 spec, now §4.A, Pythia as reference); and **Form B** — a **scrolled display**
  where the Tier-1 section links scroll the relevant section down the page (new §4.B). A site picks
  whichever fits its content; neither is more conformant.
- **The hero portrait is now explicitly optional** in both forms — a visual etalon when present
  (still the stage-sizing etalon in Form A), never a requirement. §4.A.2 documents the portrait-less
  Form-A stage (single full-width column); §4.B carries an optional top portrait band.
- Repointed the §1 `--landing-maxw` exception and the Pythia reference block at **§4.A** (the
  exception applies to Form A with a portrait only; it does not apply to Form B). Reworded the §7
  conformance item so either form passes, and noted Form B has no vanilla reference yet.

## 2026-07-17 — `design/` v1.1 — 3-level header + the single-screen landing stage

The header and landing shape settled through live iteration on Pythia and are now law.

- **`design/PANTHEONIC-DESIGN-ARCHITECTURE.md` → v1.1.** Rewrote §3 (the Header) into the definitive
  **three-level** header — L1 medallion + one shared identity block, L2 Tier-1 sections + a single
  memorable action, L3 a **fixed-height** Tier-2 zone that never resizes the header — with a
  **full-chrome-width separator** (on `.ph`, not `.ph-inner`) and strong squared `.ph-btn` buttons.
  Ruled that **Tier-2 nav lives only in the header, never duplicated in the content panel**.
- **New §4 — The Landing Stage.** A hero-portrait landing is a **fixed-size page (PDF-style)**: fixed
  header + footer, one `.landing-mid` scroll region, a `--stage-h` stage that neither grows nor
  collapses, a **fixed-box portrait** (native aspect, no `object-fit` letterbox) as the size etalon
  with a collapse toggle, and a work-area that fills to the portrait height and scrolls only on
  overflow.
- **§1 — sanctioned width exception `--landing-maxw`** for hero-portrait landings (applied to the
  landing `.shell` + header inner + footer inner alike); `--maxw: 1536px` still governs everything else.
- **§5 — the `[hidden]`-wins rule**: any `hidden`-toggled element needs its own `[hidden]{display:none}`
  guard when a `display:` rule would beat it (the class of bug behind the admin-gate ghost and the
  duplicated landing sub-nav).
- Pythia (`apps/pythia/public/{index.html,app.js,styles.css}`) is the live reference for all of the
  above, deployed at `pythia.ancientholdings.eu`.

## 2026-07-17 — Library established

Centralized the scattered Pantheon-wide standards into this one authority (folder created in the
Pantheon website repo — the central authority every site follows).

**Relocated in** (each left a pointer stub in its origin repo; references repointed):
- `automaton/` — the Pantheonic Automaton Blueprint (04) + Master-Key Codex Protection (02), from Mnemosyne.
- `identity/` — AncientHub SSO service + consumer-login recipe + generic Apollo-ownership verifier (from Pythia) + dual-Apollo consumer identity (from Codex).
- `organs/` — constructor-package blueprint (from Khronoton) + codex re-key primitive (07) + khronoton engine wire-in (05, from Mnemosyne) + Codex consumer-integration (from Codex).
- `patterns/` — the Pythia consumer-key model + its interface-control doc (from Pythia).
- `archive/` — superseded khronoton package draft (03, superseded by 05) + Codex v2 architecture plan (kept as a worked example).

**Added:**
- `design/PANTHEONIC-DESIGN-ARCHITECTURE.md` **v1.0** — the UI/UX law: the `--maxw: 1536px` width
  constant, the canonical colour-token contract (theme-agnostic), the standardized Pantheonic Header
  (back-left, one identity block, ancient-gated Admin link, role badges), and the sidebar + content-
  pane admin architecture (unselected `/admin` prompt → `/admin#section` detail, nested routing,
  responsive collapse). Includes a conformance checklist.

**Reference implementation landed:**
- Pythia's admin rebuilt to `design/` v1.0 — standardized Pantheonic Header + sidebar/content-pane
  master-detail (unselected `/admin` prompt → `/admin#section` detail, nested routing), role badges,
  `--accent` token — and **deployed live** (`pythia.ancientholdings.eu/admin`) via Pythia's own
  blue-green Deploy pipeline. The guideline now cites it. Pythia is the working template for `design/`.
