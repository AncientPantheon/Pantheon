# Pantheonic Architecture — Changelog

Human-readable log of what the library gains or changes, on top of git history. Newest first.

## 2026-08-05 — `organs/06` §6a expanded: the rule is ABSOLUTE — reads, simulations, sends AND autonomous fires, all through Pythia

Clarified (from Mnemosyne's `pythia-write-routing`, taken to full conformance) that §6 leaves nothing on
a node: a consumer's `signingClient` must route `dirtyRead` (gas simulation) through Pythia's
`/stoachain/read` too — not just the send — and must NOT surface a per-user direct-node field (drop the
local direct-node connection; a direct node is admin-gated only). Documented the embedded-Khronoton
wrap concretely (`createClient` → submit/dirtyRead/listen forwarded to Pythia; ref
`lib/khronoton/pythiaRoutedRuntime.ts`) and its **known gap**: Pythia's `/poll` reports mined-status
only, not the on-chain command result, so a node-less consumer treats a mined fire as success — closing
it needs `/poll` to return the command result (a Pythia enhancement). Metering is unaffected (counts at
`/send`).

## 2026-08-05 — `organs/06` §6a: the loaded-CODEX send bypass, and the `signingClient` fix (so implementers don't guess)

Learned live in Mnemosyne (`pythia-write-routing`, closing
`HANDOFF-mnemosyne-route-sends-through-pythia.md`). §6 already said "an automaton must not fire directly
to a node unmetered," but a consumer that surfaces the codex-ouronet dashboard has a non-obvious trap:
wiring the Pythia `global` connection routes **reads** (petitions climb, looks metered) while the codex's
**writes** still submit direct-to-node inside `CodexSigningStrategy` — so `transactions` stays flat. Added
§6a documenting the supported fix: inject a **`signingClient`** into `<CodexProvider>` whose `submit`
relays the signed command through Pythia's `/stoachain/send` (keyed via a consumer-owned, auth-gated
**server** relay, because the `x-pythia-key` is a server secret) while `dirtyRead` stays a direct-node
`/local` for accurate gas; map `503 pythia_no_tx_sender` clearly with no node fallback. Also flags that a
consumer's embedded-Khronoton fires are a SEPARATE submit seam needing the same treatment. Reference impl:
Mnemosyne `app/api/pythia/relay/route.ts` + `app/codex/codexRelaySigningClient.ts` +
`app/admin/codex/MnemosyneCodex.tsx`.

## 2026-08-06 — `organs/06 §6b`: three metering paths + per-consumer attribution

Recorded the three sanctioned ways an entity's on-chain traffic reaches Pythia's ONE ledger, learned
while building the Hub prerequisites: gateway RELAY (normal consumers), in-process SEAM (Pythia's own
fires via `meterChainRuntime`), and cross-process REPORT (the AncientHub — it holds its own node access
AND the PythXP ledger, so it fires/reads direct-to-node, attributes XP locally, and one-way reports to
`POST /pyth/report`, fleet-ledger-only, never the per-slot channel; `pondus()` is exported from
`@ancientpantheon/pythia-client` so both sides weigh identically). Also documented that every counted
read AND send is now attributed per consumer in `byConsumer` (surfaced on `/pyth` + the live pulse as
per-key petitions/pondus/transactions).

## 2026-08-06 — new `HANDOFF-ancienthub-automaton-migration.md`

Full migration handoff for the **AncientHub** (which holds the **Dalos Automaton**) into the Pantheonic
architecture — with a genuinely new metering pattern and the complete UI/identity migration. The Hub is
special on three counts: it IS Pythia's node source (feeds her the pool), it IS the PythXP-ledger holder
(Pythia reports usage to it), and it must survive Pythia being down (it is more foundational). Routing its
Dalos traffic through Pythia's gateway would be a redundant round trip AND a dependency inversion.
Resolution — the Hub **REPORTS** its traffic rather than **RELAYING** it (same philosophy as Pythia
metering her own fires in-process via `meterChainRuntime`, one process out as a cross-process report),
establishing **three** metering paths into the one ledger: gateway-relay (normal consumers), in-process
seam (Pythia's own fires), cross-process report (the Hub). Kills BOTH round trips — for transactions AND
for reads/PythXP: the Hub reads direct-from-node, computes pondus LOCALLY (shared pure formula, exported
from Pythia), attributes PythXP itself (it holds the ledger + owns the nodes), and reports one-way to
Pythia's FLEET ledger only — never fed back through Pythia's per-slot usage report (no double-XP).
Corrects the tempting error of treating the Hub's reads like Pythia's own excluded dirty reads: they are
genuine consumer reads (like Mnemosyne) that DO count and DO earn. Pythia prerequisites: export `pondus()`
as shared, and add an auth-gated keyed metering-report ingress (`POST /pyth/report`, txs + reads) that
records into `byConsumer["dalos"]` (reusing v2.7.30) and MUST NOT feed the per-slot report. Also covers
the full Pantheonic UI migration (3-tier header + URL routing, native ancient-login admin, Update page
automaton variant, Pythia connection-status panel) while re-shelling the Hub's unique surfaces (node-feed
management, operator/PythXP ledger, Dalos controls). Load-bearing rules: Pythia-down never blocks the Hub;
the node feed stays independent of the metering auth (no bootstrap deadlock); no double-count/double-XP.
Directs generalizing `organs/06 §6` to the three-path model. Refined with the full Pythia construction checklist — the Hub's reads force a NEW foundational piece: per-consumer READ attribution (petitions/pondus in `byConsumer` via `recordRead(consumer)`), which doubles as the long-requested per-API-key petitions/pondus surface — plus exported `pondus()`, the report ingress (txs + reads), and a reporter-role gate. Also mandates completing the Codex migration to `@ancientpantheon/codex` and removing the legacy `@ouronet/ouronet-codex` so it can be deprecated on npm once the fleet is fully off it.

## 2026-08-05 — new `HANDOFF-mnemosyne-route-sends-through-pythia.md`

Sibling to the OuronetUI send-routing handoff, tailored to Mnemosyne: asks the Mnemosyne agent to verify
that on-chain transactions done on its website — **loading a Codex and operating on it** (handling
stuff, and specifically **registering Apollo halves via the loaded Codex**) — are routed through Pythia's
`POST /stoachain/send` so they're metered, rather than submitted direct-to-node (the exact miswire found
in OuronetUI, where reads counted but sends bypassed the meter). Covers both transaction paths
(website/loaded-Codex + Khronoton fires), the fix (route every SIGNED submit through the same
`x-pythia-key` connection already used for reads — `client.send`/`client.poll`), the `pythia_no_tx_sender`
503 to surface, and a concrete verify step (register a half → watch `/pyth` `transactions` move). Notes
that keeping sends keyed is what makes them show as `byConsumer["mnemosyne"]` once Pythia's per-consumer
attribution lands. Reinforces `organs/06 §6` (Pythia is the on-chain meter; all traffic flows through her).

## 2026-08-05 — new `HANDOFF-ouronetui-route-sends-through-pythia.md`

Targeted fix-handoff for the OuronetUI agent, diagnosed live: transactions fired from OuronetUI don't
increment Pythia's ledger because OuronetUI submits signed txs **directly to a chainweb node**, bypassing
Pythia's `POST /stoachain/send`. Confirmed against the live fleet ledger (`GET /pyth`): today shows
`petitions: 54` (reads reach Pythia and count) but `transactions: 0, failedTransactions: 0` — Pythia
never received a send; the only lifetime transaction is her own automaton A_Link fire. Pythia side is
correct (meter wired app-wide, `/stoachain/send` counts via the txTracker on mine). The fix is purely
OuronetUI-side: route ALL writes through the SAME PythiaClient already used for reads —
`client.send({chainId,cmds})` + `client.poll(...)` instead of direct-to-node submit — so the x-pythia-key
rides along (routing makes the tx COUNT; the key makes it EARN at the hub). Reinforces `organs/06 §6`:
a daimon routes reads AND sends AND polls through Pythia.

## 2026-08-05 — `HANDOFF-explorer-seer-migration.md` §4.1: the block-ingest lane is settled (single fixed node, NOT Pythia)

Resolved the §4 research flag against Pythia's actual source. Confirmed Pythia relays only Pact
`/local | /send | /poll` and exposes none of the chainweb data-layer endpoints (`cut / header /
payload / branch`) an indexer needs. Decided — and folded into the handoff — that the Explorer runs
TWO separate chain lanes: **block ingest** sources from a SINGLE admin-configured node (never Pythia,
never a rotating/failover pool — an indexer needs one coherent view; rotating causes height-skew gaps,
split-branch reorg inconsistency, and backfill 404s), swappable via an admin-only fallback list
(node1 → node2 → custom) on health/manual; **on-page reads** route through Pythia as normal (keyed →
metered → earning). Routing block ingest through Pythia is explicitly out of scope — it would need a
Pythia block-relay enhancement (a new metered verb + a bytes-weighted counter + a PINNED single-node
relay, not the failover pool) and only if the operator later wants block-pull volume in the Pyth
economy. Updated §4/§4.1, §5 (per-lane availability), the acceptance criteria, and §9.

## 2026-08-04 — new `HANDOFF-explorer-seer-migration.md`

Added the migration handoff for the **Explorer** (StoaExplorer / Ouronet Explorer — a NestJS backend +
two frontends over one DB) to adopt the Pantheonic architecture as a **SEER** (observes the chain: polls,
downloads, and serves blocks; reads via Pythia; holds its own Codex for the connection; no Khronoton, no
transactions). Sibling to the OuronetUI daimon handoff, with three deltas: it's a seer, it has a polling
backend + database, and it has two frontends over one backend (so every UI change is a double
implementation). Core safety change: split Settings — PUBLIC keeps only theme + a read-only Pythia
connection status; the chain SOURCE (node/backend URL, network, presets — what the backend downloads into
its DB) moves behind the AncientHub admin login, so a public user can never point ingestion at an
arbitrary node. Its own Codex (Apollo halves) drives the ~3h `x-pythia-key`; the backend sources chain
data via Pythia by default with an admin-only direct-node fallback (node1/node2 + custom). Flags the one
real research question: whether Pythia's gateway relays the chainweb block/header/payload/cut endpoints
the poller needs, or only `/local` Pact reads.

## 2026-08-04 — new `HANDOFF-ouronetui-daimon-migration.md`

Added the migration handoff for **OuronetUI** to adopt the Pantheonic architecture as a **daimon** (uses
Pythia + Codex, NOT Khronoton — it performs no autonomous transactions). Specifies: the vertical→3-tier
horizontal header + URL routing migration; the two distinct logins (USER = create/load Codex, dropping
Google Drive; ADMIN = Login with AncientHub gating settings); OuronetDev's own Codex holding its two
already-linked Apollo halves + a `DualLinkConnector` minting the ~3h `x-pythia-key`; all blockchain
traffic routed through Pythia by default with an OFFLINE-until-Pythia state and an admin-only fallback to
direct nodes (node1/node2 + custom); the daimon Update-page variant (lists Khronoton's version but never
pulls it); and the footer Pythia connection status replacing the node2 line. Research-first, dev-branch,
nectar lifecycle. Mnemosyne storage-tier integration explicitly out of scope.

## 2026-08-04 — `organs/06` §2e gained a fourth correction: a consumer MUST drive the connector, or it never mints a key

Learned live in Mnemosyne (`pythia-connector-rework`): the doc left implicit that a `DualLinkConnector`
does NOTHING until something ticks it — `status()` only reports cached state, and the request-time
`keyProvider()` mints a secret ONLY when real gated traffic flows through `PythiaClient`. Mnemosyne
shipped correct wiring with a dormant gated client, so its admin panel sat at `{pending, pending}`
forever even though the pair was perfectly linked. Added a callout making the rule explicit: any
consumer that DISPLAYS connector status (or wants its key kept warm independent of request traffic)
must drive the connector itself — a boot-time `tick()` loop (with the immediate-tick-on-start fix),
an immediate tick on link, and a tick on each status poll — because activation is multi-step (prove →
Pythia's resolver links → prove → secret) and can't complete on a single tick. Corrects the earlier
"needs no loop at all" wording (true only when live gated traffic already flows). Reference:
Mnemosyne's `lib/pythia/connectorLoop.ts`. (Mnemosyne's own connector panel was also brought into full
conformance with §2e's presentation spec — framed `.acct-card` halves with ellipsis-truncated
addresses, one consolidated masked secret + depleting timer bar + always-seconds countdown.)

## 2026-08-03 — `design/…` §3.7 + §5.1 + conformance: URL-addressability extends to Tier-3 sub-tabs

Extended the "every navigable view has its own URL" standard down to **Tier-3**: a sub-tab strip
inside a view (e.g. the admin StoaChain connector page's Hub Feed / Observation / Upload / Routing
tabs) must be addressable one level deeper (`#section/sub/subtab`), routed from the URL — a click
navigates the hash, the router shows the panel, Back restores the prior sub-tab, and a bare view URL
resolves to the strip's declared default. Closes the anti-pattern of a sub-tab strip that flips panels
in memory behind an unchanging URL (addressable at Tier-1/Tier-2 but opaque at Tier-3). Learned live
in Pythia, which now implements it (`VIEW_SUBTABS` + `applySubtab` in `public/admin.js`); landing
Tier-1/Tier-2 already conformed. Updated §3.7, §5.1, and the §7 conformance checklist.

## 2026-08-04 — `organs/06` §6: Pythia is the Pantheon's on-chain METER — every entity's traffic must flow through her

Recorded the load-bearing principle (learned live): Pythia exists to count ALL Pantheon on-chain
activity in her Pyth ledger — consumer gateway traffic, **her own automaton fires** (which submit
straight to a node and previously bypassed the meter — now wrapped via `meterChainRuntime`), AND every
other automaton/daimon (Mnemosyne, OuronetUI, future Aletheia). The rule generalizes: an automaton must
not fire directly-to-node unmetered; its on-chain traffic must route through Pythia — either through her
`/send`+`/read` gateway, or, if it runs its own embedded Khronoton, by wrapping that engine's chain
runtime with the same metering seam. Firing unmetered is a conformance bug.

## 2026-08-03 — `organs/05` §6.1–6.3: server-resolver setup completeness + UI/routing requirements

Extended the server-resolver rules (§6) with the requirements learned live in Pythia's Khronoton admin:
**§6.1 setup completeness** — an automaton declares a fixed set of server resolvers and the setup is
complete only when every one is consumed by exactly one cronoton; the admin needs a resolver ROSTER
showing which are consumed. **§6.2 UI for a server-resolver cronoton** — mark it as special (badge); an
evented/trigger-only row must show Schedule = "Evented" (not the stored schedule), Next Fire =
"Evented"/"—", and DISABLE the schedule controls in the edit form; a system cronoton must be deletable
with a warning, not hard-blocked. **§6.3 routing** — the engine UI's list/detail/builder each get their
own URL (design §3.7 applies inside a mounted package component too). Flags that khronoton-core doesn't
yet satisfy these (tracked in Pythia's evented-resolver handoff) and that an automaton implementing the
pattern from scratch must satisfy §6 directly.

## 2026-08-03 — new `identity/how-an-entity-becomes-a-pythia-verifier.md`

Added the entity-level standard for **how a Pantheon entity becomes a Pythia verifier** — the trust
anchor that proves a user controls both Apollo halves before Pythia autonomously fires
`A_LinkDualApiKey`. Companion to the existing byte-exact `HANDOFF-apollo-ownership-verifier.md` (which
tells the Codex agent how to *build* `/apollo-verify`); the new doc says what an *entity* must run and
register to be a verifier: Apollo key custody in a Codex, serving `/apollo-verify` at a stable origin,
signing the canonical message byte-exact, reachability, and registration in Pythia's admin verifier
registry (Pythia seeds none — registration is the deliberate human on-ramp). Names **Mnemosyne** and
**OuronetUI** as the first two supported verifier entities (only these two for now; the gate is Apollo
key custody, expansion TBD at the Pantheon level). Unblocks the operator-driven step of bringing
Mnemosyne up to verifier status.

## 2026-08-03 — `organs/05-khronoton-engine-wire-in.md`: DELEGATE key resolution to Codex, don't hand-roll a KeyResolver

Refined (same day) after establishing the root cause: the seedType signing bug arose because each
Khronoton consumer HAND-ROLLED its `KeyResolver` (re-deriving a subset of Codex's derivation, koala
only) instead of delegating to Codex's own complete, seedType-aware resolver — which the embedded
Codex owns and the published package exports (`createHeadlessCodexResolver`). The Hub's monolithic
Khronoton never hit it (it used Codex's full resolver); the pluggable `KeyResolver` seam invited
partial reimplementations (Mnemosyne's, then Pythia's copy). The callout now leads with **delegate to
Codex's headless resolver**; the seedType-aware hand-roll (koala vs chainweaver/eckowallet, both
password-independent pubkeys, keep the wrong-key guard) is documented only as the interim fallback.
Flags that Mnemosyne carries the identical latent bug and should adopt the delegation too. Reference:
`keyResolver.ts`'s `fromSeedAccount` + `keyResolver.test.ts` (interim); target is delegation.

## 2026-08-02 — `organs/05-khronoton-engine-wire-in.md`: filter codex accounts to Kadena keys when backing `KeyResolver`/the signer picker

Learned live in Pythia: an operator codex holds mixed-curve accounts (Kadena/DALOS 64-hex keys
alongside Apollo `<len>.<xy>` keys), and a consumer's `KeyResolver`/`SignerSource` implementation
must filter to Kadena keys only — otherwise Apollo keys leak into Khronoton's Builder signing-key
picker (`DALOS.GAS_PAYER`). Added a callout under the `KeyResolver` seam documenting that the robust
filter is on the **key format itself** (`/^[0-9a-fA-F]{64}$/`), NOT on Codex's `originCurve`
metadata — Pythia first tried the metadata filter and it didn't hold in the field (real Apollo
accounts don't reliably set it). Khronoton-core itself stays curve-agnostic; the filtering is the
consumer's job because only the consumer knows it wants Kadena keys.

## 2026-08-02 — new `automaton/05-deploy-panel-and-progress.md` §10: local state files vs. the blue-green handoff race

A genuine production bug, confirmed live: Pythia's Pyth ledger admin "Nuke" button was silently
undone by an in-flight redeploy. Root cause, generalized: any local file a container mutates at
runtime (read at boot, written on an interval/shutdown) can be resurrected by an INCOMING
container's blue-green health-check window — it boots and loads the file into memory up to ~60s
*before* traffic cuts over (§1b/§3), so a reset landing on the still-live OUTGOING container in
that window is invisible to the already-booted incoming one, whose own next write silently
clobbers the reset. Shipped as `pyth-ledger-nuke-race`: `PythLedger` now tracks a `generation`
counter bumped only by `nuke()`; every `persist()` first checks the on-disk generation and
self-heals (reloads) instead of writing a stale snapshot over a newer reset it doesn't know about.

- **New §10** documents the generalized pattern (not Pythia-specific) so a future automaton with
  its own locally-persisted runtime state applies the generation-guard from the start, instead of
  discovering the same race independently.

## 2026-08-02 — `organs/06-pythia-client-wire-in.md` §2e gained a third correction callout: immediate tick on `start()`, and the `.acct-card` layout fix

Two more live-use corrections, shipped as `self-connector-boot-tick-and-layout`, following directly
from the `self-connector-panel-redesign` entry below:

- **A consumer's own periodic refresh loop must fire an immediate tick on `start()`.** A bare
  `setInterval` only fires its first call after a full `intervalMs` elapses (24h for Pythia's own
  `SelfConnectorLoop`) — so every redeploy showed a false "not-linked" for an already-linked,
  perfectly valid pair for up to a day. `start()` now fires one immediate `tick()`
  (fire-and-forget) in addition to the periodic one. §2e's Step-adjacent correction callout states
  this as a general rule for any consumer building its own scheduled loop, not just Pythia's class.
- **The reference UI's per-half zones are `.acct-card`, not `.deploy-row`** — a single-line flex row
  can't safely hold an unbreakable 162-char Apollo address next to a state chip without explicit
  truncation handling; the address bled out and visually collided with the chip. `.acct-card` is a
  bordered zone with the label + chip on their own top line and the ellipsis-truncated address
  below. §2e's worked example and "concrete, working reference implementation" paragraph are
  corrected to name the right class.
- The `formatCountdown` example is corrected to always show seconds (`"23h 58m 41s"`, not
  `"23h 58m"`) — a countdown that only visibly changes once a minute reads as static; always
  showing seconds is what makes it read as genuinely live.
- **§4 (Reference implementation) extended** with the new design doc
  (`docs/work/self-connector-boot-tick-and-layout/design.md`, Topic 5).

## 2026-08-01 — `organs/06-pythia-client-wire-in.md` §2e corrected: ONE consolidated secret, never one per half

Follow-on correction to the `self-connector-codex-signing` entry directly below, triggered by live
user feedback after Pythia linked her own dual-Apollo pair for the first time in her own admin panel:
the panel showed TWO masked ephemeral secrets, one per Apollo half, which reads as if two independent
credentials exist — when `DualLinkConnector.status()` already computes a single deduped
`secret`/`expiresAt` (standard preferred, smart fallback) and that is the only value Pythia's gate
ever honors. Shipped as `self-connector-panel-redesign`: `SelfConnectorLoop`/`SelfConnectorStatus`
now surface that one consolidated value at the top level; the per-half view carries only diagnostic
`state`, never a secret; and Pythia's own Self Connector admin panel was rebuilt into the codebase's
established framed-card language (`.deploy-card`/`.deploy-row`) with exactly one masked secret, one
depleting timer bar, and one text countdown for the whole linked pair, plus two per-half state chips.

- **§2e gained a second correction callout**, after the Codex-signing one: Step 4's UI guidance —
  which previously read `status().standard.secret`/`.smart.secret` for display, a per-half
  pattern — is corrected to read only `dualLink.status()`'s own top-level `secret`/`expiresAt`.
  Per-half state remains useful to show separately as a diagnostic chip (so a struggling half stays
  visible), but a per-half *secret* display is now explicitly called out as the wrong pattern this
  session already built once and had to correct, so a future implementation (Mnemosyne's) doesn't
  repeat it. The paragraph directly above Step 4, which previously said per-half state "is what step
  4 reads for display," is corrected to match. Step 4's worked example and its "concrete, working
  reference implementation" paragraph are rewritten to cite the real shipped field names
  (`SelfConnectorStatus.maskedSecret`/`.expiresAt` top-level, `SelfConnectorHalfView.state` per half)
  and the redesigned admin panel's actual structure (`.deploy-row` diagnostic chips + one `.ttl-card`
  holding the secret/bar/countdown).
- **§4 (Reference implementation) extended** with the new design docs
  (`docs/work/self-connector-panel-redesign/{design,plan}.md`, Topic 4) and an updated description of
  the admin-panel reference implementation's browser-side shape.

## 2026-08-01 — `organs/06-pythia-client-wire-in.md` §2e corrected: Codex-backed generation + unattended signing, not a bespoke local vault

Follow-on correction to the `self-connector-dual-link` entry directly below, triggered by direct
operator feedback after using the deployed panel: Pythia's own reference implementation used to
generate + seal her Apollo keypairs in a bespoke local vault (`SelfApolloVault.ensureGenerated()`),
indistinguishable from genuinely sensitive secrets in her Security panel's sealed-credentials list.
Shipped as `self-connector-codex-signing`: Pythia never generates or holds her own Apollo private
key material anywhere in her own code anymore — generation + on-chain activation happen exclusively
through her own embedded Codex admin tab, and ongoing unattended signing is delegated to Codex's own
`autoSignApolloChallenge` (`@ancientpantheon/codex/ouronet`, v0.7.0+), decrypting from Codex's
already-sealed snapshot server-side, zero human interaction after initial Codex setup.

- **§2e gained a correction callout**, right after the original "proven, not speculative" status
  note: the paste-in mechanism itself (`DualLinkConnector` + a per-half `ApolloSigner`) is
  unchanged; only WHERE the two `ApolloSigner`s source their key material changed, from a local
  vault to `codexApolloSigner.ts`'s `createCodexApolloSigner`/`codexHoldsAccount`, backed by Codex's
  `autoSignApolloChallenge`. Explicit note added: this is Pythia's OWN chosen solution because she
  happens to run a Codex in-process — a consumer without one (e.g. Mnemosyne, unless it adopts Codex
  itself) still needs SOME durable, server-side-accessible signing source of its own; this doc's
  `DualLinkConnector`/`ApolloSigner` contract doesn't require Codex specifically, only some real
  `ApolloSigner` implementation, wherever a consumer's own key material actually lives.
- **§4 (Reference implementation) updated**: the `selfApollo.ts`/`selfConnectorLoop.ts` file list
  gains `codexApolloSigner.ts`, with `SelfApolloVault.setDualLinkKey`'s validation and
  `createCodexApolloSigner`'s signing delegation both called out by name; the design-doc list gains
  `docs/work/self-connector-codex-signing/{design,plan}.md` (Topic 3).

## 2026-08-01 — `organs/06-pythia-client-wire-in.md` — new §2e: the now-proven dual-link-key consumption pattern

Pythia shipped the `self-connector-dual-link` topic (`@ancientpantheon/pythia-client@2.6.0`):
Pythia deployed her own dual-Apollo pair, pasted the resulting dual-link-key into her own admin
panel, and proved — end-to-end, live — the exact mechanism any future consumer (Mnemosyne first)
needs to consume an already-active dual-link-key. This handoff gains the section documenting it.

- **New §2e — "Consuming an already-active dual-link-key — the now-proven pattern."** Covers, in
  order: (1) obtaining an active dual-link-key (cross-references §2d unchanged — deploy + link stays
  a Codex concern); (2) constructing a `DualLinkConnector` (published `2.5.0`) with the pasted key
  plus one `ApolloSigner` per half; (3) wiring `dualLink.keyProvider()` into `PythiaClient`, same
  shape as §2c's single-account connector; (4) for any UI built around this, using the published
  `maskSecret()` helper (`2.6.0`) plus `status().standard.expiresAt`/`.smart.expiresAt` for a
  masked-secret-plus-countdown display — citing Pythia's own Self Connector admin panel
  (`apps/pythia/public/admin.{html,js}`, this topic) as the concrete, working reference
  implementation of exactly this pattern.
- **§4 (Reference implementation) extended** with the dual-link-key SDK source
  (`dualLinkConnector.ts`/`dualLinkKey.ts`/`maskSecret.ts`), §2e's own server+browser reference
  implementation (`selfApollo.ts`/`selfConnectorLoop.ts`/`admin.{html,js}`), and the two new design
  docs (`docs/work/pythia-dual-link-connector/design.md` umbrella, `docs/work/
  pythia-client-dual-link-sdk/design.md`, `docs/work/self-connector-dual-link/{design,plan}.md`).

## 2026-08-01 — `organs/06-pythia-client-wire-in.md` §2d corrected: deploy+link is a Codex concern, not a Pythia-connector onboarding wizard

Real consumer implementation (Mnemosyne) surfaced that §2d's original wording — "use your existing
chain-write path... the same way any other on-chain action already works" — was ambiguous enough to
read as "build a self-contained onboarding flow in the Pythia-connector admin panel that generates
a fresh Apollo pair and deploys+links it on-chain." That is the wrong shape: it duplicates
account-management capability Codex already owns generically, and turned out to be genuinely
higher-risk than it looked — an automated on-chain deploy/link path needs a working
Apollo-curve/Schnorr Pact-transaction signer, a fundamentally different operation from this SDK's
`ApolloSigner` (which only signs the short off-chain challenge message), and confirming whether
that signer even exists is not optional.

- **§2d rewritten**, explicit now: deploying + linking an Apollo pair (real STOA, steps 1-2 of the
  §1b lifecycle) is a human-initiated, Codex-owned account-management action — the same shape as
  creating any other on-chain account — done through Codex's own (generic, reusable, not
  Pythia-specific) account flow. The Pythia-connector wiring's only job is: take a REFERENCE to an
  already-deployed-and-linked pair as its configuration input, build an `ApolloSigner` that signs
  for that referenced pair (resolving key material the same way the consumer's existing on-chain
  signing already does), and wire `PythiaConnector`/`PythiaClient` per §2c. Step 3 (prove ownership
  → Pythia's Cronoton activates) stays fully automatic — only the STOA-spending steps 1-2 are not.
- **§2c gained a UI-default note**: an admin-editable `baseUrl` settings field should ship with the
  real production URL (`https://pythia.ancientholdings.eu`) as its actual *saved* default, never
  merely placeholder/hint text over an empty input — the two look identical at a glance, but an
  unsaved empty field means no gateway is wired at all.

## 2026-08-01 — `automaton/05-deploy-panel-and-progress.md` — new §1e: fixed CONSTRUCTORS row order

New canonical rule, added after Mnemosyne shipped Pythia as its third constructor
(`organs/06-pythia-client-wire-in.md`) and its own panel's row order came up for review: the
CONSTRUCTORS group's row order is now **fixed and centralized here**, not left to each automaton's
own install/wiring order. Current order: **Pythia, Codex, Khronoton**. A future organ's position in
this order gets decided in this document, as part of that organ's own wire-in handoff, so every
conformant panel across every automaton reads identically. Conformance checklist (§8) updated to
match. Mnemosyne's `lib/deploy/constructors.ts` is the reference implementation.

## 2026-07-31 — `organs/06-pythia-client-wire-in.md` (NEW) — the third organ, and 3 superseded docs archived

Pythia's connector protocol shipped this session (`@ancientpantheon/pythia-client@2.3.0`), the last
of the three organs `organs/05-khronoton-engine-wire-in.md` §4's staged-integration gate was written
for ("do not wire consumers live until all three Constructors — Pythia, Codex, Khronoton — are
finalized"). Writing the wire-in handoff surfaced that three existing docs described a protocol that
was never built — grounded assumptions from a stale local `PYTHIA.pact` checkout, corrected once the
*live* on-chain module was verified directly.

- **`organs/06-pythia-client-wire-in.md` (NEW).** What `@ancientpantheon/pythia-client` actually is
  (a pre-existing keyless read-gateway transport client, PLUS — as of `2.3.0` — a connector-auth
  SDK bolted on top), the real shipped protocol (a **symmetric** dual-Apollo Standard/Smart pair,
  module `PYTHIA` with tables `PYTHIA|S|ApiKey`/`PYTHIA|S|DualLink`, a **repeating** 3-hour
  ephemeral-secret challenge/sign/verify round trip — not a one-time activation), how to wire it
  into a consumer (`ApolloSigner`/`SecretStorage`/`PythiaConnector`/`pythiaKey`), and how to add it
  as the third `CONSTRUCTORS` row in a consumer's own deploy panel per `automaton/05` §1a/1c.
- **3 docs archived as superseded**, each left in place with a pointer banner to the new doc:
  `archive/PYTHIA-CONSUMER-KEY-MODEL.md` (single-key, baked-header, one-time activation),
  `archive/HANDOFF-consumer-key-INTERFACES.md` (the `APIARY` module-naming ICD),
  `archive/DUAL-APOLLO-CONSUMER-IDENTITY.md` (an **asymmetric** S/C role-split model — an existing
  owner-registered slot vs. a separate consumer identity — which is not what shipped; its
  caching/revocation/signing-stays-local reasoning was correct, only the role split and on-chain
  naming were wrong). `patterns/` is now empty as a result — its former content either moved to
  `organs/` (a wire-in handoff, not a "worked example") or to `archive/` (superseded).
- **README.md** updated: `organs/` now documents 3 finalized organs, not 2; `identity/`'s
  dual-Apollo mention removed (moved to `organs/06`); `patterns/` and `archive/` rows updated;
  Pythia's reference-implementation entry extended to name the connector protocol itself.
- Per `organs/05-khronoton-engine-wire-in.md` §4's standing rule, this handoff documents the pattern
  only — **whether any specific consumer (Mnemosyne, or Pythia herself as a self-referential
  consumer) actually goes live on it remains the admin's call**, made separately per consumer.

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
