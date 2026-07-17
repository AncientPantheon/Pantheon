# Handoff 03 — The Khronoton Automaton package (make `@ancientpantheon/khronoton-core` plug-and-play)

**Audience:** the Khronoton package agent — whoever builds out the
`@ancientpantheon/khronoton-*` npm package(s). Secondary: any Pantheonic Automaton
consumer (Mnemosyne is the first) that will *wire the package in*.

**Authored from:** the AncientHub reference implementation
(`ancientholdings-website`), where "codex-cronotons" — server-side, codex-signed,
scheduled/manual on-chain transactions — is live and battle-tested (~281 tests).
A full architecture map of that implementation backs every claim here.

**Status:**
- `@ancientpantheon/khronoton-core@0.1.1` today ships **only the schedule engine**
  (`computeNextFire`, `summariseSchedule`, `tickOnce`, the `ScheduleMode` /
  `ScheduleConfig` config types). That is a byte-for-byte lineage match with the
  Hub's `lib/cronoton-schedule.ts`.
- **Everything else — the store, the claim-before-fire, the headless executor, the
  codex signing adapter, the server tick, the builder UI — lives INLINE in the Hub
  and has never been extracted.** The Hub does not even import the published core
  (grep `khronoton` in `ancientholdings-website` → zero hits); it uses its local
  copy.
- **The goal of this handoff:** absorb the Hub's inline cronoton system into the
  Khronoton package behind clean **injection seams**, so an automaton becomes an
  automaton by providing four things (a codex signer, a chain runtime, a database,
  an audit sink) and getting the entire scheduler + executor + UI for free.

---

## 0. TL;DR

A Pantheonic Automaton = **Codex** (sealed keys) + **Pythia** (reads) + **Khronoton**
(scheduled autonomous signing) + logic. The Codex + master-key custody already ship
(see handoff 02). Khronoton is the missing organ: *"on a schedule, with no human,
build a Pact transaction, sign it with the sealed codex, submit it, and record the
result — safely, exactly once."*

The Hub already does all of this. It is **not** generic yet: it hard-wires its own
SQLite, its own `@stoachain` chain client, its own hub-codex-store, and its own audit
log. Your job is to lift it into a package that hard-wires **none** of those and
instead accepts them as injected adapters. When you do, Mnemosyne (which uses
`@ancientpantheon/codex` + a file-sealed codex + master key, single-instance pm2, no
SQLite) wires it in with ~5 small adapters and becomes the first true automaton.

**The one load-bearing invariant:** a scheduled fire must happen **exactly once**,
even under overlapping ticks and multi-minute inline fires. The Hub guarantees this
with an atomic **claim-before-fire** (advance/clear `next_fire_at` in a conditional
UPDATE *before* the await). Preserve this exactly — it is §4.

---

## 1. Target package architecture

Mirror the codex family's split (`@ancientpantheon/codex` core + `/ui` subpath).
Recommended **three surfaces**:

| Package / subpath | Owns | Status |
| --- | --- | --- |
| `@ancientpantheon/khronoton-core` | The **schedule engine**: `computeNextFire`, `summariseSchedule`, `tickOnce` (pure schedule), `ScheduleMode`/`ScheduleConfig`, `InvalidScheduleConfigError`. | **Published `@0.1.1`** — verify `InvalidScheduleConfigError` is exported (the store's reject-mapping needs it). |
| `@ancientpantheon/khronoton-server` (NEW — the bulk of the work) | The **store/DAO + claim-before-fire**, the **headless executor** (single-tx build→sign→submit→listen), the **server tick** (`cronotonTickOnce` + manual batches), the **server-resolver registry** mechanism, and the **DB migrations**. All behind injection seams (§6). | **Entirely missing today.** |
| `@ancientpantheon/khronoton-ui` (NEW — optional but recommended) | The **builder UI**: the cronoton builder + the 5 tabs + the Pact code editor + the fetch client. Parameterized (API base path, confirm hook, schedule picker, resolver options). | **Entirely missing today.** |

> **CRITICAL naming trap:** the published core's `tickOnce` is the **pure schedule**
> tick (given rows, tell me which are due). The Hub's `codexCronotonTickOnce` is a
> **richer server tick** that owns claim + fire + record + audit. They are different
> functions — do not conflate them. `khronoton-server` exposes the server tick;
> `khronoton-core` keeps the pure one.

---

## 2. What the package OWNS vs what the CONSUMER INJECTS

This split is the whole design. Get it right and the package is plug-and-play.

**PACKAGE OWNS (generic; must contain NO `@stoachain`, NO Hub SQLite, NO hub-codex-store):**
- The schedule engine (core, already published).
- The store/DAO: definition fingerprint, `rowToDefinition`, the AUTO-gas commit gate,
  `computeNextFire`-or-reject, the **claim-before-fire** SQL (cronoton + batch), fire
  recording / finalize / recover, terminal-intent write, manual-batch lifecycle. (In
  the Hub this is already `@stoachain`-free — the only external is the DB handle.)
- The executor **orchestration**: `effectiveSigners` → build → sign → dirty-read
  pre-flight → AUTO-gas calibrate → submit → listen(5 min) → structured result;
  `parseCapabilityLine`; `computeTerminalIntent`; the derived-request-key / 504
  recovery logic.
- The server tick orchestration (`cronotonTickOnce`, `processDueManualBatchesOnce`)
  and the server-resolver **registry** (register/get) mechanism.
- Optionally the builder UI (`khronoton-ui`).

**CONSUMER INJECTS (the seams — spec'd in §6):**
1. A **`KeyResolver`** over its own sealed codex (the single most important seam).
2. A **`ChainRuntime`** provider (its Pact/kadena client + chain constants).
3. A **`Database`/DAO** backend (must offer an atomic conditional-update primitive).
4. An **audit** hook (`onAudit` / `onFireEvent`), no-op default.
5. A **fire-mode** hook (`resolveFireMode → 'test'|'live'`), default `'live'`.
6. **Config** (tick interval, gas ceilings/guards, batch bounds, price floor, TTL).
7. Its own **server resolvers** (optional; the registry stays generic, the resolvers
   are consumer-domain — e.g. the Hub's stoicism-mint / pool-payout stay in the Hub).

---

## 3. The data model (the package ships these tables + migrations)

Three SQLite tables (the store is written against `better-sqlite3` today; keep that as
the reference backend but see §6.3 for the DAO seam). Ship the migrations with the
package (a `migrations/` bundle or a programmatic `installSchema(db)`).

### 3.1 `codex_cronotons` — the definition + timer state

```sql
CREATE TABLE codex_cronotons (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT,
  pact_code            TEXT NOT NULL,
  config_json          TEXT NOT NULL,   -- {chainId,gasPrice,gasLimit,autoGasLimit,ttl}
  payload_json         TEXT,            -- env-data map (nullable)
  gas_payer_json       TEXT NOT NULL,   -- {type:'codex'|'gas-station', address?, gasStationSignerKey?}
  signers_json         TEXT NOT NULL,   -- [{publicKey,capabilityMode,capabilities}]  (PUBLIC keys only)
  schedule_mode        TEXT NOT NULL,   -- CHECK IN the 7 ScheduleMode values
  schedule_config_json TEXT NOT NULL,   -- ScheduleConfig, discriminated by mode
  status               TEXT NOT NULL DEFAULT 'active', -- active|paused|completed|error
  next_fire_at         TEXT,            -- NULLABLE: NULL = terminal OR trigger-only
  last_fire_at         TEXT,
  created_at           TEXT NOT NULL,
  modified_at          TEXT NOT NULL,
  created_by           TEXT NOT NULL,
  -- generic extension columns (keep; they're not Hub-specific):
  external_fireable    INTEGER NOT NULL DEFAULT 0,  -- opt into an external HMAC trigger
  runtime_arg_keys     TEXT                         -- JSON string[]; NULL = ordinary fixed cronoton
);
CREATE INDEX idx_codex_cronotons_next_fire ON codex_cronotons(status, next_fire_at);
```

The store **excludes** `runtime_arg_keys IS NOT NULL` rows from the scheduled sweep
(those fire only via an explicit trigger). `fire_mode_override` and `server_resolver`
are Hub extensions — keep `server_resolver TEXT` (generic: names an injected resolver);
`fire_mode_override` can stay as a generic `'live'|NULL` override.

### 3.2 `codex_cronoton_fires` — immutable fire history

```sql
CREATE TABLE codex_cronoton_fires (
  id                     TEXT PRIMARY KEY,
  codex_cronoton_id      TEXT NOT NULL REFERENCES codex_cronotons(id) ON DELETE CASCADE,
  job_id                 TEXT,                       -- optional link to a background job
  fired_at               TEXT NOT NULL,
  status                 TEXT NOT NULL,              -- success|failure|running|nothing (app-owned domain)
  request_key            TEXT,
  chain_id               TEXT,
  error_message          TEXT,
  chain_response_json    TEXT,
  definition_fingerprint TEXT,                       -- sha256 of the canonical definition AT FIRE TIME
  mode                   TEXT NOT NULL DEFAULT 'test', -- test|live badge
  recovered_at           TEXT,                       -- set when a 504-masked success is reconciled
  tx_keys_json           TEXT                        -- multi-tx breakdown (optional)
);
CREATE INDEX idx_codex_fires_cronoton ON codex_cronoton_fires(codex_cronoton_id, fired_at DESC);
```

### 3.3 `codex_cronoton_manual_batches` — "Execute Now ×N"

```sql
CREATE TABLE codex_cronoton_manual_batches (
  id                TEXT PRIMARY KEY,
  codex_cronoton_id TEXT NOT NULL REFERENCES codex_cronotons(id) ON DELETE CASCADE,
  total             INTEGER NOT NULL,
  completed         INTEGER NOT NULL DEFAULT 0,
  interval_seconds  INTEGER NOT NULL DEFAULT 60,
  status            TEXT NOT NULL DEFAULT 'active', -- active|completed|cancelled
  next_at           TEXT,
  created_at        TEXT NOT NULL,
  modified_at       TEXT NOT NULL,
  created_by        TEXT NOT NULL
);
CREATE INDEX idx_codex_manual_batches_due ON codex_cronoton_manual_batches(status, next_at);
```

Hub reference: `db/migrations/101_codex_cronotons.sql`, `103_…manual_batches.sql`,
`102/108/113/135/136` (fires evolution). Copy them, drop the Hub-domain columns
(`server_resolver` → keep generic, `fire_mode_override` → keep generic;
`scoring_live_locked` reads → become the fire-mode hook §6.5).

---

## 4. The claim-before-fire (LOAD-BEARING — the once-only guarantee)

This is the heart. A due row is selected, then **atomically claimed before the
inline fire** so overlapping ticks / a manual Execute-Now cannot double-fire it.

**Select due (excludes trigger-only rows):**
```sql
SELECT * FROM codex_cronotons
 WHERE status='active' AND next_fire_at IS NOT NULL AND next_fire_at <= :now
   AND runtime_arg_keys IS NULL
 ORDER BY next_fire_at ASC LIMIT :batch;
```

**Claim (the conditional UPDATE re-asserts the due predicate → exactly one racer wins):**
```sql
-- one-time (and any corrupt-recurring): clear so it never re-selects
UPDATE codex_cronotons
   SET next_fire_at = NULL, last_fire_at = :now, modified_at = :now
 WHERE id = :id AND status='active' AND next_fire_at IS NOT NULL AND next_fire_at <= :now;

-- recurring: advance to computeNextFire(mode, config, FRESH now)
UPDATE codex_cronotons
   SET next_fire_at = :computedNext, last_fire_at = :now, modified_at = :now
 WHERE id = :id AND status='active' AND next_fire_at IS NOT NULL AND next_fire_at <= :now;
```

The caller fires **only if `result.changes === 1`**. Because the claim advances/clears
`next_fire_at` *before* the (up-to-5-minute) fire await, the row is no longer
re-selectable the instant the claim commits — this is the **primary** double-fire
guard. Manual batches use the exact analogue (`claimManualBatchFire`: increment
`completed`, advance `next_at`+interval or NULL on the last slot).

> **Canonical rule #1:** the atomic per-row claim is the once-only guarantee. It does
> NOT depend on a single-writer worker. A DAO backend that cannot express an atomic
> conditional UPDATE (compare-and-advance) is not a valid Khronoton backend.

Failure policy (REQ-18): single attempt, no retry, no backoff, no auto-pause. Exactly
ONE fire row per fire. A recurring failure stays `active` (its `next_fire_at` was
already advanced). A one-time fire applies the executor's terminal intent
(success→`completed`, failure→`error`).

---

## 5. The headless executor (build → sign → submit)

Single entry point: `executeCodexTransaction(definition, mode: 'simulate'|'fire',
ctx)` where `ctx` carries the injected runtime + resolver (§6). Flow:

1. **`effectiveSigners`** — self-heal the gas payer: a `codex` payer pubkey is
   auto-added as a `pure` signer; a `gas-station` payer synthesizes a scoped
   `GAS_PAYER` signer for its `gasStationSignerKey`.
2. **Build** — `Pact.builder.execution(pactCode).setMeta(...).setNetworkId(...)`,
   `addData` over payload, `pure`/`scoped` `addSigner` (capabilities via
   `parseCapabilityLine`). Sender = the gas-station account or `k:<addr>`.
3. **Sign** — for each signer: `resolver.getKeyPairByPublicKey(pub)` → keypair →
   `universalSignTransaction(tx, keypairs)`; assert `isSignedTransaction`.
4. **Dirty-read pre-flight** — never submit a tx a pre-flight would reject.
5. **AUTO-gas** — if `config.autoGasLimit`, rebuild+re-sign with
   `calculateAutoGasLimit(preflight.gas)` (build at a ceiling first, e.g. 2_000_000).
6. **Submit → listen** with a **5-minute** timeout. Derive the request key from the
   signed command hash **up front** so a lost 504 never records a NULL key; on submit
   throw, poll by the derived key; on listen timeout return `ok:false` **preserving
   the key** for later `recoverFire`.

**Never throws on fire.** Every failure returns
`{ ok:false, mode:'fire', chainId, error, terminalIntent }`.
`computeTerminalIntent(scheduleKind, mode, ok)`: one-time+fire+success →
`{status:'completed'}`; one-time+fire+failure → `{status:'error'}`; recurring or any
simulate → `null`.

**Result shapes** (`types.ts`): `SimulateResult {ok, mode:'simulate',
calibratedGasLimit?, gasUsed?, rawResult?, error?, terminalIntent:null}`;
`FireResult {ok, mode:'fire', requestKey?, chainId?, rawResult?, error?, terminalIntent}`.

**Leave OUT of the generic executor:** the Hub's cross-chain SPV / burn /
continuation block (`executeCrossChainBurn`, `getContinuationStatus`,
`localChainwebBaseUrl`) — that is a Hub-only multi-tx resolver, not part of a generic
single-tx executor. Ship only `executeCodexTransaction` + the resolver registry.

Hub reference: `lib/codex-cronoton/executor.ts`, `types.ts`, `server-resolvers.ts`.

---

## 6. The injection seams (the consumer contract — spec these as the package's public API)

### 6.1 `KeyResolver` — the codex signing adapter (the #1 seam)

The executor signs by calling ONE method. Accept an injected resolver; do **not**
`new`-up a hub-specific one internally.

```ts
interface KeyResolver {
  listCodexPubs(): Promise<Set<string>>;
  getKeyPairByPublicKey(publicKey: string): Promise<IKadenaKeypair>; // executor calls this
  requestForeignKey?(publicKey: string): Promise<string>;            // may fail fast server-side
}
// IKadenaKeypair = { publicKey, privateKey, seedType, encryptedSecretKey?, password? }
```

The consumer's resolver is what makes signing **headless**: unseal the sealed codex
with the master key (no human, no lock gate) → get the machine codex password →
resolve the keypair for the signer's public key from the snapshot (pure keypair →
`smartDecrypt`; derived account → mnemonic → wallet-builder → decrypt). The Hub's
reference is `lib/codex-cronoton/codex-key-resolver.ts` (over `@stoachain/ouronet-codex`
+ `lib/hub-codex-store.ts` + `lib/vault.ts`). Mnemosyne will implement the same
interface over `@ancientpantheon/codex` (see §10).

> **Canonical rule #2:** the package never touches a specific codex library, master
> key, or vault. It only ever calls `resolver.getKeyPairByPublicKey(pub)`. All custody
> lives in the injected resolver.

### 6.2 `ChainRuntime` — the chain client + constants

Everything the executor currently pulls from `@stoachain` via `loadRuntime()`:

```ts
interface ChainRuntime {
  Pact: /* Pact.builder */;               createClient(url): { dirtyRead; submit; listen; pollRequestKeys };
  universalSignTransaction; isSignedTransaction; calculateAutoGasLimit; anuToStoa;
  networkId: string; namespace: string;   getPactUrl(chainId): string;
  gasStationAccount: string;              // e.g. STOA_AUTONOMIC_OURONETGASSTATION
}
```

Inject it so the consumer chooses node routing (failover vs a co-located loopback
node) and supplies its own chain constants. Package ships NO `@stoachain` dependency.

### 6.3 `Database` / DAO — storage backend

Reference backend = `better-sqlite3`. Accept the DB handle (the Hub's `DbDep {db?}`
pattern) OR a narrow DAO interface. The one hard requirement is an **atomic
conditional update** for the claim (§4). Ship the migrations (§3) as SQL files and/or
`installSchema(db)`. Consumers with no SQLite either adopt `better-sqlite3` for these
three tables or implement the DAO over their own store with a real CAS primitive.

### 6.4 `onAudit` / fire-event hook

Replace direct `logAudit` / `logAuditFromWorker` / `recordStoicismEvent` calls with an
injected callback (no-op default): `onAudit(event: { action, result, targetKind,
targetId, detail })`. The tick calls it after each fire.

### 6.5 `resolveFireMode` hook

The Hub reads `system_state.scoring_live_locked` for the test/live badge. Generalize
to `resolveFireMode(cronotonId): 'test'|'live'` (default `'live'`).

### 6.6 Config object

`{ tickIntervalMs=30_000, listenTimeoutMs=300_000, autoGasCeiling=2_000_000,
singleTxGasGuard=1_600_000, tickBatchLimit=100, manualBatch:{min:2,max:60,intervalSeconds:60},
gasPriceFloor, ttl:{min:60,max:86400} }`.

### 6.7 Server-resolver registry

Keep the generic `registerServerResolver(name, resolver)` / `getServerResolver(name)`
mechanism in the package; the resolvers themselves are consumer-domain (Mnemosyne may
ship none in v1 — ordinary fixed cronotons need no resolver).

---

## 7. The tick contract (single-instance friendly)

Expose `cronotonTickOnce(now, ctx)` and `processManualBatchesOnce(now, ctx)` where
`ctx = { db, resolver, runtime, onAudit, resolveFireMode, config }`. The body is the
Hub's `codex-cronoton/tick.ts` (select-due → claim → fire → record → terminal → audit),
already isolated for unit-testing.

**How it's driven — make BOTH shapes work:**
- **Single-instance standalone (Mnemosyne):** a bare
  `setInterval(() => cronotonTickOnce(new Date(), ctx), config.tickIntervalMs)` plus a
  one-boolean **re-entrancy guard** (a multi-minute inline fire must not launch an
  overlapping tick). No leader election needed — the per-row atomic claim (§4) is the
  double-fire guard. Document a Next `instrumentation.ts` recipe for this.
- **Multi-worker (Hub):** the same tick behind a leader lease + throttle. The package
  should not hard-require a lease; expose the tick and let the consumer add a lease if
  it runs N workers.

Ship a tiny `startKhronotonLoop(ctx): stop()` helper (setInterval + re-entrancy guard)
so a single-instance consumer starts the automaton in one call.

Hub reference: `lib/codex-cronoton/tick.ts`, `worker/index.ts`
(`runCodexCronotonTickThrottled`, `CODEX_CRONOTON_TICK_INTERVAL_MS`, `codexTickInFlight`).

---

## 8. The UI subpackage (`khronoton-ui`)

Yes — the full builder should be a subpackage (it is `@stoachain`-free at runtime; all
signing is server-side). Port `components/admin/codex-cronotons/**`:
- `CodexCronotonBuilder` (two-pane, `next/dynamic ssr:false`) + the 5 tabs
  (`ConfigTab`, `PayloadTab`, `GasPayerTab`, `SignaturesTab`, `ExecuteTab`) +
  `helpers.ts` + `types.ts` (`buildEnvelope` = the builder→API mapper).
- `PactCodeEditor` (CodeMirror: `@uiw/react-codemirror`, `@codemirror/view`,
  `@codemirror/state` — peer deps).
- The `client.ts` fetch wrappers.

**Parameterize (these are the couplings to lift):** the API base path (default
`/api/admin/codex-cronotons`), the confirm-password / admin-guard hook (inject a
`useConfirm()` provider), the schedule picker component (inject or bundle a generic
`ScheduleStep` supporting all 7 modes), and `SERVER_RESOLVER_OPTIONS` (a prop, empty
by default). No `codex-ui`, no recharts needed.

---

## 9. The API surface (what the consumer mounts)

The package can ship **framework-agnostic handlers** (take a parsed request, return a
result) that the consumer mounts on its own gated routes, OR document the route
contract so the consumer writes thin handlers. The routes (all ancient-gated; mutating
+ signing ones behind a fresh-confirm):

`GET/POST /cronotons` · `GET/PATCH/DELETE /cronotons/:id` ·
`POST /cronotons/:id/execute` (Execute-Now; one-time → atomic claim, 409 on lost) ·
`GET/POST/DELETE /cronotons/:id/execute-batch` · `POST /cronotons/:id/trigger`
(runtime-arg fire) · `PATCH /cronotons/:id/pause|resume` · `GET /cronotons/:id/fires`
· `POST /cronotons/:id/fires/:fireId/recover` · `POST /simulate` (dry-run, never
submits) · `GET /signers` (secret-free descriptor list).

Hub reference: `pages/api/admin/codex-cronotons/*`, `lib/codex-cronoton/client.ts`.

---

## 10. Reference consumer — Mnemosyne's wire-in (what it PROVIDES)

Mnemosyne uses `@ancientpantheon/codex` (not `@stoachain/ouronet-codex`), a
**file-sealed** codex + master key (handoff 02), single-instance pm2, and has **no
SQLite yet**. To become an automaton it provides:

1. **A `KeyResolver`** over its file-sealed codex: `loadBackup()` (unseal the snapshot
   with `MNEMOSYNE_MASTER_KEY`) + `getOrCreateCodexPassword()` → resolve the keypair
   for a signer pubkey using `@ancientpantheon/codex/ouronet`'s
   `InternalCodexResolver` / `KeyResolver` / `getKeypair` (the exports confirmed to
   exist). This is the Mnemosyne analogue of the Hub's `codex-key-resolver`.
2. **A `ChainRuntime`** — its own `@stoachain`/kadena client + chain constants (it
   already depends on `@stoachain/*` transitively via `@ancientpantheon/codex`).
3. **A storage backend** — adopt `better-sqlite3` for the three tables in the stable
   `MNEMOSYNE_CODEX_DIR`-adjacent data dir (survives deploys), OR a DAO with an atomic
   CAS. (Recommend SQLite — the claim-before-fire wants it.)
4. **An `onAudit` sink** (a small file/console audit; or a future Mnemosyne audit log).
5. **A driver** — `startKhronotonLoop(ctx)` from an `instrumentation.ts`, single
   instance, re-entrancy-guarded.
6. **UI** — mount `khronoton-ui`'s builder at `/admin/khronoton` (a new tile in the
   Hub-style admin), pointing at Mnemosyne's mounted API routes.

Everything else (schedule, store, claim, executor, tick, terminal-intent, batches,
history) comes from the package. That is the plug-and-play win.

---

## 11. Concrete build steps for the package agent

1. **Confirm/patch `khronoton-core`:** ensure it exports `InvalidScheduleConfigError`
   alongside `computeNextFire`/`summariseSchedule`/`tickOnce`/config types.
2. **Create `khronoton-server`:** lift the Hub's `lib/codex-cronoton/store.ts`
   verbatim behind a `Database`/`DbDep` seam; ship its migrations (§3).
3. Refactor `executor.ts` so `loadRuntime()` and `new CodexKeyResolver()` become the
   injected `ChainRuntime` + `KeyResolver` (§6.1–6.2); **drop the cross-chain SPV
   block** (Hub-only). Keep `parseCapabilityLine`, `effectiveSigners`,
   `computeTerminalIntent`, the 504/derived-key recovery, the 5-min listen, AUTO-gas.
4. Generalize `readFireMode`, `logAudit*`, `recordStoicismEvent` into the `onAudit` +
   `resolveFireMode` hooks (§6.4–6.5).
5. Keep `tick.ts` (`cronotonTickOnce`, `processManualBatchesOnce`) taking a `ctx`
   object; add `startKhronotonLoop(ctx)` (setInterval + re-entrancy guard).
6. Keep the server-resolver **registry** generic; ship no concrete resolvers.
7. **Create `khronoton-ui`:** port the builder + tabs + editor + client; parameterize
   the API base path, confirm hook, schedule picker, resolver options.
8. Ship the API handlers (framework-agnostic) or document the route contract (§9).
9. Publish; bump `khronoton-core` if you touch it; version + changelog each package.

---

## 12. Done when (the package's definition of done)

- [ ] `khronoton-server` has **zero** static `@stoachain` / hub-SQLite /
      hub-codex-store imports — everything chain/custody/db/audit arrives via `ctx`.
- [ ] A consumer can start a working automaton with: a `KeyResolver`, a `ChainRuntime`,
      a `Database`, an `onAudit`, and `startKhronotonLoop(ctx)`.
- [ ] The **claim-before-fire** (§4) is preserved verbatim; a **double-fire test**
      proves two overlapping ticks fire a due row exactly once.
- [ ] A **codex-signs-a-scheduled-tx** integration test: seal a codex, schedule a
      one-time cronoton, run `cronotonTickOnce`, assert it built+signed+submitted (via
      a mock `ChainRuntime`) exactly one fire row, and the executor never threw.
- [ ] The executor **never throws on fire**; a failed fire records `status:'failure'`
      with the request key preserved.
- [ ] `khronoton-ui` builds against React + CodeMirror only, with the API base path +
      confirm hook + resolver options as props.
- [ ] Each package is versioned with a changelog entry (the Mnemosyne convention;
      see its `docs/RELEASING.md`).

## 13. Universal automaton checklist (for any Khronoton consumer)

- [ ] Provides a headless `KeyResolver` over its sealed codex (no human, no lock gate).
- [ ] Provides a `ChainRuntime` + a `Database` with an atomic conditional-update.
- [ ] Runs the tick single-instance (setInterval + re-entrancy) OR leader-gated (N
      workers) — never relying on a single writer for once-only (the claim is that).
- [ ] AUTO-gas is gated at commit (a concrete `gasLimit` always exists — no human at
      fire time to calibrate).
- [ ] Signing/mutating routes are behind the strongest admin gate + fresh confirm.
- [ ] A double-fire test + a codex-signs-scheduled-tx test are green.

## 14. Hub reference files (read these when building the package)

| Concern | Hub file |
| --- | --- |
| Schedule engine (= published core) | `lib/cronoton-schedule.ts` |
| Store + claim-before-fire | `lib/codex-cronoton/store.ts` |
| Headless executor | `lib/codex-cronoton/executor.ts` + `types.ts` |
| Codex signing adapter (the seam) | `lib/codex-cronoton/codex-key-resolver.ts`, `codex-signers-read.ts` |
| Server-resolver registry | `lib/codex-cronoton/server-resolvers.ts` (+ `stoicism-mint.ts` as a Hub example) |
| Server tick | `lib/codex-cronoton/tick.ts` |
| Worker driver (throttle/lease/re-entrancy) | `worker/index.ts` (`runCodexCronotonTickThrottled`) |
| Custody underneath | `lib/hub-codex-store.ts`, `lib/vault.ts` |
| Migrations | `db/migrations/101,102,103,108,113,135,136,149` |
| API routes | `pages/api/admin/codex-cronotons/*` |
| Builder UI | `components/admin/codex-cronotons/**`, `pages/hub/codex-cronotons/[id].tsx` |

## 15. Open decisions for the owner

1. **Package count** — three (`core` / `server` / `ui`) as recommended, or fold server
   into `core` with subpath exports (`@ancientpantheon/khronoton-core/server`,
   `/ui`)? (The codex family uses one package + subpaths; matching that is defensible.)
2. **API handlers in-package vs consumer-written** — ship framework-agnostic handlers,
   or just the route contract? (Mnemosyne is App Router; the Hub is Pages Router — a
   framework-agnostic core handler + thin per-framework adapters is the most reusable.)
3. **Mnemosyne storage** — adopt `better-sqlite3` (recommended) or a file/DAO backend?
   This is the one real new dependency Mnemosyne takes on.
4. **v1 scope for Mnemosyne** — ordinary fixed cronotons only (no server resolvers, no
   multi-tx), which is the smallest thing that proves the automaton, then expand.
