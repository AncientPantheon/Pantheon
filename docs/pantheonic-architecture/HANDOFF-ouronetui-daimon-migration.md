# Handoff — Migrate OuronetUI to the Pantheonic architecture (as a Pythia DAIMON)

**Audience:** the OuronetUI agent.
**Where to work:** OuronetUI's **dev branch** — every change must be testable **locally AND on the
OuronetUI dev website link**. Do not touch production.
**How to work:** this is a **research-first** migration. Read the Pantheonic architecture (the docs
listed below) BEFORE writing code, then follow the nectar lifecycle (shape → plan → build → review) —
produce a design + plan under `docs/work/<topic>/` in the OuronetUI repo and get them approved before
implementing. Do NOT free-hand it: OuronetUI is critical software and the target shape is fully
specified by the architecture.

---

## 0 · What OuronetUI becomes: a DAIMON

A **daimon** is a Pantheon consumer that uses **Pythia** (blockchain transport gateway) + **Codex**
(sovereign key vault) — but **NOT Khronoton**, because it performs **no autonomous on-chain
transactions of its own**. Contrast with an **automaton** (Pythia, Mnemosyne, future Aletheia) which
runs an embedded Khronoton to sign/fire on-chain by itself.

OuronetUI is a daimon: after this migration, **all** of OuronetUI's blockchain communication is routed
through Pythia; it holds no autonomous signing engine. Users still sign their own transactions in their
own Codex (as today) — those signed transactions are then **relayed through Pythia**, not broadcast to a
node directly.

---

## 1 · READ FIRST — the canonical references (research pass)

All under `websites/Pantheon/docs/pantheonic-architecture/`:

- **`design/PANTHEONIC-DESIGN-ARCHITECTURE.md`** — the load-bearing UI/UX standard: fixed width, colour
  tokens, the **standardized 3-tier Pantheonic Header** (§3), **Tier-1 sections + Tier-2 sub-views**
  (§3.3/3.4), the **admin sidebar + content-pane** layout (§5), and **§3.7 — every navigable view has
  its own URL** (Tier-1/Tier-2/Tier-3). THIS is what "migrate to the Pantheonic architecture" means.
- **`organs/06-pythia-client-wire-in.md`** — THE Pythia wire-in. Read all of it, especially **§2e**
  (`DualLinkConnector` — driving an already-active dual-Apollo pair with the composite `dual-link-key`,
  the ~3h ephemeral-secret refresh, feeding `x-pythia-key` into `PythiaClient`) and **§6** (Pythia is
  the meter — all reads/sends route through her).
- **`organs/CONSUMER-INTEGRATION.md`** + **`organs/codex-package-blueprint.md`** — hosting the
  `@ancientpantheon/codex` package in a consumer (loading a user's Codex into the browser, sealed vault).
- **`identity/HANDOFF-consumer-ancienthub-login.md`** — the "Login with AncientHub in any consumer"
  recipe (this is the ADMIN login — see §2 below, do NOT make it the user login).
- **`automaton/04-automaton-blueprint.md`** + **`automaton/05-deploy-panel-and-progress.md`** — the
  Update/Deploy page + package-version surface (the **daimon variant** in §6 below).

Reference implementations to study (they've already walked this path):
- **Pythia** (`constructors/Pythia`) — the clean `design/` reference (header, Tier-1/2/3 URL routing,
  sidebar admin), the connector server side, and the `DualLinkConnector` self-wiring (`self-connector`).
- **Mnemosyne** (`automatons/Mnemosyne`) — the React reference for hosting the Codex, the hub login, and
  the `DualLinkConnector` client loop (its `lib/pythia/connectorLoop.ts` — the ~3h tick, immediate tick
  on start, tick on status poll; see `organs/06 §2e`'s "a consumer MUST drive the connector" note).

---

## 2 · Two DIFFERENT logins — never conflate them

This is the single most important thing to get right:

- **USER login (everyday, for end users):** a user either **creates a new Codex** or **loads an
  existing one** — exactly like Mnemosyne's Codex flow. The user's keys live in their own browser-held
  Codex; the seed never leaves it. **This replaces the current "load Codex from Google Drive" entirely —
  drop the Google Drive path.** (Loading FROM Mnemosyne's storage tier is a LATER integration, OUT OF
  SCOPE here — see §8.)
- **ADMIN login (Login with AncientHub):** ONLY the OuronetDev operator uses this. It gates the **admin
  settings** (Pythia wiring, fallback config, OuronetDev's own Codex). It is **NOT** the user login and
  must never be presented as the way a user signs in. Follow
  `identity/HANDOFF-consumer-ancienthub-login.md`, presented in the standardized header (§3).

---

## 3 · Adopt the Pantheonic architecture (the UI migration)

OuronetUI today has a **vertical** menu. Migrate to the **horizontal Pantheonic Header**:

- Replace the vertical menu with the **3-tier header** (`design/` §3): Tier-1 sections + one memorable
  action; Tier-2 sub-views in the fixed L3 zone; the identity block (with an ancient-gated Admin entry).
- **Every Tier-1 / Tier-2 (and any Tier-3 sub-tab) view gets its own URL** (`design/` §3.7) — routed
  from the URL, back-navigable. No in-memory nav behind a static URL.
- The **admin area** uses the sidebar + content-pane layout (`design/` §5), each section its own
  `#hash`.
- Keep OuronetUI's existing functionality intact — this is a **re-shell + re-route**, not a rewrite of
  the features. The features move under the new header/routing and their blockchain calls move onto
  Pythia (§4).

---

## 4 · Wire in Pythia (OuronetDev's identity + the connector)

- **OuronetDev has its OWN Codex** (via `@ancientpantheon/codex`, created/loaded like any Codex),
  holding OuronetDev's keys **and its two Apollo halves**. This lives behind the ADMIN login.
- Those **two Apollo halves are already LINKED on-chain** (an active dual link). Bring them into
  OuronetDev's Codex and wire the **`DualLinkConnector`** (`organs/06 §2e`) with the composite
  **`dual-link-key`** (`<standard-apollo>|<smart-apollo>`).
- The connector, driven on a loop (**immediate tick on start, then every ~3h**, plus a tick on status
  poll — mirror Mnemosyne's `connectorLoop.ts`), proves ownership of both halves to Pythia and mints a
  **live, auto-refreshing ephemeral secret** (`x-pythia-key`, ~3h TTL).
- **ALL blockchain reads/sends route through Pythia** (`PythiaClient` fed the live `x-pythia-key`) — no
  direct node access on the default path. Users' own signed transactions are relayed via Pythia's
  `/send`; reads via `/read`. (Per `organs/06 §6`, this is also how OuronetUI's traffic gets metered —
  its keyed reads count at the hub.)

---

## 5 · Offline-until-Pythia + the admin FALLBACK

OuronetUI is critical software, but this migration makes it **depend on Pythia by default**. Handle it
exactly so:

- **DEFAULT = via Pythia.** If Pythia is not wired / not alive, OuronetUI is in an explicit **OFFLINE**
  state: **no transactions work** — not from the UI, not from users' Codices, not from OuronetDev's own
  admin Codex. Reads that require the gateway are unavailable. Surface this state clearly (not a silent
  failure).
- **FALLBACK (admin-only, OFF by default):** the admin can switch OuronetUI to a **non-Pythia direct-
  node** connection — OuronetUI's *current* system — pointing at **`node1.stoachain.com`** and
  **`node2.stoachain.com`**. The admin can **also add other node URLs** (a small editable node list),
  not only those two. This exists solely as a break-glass for when Pythia is down; the default stays
  Pythia.
- The switch and node list live behind the ADMIN login (§2).

---

## 6 · The Update page — the DAIMON variant

Follow `automaton/04`/`05` for the version/update surface, with the daimon distinction:

- List the packages OuronetUI **uses and pulls**: **`@ancientpantheon/pythia-client`** and
  **`@ancientpantheon/codex`** (with versions, update path).
- List **Khronoton** with **its version** but **do NOT pull it** — visibly marking OuronetUI as a
  **daimon** (it doesn't need the Khronoton package because it performs no autonomous transactions).
  Show it as "not used (daimon)" rather than hiding it, so the entity's nature is explicit.

---

## 7 · Footer connection status — Pythia, not node2

- OuronetUI's current footer shows a **connection line to node2**. **Replace it with the Pythia
  connection status:** the live **ephemeral secret** (masked, `first7…last7`) + its **elapsing time**
  (a countdown to the ~3h refresh) — presented like Mnemosyne's connector status. When on the admin
  fallback, the footer instead reflects the direct-node connection state.

---

## 8 · Out of scope (do NOT build here)

- **Mnemosyne storage-tier integration** — loading/saving a Codex from Mnemosyne's first storage tier is
  a LATER task, after this migration lands. For now, user Codices are create-new / load-existing only.
- **Khronoton** — OuronetUI is a daimon; no embedded engine, no autonomous transactions.
- A rewrite of OuronetUI's feature set — preserve current functionality; only its shell (header/routing)
  and its transport (onto Pythia) change.

---

## 9 · Acceptance criteria

- [ ] Vertical menu replaced by the 3-tier Pantheonic Header; every Tier-1/Tier-2 view is URL-addressable
      (`design/` §3 + §3.7); admin uses the sidebar + content-pane layout.
- [ ] USER login = create-new / load-existing Codex (Google Drive path removed). ADMIN login = Login with
      AncientHub, gating admin settings — the two are distinct and never conflated.
- [ ] OuronetDev's own Codex (admin) holds its keys + two already-linked Apollo halves; a
      `DualLinkConnector` mints a live `x-pythia-key` on an immediate-then-~3h loop.
- [ ] All blockchain reads/sends route through Pythia by default; users' signed txs relay via Pythia.
- [ ] With Pythia unavailable, OuronetUI is a clear OFFLINE state (no tx from UI / user Codex / admin
      Codex); the admin can switch to the non-Pythia fallback (node1/node2 + additional custom nodes).
- [ ] Update page lists pythia-client + codex (pulled) and Khronoton (version shown, NOT pulled — daimon).
- [ ] Footer shows Pythia connection status (masked ephemeral key + countdown), replacing the node2 line.
- [ ] Everything runs on the OuronetUI dev branch, testable locally and on the dev website link.

---

## 10 · When done

Report back: the dev-link URL to test against, a short note per acceptance criterion, and any place where
OuronetUI's existing behavior had to change to fit the architecture. Do not merge to production — the
admin decides go-live separately (the staged-integration gate, `organs/05 §4`).
