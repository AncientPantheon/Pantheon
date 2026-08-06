# Handoff — Migrate the AncientHub to the Pantheonic architecture (report-metered automaton)

**Audience:** the AncientHub agent (the Hub holds the **Dalos Automaton**, which fires on-chain
transactions AND reads chain data) — and, for the prerequisite, the **Pythia** agent.
**Where to work:** the Hub's **dev branch** — testable locally AND on the dev link. Not prod.
**How to work:** **research-first**, nectar lifecycle (shape → plan → build → review). Read the
Pantheonic architecture (below) BEFORE writing code; produce design + plan under `docs/work/<topic>/`
and get them approved before implementing. This is critical, load-bearing infrastructure — the Hub is
the root of the fleet (it feeds Pythia her nodes). Do NOT free-hand it.

**Siblings:** `HANDOFF-mnemosyne-route-sends-through-pythia.md` and
`HANDOFF-ouronetui-daimon-migration.md` — read them for the *normal* (relay) path and the base UI
migration shape. The Hub is DELIBERATELY DIFFERENT in two ways: on metering it REPORTS rather than relays
(§2–§3, do NOT just route it through `/send`), and its UI has a **four-tier role hierarchy** split across
the header (non-admins) and an Admin Dashboard (admins) (§7) rather than the two-login split the others
use.

---

## 0 · What the Hub already IS, what it becomes, and why it is special

**Start from the truth that the Hub is ALREADY a working automaton — this is a MIGRATION / re-shell,
NOT a from-scratch build.** The Hub today already has:

- **A Codex** (its own key vault) — already set up and holding real keys.
- **Khronoton capabilities** — already-defined cronotons that fire (the Dalos Automaton).
- **Admin-gated menus** — role-gated actions, today all on the same page.
- **A deploy pipeline**, a running service, and existing UI.

So do NOT re-create any of that. The job is to bring the EXISTING, working Hub **into the Pantheonic
architecture**: its own Pythia connection + report-metering (§2–§6), the new Codex/Khronoton package
lineage adopted **without disturbing the existing vault or cronotons** (§5, §5.1), and the Pantheonic UI
shell with proper role-gated navigation (§7). Inventory what exists first; preserve it; re-shell around it.

The Hub is an **automaton** in the Pantheonic sense — its Dalos Automaton signs/submits transactions and
reads chain data, so per `organs/06 §6` (Pythia is the on-chain meter) that traffic must be **counted in
Pythia's Pyth ledger** (transactions AND petitions/pondus). Like any automaton it gains its own
**`DualLinkConnector`** (over its EXISTING Codex) minting an `x-pythia-key`, so its activity is keyed and
attributed.

> **Pythia side is DONE (shipped v2.7.31).** Everything §4 lists — the shared `pondus()` export in
> `@ancientpantheon/pythia-client`, per-consumer petitions/pondus attribution, and the auth-gated
> `POST /pyth/report` ingress — is already built, released, and live. The Hub agent is unblocked; §4 is
> now a reference, not a wait. The operator just sets `PYTHIA_REPORTERS` to the Hub's consumer name to
> open the ingress.

But the Hub is **not** a normal consumer. Three things make it unique, and they drive the whole design:

1. **The Hub IS Pythia's node source.** It serves the node pool to Pythia (the hub-feed). It already has
   direct node access — relaying its own traffic *through* Pythia (Hub → Pythia → node) is a redundant
   round trip back to nodes the Hub already holds.
2. **The Hub IS the PythXP ledger holder.** Pythia meters usage and *reports it to the Hub*; the Hub is
   the one that credits operators their PythXP. So for the Hub's OWN reads, the naive flow is a DOUBLE
   round trip: Hub → Pythia (to be metered) → Pythia → Hub (usage report, to attribute XP). Both trips
   are pure overhead when the Hub did the read itself and holds the XP ledger.
3. **Dependency inversion risk.** If the Hub's Dalos depended on Pythia being up, a Pythia outage would
   freeze the *more foundational* Hub — and since the Hub feeds Pythia her nodes, that can wedge the
   whole fleet. The Hub must keep working when Pythia is down.

---

## 1 · READ FIRST — the canonical references

All under `websites/Pantheon/docs/pantheonic-architecture/`:
`design/PANTHEONIC-DESIGN-ARCHITECTURE.md` (the 3-tier header, Tier-1/2/3, admin sidebar+pane, §3.7
every-view-its-own-URL); `organs/06-pythia-client-wire-in.md` (§2e `DualLinkConnector` + the ~3h
`x-pythia-key`; §6 Pythia is the meter — the rule this handoff GENERALIZES, see §8);
`organs/CONSUMER-INTEGRATION.md` + `organs/codex-package-blueprint.md` (hosting `@ancientpantheon/codex`);
`identity/HANDOFF-consumer-ancienthub-login.md` (the admin login — note the Hub IS the identity provider
here); `automaton/04`/`05` (the Update-page / version surface). Reference implementations: **Mnemosyne**
(`automatons/Mnemosyne` — Codex hosting, the `DualLinkConnector` loop `lib/pythia/connectorLoop.ts`, and
the closest peer: an automaton that both reads and transacts) and **Pythia** (`constructors/Pythia` — the
clean `design/` reference + the meter/ledger this reports into).

---

## 2 · The core metering decision: the Hub REPORTS, it does not RELAY

This is the same pattern Pythia already uses for **her own** fires: her Khronoton does not call her own
HTTP `/send` — it wraps its chain runtime with an in-process metering seam (`meterChainRuntime`) that
submits straight to a node AND records to the ledger. The Hub is the same shape, one process further out
— a **cross-process metering report**. (This holds even if the Dalos Automaton runs on Khronoton: the
in-process seam writes to *Pythia's* in-process ledger, which the Hub — a separate process — cannot
touch, so the Hub reports across the wire regardless.)

**Three metering paths, one ledger:**

| Entity | Chain traffic | Metered via |
|---|---|---|
| Normal consumers (OuronetUI, Mnemosyne, Explorer) | **relay** through Pythia `/send` + `/read` (no node access) | Pythia meters as she serves |
| Pythia's own fires | direct-to-node, in-process | `meterChainRuntime` → ledger |
| **The Hub (Dalos)** | direct-to-node (it *is* the source) | **cross-process REPORT → Pythia** |

So the Hub **keeps firing transactions AND doing reads straight against its nodes** — zero extra round
trips, no new dependency on Pythia for the actual chain work — and sends Pythia a **lightweight, batched,
best-effort metering report** of what it did, keyed with its `x-pythia-key`. Pythia records it into the
same fleet ledger (aggregate + `byConsumer["dalos"]`) as any relayed traffic.

---

## 3 · Reads + PythXP — avoiding BOTH round trips (the load-bearing subtlety)

**Correction to a tempting mistake:** the Hub's chain-data reads are NOT like Pythia's own internal
dirty reads (safety-sims, gas calibration), which are excluded. The Hub reads *real* chain data to do its
work — exactly like Mnemosyne, a genuine consumer. Per the established rule (petitions = client-served
reads, EXCEPT Pythia's own machinery reads), **the Hub's reads DO count as petitions/pondus and DO earn
PythXP.**

Now the two round trips to kill:

- **Round trip A — the read itself.** Avoided the same way as transactions: the Hub reads
  **direct-from-node** and *reports* the read to Pythia; it never relays through Pythia's `/read`.
- **Round trip B — XP attribution.** Normally: Pythia's per-slot meter records a served read →
  `usageReporter` sends the per-slot usage to the Hub → the Hub credits the operator PythXP. For the
  Hub's OWN direct reads, that would mean Hub → Pythia → back-to-Hub just to learn the weight of a read
  the Hub already performed. **Avoid it: the Hub computes the pondus locally and attributes PythXP
  itself**, at read time — it already holds the XP ledger and knows which node/operator served the read.

**How the pieces divide cleanly (no double-count, no round trip):**

- **Pondus is a pure, shared function** — `pondus = classBase + sqrt(gasUsed)/2 + responseBytes/4096`
  (the `sqrt` is per-request, which is why it must be computed by whoever served the read). It is now
  **exported from `@ancientpantheon/pythia-client`** as `pondus()` + `CLASS_BASE` (shipped v2.7.31) — the
  Hub imports it and computes byte-identical weights locally from its own `gasUsed`/`responseBytes`,
  without asking Pythia.
- **XP attribution → done LOCALLY by the Hub** for its own reads (it owns the XP ledger + the nodes).
- **Fleet-ledger accounting → reported ONE-WAY to Pythia** (petitions + pondus, keyed → `byConsumer`),
  for the fleet-wide odometer + the live pulse. Fire-and-forget.
- **Pythia's per-slot usage report to the Hub does NOT include the Hub's own direct reads** — they never
  entered Pythia's per-slot meter (they bypassed her gateway), so Pythia has nothing to send back and
  CANNOT double-attribute. Pythia's per-slot report still carries reads that OTHER consumers made against
  Hub-fed nodes *through Pythia* — those are unaffected. The two channels stay disjoint.

> Policy flag (decide with the operator, don't assume): should the Hub earn PythXP for reads served by
> its OWN nodes (self-service), or only for reads its Dalos makes against *other* operators' nodes? The
> mechanism supports either; the economic choice is yours. Default suggestion: attribute per the existing
> "a served read earns" rule and revisit if self-dealing is a concern.

---

## 4 · Pythia side — DONE (shipped v2.7.31). Reference for what to wire against.

**This whole section is already built, released, and live** — the Hub agent does NOT wait on it. What
Pythia now exposes:

1. **Per-consumer READ attribution** — the ledger's `byConsumer` carries `petitions` + `pondus`;
   `recordRead(pondus, consumer)` attributes keyed reads. (This also gave the fleet the per-API-key
   petitions/pondus surface on `/pyth` + the live pulse.)
2. **Shared `pondus()` + `CLASS_BASE`** — exported from **`@ancientpantheon/pythia-client`** (v2.7.31).
   Import it in the Hub to weigh reads locally, identically to Pythia.
3. **`POST /pyth/report`** — the metering-report ingress. Body:
   `{ transactions?: [{ gasLimit, accepted, count? }], reads?: [{ gasUsed, responseBytes, count? }] }`.
   Send RAW read inputs — Pythia recomputes pondus (a reporter can't inflate weight). Records into the
   **FLEET ledger ONLY**, under the reporter's consumer (`byConsumer[...]`); it never feeds the per-slot
   usage report and is not an operational path (so the gateway meter never double-counts it). Batch is
   validated + bounded, all-or-nothing (any bad field → 400).
4. **Reporter authorization gate** — closed by default. The endpoint accepts reports ONLY from a consumer
   named in the env allow-list **`PYTHIA_REPORTERS`** (comma-separated); anyone else / anonymous → 403.
   **Operator action:** set `PYTHIA_REPORTERS` to the Hub's resolved consumer identifier to open it.
5. **(doc)** `organs/06 §6b` already documents the three-path metering model.

> The Hub's `x-pythia-key` resolving to its consumer identifier uses Pythia's EXISTING connector
> registration — the Hub registers its dual-link (§5) and confirms what name/account its key resolves to,
> then that value goes in `PYTHIA_REPORTERS`. (An ephemeral key resolves to the smart-Apollo account; a
> stored connector resolves to its configured name — confirm which, and allow-list that exact string.)

---

## 5 · Hub-side migration (the automaton wiring — over what ALREADY exists)

> **CRITICAL — preserve the existing Codex and Khronoton state.** The Hub ALREADY has a working Codex
> (holding real keys) and already-defined Khronoton cronotons (the Dalos Automaton). Adopting the new
> `@ancientpantheon/codex` / `@ancientpantheon/khronoton-core` packages must **NOT** re-initialize, wipe,
> or shadow them. **Capture the current vault + cronotons AS THEY ARE**, then migrate the code that
> references them onto the new package APIs. Before touching anything: snapshot/back up the existing
> Codex vault and the Khronoton store, and write a migration step that carries the exact existing keys +
> cronoton definitions across (§5.1). A broken key or a lost cronoton here is a production incident — the
> Dalos Automaton stops firing. Treat the existing data as immutable ground truth to be *carried*, not
> *regenerated*.

- **Connector over the EXISTING Codex.** The Hub already has its Codex — do not create a second one. Add
  a `DualLinkConnector` (`organs/06 §2e`, mirror Mnemosyne's `connectorLoop.ts`) driven by the Hub's
  existing keys / its two linked Apollo halves, minting the `x-pythia-key` that keys its reports.
- **Keep all chain work direct-to-node.** Do NOT reroute Dalos submit/poll/read through Pythia. The Hub
  has the pool; it keeps using it. No change to the chain path, no new latency, no new dependency.
- **Local XP attribution for its own reads** (§3): compute pondus with the shared function at read time;
  credit the serving operator in the Hub's existing XP ledger. This is a refactor of the Hub's *own*
  bookkeeping, not new economics.
- **A metering reporter.** A small background reporter batches the Hub's transactions AND reads and POSTs
  them to Pythia's `/pyth/report` (§4), keyed:
  - **Batched** (N events per flush, not one POST per event).
  - **Fire-and-forget / non-blocking** — never `await` on the fire/read path.
  - **Bounded queue** — if Pythia is unreachable, retain a capped queue and retry; drop oldest past the
    cap (log the drop). A dropped report loses a metering datapoint, NEVER a transaction/read and NEVER
    an XP attribution (XP is already done locally).

---

### 5.1 · Complete the Codex migration — retire the OLD `@ouronet/ouronet-codex`

The Hub's own Codex (§5) MUST be built on the NEW package **`@ancientpantheon/codex`**, not the legacy
**`@ouronet/ouronet-codex`** (https://www.npmjs.com/package/@ouronet/ouronet-codex). This migration is
the moment to finish the Hub's move OFF the old package entirely:

- **Preserve the existing vault across the package switch (see §5's CRITICAL box).** Moving from
  `@ouronet/ouronet-codex` to `@ancientpantheon/codex` is a code/dependency change — it must carry the
  Hub's EXISTING keys/vault across unchanged. Do NOT let the new package initialize a fresh vault over the
  old one. If the on-disk vault format differs between packages, write an explicit one-time migration that
  reads the old vault and writes it in the new format (with a verified back-up first); if it's the same
  format, confirm the new package opens the existing vault byte-for-byte. Same principle for any
  already-defined Khronoton cronotons carried onto `@ancientpantheon/khronoton-core`.
- **Zero remaining imports** of `@ouronet/ouronet-codex` in the Hub after this migration — remove it from
  `package.json` and replace every usage with `@ancientpantheon/codex`. Grep the repo to confirm none
  linger (including transitive/dev usages and any vendored copy).
- **Fleet-wide retirement goal.** The old package is being wound down across the Pantheon — OuronetUI and
  the Explorer migrations already adopt `@ancientpantheon/codex`. The Hub is likely one of the last
  holdouts (it predates the rename). **Once NO consumer depends on `@ouronet/ouronet-codex` anymore, it
  can be safely DEPRECATED on npm** (`npm deprecate @ouronet/ouronet-codex "moved to @ancientpantheon/codex"`).
- **Coordinate the deprecation, don't do it blind.** Before deprecating, verify (npm dependents + a fleet
  grep) that Hub, OuronetUI, Explorer, Mnemosyne, and any pact/tooling repos are all off it. Report the
  Hub's status so the operator can pull the deprecation trigger when the last consumer is clear.
- Any Codex API differences between the two packages surface here — reconcile them as part of the Hub's
  Codex/connector wiring (§5), not as a silent shim around the old surface.

## 6 · The load-bearing rules (do not violate — these prevent a bootstrap deadlock)

1. **Pythia being down must NEVER block the Hub.** Dalos fires and reads happen direct-to-node
   regardless; XP is attributed locally; only the fleet-ledger report is best-effort. Violating this
   cascades a Pythia outage into a Hub outage → whole-fleet wedge.
2. **The Hub → Pythia node feed stays INDEPENDENT of this metering auth.** The hub-feed must not begin to
   depend on the Hub's `x-pythia-key` or on Pythia acking reports. Verify in design that the node feed
   and the metering-report channel are fully decoupled — no edge where each waits on the other.
3. **No double-count / no double-XP.** A Dalos event is metered EITHER by report (this path) OR by relay
   — never both. The Hub's own direct reads are XP-attributed locally and reported to the fleet ledger
   only — never fed back through Pythia's per-slot report.
4. **Best-effort everywhere.** Neither side's core function (Hub firing/reading/attributing, Pythia
   serving) may break from a metering slip on the other side.

---

## 7 · Pantheonic UI migration — role hierarchy, admin dashboard, layout

The Hub already has role-gated menus, **today all crammed onto the same page**. The Pantheonic migration
re-shells this into the standard 3-tier header for non-admins and a separate **admin dashboard** for
admins. **Inventory the existing menus/actions first**, bucket each by role tier (below), then place it.

### 7.1 · The four user tiers — a strict inclusion hierarchy

Four categories, each INCLUDING everything the previous can do, plus its own gated actions:

```
Operator  ⊂  Baron  ⊂  Modern admin  ⊂  Ancient admin
└─ non-admin ─┘        └────── admin ──────┘
```

- **Operator** (non-admin) — base tier.
- **Baron** (non-admin) — everything an operator does **+ baron-only actions**.
- **Modern admin** (ADMIN) — everything a baron does **+ modern-admin actions**.
- **Ancient admin** (ADMIN) — everything a modern admin does **+ ancient-admin actions**.

Model this as ordered levels (e.g. `operator=0, baron=1, modernAdmin=2, ancientAdmin=3`) with a single
`can(user, minLevel)` check, so "includes the previous" is inherent — a baron passes every operator gate,
an ancient admin passes every gate. Do NOT hand-enumerate per-tier allow-lists that duplicate lower tiers.

### 7.2 · The admin/non-admin split drives WHERE things live (the core Pantheonic change)

This is the heart of the migration and the biggest departure from today's "all on one page":

- **Operators + barons are NON-admins.** Their actions live in the **3-tier Pantheonic Header** as normal
  navigation (`design/` §3): Tier-1 sections, Tier-2 sub-views, Tier-3 sub-tabs — **every view
  URL-addressable** (`design/` §3.7). A baron simply sees additional buttons/sections an operator does
  not (gated by tier), but they're all in the same normal header nav.
- **Modern + ancient admins are ADMINS.** Their actions do **NOT** sit inline in the normal page. They
  move behind an **Admin Dashboard** — the sidebar + content-pane layout (`design/` §5) — reached from
  the identity block's admin entry, itself shown only to admin-tier users. Inside the dashboard, modern-
  vs ancient-only panes are gated by tier (an ancient admin sees the modern panes plus the ancient ones).
- **Net:** non-admin capability → header nav; admin capability → admin dashboard. Nothing admin-gated
  remains loose on the main page. This is exactly how the other Pantheonic entities separate the two
  logins; the Hub's four tiers just fold onto the same two-surface split (non-admin header / admin pane).

### 7.3 · Identity / login

The Hub IS the AncientHub identity provider — it hosts the login the other entities *consume*. So the
tier of the logged-in user is known natively; use it to (a) show/hide header sections for
operator-vs-baron and (b) reveal the Admin Dashboard entry for modern/ancient admins. Don't bolt on a
second auth scheme; drive everything off the Hub's existing identity + the tier level.

### 7.4 · Layout — the core page width changes

Adopt the Pantheonic work-area layout, which means the **core page content width changes** to the
standard Pantheonic content column (see `design/` — the header + work-area shell the other entities use,
e.g. Pythia's landing). The Hub's current full-bleed/legacy width is replaced by the Pantheonic
header-over-work-area structure with the same content measure and the collapsible-portrait allowance
where applicable. Build the **3-tier menu in the Pantheonic style** (the `.ph-tier1` / Tier-2 / L3 rows)
rather than the current bespoke nav — the header IS the control surface.

### 7.5 · The rest of the shell

- **Update page (automaton variant)** (`automaton/04`/`05`): list the packages the Hub pulls —
  `@ancientpantheon/codex`, `@ancientpantheon/pythia-client`, and **`@ancientpantheon/khronoton-core`**
  (with versions) — since the Hub IS an automaton that runs Khronoton. Keep the existing
  changelog/version surface and deploy-pipeline hooks.
- **Pythia connection status.** Add a connector-status panel (masked `x-pythia-key` + depleting TTL
  countdown), like Mnemosyne's connector panel (`organs/06 §2e`) — so an admin can see the Hub's link to
  Pythia and whether reports are flowing. (Place it in the Admin Dashboard — it's operator/admin info.)
- **Preserve — re-shell, don't rewrite — the Hub's unique surfaces**, bucketing each by tier: the
  **node-feed management** (the pool it serves Pythia), the **operator / PythXP ledger** views, and the
  **Dalos Automaton controls** and **deploy pipeline**. Functionally identical; they just move into the
  header (non-admin views) or the Admin Dashboard (admin views) per §7.2. The XP ledger view now also
  reflects the Hub's own locally-attributed reads (§3).

---

## 8 · Architecture doc — already updated

`organs/06 §6b` now documents the three-path metering model (relay / in-process seam / cross-process
report) and the rule that an entity holding its own node access AND the XP ledger (the Hub) attributes XP
locally and reports one-way — never round-tripping through Pythia's per-slot channel. Nothing to do here;
it's a reference.

---

## 9 · Out of scope

- Rerouting the Hub's actual chain submit/poll/read through Pythia (explicitly rejected — §2/§3).
- Changing the existing hub-feed (Hub → Pythia node pool) mechanism beyond confirming its independence.
- Redesigning the PythXP economics — only *where* the Hub's own-read attribution is computed changes
  (locally, with the shared formula), not the reward math.
- Re-creating the Codex, the Khronoton cronotons, the role model, or the deploy pipeline — they EXIST;
  this is a migration that preserves and re-shells them, never a rebuild (§0, §5).
- Changing what any tier is ALLOWED to do — the role capabilities are unchanged; only WHERE they render
  (header vs admin dashboard) changes (§7).

---

## 10 · Acceptance criteria

- [x] *(Pythia, DONE v2.7.31)* `byConsumer` carries per-consumer **petitions + pondus**; a shared
      `pondus()` is exported from `@ancientpantheon/pythia-client`; the auth-gated `POST /pyth/report`
      ingress records batched **transactions AND reads** into `byConsumer` (recomputing pondus), fleet-
      ledger-only, no per-slot feed, no gateway double-count; `organs/06 §6b` documents it. — the Hub
      wires against these.
- [ ] **Existing state preserved:** the Hub's existing Codex vault and Khronoton cronotons are carried
      onto `@ancientpantheon/codex` / `@ancientpantheon/khronoton-core` intact — no fresh vault, no lost
      cronoton (verified against a pre-migration back-up), Dalos keeps firing throughout.
- [ ] The Hub adds a `DualLinkConnector` over its EXISTING Codex minting an `x-pythia-key`, and has
      **zero remaining imports of `@ouronet/ouronet-codex`** (grep-clean), so the legacy package can be
      deprecated once the fleet is fully off it (§5.1).
- [ ] The Hub keeps firing Dalos transactions AND doing reads direct-to-node (no reroute through Pythia).
- [ ] The Hub attributes PythXP for its own reads LOCALLY (pondus via the shared formula); Pythia never
      sends those reads back.
- [ ] With Pythia UP: after a Dalos fire/read, `/pyth` `byConsumer["dalos"]` (and the aggregate)
      increment and the consumer appears in the live Activity pulse.
- [ ] With Pythia DOWN: Dalos still fires and reads; XP is still attributed locally; reports queue
      (bounded) and flush on recovery; the Hub is never blocked.
- [ ] The Hub → Pythia node feed is confirmed independent of the metering-report auth (no bootstrap
      deadlock).
- [ ] Both the metering channels are disjoint: no read is both locally-XP-attributed AND round-tripped
      via Pythia's per-slot report (no double-XP).
- [ ] **Roles as a strict inclusion hierarchy** (`operator ⊂ baron ⊂ modern admin ⊂ ancient admin`)
      driven by a single ordered `can(user, minLevel)` check — a higher tier passes every lower gate.
- [ ] **Non-admin (operator/baron) actions live in the 3-tier Pantheonic Header** (URL-addressable,
      `design/` §3/§3.7); **admin (modern/ancient) actions live behind an Admin Dashboard** (sidebar+pane,
      `design/` §5), reached from an admin-only identity entry — NOTHING admin-gated remains loose on the
      main page (the today-state is fixed).
- [ ] The **core page width** is the Pantheonic work-area measure (header-over-work-area shell), and the
      menu is built in the Pantheonic style (`.ph-tier1` / Tier-2 / L3) — not the legacy bespoke nav.
- [ ] The Update page lists Codex + pythia-client + **khronoton-core** (versions); a Pythia
      connection-status panel is present in the Admin Dashboard; node-feed + PythXP-ledger + Dalos
      controls + deploy pipeline are intact, each bucketed into the header or the dashboard by tier.

## 11 · When done

Report, per side: the endpoint's auth model + shape and whether it recomputes pondus (Pythia); the
reporter's batching/queue behavior and the local-XP refactor (Hub); the observed `/pyth`
`byConsumer["dalos"]` delta after a Dalos fire/read; and a demonstration that a Pythia outage does NOT
stop the Hub (fires, reads, and XP attribution all continue). Dev branch; the operator decides go-live.
