# Handoff 06 — What `@ancientpantheon/pythia-client` actually is, and how to wire the connector protocol into a consumer

**For:** any Daimon or Automaton (Mnemosyne, Caduceus, Aletheia, Pythia herself, …) adopting Pythia
as its blockchain read gateway with attributed/gated access.
**From:** the Pythia package agent.
**Supersedes:** `archive/PYTHIA-CONSUMER-KEY-MODEL.md`, `archive/HANDOFF-consumer-key-INTERFACES.md`,
`archive/DUAL-APOLLO-CONSUMER-IDENTITY.md` — all three described a protocol that was never built
(single Apollo key, `APIARY` module naming, one-time activation, or an asymmetric S/C role split).
This doc reflects what actually shipped, grounded against the **live** on-chain `PYTHIA.pact`
module, not a stale local checkout.

**Companion doc:** `organs/05-khronoton-engine-wire-in.md` §4 — the **staged-integration gate**
("do not wire consumers live until all three Constructors — Pythia, Codex, Khronoton — are
finalized"). Pythia is now the third. See §5 below.

---

## 0 · Why this package is confusing, and the one thing to understand first

`@ancientpantheon/pythia-client` is **one npm package with two, additive, unrelated-looking
capabilities** that shipped at different times:

1. **The read-gateway transport client** (shipped first, unchanged): `PythiaClient.read`/`send`/
   `poll`/`health` — a thin, keyless wrapper over Pythia's `/stoachain/*` endpoints. This is what
   `organs/CONSUMER-INTEGRATION.md` means when it says the Codex's `PythiaConnection` "wraps
   `@ancientpantheon/pythia-client`." **Every consumer that reads chain data through Pythia already
   needs this half**, gated or not.
2. **The connector-auth SDK** (added in `2.3.0`, this handoff): `PythiaConnector`, `ApolloSigner`,
   `SecretStorage`, and a `pythiaKey` option on `PythiaClientOptions`. This is **new** — it drives
   Pythia's headless challenge/sign/verify protocol to obtain a live, attributed, gated
   `x-pythia-key` secret, and feeds it into the SAME `PythiaClient` from capability 1.

**If a consumer only ever needs anonymous/unattributed reads, capability 1 alone is enough — do not
force capability 2 on it.** Capability 2 exists for a consumer that wants attributed access (its own
read/send/poll lane, gated per Pythia's own request-gating rule — see §2) or that wants to avoid the
unattributed "direct" bucket entirely.

This makes `@ancientpantheon/pythia-client` the **third organ**, alongside `@ancientpantheon/codex`
and `@ancientpantheon/khronoton-core` — every automaton that wants gated Pythia access installs it
the same way it already installs the other two.

---

## 1 · The protocol (what's actually live on-chain)

Grounded against the deployed `PYTHIA.pact` module (verified directly this session — the archived
docs' `APIARY`/`pythia-consumer-keys` sketches were guesses from a stale checkout and do not match).

### 1a · Identity: a dual-Apollo pair, symmetric

A consumer's Pythia identity is **one pair of Apollo accounts** — a **Standard** (`₱.`, U+20B1) and
a **Smart** (`Π.`, U+03A0) account, both 162-char strings, both signed with the `dalos-apollo`
Schnorr v2 curve. **Both halves belong to the same consumer** — there is no separate "owner slot"
vs. "consumer identity" role split (unlike the archived `DUAL-APOLLO-CONSUMER-IDENTITY.md`'s S/C
model). The consumer deploys both halves, links them together, and the linked pair is its one
identity.

On-chain (module `PYTHIA`, in `ouronet-ns`):

| Table | Row | Key fields |
|---|---|---|
| `PYTHIA\|S\|ApiKey` | one per Apollo half | `public`, `counterpart` (`BAR` sentinel until linked), `owner-account` |
| `PYTHIA\|S\|DualLink` | one per linked pair | `standard-apollo`, `smart-apollo`, `consumer-lane`, `iz-active` |

Functions:

- **`C_DeployApolloPythiaApiKey`** — user-called, self-service, 500 STOA per half. Deploys one
  Standard or Smart Apollo API-key row.
- **`C_LinkDualApiKey(standard, smart, consumer-lane)`** — user-called, requires **both**
  half-owners' authorization, no fee. Creates an **inactive** `DualLink` row (`iz-active: false`).
  ONE pair per call — never batched.
- **`A_LinkDualApiKey(standard, smart)`** — **Cronoton-gated** (Pythia's own automaton signs this,
  the same proven mechanism as her ledger-flush action). Flips `iz-active: true`, only after
  Pythia has independently verified — off-chain — that the caller proved possession of **both**
  Apollo private keys via a fresh signed challenge. This is the step this handoff's SDK exists to
  drive the client side of.
- **`UR_ActiveDualLinkSet`** / **`UR_Counterpart`** — free `/local` reads Pythia's own server uses to
  mirror the active set and pair up independent per-half proofs.

### 1b · Lifecycle

```
1. Deploy   — consumer calls C_DeployApolloPythiaApiKey twice (Standard half, Smart half).
              500 STOA each. Both keys live in the consumer's OWN sealed Codex — the seed
              never leaves it.
2. Link     — consumer calls C_LinkDualApiKey(standard, smart, lane). Free. Creates an
              INACTIVE DualLink row.
3. Prove    — consumer (via this SDK) drives a headless challenge/sign/verify round trip
              for EACH half against Pythia. Each successful verify records a proof;
              Pythia's own activation-resolver pairs the two proofs and fires
              A_LinkDualApiKey once both are in — Cronoton-signed, on-chain, autonomous.
4. Use      — once active, PROVING OWNERSHIP AGAIN via challenge/verify mints a live
              ephemeral secret (3h TTL) the consumer sends as `x-pythia-key` on every
              gated read/send/poll call. This repeats every ~3h for as long as the
              consumer keeps calling — NOT a one-time activation-then-static-header
              model (that was the archived docs' guess, and is wrong).
5. Revoke   — the owner (or admin) flips `iz-active` false on-chain; Pythia's cache
              catches it on its next poll and the gate starts rejecting.
```

**The security property that makes this safe** (unchanged from the archived identity doc's
reasoning, which got this part right): on-chain data is public keys only. The private half never
leaves the consumer's own sealed Codex. Pythia authenticates by **proof-of-possession** (a fresh
signature over a server-issued nonce) — never by an asserted/copied public identifier.

### 1c · Wire shapes (locked, verified against the live route handlers)

- `POST /connectors/auth/challenge` — body `{ apolloAccount }` → `200 { nonce, rp, expiresAt }`, or
  `400 { error: "invalid apollo account" }`.
- `POST /connectors/auth/verify` — body `{ apolloAccount, nonce, signature }` →
  - `200 { secret, expiresAt }` — active dual link, secret issued.
  - `202 { error: "..." }` — ownership proven, not yet an active dual link (a normal, expected
    state for a brand-new pair still waiting on step 3 above — **not an error**).
  - `400` invalid/expired nonce · `401` bad signature · `403` not active, no pairing path available ·
    `502` transient chain-read failure.
- Gated requests carry `x-pythia-key: <secret>`. No header at all → today's unchanged, unattributed
  "direct" access. A present-but-invalid/expired key → `401` (an actively-wrong identity is treated
  differently from an anonymous caller, on purpose — it usually means a misconfigured consumer).

---

## 2 · How to wire it in

### 2a · Install

```sh
npm install @ancientpantheon/pythia-client
```

Peers: **none required** — this organ has zero runtime dependencies (rests only on the platform
`fetch`). Nothing to add to R1's peer-declaration checklist in `organs/ORGAN-DEPENDENCY-CONTRACT.md`.

### 2b · Bridge your own Apollo signing capability

`PythiaConnector` never holds key material — it needs an `ApolloSigner` you supply, backed by
wherever your consumer's Codex/sealed identity already lives:

```ts
import type { ApolloSigner } from "@ancientpantheon/pythia-client";

const signer: ApolloSigner = {
  async sign({ apolloAccount, nonce, rp }) {
    // Bridge to your own sealed Codex's Apollo-signing capability.
    const signature = await myCodex.signApolloChallenge(apolloAccount, nonce, rp);
    return { signature };
  },
};
```

This mirrors §1c of `organs/CONSUMER-INTEGRATION.md`'s injection philosophy exactly: the organ
receives a **capability**, never the key itself.

### 2c · Wire the connector, then feed its secret into `PythiaClient`

```ts
import { PythiaClient, PythiaConnector } from "@ancientpantheon/pythia-client";

const connector = new PythiaConnector({
  baseUrl: "https://pythia.ancientholdings.eu",
  apolloAccount: myStandardOrSmartApolloAccount, // whichever half this process proves
  signer,
  // storage defaults to in-memory; inject your own to persist across restarts.
});

const client = new PythiaClient({
  baseUrl: "https://pythia.ancientholdings.eu",
  pythiaKey: connector.keyProvider(), // resolved fresh per request — no manual refresh loop
});
```

`connector.ensureSecret()` returns `{status:"pending"}` (not a thrown error) while step 3 of the
lifecycle (§1b) is still in flight — a brand-new pair, or one whose proof hasn't both landed yet.
Poll it on your own cadence; there is no built-in timer (this package stays dependency-light and
runtime-agnostic per its own established convention — see `docs/work/pythia-client-connector-sdk/
design.md` Decision 1 in the Pythia repo for the full reasoning).

**If you expose `baseUrl` as an admin-editable settings field** (e.g. so an operator can point at a
non-production Pythia), make the real production URL
(`https://pythia.ancientholdings.eu`) the field's actual **saved default** — not merely
placeholder/hint text shown over an empty input. A placeholder looks identical to a real, active
value at a glance, but an unsaved empty field means no gateway is wired at all; describe the field
as "change this only if Pythia is deployed somewhere else," and ship it pre-filled/pre-saved with
the real URL, not empty-with-a-hint.

**Two independent processes proving each half** (e.g. the Standard half signed by one service, the
Smart half by another) is supported — `recordProof` on Pythia's side pairs them regardless of order
or which process calls first.

### 2d · Deploy + link is a CODEX concern, not a Pythia-connector one — do not build an onboarding wizard for it

> **⚠ Confirmed mistake, corrected here (2026-08-01):** an earlier draft of this section left steps
> 1-2 open-ended enough that a real consumer implementation read it as "build a self-contained
> onboarding flow in your Pythia-connector admin panel that generates a fresh Apollo pair and
> deploys+links it on-chain." **That is the wrong shape.** It duplicates account-management
> capability Codex already owns generically, and — found the hard way — it is genuinely
> higher-risk than it looks: an automated on-chain deploy/link flow needs a working
> Apollo-curve/Schnorr Pact-transaction *signer*, which is a DIFFERENT operation from this SDK's
> `ApolloSigner` (that only signs the short off-chain challenge message, §1c) and may not exist
> anywhere in your stack — confirm this before ever wiring an automated on-chain path, do not
> assume it.

Steps 1-2 of §1b (`C_DeployApolloPythiaApiKey` ×2, `C_LinkDualApiKey`) are **key-management
actions on an Apollo pair — the same kind of action as creating any other on-chain account your
Codex already manages.** They belong wherever your consumer already lets a human generate, deploy,
and manage its own on-chain accounts generically (Codex's own account UI/flow) — **not** a
bespoke "Pythia connector onboarding" feature. Concretely:

- **The human**, using Codex's existing (or to-be-built, but generically-Apollo-shaped, not
  Pythia-specific) account management flow, generates a Standard + Smart Apollo pair, deploys both
  halves on-chain, and links them (`C_DeployApolloPythiaApiKey` ×2 + `C_LinkDualApiKey` — real STOA,
  a deliberate, admin-initiated action, same as any other on-chain account creation already is).
- **The Pythia-connector wiring** (this handoff's actual scope) then does exactly three things,
  none of which touch on-chain deploy/link:
  1. Takes a **reference to that already-deployed-and-linked pair** as its only configuration input
     — e.g. the Standard account's address, or however your Codex already lets one account be
     selected/named among several. Not a "start onboarding" action; a plain settings field, the
     same shape as picking which existing account to use for anything else.
  2. Builds an `ApolloSigner` (§2b) that signs FOR that referenced pair, reading its key material
     the same way your Codex already resolves any other account's signing key (mirror whatever
     your existing on-chain transaction signing already does to resolve a keypair by
     account/address — do not invent a second, parallel key-resolution path just for this).
  3. Wires `PythiaConnector`/`PythiaClient` per §2c. **Step 3 of §1b (prove ownership → Pythia's
     Cronoton activates the link) stays fully automatic** — that's what `ensureSecret()`/
     `keyProvider()` already do, on whatever polling cadence you drive them from. Only steps 1-2
     (deploy + link, the STOA-spending part) are the human's job, done through Codex, not this
     wiring.

If your consumer's Codex doesn't yet have a generic "create + deploy + link an Apollo pair" flow,
build THAT (Codex-shaped, reusable for any future Apollo-account need) rather than a
Pythia-connector-specific onboarding wizard — the distinction matters for exactly the reason this
box exists.

---

## 3 · Becoming the third row in the deploy panel

Per `automaton/05-deploy-panel-and-progress.md` §1a: the `CONSTRUCTORS` group in a consumer's own
Update & Deploy panel is populated by **that consumer's own organ-probe code** — nothing about
publishing this package makes it appear automatically anywhere. To add Pythia as a third constructor
row (alongside Codex and Khronoton) in your own panel:

1. Add `@ancientpantheon/pythia-client` wherever your consumer already resolves the other two organs'
   installed version + npm `dist-tags.latest` (Pythia's own reference implementation:
   `apps/pythia/src/admin/organVersions.ts`, in the Pythia repo — resolve from the **reading
   module's own location**, not `process.cwd()`, per §1d's hoisting trap).
2. Follow whichever constructor-adoption policy (`automaton/05` §1c) your consumer already declared
   for Codex/Khronoton — auto-adopt (`npm install @ancientpantheon/pythia-client@latest` before
   each build) is canonical; apply the same policy to this organ, don't mix policies per-organ.
3. Run the organ-bump checklist (`organs/ORGAN-DEPENDENCY-CONTRACT.md` §3) once, against the
   published `2.3.0` tarball, before wiring it live.

---

## 4 · Reference implementation

- **Package source:** `constructors/Pythia/packages/pythia-client/src/{connector,connectorErrors,
  secretStorage}.ts` — the SDK this handoff describes.
- **Server-side protocol** (deployed with the Pythia service, NOT part of the npm package):
  `constructors/Pythia/apps/pythia/src/connectors/auth/*`, `constructors/Pythia/apps/pythia/src/
  automaton/khronoton/dualLinkActivateResolver.ts`, `constructors/Pythia/apps/pythia/src/routes/
  connectorAuth.ts`.
- **Build rationale + full design decisions:** `constructors/Pythia/docs/work/
  pythia-connector-protocol/design.md` (umbrella), `constructors/Pythia/docs/work/
  connector-auth-core/`, `constructors/Pythia/docs/work/connector-activation-resolver/`,
  `constructors/Pythia/docs/work/pythia-client-connector-sdk/` (`design.md`/`plan.md`/`review.md`
  each).

---

## 5 · The staged-integration gate — going live is a separate decision from this handoff

This handoff documents **how** to wire the connector protocol in. **Whether to flip any specific
consumer onto it live is the admin's call** — same standing rule `organs/05-khronoton-engine-wire-in.md`
§4 already states for Khronoton. Two known candidate first consumers, **neither wired yet**:

- **Mnemosyne** — not yet scoped. Whether Mnemosyne's existing Pythia calls should move to gated
  access, and what its own Apollo pair / signing story looks like, needs its own pass in the
  Mnemosyne repo.
- **Pythia herself, as her own consumer** (self-referential — deploying her own dual-Apollo pair and
  using this same SDK against her own gateway) — explicitly deferred when the connector protocol was
  designed (`docs/work/pythia-connector-protocol/design.md` Decision 4): *"not required for the core
  capability... revisit once there's an actual internal consumer of it."* Still deferred.

Do not wire either live from this handoff alone — it documents the pattern; the admin instructs each
consumer's own agent/session separately when ready to execute.
