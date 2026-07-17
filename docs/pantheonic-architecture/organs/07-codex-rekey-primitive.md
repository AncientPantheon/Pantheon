# Handoff 07 — The codex package should own password re-key (`rekeyCodex`)

**For:** the Codex package agent (repo `D:/_Claude/AncientPantheon/Codex`, behind
`@ancientpantheon/codex`).
**From:** the Mnemosyne (consumer) agent.
**Type:** investigate + (likely) a small, additive package primitive that every automaton
needs going forward.

## The gap (please confirm — the owner assumed this already existed)
"A user can change their codex password" is a first-class expectation. But auditing the
published package against a real consumer, the **re-encryption itself is not in the package**:

- The package ships **`ChangePasswordCard`** — but only the *form + validation*. Its doc says
  it verbatim: *"The package does NOT own codex-password rotation: re-encrypting every secret
  under a new password is a crypto operation the consumer performs (OuronetUI's
  ChangePasswordModal does this against its own wallet-context)."* It delegates to an
  `onChangePassword` **consumer seam**.
- The cipher is **not in this package either** — it's in the shared `@stoachain/stoa-core/crypto`
  (`smartDecrypt` / `encryptStringV2`, PBKDF2-SHA512/600k + AES-GCM-256, pure/isomorphic).
- So the actual re-key — *walk the snapshot's secret fields, decrypt each with the old
  password, re-encrypt with the new* — lives **nowhere in the package**. OuronetUI hand-rolled
  it (`src/context/wallet-context.tsx` → `upgradeCodexEncryption()`). Mnemosyne would hand-roll
  it again. So would Caduceus/Aletheia.

The re-key is a **pure `snapshot → snapshot` transform** — no persistence, no store, no DOM.
Persistence (`saveAll`) is legitimately the consumer's; the *transform* is not. It belongs
where the snapshot shape is owned: here.

**Please investigate first:** confirm there isn't already a snapshot-level re-key / export-
with-password export we missed, and whether the consumer-seam split was deliberate for a
reason. Our finding: only the `ChangePasswordCard` form-seam exists; no snapshot-level
`rekey`/`reencrypt`/`exportWithPassword` is exported.

## The ask — ship `rekeyCodex` (pure, isomorphic)
```ts
// Pure snapshot→snapshot; runs in Node AND browser; no store/DOM dependency.
export async function rekeyCodex(
  snapshot: CodexSnapshot,
  oldPassword: string,
  newPassword: string,
): Promise<CodexSnapshot>;
```
Behavior (mirror OuronetUI's proven `upgradeCodexEncryption`, but old→new instead of same-pw
V1→V2):
- **Pre-flight**: verify `oldPassword` against one known blob; a `WrongPasswordError` aborts
  **before mutating anything**.
- **Re-key every ciphertext field** — `plain = await smartDecrypt(blob, oldPassword)` then
  `blob = await encryptStringV2(plain, newPassword)`. Output V2 (a re-key is the moment to
  upgrade any lingering V1).
- **Skip-not-drop**: a non-decryptable entry keeps its original ciphertext + is recorded
  (never silently dropped) — OuronetUI's safety pattern.
- Leaves non-secret fields (public keys, uiSettings, addressBook, ids, timestamps) untouched.

**The secret-field inventory `rekeyCodex` must walk** (from a full read of the current
snapshot types — *this is exactly why it belongs in the package: it grew in 0.3.0 and only you
can keep it in lockstep*):

| Slice | Field(s) | Type |
|---|---|---|
| `kadenaSeeds` (export: `kadenaWallets`) | `.secret` | `IStoaChainSeed` |
| `ouroAccounts` (export: `ouronetWallets`) | `.secret`, `.backup` | `IOuroAccount` |
| `pureKeypairs` | `.encryptedPrivateKey` | `IPureKeypair` |
| `foreignKeys` | `.encryptedKeyfile` (per entry) | `ForeignKeyEntry` |
| `codexIdentity` (v0.3.0+) | 9 required `encrypted*` + 2 optional (`encryptedSeedWords`, `encryptedStandard/SmartBitstring`, `.../Base10`, `.../Base49`, optional `.../PrivateKey`) | `ICodexIdentity` |
| `uiSettings_enc` sidecar | adapter-owned CK slot (server adapters no-op it) | document the handling |

Crypto to call: `@stoachain/stoa-core/crypto` → `smartDecrypt`, `encryptStringV2`
(`smartEncrypt`, `smartDecryptWithDetails`, `WrongPasswordError`). Reference algorithm:
OuronetUI `wallet-context.tsx` `upgradeCodexEncryption()` (decrypt-all → re-encrypt-all,
`verifyPassword` pre-flight, skip-not-drop).

## Also — make `ChangePasswordCard` work out of the box
Wire `rekeyCodex` as the **default `onChangePassword`** (or expose a headless
`changeCodexPassword` that does rekey + `saveAll`), so "change your password" works without
every consumer re-implementing it. The consumer should only need to supply persistence.

## Why the PACKAGE and not each consumer (the load-bearing reason)
The inventory **grew in 0.3.0** (the CodexID). A consumer-inline copy of the field-walk
**silently misses any new secret field** a future codex adds → a re-key leaves that secret
under the *old* password → **permanently unusable after rotation**. Only the package, which
owns the snapshot shape, can keep `rekeyCodex` correct as the shape evolves. That's a
correctness guarantee, not just DRY.

## How Mnemosyne will consume it (both are server-side, Node)
Mnemosyne's codex is server-custody (master-key sealed; the codex password is a machine value
the user never sees). Once `rekeyCodex` ships, Mnemosyne builds two thin ancient-gated
endpoints:
- **Download** (`POST /api/admin/codex/export {newPassword}`): unseal → `rekeyCodex(snapshot,
  machinePw, newPassword)` → `exportForCloud` → user downloads a portable codex encrypted
  under a password *they* chose. Live codex untouched.
- **Load/adopt** (`POST /api/admin/codex/import {backup, filePassword}`): `rekeyCodex(
  foreignSnapshot, filePassword, machinePw)` → `saveAll` (re-sealed under the master key) → the
  loaded codex is adopted into server custody and auto-unlocks as normal.

Both require `rekeyCodex` to be a **pure snapshot transform usable in Node** (not tied to the
mounted store) — please keep it store-free.

## Suggested version
Additive → a codex **minor** bump. Mnemosyne's Download/Load waits on it (owner chose
package-first, consistent with the Khronoton `khronoton-stoachain` decision in handoff 06).
