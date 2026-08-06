# Handoff — Migrate the AncientHub to the Pantheonic architecture (report-metered automaton)

**Audience:** the AncientHub agent (the Hub holds the **Dalos Automaton**, which fires on-chain
transactions) — and, for the prerequisite, the **Pythia** agent.
**Where to work:** the dev branch — testable locally AND on the dev link.
**How to work:** research-first, nectar lifecycle (shape → plan → build → review). This is critical,
load-bearing infrastructure — do not free-hand it.
**Siblings:** `HANDOFF-mnemosyne-route-sends-through-pythia.md` and
`HANDOFF-ouronetui-route-sends-through-pythia.md` — read them for the *normal* (relay) metering path.
The Hub is DELIBERATELY DIFFERENT (see §1) — do NOT just route it through `/send`.

---

## 0 · What the Hub becomes, and why it's special

The Hub is an **automaton** in the Pantheonic sense — its Dalos Automaton signs and submits on-chain
transactions, so per `organs/06 §6` (Pythia is the on-chain meter) that traffic must be **counted in
Pythia's Pyth ledger**. Like any automaton it gets its own **Codex** + a **`DualLinkConnector`** minting
an `x-pythia-key`, so its activity is keyed and attributed.

But the Hub is **not** a normal consumer, for two reasons that forbid the usual "route sends through
Pythia's `/send`" fix:

1. **The Hub IS Pythia's node source.** The Hub serves the node pool to Pythia (the hub-feed); Pythia
   serves those nodes to consumers and reports usage back to the Hub. The Hub already has direct node
   access — relaying its own transactions *through* Pythia (Hub → Pythia → node) is a redundant round
   trip back to nodes the Hub already holds.
2. **Dependency inversion.** If the Hub's Dalos fires depended on Pythia's `/send` being up, then Pythia
   being down would freeze the Hub's automaton — even though the Hub is MORE foundational than Pythia
   (it feeds her the nodes). That inverts the dependency and risks a bootstrap deadlock.

---

## 1 · The core decision: the Hub REPORTS its transactions, it does not RELAY them

This is the same pattern Pythia already uses for **her own** fires: her Khronoton does not call her own
HTTP `/send` — it wraps its chain runtime with an in-process metering seam (`meterChainRuntime`) that
submits straight to a node AND records to the ledger. The Hub is the same shape, one process further out
— a **cross-process metering report**.

**Three metering paths, one ledger:**

| Entity | Chain traffic | Metered via |
|---|---|---|
| Normal consumers (OuronetUI, Mnemosyne, Explorer) | **relay** through Pythia `/send` (no node access) | Pythia meters as she relays |
| Pythia's own fires | direct-to-node, in-process | `meterChainRuntime` → ledger |
| **The Hub (Dalos)** | direct-to-node (it *is* the source) | **cross-process REPORT → Pythia** |

So the Hub:
- **Keeps firing its Dalos transactions straight to its nodes** — zero extra round trips, no new
  dependency on Pythia for the actual chain work.
- **Sends Pythia a lightweight, batched, best-effort metering report** of what it fired, keyed with its
  `x-pythia-key`. Pythia records those into the aggregate `transactions` + `byConsumer["dalos"]` (or
  `"hub"`), exactly as if she'd relayed them — following the same reporting/attribution rules. It is the
  mirror of the per-slot usage report Pythia already sends the Hub, flowing the other way.

---

## 2 · PREREQUISITE (Pythia side): a metering-report ingress endpoint

Pythia has **no** "record a transaction I did elsewhere" door today — she only meters what flows through
her gateway. This must be added first. **This is a Pythia handoff item** (the Pythia agent builds it):

- **New endpoint, e.g. `POST /pyth/report`** (name TBD). Body: a batch of transaction outcomes the
  reporter performed, e.g. `{ transactions: [{ gasLimit: number, accepted: boolean, count?: number }] }`
  (optionally reads later — see §5). Pythia records each into `pythLedger.recordSend(accepted, gasLimit,
  count, consumer)` under the reporter's resolved consumer — reusing the exact per-consumer accounting
  built in v2.7.30 (`byConsumer`).
- **Keyed + authorization-gated.** This ingress can inflate the ledger, so it must NOT be open. Resolve
  the consumer from the `x-pythia-key`, and accept reports ONLY from an authorized **reporter role**
  (the Hub) — not any keyed consumer, and not anonymous. Decide the gate in design: a dedicated reporter
  allow-list, an ancient-gated connector flag, or a distinct reporter credential. Validate + bound every
  field (finite, non-negative, capped batch size) so a bad/hostile report can never corrupt the ledger
  or the economy.
- **Best-effort semantics on Pythia's side too:** a malformed report is rejected with a clear 4xx; it
  never throws into the ledger.
- **Attribution:** the Hub's reports land under a stable consumer label (`"dalos"` or `"hub"`), visible
  in `/pyth` `byConsumer` and the live Activity pulse alongside every other consumer.

> The Pythia agent should treat this as its own nectar topic (design → build → review → release), and
> confirm it does NOT double-count: a reported tx must not ALSO be relayed through `/send`.

---

## 3 · Hub-side migration

- **Own Codex + connector.** The Hub holds its own Codex (its Dalos signing keys already live
  somewhere — inventory that) and wires a `DualLinkConnector` (`organs/06 §2e`, mirror Mnemosyne's
  `connectorLoop.ts`) with its two linked Apollo halves, minting the `x-pythia-key`. This is what keys
  its reports.
- **Keep firing Dalos direct-to-node.** Do NOT reroute the actual submit/poll through Pythia. The Hub
  has the node pool; it keeps using it. No change to the chain path.
- **Add a metering reporter.** After a Dalos tx is submitted (and, ideally, after its outcome is known —
  mined vs failed), enqueue a metering record. A small background reporter POSTs the batched queue to
  Pythia's `/pyth/report` (§2) every few seconds, keyed with the `x-pythia-key`.
  - **Batched** (N txs per flush, not one POST per tx).
  - **Fire-and-forget / non-blocking** — never `await` it on the fire path.
  - **Queued with a bound** — if Pythia is unreachable, retain a capped queue and retry; drop oldest past
    the cap (log the drop, don't grow unbounded). A dropped report loses a metering data point, never a
    transaction.
- **Pantheonic UI + admin.** Bring the Hub's own console under the Pantheonic header/routing and the
  AncientHub admin login where applicable (mirror the daimon/automaton handoffs), and surface a Pythia
  connection status (key + countdown) like Mnemosyne's connector panel.

---

## 4 · The load-bearing rules (do not violate — these prevent a bootstrap deadlock)

1. **Pythia being down must NEVER block the Hub's Dalos fires.** The tx submits direct-to-node
   regardless; the report is best-effort. If this rule is violated, a Pythia outage cascades into a Hub
   outage, which (since the Hub feeds Pythia her nodes) can wedge the whole fleet.
2. **Pythia getting nodes from the Hub must stay INDEPENDENT of this metering auth.** The hub-feed (Hub →
   Pythia node pool) must not begin to depend on the Hub's `x-pythia-key` or on Pythia acknowledging
   reports. Verify in design that the node feed and the metering-report channel are fully decoupled — no
   new edge that makes each side wait on the other.
3. **No double-count.** A Dalos tx is metered EITHER by report (this path) OR by relay — never both. The
   Hub does not route Dalos sends through `/send`.
4. **Best-effort everywhere.** Neither side's core function (Hub firing, Pythia serving) may be broken by
   a metering slip on the other side.

---

## 5 · Reads (scope)

The Hub's Dalos does its own dirty reads directly against its nodes. Like **Pythia's own** internal dirty
reads (which are deliberately NOT counted as petitions — see `meteredRuntime`'s comment), the Hub's own
machinery reads are **not client-served petitions** and are **out of scope** for metering here. Report
**transactions** only. (If per-consumer read/pondus attribution is later added Pantheon-wide, the report
endpoint can be extended to carry reads — but not in this migration.)

---

## 6 · Reporting-rule alignment (so it "follows Pythia's rules")

- Reports are **keyed** with the Hub's `x-pythia-key` → attributed to the `"dalos"`/`"hub"` consumer.
- They increment the same **aggregate `transactions`** counter and the **`byConsumer`** tally as any
  relayed send — visible on `/pyth` and the live pulse. No separate ledger, no special-case accounting.
- Transactions = fires (the established rule). The Hub's fires now count like everyone else's — just
  delivered by report instead of relay.

---

## 7 · Also update the architecture doc

`organs/06-pythia-client-wire-in.md §6` currently frames metering as "route all traffic through Pythia's
gateway." This migration generalizes it to **three** paths (relay / in-process seam / cross-process
report). Add the report path as the sanctioned way for an entity that (a) legitimately holds its own
direct node access AND (b) would create a harmful dependency by routing through Pythia — i.e. Pythia's
own process and the Hub. Everyone else still relays. (The Pythia agent should land this doc update with
the endpoint.)

---

## 8 · Acceptance criteria

- [ ] Pythia exposes an authorization-gated, keyed metering-report ingress that records batched
      transaction outcomes into the ledger's aggregate + `byConsumer` under the Hub's consumer label,
      with validated/bounded inputs and no double-count vs `/send`.
- [ ] The Hub has its own Codex + `DualLinkConnector` minting an `x-pythia-key`.
- [ ] The Hub keeps firing Dalos transactions direct-to-node (no reroute through Pythia); a background,
      batched, best-effort reporter posts what it fired to Pythia.
- [ ] With Pythia UP: after Dalos fires, `/pyth` `byConsumer["dalos"]` (and the aggregate) increment, and
      the consumer appears in the live Activity pulse.
- [ ] With Pythia DOWN: Dalos still fires normally; reports queue (bounded) and flush on recovery; the Hub
      is never blocked.
- [ ] The Hub → Pythia node feed is confirmed independent of the metering-report auth (no bootstrap
      deadlock).
- [ ] `organs/06 §6` updated to the three-path metering model.

## 9 · Out of scope

- Rerouting the Hub's actual chain submit/poll through Pythia (explicitly rejected — §1).
- Per-consumer read/pondus attribution for the Hub (transactions only here).
- Any change to the existing hub-feed (Hub → Pythia node pool) mechanism beyond confirming its
  independence.

## 10 · When done

Report, per side: the endpoint's auth model + shape (Pythia), the reporter's batching/queue behavior
(Hub), and the observed `/pyth` `byConsumer["dalos"]` delta after a Dalos fire — plus a demonstration
that a Pythia outage does NOT stop the Hub. Dev branch; the operator decides go-live.
