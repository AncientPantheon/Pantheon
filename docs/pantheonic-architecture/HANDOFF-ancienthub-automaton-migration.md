# Handoff — Migrate the AncientHub to the Pantheonic architecture (report-metered automaton)

**Audience:** the AncientHub agent (the Hub holds the **Dalos Automaton**, which fires on-chain
transactions AND reads chain data) — and, for the prerequisite, the **Pythia** agent.
**Where to work:** the Hub's **dev branch** — testable locally AND on the dev link. Not prod.
**How to work:** **research-first**, nectar lifecycle (shape → plan → build → review). Read the
Pantheonic architecture (below) BEFORE writing code; produce design + plan under `docs/work/<topic>/`
and get them approved before implementing. This is critical, load-bearing infrastructure — the Hub is
the root of the fleet (it feeds Pythia her nodes). Do NOT free-hand it.

**Siblings:** `HANDOFF-mnemosyne-route-sends-through-pythia.md` and
`HANDOFF-ouronetui-daimon-migration.md` — read them for the *normal* (relay) path and the standard UI
migration shape. The Hub is DELIBERATELY DIFFERENT on metering (see §2–§3) — do NOT just route it
through `/send` — but the UI/identity migration (§7) is the same shape as the others.

---

## 0 · What the Hub becomes, and why it is special

The Hub is an **automaton** in the Pantheonic sense — its Dalos Automaton signs/submits transactions and
reads chain data, so per `organs/06 §6` (Pythia is the on-chain meter) that traffic must be **counted in
Pythia's Pyth ledger** (transactions AND petitions/pondus). Like any automaton it gets its own **Codex**
+ a **`DualLinkConnector`** minting an `x-pythia-key`, so its activity is keyed and attributed.

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
  (the `sqrt` is per-request, which is why it must be computed by whoever served the read). Today it
  lives in Pythia (`pyth/pondus.ts`). **PREREQUISITE: export it as a shared pure function** (see §4) so
  the Hub computes byte-identical weights locally from its own `gasUsed`/`responseBytes`, without asking
  Pythia.
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

## 4 · PREREQUISITE (Pythia side): what Pythia must construct for this to work

Pythia has **no** "record traffic I did elsewhere" door today, and — importantly — she cannot yet
attribute per-consumer **reads** at all (the `byConsumer` shipped in v2.7.30 is **transactions-only**).
So the Hub migration is blocked on FIVE Pythia items (a Pythia nectar topic — the Pythia agent builds
them). Items 1–4 are code; 5 is docs. Build in this order (each builds on the previous):

1. **Per-consumer READ attribution (foundational — currently MISSING).** Extend the ledger's `ConsumerTx`
   / `byConsumer` with `petitions` + `pondus`, and extend `recordRead(pondus)` → `recordRead(pondus,
   consumer?)` so a keyed read credits its consumer. Today `byConsumer` only carries the four
   transaction fields; the Hub's reported reads have nowhere to land without this. **Bonus:** this is
   exactly the "petitions/pondus per API key" surface — once built it lights up for EVERY keyed consumer
   on `/pyth` + the live pulse, not just the Hub.
2. **Export the pondus formula as a shared pure function.** Lift `pyth/pondus.ts`'s `pondus()` +
   `CLASS_BASE` into something the Hub can import (re-export from `@ancientpantheon/pythia-client`, or a
   tiny shared module) so weight is computed identically on both sides. Pythia keeps using it internally;
   the Hub imports it for local XP attribution.
3. **A metering-report ingress, e.g. `POST /pyth/report`** (name TBD). Body: batched outcomes the
   reporter performed — transactions `{ transactions: [{ gasLimit, accepted, count? }] }` AND reads
   `{ reads: [{ gasUsed, responseBytes, count? }] }` (send RAW inputs and let Pythia recompute pondus via
   item 2 — safer than trusting a reporter-supplied weight). Pythia records each via `recordSend(...)` /
   `recordRead(...)` under the reporter's resolved consumer. **Records into the FLEET ledger ONLY — it
   MUST NOT feed the per-slot usage report** (that would round-trip XP back to the Hub; §3).
   - **No double-count:** a reported tx/read must NOT also be relayed through `/send`|`/read`.
4. **A reporter-role authorization gate.** This ingress can inflate the ledger/economy, so it must NOT be
   open. Resolve the consumer from `x-pythia-key`; accept reports ONLY from an authorized **reporter
   role** (the Hub) — not any keyed consumer, never anonymous. Decide the gate in design (dedicated
   reporter allow-list of consumer names / ancient-gated connector flag / distinct reporter credential).
   Validate + bound every field (finite, non-negative, capped batch); malformed → clear 4xx, never
   throws into the ledger.

5. **(doc)** Update `organs/06 §6` to the three-path metering model (§8).

> The Hub's `x-pythia-key` resolving to the `"dalos"` consumer name uses Pythia's EXISTING connector
> registration (`connectorStore.nameForKey`) — no new Pythia work there, just the Hub registering its
> dual-link (§5) and confirming the name is `"dalos"`.

---

## 5 · Hub-side migration (the automaton wiring)

- **Own Codex + connector.** Inventory where the Dalos signing keys live; hold them in the Hub's own
  Codex (`@ancientpantheon/codex`). Wire a `DualLinkConnector` (`organs/06 §2e`, mirror Mnemosyne's
  `connectorLoop.ts`) with its two linked Apollo halves, minting the `x-pythia-key` that keys its reports.
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

## 7 · Pantheonic UI + identity migration (same shape as the other entities)

The Hub is primarily an operator/admin console, but it still adopts the full Pantheonic shell. (I don't
have the Hub's current screens — **inventory the existing UI first**, then apply the standard migration.)

- **3-tier Pantheonic Header** (`design/` §3): replace the current nav with Tier-1 sections + Tier-2
  sub-views; the identity block; **every view URL-addressable** down to Tier-3 sub-tabs (`design/` §3.7).
  Admin areas use the sidebar + content-pane layout (`design/` §5).
- **Identity/login.** The Hub IS the AncientHub identity provider, so its operator console is inherently
  the "admin" surface — gate operator/config views behind the ancient login natively (don't bolt on a
  second scheme). Follow `identity/HANDOFF-consumer-ancienthub-login.md` for the presentation, adapted to
  "this app hosts the login."
- **Update page (automaton variant)** (`automaton/04`/`05`): list the packages the Hub pulls —
  `@ancientpantheon/codex`, `@ancientpantheon/pythia-client` (with versions) — and, since the Hub IS an
  automaton, list **Khronoton with its version** (mark whether the Dalos Automaton actually runs on
  Khronoton — **confirm this**; if Dalos uses its own scheduler, say so and show it instead). Keep the
  existing changelog/version surface.
- **Pythia connection status.** Add a connector-status panel/footer (masked `x-pythia-key` + depleting
  TTL countdown), exactly like Mnemosyne's connector panel (`organs/06 §2e` presentation spec) — so the
  operator can see the Hub's link to Pythia and whether reports are flowing.
- **Preserve — re-shell, don't rewrite — the Hub's unique surfaces:** the **node-feed management** (the
  pool it serves Pythia), the **operator / PythXP ledger** views, and the **Dalos Automaton controls**.
  These stay functionally identical; they just move into the new header/routing/admin layout. The XP
  ledger view now also reflects the Hub's own locally-attributed reads (§3).

---

## 8 · Also update the architecture doc

`organs/06 §6` currently frames metering as "route all traffic through Pythia's gateway." This migration
generalizes it to **three** paths (relay / in-process seam / cross-process report), and adds the rule
that an entity holding its own node access AND the XP ledger (the Hub) attributes XP locally and reports
one-way — never round-tripping through Pythia's per-slot channel. The Pythia agent should land this doc
update alongside the endpoint.

---

## 9 · Out of scope

- Rerouting the Hub's actual chain submit/poll/read through Pythia (explicitly rejected — §2/§3).
- Changing the existing hub-feed (Hub → Pythia node pool) mechanism beyond confirming its independence.
- Redesigning the PythXP economics — only *where* the Hub's own-read attribution is computed changes
  (locally, with the shared formula), not the reward math.

---

## 10 · Acceptance criteria

- [ ] Pythia's `byConsumer` carries per-consumer **petitions + pondus** (not just transactions), via a
      `recordRead(pondus, consumer?)` — so keyed reads are attributed per consumer (also the "per-key
      petitions/pondus" surface). This is the missing foundational piece (§4 item 1).
- [ ] Pythia exports a shared `pondus()` the Hub imports, and an authorization-gated, keyed
      metering-report ingress that records batched **transactions AND reads** into the fleet ledger's
      aggregate + `byConsumer["dalos"]`, validated/bounded (recomputing pondus from raw inputs), with NO
      feed into the per-slot usage report and NO double-count vs the gateway.
- [ ] The Hub has its own Codex on **`@ancientpantheon/codex`** + a `DualLinkConnector` minting an
      `x-pythia-key` — and **zero remaining imports of `@ouronet/ouronet-codex`** (grep-clean), so the
      legacy package can be deprecated once the fleet is fully off it (§5.1).
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
- [ ] The Hub uses the 3-tier Pantheonic Header with URL-addressable views (`design/` §3, §3.7); admin
      uses the sidebar+pane; the Update page lists Codex + pythia-client + Khronoton (or the Dalos
      scheduler); a Pythia connection-status panel is present; node-feed + XP-ledger + Dalos controls are
      intact in the new shell.
- [ ] `organs/06 §6` updated to the three-path metering model.

## 11 · When done

Report, per side: the endpoint's auth model + shape and whether it recomputes pondus (Pythia); the
reporter's batching/queue behavior and the local-XP refactor (Hub); the observed `/pyth`
`byConsumer["dalos"]` delta after a Dalos fire/read; and a demonstration that a Pythia outage does NOT
stop the Hub (fires, reads, and XP attribution all continue). Dev branch; the operator decides go-live.
