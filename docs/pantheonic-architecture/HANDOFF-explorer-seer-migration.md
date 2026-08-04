# Handoff — Migrate the Explorer to the Pantheonic architecture (as a Pythia SEER)

**Audience:** the Explorer agent (the StoaExplorer / Ouronet Explorer repo — a NestJS backend + two
frontends over one database).
**Where to work:** the Explorer's **dev branch** — testable **locally AND on the dev link**. Not prod.
**How to work:** **research-first**, nectar lifecycle (shape → plan → build → review). Read the
Pantheonic architecture (below) BEFORE writing code; produce design + plan under `docs/work/<topic>/`
and get them approved before implementing. This is critical infrastructure — do not free-hand it.

**Sibling handoff:** `HANDOFF-ouronetui-daimon-migration.md` — read it first. The Explorer migration is
the SAME shape (Pantheonic header + URL routing, hub-login admin, its own Codex, Pythia connection with
an admin-only direct-node fallback) with three differences called out below: it's a **seer**, it has a
**polling backend + database**, and it has **two frontends over one backend**.

---

## 0 · What the Explorer becomes: a SEER

A **seer** is a Pantheon entity that **observes** the chain — it polls, downloads, and serves blocks
(read-only); it performs **no transactions of its own**. Like a daimon it uses **Pythia** (to read the
chain) and **Codex** (its own key vault, for the Pythia connection), and like a daimon it does **NOT**
use **Khronoton** (no autonomous signing). The distinction from a daimon (OuronetUI) is purely that a
seer's whole job is observation — no user-signed transactions flow through it either.

The Explorer is a seer: after this migration its chain data is sourced **via Pythia by default**, it
holds its own Codex (Apollo halves) to make that connection, and it exposes a Pantheonic UI. It signs
nothing and fires nothing.

---

## 1 · The Explorer's shape (know it before you touch it)

- **One NestJS backend + one database.** The backend **polls a chain source, downloads blocks, and
  stores them** locally; it serves that data to the frontends over its API
  (`https://apiexplorer.stoachain.com` today).
- **TWO frontends over that one backend:** the **Stoa Explorer** and the **Ouronet Explorer**. Both
  read the same DB/API. **Every UI change in this handoff (Pantheonic header, settings split, hub login,
  Pythia status footer) must be applied to BOTH frontends** — a double implementation over the single
  shared backend.
- **The chain SOURCE is a BACKEND concern, not a frontend one.** What the backend polls (and downloads
  into the DB) is set on the backend, and that is exactly the thing that must never be publicly
  writable (see §3).

---

## 2 · READ FIRST — the canonical references

All under `websites/Pantheon/docs/pantheonic-architecture/`: `design/PANTHEONIC-DESIGN-ARCHITECTURE.md`
(the 3-tier header, Tier-1/Tier-2, admin sidebar+pane, §3.7 every-view-its-own-URL);
`organs/06-pythia-client-wire-in.md` (§2e `DualLinkConnector` + the ~3h `x-pythia-key`; §6 Pythia is the
meter — the Explorer's reads through Pythia are metered/keyed); `organs/CONSUMER-INTEGRATION.md` +
`organs/codex-package-blueprint.md` (hosting `@ancientpantheon/codex`); `identity/HANDOFF-consumer-
ancienthub-login.md` (the ADMIN hub login); `automaton/04`/`05` (the Update page / version surface).
Reference implementations: **Pythia** (`constructors/Pythia` — the clean `design/` reference + the
connector server side + gateway `/read`) and **Mnemosyne** (`automatons/Mnemosyne` — Codex hosting, hub
login, the `DualLinkConnector` loop).

---

## 3 · The SETTINGS SPLIT — the core safety change

Today the Explorer's Settings page is **public** and exposes the chain wiring (screenshot: Explorer
Backend URL, **StoaChain Node URL**, Network, Quick Presets). That is dangerous: the node URL controls
**what the backend downloads into its database**. A user pointing it at, say, a Kadena mainnet node
would have the backend attempt to ingest an entire foreign chain (wrong, and infeasible). Chain source
config must **never** be publicly writable.

Split the settings in two:

- **PUBLIC settings (any user) — only what CANNOT break the backend:**
  - **Appearance / colour / theme** (Light / Dark / System) — keep as-is.
  - **Pythia connection status** (read-only) — is the Explorer's chain source live via Pythia, the
    masked ephemeral key + its countdown (like Mnemosyne's connector status), or on the admin fallback.
  - Nothing that changes the backend's chain source, backend URL, node URL, or network.

- **ADMIN settings (behind the AncientHub login) — everything that affects the backend:**
  - The **chain source**: Pythia connection (default) vs the direct-node fallback (§5), the backend API
    URL, the network selection, quick presets. All the endpoint/node config that's currently public
    moves here.
  - The Explorer's own **Codex** (§4).

The ADMIN login is the **AncientHub hub login** — for the operator only, gating these settings. It is
NOT a user login; the Explorer has no per-user accounts (it's a public read-only explorer). Follow
`identity/HANDOFF-consumer-ancienthub-login.md`.

---

## 4 · The Explorer's own Codex + the Pythia connection

- The Explorer holds its **own Codex** (via `@ancientpantheon/codex`, created/loaded like any Codex)
  containing its keys and its **two already-linked Apollo halves** — required to connect to Pythia. This
  lives behind the ADMIN login (the operator sets it up).
- Wire the **`DualLinkConnector`** (`organs/06 §2e`) with the Explorer's composite `dual-link-key`,
  driven on an immediate-then-~3h loop (mirror Mnemosyne's `connectorLoop.ts`), minting the live
  `x-pythia-key`.
- **The BACKEND uses that connection to source chain data via Pythia** — its polling/read path reads
  through Pythia's gateway with the Explorer's ephemeral key (so, per `organs/06 §6`, the Explorer's
  reads are keyed and counted at the hub). The frontends just display the DB + the connection status.

> **RESEARCH FLAG (resolve in the design phase, do not assume).** Pythia's gateway `/read` relays a Pact
> **dirty read** (`/local`). A block-downloading explorer also needs chainweb **cut / block-header /
> block-payload** endpoints. **Confirm whether Pythia relays those, or only `/local`.** Three outcomes:
> (a) Pythia already relays what the poller needs → route the backend through Pythia; (b) it doesn't →
> this needs a Pythia enhancement (a block-relay surface) — write that as a Pythia handoff and, until it
> lands, keep the poller on the admin-configured node while routing the Pact reads through Pythia; (c)
> decide, with the operator, the interim split. Do NOT silently point the whole poller at Pythia if it
> can't serve those endpoints — that would break ingestion.

---

## 5 · Offline-until-Pythia + admin-only direct-node FALLBACK

Same rule as OuronetUI: **default = via Pythia.** If Pythia is unavailable and no fallback is set, the
Explorer's live chain source is down (it can still serve what's already in its DB, but new ingestion via
Pythia stalls) — surface that state clearly. The **admin** (only) can switch the backend to a
**direct-node** source: **`node1.stoachain.com` / `node2.stoachain.com`**, and can **add other custom
node URLs**. This is the break-glass for when Pythia is down; the default stays Pythia. All node/source
switching lives behind the admin login (§3) — never public.

---

## 6 · Pantheonic UI migration (BOTH frontends) + the Update page (seer variant)

- Replace each frontend's current nav with the **3-tier Pantheonic Header** (`design/` §3), Tier-1
  sections + Tier-2 sub-views, the identity block with an ancient-gated Admin entry, and **every view
  URL-addressable** (`design/` §3.7). Admin uses the sidebar + content-pane layout (`design/` §5).
- Apply to **both** the Stoa Explorer and the Ouronet Explorer frontends (shared backend).
- **Update page (seer variant):** list the packages the Explorer pulls — `@ancientpantheon/pythia-client`
  and `@ancientpantheon/codex` (with versions) — and list **Khronoton with its version but NOT pulled**,
  visibly marking the Explorer a **seer** (no autonomous signing). Mirror `automaton/04`/`05`, keep the
  existing changelog/version surface (the screenshot's "v0.5.0" / "View full changelog").
- Preserve all current explorer functionality — this is a re-shell (header/routing) + a settings split +
  a chain-source re-route, NOT a rewrite of the explorer features.

---

## 7 · Out of scope

- Any change to what the explorer *displays* (block/tx/account views stay as they are).
- Khronoton / autonomous transactions (a seer signs nothing).
- Mnemosyne storage-tier integration (later, Pantheon-wide).
- Rebuilding the backend's ingestion — only its **chain source** (Pythia vs node) and its config
  gating change; the block model/DB stays.

---

## 8 · Acceptance criteria

- [ ] BOTH frontends use the 3-tier Pantheonic Header with URL-addressable views (`design/` §3, §3.7);
      admin uses the sidebar + content-pane.
- [ ] Public Settings expose ONLY theme/colour + a read-only Pythia connection status. All chain-source
      config (backend URL, node URL, network, presets) is behind the AncientHub admin login.
- [ ] The Explorer has its own Codex (Apollo halves) + a `DualLinkConnector` minting the ~3h
      `x-pythia-key`, and the backend sources chain data via Pythia by default (subject to the §4
      research flag's resolution).
- [ ] Admin can switch the backend to a direct-node fallback (`node1`/`node2` + custom nodes) when Pythia
      is down; default is Pythia; the switch is admin-only.
- [ ] Update page lists pythia-client + codex (pulled) and Khronoton (version shown, NOT pulled — seer).
- [ ] A public user can NEVER point the backend at an arbitrary node from the UI.
- [ ] Runs on the dev branch, testable locally and on the dev link, with the existing explorer features
      intact on both frontends.

---

## 9 · When done

Report the dev-link URL(s), a note per acceptance criterion, and — importantly — **the §4 research
verdict** (does Pythia relay the poller's endpoints, and what interim split you chose). Don't merge to
prod; the operator decides go-live (the staged-integration gate, `organs/05 §4`).
