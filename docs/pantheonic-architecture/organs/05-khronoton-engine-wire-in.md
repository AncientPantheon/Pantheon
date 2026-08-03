# Handoff 05 — What `@ancientpantheon/khronoton-core` actually is, and how to wire the engine into Mnemosyne

**For:** the Mnemosyne (localhost) agent.
**From:** the Khronoton package agent.
**Supersedes:** the packaging assumptions in `03-khronoton-automaton-package.md` (that handoff proposed **three** packages `khronoton-core` / `khronoton-server` / `khronoton-ui`; the actual shipped shape is **one** package with subpaths — see below).

---

## 1. What shipped (reality check)

**`@ancientpantheon/khronoton-core@0.2.0` — live on public npm.** It is **one** package with **two** import surfaces, NOT three packages:

| Import | What it is | Status |
|---|---|---|
| `@ancientpantheon/khronoton-core` (root `.`) | the pure schedule engine — `computeNextFire`, `summariseSchedule`, `tickOnce`, the 7-mode `ScheduleMode`/`ScheduleConfig` | shipped (unchanged since 0.1.x) |
| `@ancientpantheon/khronoton-core/server` | the **headless automaton engine** — store + atomic claim-before-fire, executor, tick, loop, resolver registry, `installSchema` | shipped (0.2.0) |

There is **no** `khronoton-server` or `khronoton-ui` package. The **UI + framework-agnostic API route handlers are NOT shipped yet** — planned as **0.3.0** subpaths (`/handlers`, `/provider`, `/hooks`, `/ui`, `/ui.css`). So today you can wire the **running automaton** (scheduled, codex-signed on-chain firing); a management UI/routes you either write thin yourself over the store, or wait for 0.3.0. (A static UI mockup for review is embedded separately — see `04-khronoton-ui-mockup-embed.md`.)

Package facts: dual ESM `import` + CJS `require` on both surfaces; **zero required runtime deps**; `better-sqlite3` is an *optional* dep (reference backend — you inject your own DB via the seam); CJS `require` needs Node ≥ 20.19 / ≥ 22.12 (`require(esm)`).

**The load-bearing guarantee:** a due fire happens **exactly once**, via an atomic claim-before-fire (a conditional `UPDATE` that re-asserts the row is due and advances `next_fire_at` in the same statement; fires only if it claimed the row). No leader election needed. A double-fire would double-sign a real on-chain tx — this is the invariant the whole package protects.

---

## 2. How you wire it in — implement the six seams, then run the loop

The engine reaches for **nothing** host-specific directly. You inject six seams (imported from `@ancientpantheon/khronoton-core/server`). Three are the real integration points; three are trivial.

### The three that matter — map to what Mnemosyne already has

**`KeyResolver` — this is where the codex signs.** Bridge it to Mnemosyne's **sealed operator codex** (the same auto-unlocked master-key seal `app/admin/codex` already uses for manual ops). No human in the loop: the tick calls `getKeyPairByPublicKey(pub)` at fire time.
```ts
interface KeyResolver {
  getKeyPairByPublicKey(publicKey: string): Promise<IKadenaKeypair>; // { publicKey, privateKey, seedType, encryptedSecretKey?, password? }
  listCodexPubs(): Promise<Set<string>>;
  requestForeignKey?(publicKey: string): Promise<string>; // optional; a headless host may omit/reject
}
```
Back it with the same codex resolver your `MnemosyneServerCodexAdapter` / codex-ouronet signing path uses. NB the field-name bridge: resolver returns `privateKey`; the runtime's signer wants `secretKey` — the executor already remaps it, you just return `privateKey`.

> **Filter your codex accounts to Kadena keys ONLY when backing `KeyResolver`/its signer-picker source (learned live in Pythia, 2026-08-02).** An operator codex holds **mixed-curve** accounts — Kadena/DALOS accounts (whose `publicKey` is a 64-hex ed25519 key) sit alongside **Apollo** accounts (whose `publicKey` is Codex's own `<len>.<xy>` string, e.g. `9G.17Kd3B…`). Khronoton signs Kadena transactions, so `listCodexPubs()`, `getKeyPairByPublicKey()`, and — critically — the Builder's signer-picker source (`SignerSource.listSignerDescriptors()`) must return **only** the Kadena-curve accounts. Pythia first tried filtering on Codex's `IOuroAccount.originCurve` metadata (`!== "apollo"`) and it **did not hold in the field** — real Codex-generated Apollo accounts don't reliably carry that field set, so the Apollo keys still leaked into the `DALOS.GAS_PAYER` signing-key dropdown. The robust filter is on the **key format itself**: `/^[0-9a-fA-F]{64}$/` against the bare (`k:`-stripped) `publicKey`. A Kadena ed25519 pubkey is always exactly 32 bytes → 64 hex chars; an Apollo `<len>.<xy>` key can never match, regardless of what optional metadata a generator did or didn't populate. Apply it at every codex-account iteration site, not just the picker (the signing path too, as defense-in-depth). Reference implementation: `constructors/Pythia/apps/pythia/src/automaton/khronoton/keyResolver.ts` (`isKadenaPublicKey`) + `keyResolver.test.ts`. Khronoton-core itself stays correctly curve-agnostic here — its `CodexSignerDescriptor` carries no curve concept; the filtering is the **consumer's** job in its own `KeyResolver`/`SignerSource` implementation, because only the consumer knows it wants Kadena keys specifically.

> **DELEGATE key resolution to Codex's own headless resolver — do NOT hand-roll a `KeyResolver` (learned the hard way in Pythia, 2026-08-03).** The automaton already embeds Codex, and Codex OWNS the one complete, seedType-aware key-resolution implementation (it's the thing that generated the keys). The published `@ancientpantheon/codex` package exports it — `createHeadlessCodexResolver(deps)` returning `{ getKeyPairByPublicKey, listCodexPubs }`, the exact `KeyResolver` shape — plus `InternalCodexResolver` (the browser/unlock-gated variant). **Bind your `KeyResolver` seam to that, rather than reimplementing derivation.** The bug that motivated this note is precisely what hand-rolling costs: Pythia (copying Mnemosyne) wrote its own `KeyResolver` that re-derived EVERY HD-wallet **seed** account with the `koala` SLIP-10 path only, ignoring `seedType` — so a `chainweaver`/`eckowallet` seed (12-word, Chainweaver BIP32-Ed25519 WASM scheme, distinct from koala's 24-word SLIP-10 `m'/44'/626'/idx'`) re-derived a DIFFERENT key and the resolver's own guard refused to sign (`seed "…" derived a different key at index N than the codex recorded`). The Hub's monolithic Khronoton never hit this because it signed through Codex's full resolver; the regression was introduced when Khronoton became a package with a pluggable `KeyResolver` seam and each consumer reimplemented a *subset* of Codex's derivation. **Mnemosyne carries the identical latent bug** (`automatons/Mnemosyne/lib/khronoton/keyResolver.ts`) and should adopt the delegation too. **How to delegate (the enablement now exists):** Codex `0.8.0+` exports a server-safe, pre-bound headless Kadena `KeyResolver` from `/ouronet` — `createHeadlessKadenaResolver({ loadSnapshot, getPassword })` → `{ getKeyPairByPublicKey, listCodexPubs }` — that binds ALL `@stoachain` crypto internally (the consumer binds none). A consumer supplies only two fire-time thunks (its decrypted snapshot slice + the machine password) and drops the result into the engine's `KeyResolver` seam. **Reference implementation: `constructors/Pythia/apps/pythia/src/automaton/khronoton/keyResolver.ts` (v2.7.14) — it delegates all derivation to Codex; the only Pythia-side residue is a Kadena-only public-key filter (Apollo accounts must never enter the Kadena signer list) and a thin non-derivation ouro-account fallback (Codex's resolver reads only `{ kadenaSeeds, pureKeypairs }`). Two `IKadenaKeypair` shapes differ slightly (Codex's `seedType?`/`encryptedSecretKey: unknown` vs Khronoton's `seedType`/`encryptedSecretKey: string`) — map with a `seedType ?? "koala"` + a narrow `encryptedSecretKey as string | undefined` cast.** Codex's own wrong-key refusal guard (a re-derived pubkey ≠ the recorded one) propagates through the delegation — keep it. Only if a consumer genuinely cannot delegate should it hand-roll, and then it MUST branch on `seedType` (koala SLIP-10 vs chainweaver/eckowallet Chainweaver BIP32-Ed25519 WASM) and keep the wrong-key guard — but delegation is the correct end-state, and Pythia's own history (a hand-rolled koala-only resolver that refused to sign a chainweaver operator seed) is why. Pure/ouro accounts a consumer resolves directly (secret decrypt, no derivation) are unaffected.

**`ChainRuntime` — the network client + constants.** This is your **Pythia / network** Constructor's job: a Pact builder, a client factory, the universal signer, gas helpers, and the network constants.
```ts
interface ChainRuntime {
  Pact: { builder: { execution(code: string): unknown } };
  createClient(url: string): { dirtyRead(tx): Promise<{result:{status,error?,data?}, gas?}>; submit(tx): Promise<{requestKey}>; listen(desc): Promise<{result:{status,error?}, reqKey?}> };
  isSignedTransaction(tx: unknown): boolean;
  universalSignTransaction(tx, keypairs: UniversalKeypair[]): Promise<unknown>;
  calculateAutoGasLimit(gas: number): number;
  anuToStoa(anu: number): number;
  getPactUrl(chainId: string): string;
  networkId: string; namespace: string; gasStationAccount: string;
}
```
Wrap your existing `@stoachain/*` client here (the Hub's `StoachainRuntime`, renamed: `KADENA_NETWORK→networkId`, `KADENA_NAMESPACE→namespace`, `STOA_AUTONOMIC_OURONETGASSTATION→gasStationAccount`).

**`Database` — your DB handle.** A minimal synchronous SQL interface; a `better-sqlite3` `Database` satisfies it structurally. Run `installSchema(db)` ONCE to create the three tables (`codex_cronotons`, `codex_cronoton_fires`, `codex_cronoton_manual_batches`).
```ts
interface Database { exec(sql: string): unknown; prepare(sql: string): { run(...p): {changes,lastInsertRowid}; get(...p): unknown; all(...p): unknown[] } }
```

### The three trivial ones
- **`onAudit(event)`** — `(event: { action, result, targetKind, targetId, detail }) => void | Promise<void>`. Point it at Mnemosyne's audit log; default is a no-op.
- **`resolveFireMode(cronotonId): 'test' | 'live'`** — strictly synchronous. Default `() => 'live'`; may honor a per-row `fire_mode_override='live'` first (Mnemosyne's live-lock signal).
- **`config: Partial<Config>`** — 6 optional knobs, each with a default: `tickIntervalMs`(30000), `listenTimeoutMs`(300000), `autoGasCeiling`(2_000_000), `singleTxGasGuard`(1_600_000), `tickBatchLimit`(100), `manualBatch`({min:2,max:60,intervalSeconds:60}). Omit to take defaults.

### The wire-in (the whole thing)
```ts
import { installSchema, startKhronotonLoop } from "@ancientpantheon/khronoton-core/server";

installSchema(db); // once — creates the 3 tables

const stop = startKhronotonLoop({
  db,                 // your Database seam
  resolver,           // KeyResolver → sealed operator codex (signing)
  runtime,            // ChainRuntime → Pythia/network client
  onAudit,            // → Mnemosyne audit log
  resolveFireMode,    // () => 'test' | 'live'
  config,             // Partial<Config> or {}
}).stop;             // startKhronotonLoop(ctx) → { stop() }; call stop() to halt
```
That's the automaton: it ticks every `config.tickIntervalMs`, claims due cronotons, fires each through the executor (codex-signed), records exactly one fire per due row, and never double-fires. Single-instance re-entrancy guard is built in (a multi-minute inline fire never stacks an overlapping tick).

---

## 3. Creating & reading cronotons (until 0.3.0 `/handlers` lands)

The `/server` surface also exports the full store so you can write thin routes now (create/list/observe), mirroring the Hub's route contract:
- **Create:** `commitCodexCronoton(input, { db })` (validates + schedules; returns `{ codexCronotonId, nextFireAt }`).
- **Read:** `getCodexCronoton(id, { db })`, `listCodexCronotons({ limit, offset, status }, { db })`, `listFires(id, { limit, offset }, { db })` (→ `{ fires, total, limit, offset }` — paginate at **50/page** per the ancient admin's preference).
- **Lifecycle:** `editCodexCronoton`, `pauseCodexCronoton`, `resumeCodexCronoton`, `deleteCodexCronoton`, `recoverFire`, the manual-batch fns.
- **Fire on demand:** `fireByServerResolver` / `executeCodexTransaction` for an "Execute now" route.
Exact input/row shapes are in the published `.d.ts` (or `Khronoton/packages/khronoton-core/src/server/**`). The Hub's route contract (paths, request/response) is mapped in `Khronoton/.bee/recon/codex-cronoton-ui-map.md §4`.

---

## 4. IMPORTANT — the staged-integration gate

Per the ancient admin's standing decision: **do not wire consumers live until all three Constructors (Pythia, Codex, Khronoton) are finalized.** The Hub's rewire onto khronoton-core was deliberately reverted for this reason. This handoff documents **how** to wire it; **whether to execute it now** is the admin's call — confirm before flipping Mnemosyne onto the live engine. The `app/admin/khronoton` page can keep showing the mockup (handoff 04) until the gate opens.

## 5. Forward idea (not this handoff) — automaton provenance on the explorer
Planned: Khronoton's executor stamps a marker on each fired tx (pragmatic: the Kadena `nonce = "khronoton:<automatonId>:<cronotonId>:<fingerprint>"`; verifiable: a registered automaton signer pubkey or a signed marker cap) so StoaExplorer badges automaton txs and deep-links back to the cronoton's public view. Cross-repo (Khronoton `/server` + StoaExplorer), separate track.

---

## 6. Server-resolver rules (binding, uniqueness, evented) — for every khronoton consumer

A **server resolver** fills a cronoton's payload (and, for a single-tx resolver, drains its work) at
fire time. These rules govern how a consumer (Pythia today, Mnemosyne next) binds and uses them.
Learned live in Pythia (`constructors/Pythia`, `apps/pythia/src/automaton/khronoton/`).

- **The `serverResolver` name IS the tag — the whole binding.** A resolver is registered in code under a
  name (`registerServerResolver("dual-link-activate", …)`); a cronoton references that exact name in its
  `serverResolver` field. Both ends rendezvous on the string — the tick (or an event trigger via
  `findCodexCronotonIdByServerResolver(name)`) fires the cronoton whose `server_resolver` equals it. A
  typo, blank, or mismatched name = nothing fires. There is no separate "subscription"/ticker: the name
  is the wiring. The cronoton's pact `(read-msg "<key>")` keys MUST match the resolver's payload keys
  (Pythia: `standardApollo`/`smartApollo`).

- **One resolver ↔ one cronoton (uniqueness).** A server-resolver name must be bound to **exactly one**
  cronoton. `findCodexCronotonIdByServerResolver` returns the *most-recently-created* match, so a second
  cronoton on the same resolver silently shadows the first (the wrong template fires). To replace a
  server-resolved cronoton, **delete the old one, then create** — never leave two. Pythia enforces this
  consumer-side (a commit reusing a bound resolver is rejected 409); ideally the store enforces it
  package-wide (see the evented-resolver handoff).

- **An EVENTED resolver ⇒ a scheduleless cronoton.** A resolver fired by an in-process event (Pythia's
  `dual-link-activate`, fired on a verified-pair *link event*) is NOT schedule-driven. Its cronoton must
  be **trigger-only** (`externalFireable` → `next_fire_at = NULL` → the tick's `next_fire_at IS NOT NULL`
  due-query skips it); the event fires it via `executeNow`. Picking such a resolver in the builder should
  turn scheduling OFF (Pythia forces this at commit), and the cronoton's "next fire" should read
  **"Evented"**, not a time. A NON-evented, schedule-driven resolver (Pythia's `pyth-flush`, a daily
  flush) keeps its schedule normally. Whether a resolver is evented is the consumer's knowledge (the
  engine's resolver type has no such flag today — handoff pending).
