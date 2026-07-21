# Handoff 02 — Automaton Master-Key Codex Protection

**Audience:** the Mnemosyne agent (and every future Pantheonic Automaton that
custodies a server-side codex).
**Authored from:** the AncientHub reference implementation (`ancientholdings-website`),
where this pattern is live and now covered by a regression test.
**Status:** the HUB implements this fully and correctly (verified — see §6).
**Mnemosyne does NOT yet** (it ported codex *storage* but not the rotation
*re-seal*, so a raw key swap would brick its codex). This doc is the spec to
close that gap and the canonical pattern for all automatons.

---

## 0. TL;DR

A server-side codex is sealed under a **master key**. If you ever change that
master key, you MUST **re-seal** every secret that was sealed with the old key —
in one atomic transaction — *before* you swap the key on disk. A naive "just
write the new key" rotation leaves the old ciphertext undecryptable and **bricks
the codex** (and every other sealed secret).

The elegant part: if all sealed material is stored as ordinary rows in **one
vault** through **one shared `seal()`/`unseal()`**, then a single generic
"re-seal the whole vault" routine protects the codex *and* everything else — for
free, including secret types added later. Build the rotation as a generic vault
re-seal, and your codex is protected by construction.

---

## 1. The threat model

Master keys should be rotatable (leaked `.env`, staff change, periodic hygiene).
The custody crypto is symmetric: a secret sealed under key *K_old* can only be
opened with *K_old*. So the moment the process starts using *K_new*:

- `unseal(codex_snapshot)` → fails → the codex can't even load.
- `unseal(codex_password)` → fails → the package can't decrypt any inner entry.
- `unseal(any other secret)` → fails → e.g. SSH keys, signing keys, etc.

Everything sealed under the old key is **cryptographically orphaned**. This is
what "the codex becomes unusable, it remains with the old key" means. The fix is
not to avoid rotation — it's to **re-seal on rotation**.

---

## 2. The two-layer sealing model (why the codex needs only a cheap re-seal)

There are two independent secrets, and this separation is what makes rotation
cheap:

```
                       ┌─────────────────────────────────────────────┐
   INNER (per-entry)   │  seed mnemonics, account secrets, privkeys   │
   encrypted by the    │  → each field encrypted under the CODEX       │
   codex package under │    PASSWORD (smartEncrypt) BEFORE it reaches  │
   the CODEX PASSWORD  │    the server. The master key NEVER sees      │
                       │    plaintext key material.                    │
                       └───────────────────┬─────────────────────────┘
                                           │  (the whole snapshot JSON,
                                           │   inner-ciphertext included)
                       ┌───────────────────▼─────────────────────────┐
   OUTER (at-rest)     │  snapshot blob   → seal() under MASTER KEY    │  ← vault row
   sealed by the       │  codex password  → seal() under MASTER KEY    │  ← vault row
   MASTER KEY          │  (both are just standard secrets_vault rows)  │
                       └─────────────────────────────────────────────┘
```

- **Inner layer** — the codex package (`@stoachain/ouronet-codex`) encrypts every
  per-entry secret under a machine-generated **codex password** (a 32-byte random,
  base64), *client-side*, before the server ever sees it. The server stores opaque
  ciphertext.
- **Outer layer** — the server seals (a) the whole snapshot JSON and (b) the codex
  password itself, each under the **master key**, as two vault rows.

**Rotation only touches the OUTER layer.** The codex password *value* never
changes during a master-key rotation (only its vault wrapper is re-sealed), so
the inner ciphertext still decrypts with the same password afterward. That's why
rotating the master key re-seals **two rows** and does **not** need to re-encrypt
every inner entry. (Hub changelog: *"Rotating SECRETS_MASTER_KEY re-seals two
rows; it does NOT need to re-encrypt every inner entry."*)

---

## 3. Storage contract (the vault)

One table, one seal format, one shared helper. On the hub:
`lib/vault.ts` + `secrets_vault` (id, kind, sealed_box BLOB, created_at, notes).

**Seal** (`seal(kind, plaintext) → id`):
```
nonce      = random(crypto_secretbox_NONCEBYTES)          # 24 bytes
ciphertext = crypto_secretbox_easy(plaintext, nonce, MASTER_KEY)
sealed_box = nonce || ciphertext                          # concatenated bytes
INSERT (uuid, kind, sealed_box)  → return uuid
```

**Unseal** (`unseal(id) → plaintext`):
```
combined   = sealed_box
nonce      = combined[0 .. NONCEBYTES]
ciphertext = combined[NONCEBYTES ..]
plaintext  = crypto_secretbox_open_easy(ciphertext, nonce, MASTER_KEY)   # CURRENT key
```

`MASTER_KEY` = `base64_decode(env.SECRETS_MASTER_KEY)`, exactly 32 bytes.

**The codex uses this and nothing else.** On the hub (`lib/hub-codex-store.ts`),
the codex is a singleton row (`codex_dropin`, migration 100) pointing at two
`secrets_vault` rows:
- `snapshot_blob_id = seal('codex-dropin', JSON.stringify(snapshot))`
- `password_blob_id = seal('codex-dropin-password', codexPassword)`

Because these are *ordinary vault rows*, the generic vault re-seal (§4) covers
them with zero codex-specific code.

> **Canonical rule #1:** every master-key-sealed secret an automaton holds MUST be
> a standard vault row via the one shared `seal()`. Never invent a second sealing
> path — it won't be covered by the re-seal and will brick on rotation.

---

## 4. The rotation contract (the load-bearing part)

Reference: hub `lib/rotation.ts` `rotateMasterKey(newKeyBase64)`. Rotation MUST
be a **re-seal**, ordered so a mid-run failure is recoverable:

1. **Validate.** New key decodes to 32 bytes and is *different* from the current
   one.
2. **Refuse while busy.** If any job/task could be mid-`unseal` with the old key,
   abort (`SELECT COUNT(*) FROM jobs WHERE status='running'` on the hub). Raise a
   `rotation_in_progress` flag so workers hold off claiming new work.
3. **PLAN (read-only, in memory).** `SELECT id, sealed_box FROM <vault>` for
   **every** row. For each: unwrap with the **OLD** key. **If any row fails to
   decrypt, ABORT the whole rotation now** — before writing anything. Otherwise
   compute its new sealed_box = `newNonce || secretbox(plaintext, newNonce, NEW)`.
   Do the same for any other sealed artifacts (e.g. `.ahbk` archive headers).
4. **APPLY vault re-seal as ONE atomic DB transaction** — `UPDATE <vault> SET
   sealed_box = ? WHERE id = ?` for all rows. All rows rotate or none.
5. **Write the new key to disk** (`.env.local`) — *after* the re-seal succeeds,
   via an upsert helper that preserves comments/other vars. This write MUST be
   **atomic**: write the new content to a sibling temp file in the same directory,
   `fsync` it, then `rename` it into place at `0o600` (hub: `lib/env-file.ts`).
   This is load-bearing — the vault is already re-sealed under the new key by this
   point, so a crash mid-write that truncated `.env.local` would lose the new key
   and brick the codex. `rename` on one filesystem is atomic; a plain
   `writeFileSync` (truncate-then-write) is **not** — do not use it here.
6. **Flip the in-process key LAST** (`process.env.SECRETS_MASTER_KEY = newKey`) so
   the running process uses the new key immediately.
7. **Rollback on failure** — restore any already-rewritten on-disk artifacts from
   the in-memory plan; the DB transaction rolls itself back.

> **Canonical rule #2:** never write the new key (to disk or env) *before* the
> re-seal succeeds. Order is: re-seal vault → write key to disk → flip in-memory.
> If the re-seal throws, the old key stays valid and nothing is orphaned.

> **Canonical rule #3:** the re-seal walks the vault **generically** (all rows, no
> hardcoded list). This is what makes it future-proof — a secret type added months
> later (like the codex was) is covered automatically because it lives in the same
> vault.

**Multi-process note.** The process that ran the rotation flips its own
`process.env`. Any *other* process (e.g. a background worker) picks up the change
by polling `.env.local` for a changed `SECRETS_MASTER_KEY` and swapping its
in-memory copy (hub: `worker/index.ts reloadMasterKeyFromDisk`, every ~10s). A
worker swap is safe *because the vault was already re-sealed* — it only ever
opens rows that are now under the new key.

**Access gating.** Expose rotation behind your strongest admin gate + a fresh
re-confirm, and require an explicit "I have exported/backed up the key"
acknowledgement so a rotation without a recoverable key is impossible via the UI
(hub: `POST /api/admin/security/rotate-master-key`, requires
`{acknowledgedExport: true}`).

---

## 5. What Mnemosyne must implement

Mnemosyne ported the codex **storage** (`lib/mnemosyneVault.ts`,
`lib/mnemosyneCodexStore.ts`, `MnemosyneServerCodexAdapter.ts`) but not the
rotation **re-seal**. Today a master-key change on Mnemosyne would orphan its
codex — its own agent is correct about that. To fix it, port the hub's
`lib/rotation.ts` shape adapted to Mnemosyne's vault. Concretely:

```ts
// lib/mnemosyneRotation.ts  (new)
import sodium from 'libsodium-wrappers';
import { getDb } from '@/db';
import { upsertEnvVar } from '@/lib/envFile';        // add if missing — MUST be an atomic
                                                    // write-temp→fsync→rename at 0o600,
                                                    // NOT a plain writeFileSync (see step 5)

export async function rotateMnemosyneMasterKey(newKeyBase64: string) {
  await sodium.ready;
  const NB = sodium.crypto_secretbox_NONCEBYTES;
  const oldKey = Buffer.from(process.env.SECRETS_MASTER_KEY!, 'base64');
  const newKey = Buffer.from(newKeyBase64, 'base64');
  if (newKey.length !== 32) throw new Error('new key must be 32 bytes');
  if (Buffer.compare(oldKey, newKey) === 0) throw new Error('new key equals old');

  const db = getDb();
  // (guard: refuse while any task that unseals could be mid-flight)

  // 1. PLAN — unwrap ALL rows with the OLD key; abort if any fails.
  const rows = db.prepare('SELECT id, sealed_box FROM <mnemosyne_vault>').all();
  const plan = rows.map((r) => {
    const box = new Uint8Array(r.sealed_box);
    const pt = sodium.crypto_secretbox_open_easy(box.slice(NB), box.slice(0, NB), oldKey);
    // ^ throws on a foreign row → whole rotation aborts before any write
    const n = sodium.randombytes_buf(NB);
    const ct = sodium.crypto_secretbox_easy(pt, n, newKey);
    const out = new Uint8Array(NB + ct.length); out.set(n, 0); out.set(ct, NB);
    return { id: r.id, sealed_box: Buffer.from(out) };
  });

  // 2. APPLY re-seal atomically.
  const tx = db.transaction((rs) => {
    const s = db.prepare('UPDATE <mnemosyne_vault> SET sealed_box = ? WHERE id = ?');
    for (const r of rs) s.run(r.sealed_box, r.id);
  });
  tx(plan);

  // 3. Persist the new key AFTER the re-seal, then flip in-memory LAST.
  upsertEnvVar('.env.local', 'SECRETS_MASTER_KEY', newKeyBase64);
  process.env.SECRETS_MASTER_KEY = newKeyBase64;
  return { vaultRowsRotated: plan.length };
}
```

Then expose it behind Mnemosyne's ancient/admin gate with a fresh re-confirm and
an `acknowledgedExport` flag, mirroring the hub route. Because Mnemosyne's codex
snapshot + password are stored via its shared `seal()` into `<mnemosyne_vault>`,
this generic re-seal covers them automatically — no codex-specific branch.

**Do NOT** write a rotation that only swaps `.env.local`/`process.env`. That is
the exact bug that bricks the codex.

---

## 6. How the hub proves it (and how Mnemosyne should)

The hub has an executable regression test:
`tests/integration/rotation-codex-survives.test.ts`. It:
1. seals a codex (snapshot + auto-provisioned password) + an SSH-key secret under
   an OLD key,
2. calls `rotateMasterKey(newKey)`,
3. asserts the codex snapshot + password + SSH key all still `unseal()` — under
   the NEW key — **unchanged**, that the stored ciphertext actually changed
   (genuine re-seal), and that a row which can't decrypt **aborts before any
   write** (no partial rotation).

All three pass. Mnemosyne should port an equivalent test as its definition of
done — it is the difference between "we think rotation is safe" and "rotation is
proven not to brick the codex."

---

## 6b. Codex-mount UI convention — a single lock control

Server-held auto-unlock (§8b) has a direct UI consequence for how the codex
package is **mounted**. The master key lives on the server, the codex opens at
boot with no operator password prompt, and any flow that needs the password
re-submits it automatically. So the lock/unlock affordance never needs a password
field — and there must be exactly **one** of it.

The codex package already renders a **Lock / Unlock control in its identity row** —
the canonical, always-present affordance (backed here by the auto-password-resolver,
so unlocking it costs no typing). When an automaton wraps the mounted codex, its
top-bar action slot carries **portability only** — the custody-appropriate pair
(e.g. **Download / Load**, the server-custody equivalents of the standalone's
Export / Load). It must **NOT** add a second Lock button in the top bar: that is
redundant chrome for a control that already exists, and works, one row below.

- **One lock, one place.** The lock/unlock affordance is the package's identity-row
  control — never duplicated in the automaton's top bar.
- **Top-bar actions = portability.** The automaton's wrapper adds only its
  custody-appropriate portability pair; nothing else.
- **Reference (Mnemosyne):** `app/admin/codex/MnemosyneCodex.tsx` mounts the shared
  `CodexShell` with `topbarActions={<CodexPortabilityControls />}` — Download/Load
  and no wrapper Lock button; the identity-row control is the sole lock.

---

## 7. Universal automaton checklist

For any automaton that custodies a codex under a master key:

- [ ] One vault, one `seal()`/`unseal()` (nonce‖ciphertext under the master key).
- [ ] Codex snapshot **and** codex password are standard vault rows (not a bespoke
      sealing path).
- [ ] Inner per-entry secrets are encrypted under the codex password client-side;
      the master key never sees plaintext key material.
- [ ] Rotation is a **generic vault re-seal**, not a key swap.
- [ ] Rotation order: plan (unwrap-old, abort-on-any-failure) → atomic re-seal
      transaction → write new key to disk → flip in-memory last → rollback on
      failure.
- [ ] Rotation refuses while unseal-using work is in flight; other processes pick
      up the new key by polling the env file (safe because rows are already
      re-sealed).
- [ ] Rotation is gated (strongest admin + fresh re-confirm + explicit
      key-export acknowledgement).
- [ ] A regression test proves the codex round-trips through a rotation.
- [ ] The codex mount shows **one** lock control — the package's identity-row
      affordance; the automaton's top bar carries portability actions only
      (Download/Load), never a duplicate Lock button (§6b).

---

## 8b. Cross-entity roster + accepted variants (the settled method)

Verified in code (2026-07-19): the **hub** (`lib/vault.ts`, `lib/hub-codex-store.ts`) and
**Mnemosyne** (`lib/mnemosyneVault.ts`, `lib/mnemosyneCodexStore.ts`) implement §1–§7
**identically in scheme**. Two things differ per-entity — these are **accepted variants, not
drift**; the invariants below are non-negotiable and the same everywhere.

**Non-negotiable invariants (every entity):**
- libsodium `crypto_secretbox_easy` — `sealed_box = nonce(24) ‖ ciphertext`; `MASTER_KEY =
  base64_decode(env) `, **exactly 32 bytes**.
- Two layers: inner per-entry secrets encrypted under a machine-generated **codex password**
  (the master key never sees plaintext key material); outer = the snapshot **and** the codex
  password each sealed under the master key as **ordinary vault entries** (canonical rule #1).
- **Server-held auto-unlock**: the master key is held by the server; the codex loads and
  unlocks at boot with **no operator password prompt** — the admin gains access automatically.
- Rotation = **generic vault re-seal** (§4), never a raw key swap.

**Accepted per-entity variants:**
1. **Master-key env var name:** `<ENTITY>_MASTER_KEY`, always a 32-byte base64 value.
2. **Vault storage medium:** **DB rows** *or* **sealed files** — both are "one vault, one
   `seal()`, generic re-seal." A service with no database uses the file variant.

**Roster:**

| Entity | Env var | Storage | Codex key handling |
|---|---|---|---|
| AncientHub | `SECRETS_MASTER_KEY` | SQLite `secrets_vault` rows (`codex_dropin`) | canonical |
| Mnemosyne | `MNEMOSYNE_MASTER_KEY` | sealed files (`*.sealed`) | canonical (file variant) |
| **Pythia** | `PYTHIA_MASTER_KEY` | sealed files (no DB) | **converging** — see note |

> **Pythia note.** Pythia joins via the **file variant** (like Mnemosyne, since it has no DB),
> master key `PYTHIA_MASTER_KEY` (32-byte base64). Its **interim** `SealedVault` (AES-256-GCM +
> scrypt, holding only the hub HMAC operator secret) is a pre-sovereignty drift; the sovereign
> upgrade replaces it with the canonical libsodium vault and migrates that operator secret into
> it as an ordinary vault entry — so Pythia ends with **one vault, one `seal()`** covering the
> codex snapshot, the codex password, and the HMAC secret. If any entity later drifts from the
> scheme above, that entity's agent brings it back in line — this section is the reference.

## 8. Hub reference files (read these when porting)

| Concern | Hub file |
| --- | --- |
| Seal/unseal + vault format | `lib/vault.ts` |
| Codex server storage (2 vault rows) | `lib/hub-codex-store.ts` |
| Master-key rotation (generic re-seal) | `lib/rotation.ts` |
| Atomic `.env.local` upsert | `lib/env-file.ts` |
| Rotation route (gated) | `pages/api/admin/security/rotate-master-key.ts` |
| Rotation admin UI | `pages/hub/security.tsx` |
| Worker key reload (env poll) | `worker/index.ts` (`reloadMasterKeyFromDisk`) |
| Proof | `tests/integration/rotation-codex-survives.test.ts` |
