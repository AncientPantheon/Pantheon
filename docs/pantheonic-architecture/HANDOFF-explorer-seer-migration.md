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
- **The Explorer runs TWO SEPARATE chain lanes** (see §4.1 — this is settled architecture, do not
  re-litigate). Genuine on-page reads route through Pythia (keyed → metered → counted at the hub, per
  `organs/06 §6`); block ingestion does NOT. The frontends just display the DB + the connection status.

### 4.1 · TWO chain lanes — SETTLED (was a research flag; now decided)

Verified at the source: Pythia today relays only Pact `/local | /send | /poll` and does **NOT** expose
the chainweb data-layer endpoints (`cut / header / payload / branch`) an indexer needs. More importantly,
even if it did, routing ingest through Pythia would be **wrong** — so keep the two lanes separate:

- **BLOCK INGEST LANE** (the firehose: `cut / header / payload / branch`, plus backfill/reorg traversal)
  → sources from a **SINGLE FIXED NODE**. **NOT** through Pythia, **NOT** a rotating/failover pool.
  Reason: indexing needs **one coherent view** of the chain. Rotating across nodes causes height-skew
  gaps, split-branch inconsistency during reorgs, and 404s on backfill (mixed node retention). Pythia's
  dial layer is a failover **pool** chosen for availability, not coherence — the wrong tool for ingest.
  - Pin to **one active node at a time**, **admin-configurable** with a fallback list
    (`node1.stoachain.com` → `node2.stoachain.com` → custom), switched on **health/manual** — **not**
    striped across several. One source, swappable; never a load balancer.
  - This node config is a BACKEND concern and stays **behind the ADMIN (AncientHub) login** — never
    public (it controls what the backend downloads into the DB; §3).

- **READ LANE** (genuine on-page reads: stoa supply, small Pact queries)
  → routes through **Pythia** as normal, keyed with the Explorer's `x-pythia-key` (metered/earning,
  benefits from Pythia's failover, low volume, no consistency requirement).

**NOT DOING:** routing block ingest through Pythia. That would require a Pythia **block-relay
enhancement** (a new metered verb + a bytes-weighted counter + a **pinned** single-node relay lane, not
the failover pool) and only makes sense if the operator later decides the Pyth economy must account for
block-pull volume. **Out of scope** for this migration unless the operator explicitly asks — and if it
ever happens it must be a pinned single-node relay, never Pythia's failover pool. No research needed on
this point; build against the two-lane split above.

---

## 5 · Availability per lane (the two lanes fail independently)

Given the §4.1 split, the two lanes have **different** availability rules — don't conflate them:

- **Block ingest lane** always runs off the **admin-configured single node** (never Pythia). If that
  node is down, ingestion stalls — the Explorer keeps serving whatever is already in its DB; surface the
  ingest source's health clearly. Recovery = admin switches the active node to the next in the fallback
  list (`node1` → `node2` → custom). This lane never depends on Pythia.
- **Read lane** is **via Pythia by default.** If Pythia is unavailable the on-page reads degrade; surface
  that state (the read-only Pythia connection status, §3). An admin-only break-glass MAY point the read
  lane at a direct node too, but the default stays Pythia.

All node/source switching (either lane) lives behind the admin login (§3) — never public.

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
      `x-pythia-key`, and the **read lane** (on-page Pact reads) routes through Pythia by default.
- [ ] The **block ingest lane** sources from a SINGLE admin-configured node (never Pythia, never a
      rotating pool), with an admin-only fallback list (`node1`/`node2` + custom) switched on
      health/manual. Block ingest through Pythia is NOT built (§4.1 out-of-scope).
- [ ] Admin can switch either lane's node source; both are admin-only; no source config is public.
- [ ] Update page lists pythia-client + codex (pulled) and Khronoton (version shown, NOT pulled — seer).
- [ ] A public user can NEVER point the backend at an arbitrary node from the UI.
- [ ] Runs on the dev branch, testable locally and on the dev link, with the existing explorer features
      intact on both frontends.

---

## 9 · When done

Report the dev-link URL(s) and a note per acceptance criterion — in particular confirm the **two-lane
split** is in place (block ingest off a single admin-configured node, reads via Pythia; §4.1). That
question is settled architecture now, not a research item. Don't merge to prod; the operator decides
go-live (the staged-integration gate, `organs/05 §4`).
