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
