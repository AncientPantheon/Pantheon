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

### 2e · Consuming an already-active dual-link-key — the now-proven pattern

> **Status (2026-08-01): proven, not speculative.** Everything in this section is driven by classes
> that shipped and are exercised end-to-end by Pythia's own "Self Connector" admin panel — Pythia
> deployed her own dual-Apollo pair, pasted the resulting dual-link-key into her own admin UI, and
> watched this exact mechanism carry it from "not linked" to a live, auto-refreshing gated secret.
> See `constructors/Pythia/docs/work/self-connector-dual-link/{design,plan}.md` for the full build
> record. This supersedes any earlier, more speculative wording in this doc about how a consumer
> that already holds a composite dual-link-key (rather than one lone Apollo account, §2c's shape)
> should wire it in.

> **Correction (2026-08-01, `self-connector-codex-signing` topic):** the paste-in mechanism above
> (`DualLinkConnector` + a per-half `ApolloSigner`) is unchanged and still exactly how Pythia
> consumes her own dual-link-key. What changed is WHERE her two `ApolloSigner`s get their key
> material from, and it matters enough to call out explicitly: an earlier build of Pythia's own
> reference implementation generated + sealed her Apollo keypairs in a bespoke local vault — that
> was corrected after direct operator feedback. **Today Pythia never generates or holds her own
> Apollo private key material anywhere in her own code.** Generation and on-chain activation happen
> exclusively through Pythia's own embedded Codex admin tab (the same proper seed-word/confirmation
> UX any Codex account gets — §2d's "generic account management" reasoning, not a Pythia-specific
> flow). Ongoing unattended signing — the `ApolloSigner.sign()` call `DualLinkConnector` makes every
> tick — is delegated to Codex's own `autoSignApolloChallenge` (`@ancientpantheon/codex/ouronet`,
> v0.7.0+), which decrypts the account's key material from Codex's own already-sealed snapshot
> (`codexStore.loadBackup()` + `codexStore.getOrCreateCodexPassword()`, both already held
> server-side since the initial Codex setup) and signs — zero human interaction after that initial
> setup. See `constructors/Pythia/docs/work/self-connector-codex-signing/{design,plan}.md` for the
> full correction record.
>
> **This is Pythia's own chosen solution, not a requirement of this section's contract.** She uses
> Codex because she happens to run one in-process already, and it already had a proper generation UI
> and an unattended-signing primitive (`autoSignApolloChallenge`) built for exactly this. A consumer
> WITHOUT an in-process Codex (e.g. Mnemosyne, unless it separately adopts Codex itself) still needs
> SOME durable, server-side-accessible signing source of its own — `DualLinkConnector`/`ApolloSigner`
> (§2b) do not require Codex specifically, only some real implementation of the `ApolloSigner`
> interface, wherever that consumer's own key material actually lives.

> **Correction (2026-08-01, `self-connector-panel-redesign` topic):** Step 4 below used to recommend
> reading `status().standard.secret`/`.expiresAt` (and `.smart.*` as a fallback) directly for display —
> **a per-half secret display.** Live use of Pythia's own reference implementation surfaced that this
> is actively misleading: it renders as if two independent credentials exist, when Pythia's gate only
> ever honors ONE — `DualLinkConnector.status()`'s own top-level `secret`/`expiresAt` (standard
> preferred, smart fallback, `null` if neither half is active yet), the exact value `keyProvider()`
> hands to `PythiaClient` in Step 3 above. **This was corrected once already, the hard way** — Pythia's
> own admin panel briefly shipped exactly this wrong per-half pattern before the correction — so this
> section now states the fix directly rather than leaving a future implementation (Mnemosyne's) to
> discover the same confusion independently. Step 4 below reflects the corrected guidance.

> **Correction (2026-08-02, `self-connector-boot-tick-and-layout` topic):** two more corrections
> from direct operator use of the reference implementation, both real bugs rather than polish:
>
> 1. **A consumer's own periodic refresh loop must fire an immediate tick on `start()`, not rely on
>    `setInterval` alone.** `setInterval(fn, intervalMs)` fires its FIRST call only after a full
>    `intervalMs` elapses — for Pythia's own `SelfConnectorLoop` that's 24h. A dual-link-key linked
>    in a PRIOR process lifetime is sealed and survives a restart, but a loop's own cached per-half
>    status starts every fresh boot at `"not-linked"` regardless — so without an immediate tick,
>    EVERY redeploy left the admin looking at a false "not-linked" for up to a day, even though the
>    key was still perfectly good, with no actual action needed to fix it (the operator's first
>    instinct — "do I have to link it again?" — was the wrong diagnosis; the fix was in the loop,
>    not a re-paste). `SelfConnectorLoop.start()` now fires `tick()` once immediately
>    (fire-and-forget, not awaited — a slow/unreachable chain read must never delay the caller's own
>    boot), in addition to starting the periodic interval. Any consumer building its own scheduled
>    refresh loop around `DualLinkConnector`/`PythiaConnector` (rather than the request-time
>    `keyProvider()` pattern in Step 3 below, which needs no loop at all) should do the same.
> 2. **The reference UI's per-half zones are NOT `.deploy-row`** (a later correction to Step 4's own
>    earlier wording, in this same doc, below) **— they're a distinct, purpose-built `.acct-card`.**
>    A single-line `.deploy-row` cannot safely hold a 162-char, unbreakable (no spaces) Apollo
>    account address next to a state chip: without explicit `overflow`/`text-overflow` handling the
>    address bleeds out past its shrunk flex box and visually collides with the chip. `.acct-card` is
>    a bordered zone with the label + chip on their own top line and the address on its own line
>    below, ellipsis-truncated (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`) to
>    fit whatever width is actually available — the general lesson: never put a long, unbreakable
>    identifier string in a plain single-line flex row next to another element without truncation
>    handling, regardless of which specific CSS classes a UI ends up using.
>
> See `constructors/Pythia/docs/work/self-connector-boot-tick-and-layout/design.md` for the full
> record.

> **Correction (2026-08-04, Mnemosyne's `pythia-connector-rework` topic):** the single most
> important thing for a consumer to understand, and the one this doc left implicit until Mnemosyne
> hit it head-on — **a `DualLinkConnector` (or `PythiaConnector`) does NOTHING until something ticks
> it.** `status()` only ever REPORTS cached per-half state; it never itself performs the
> challenge → sign → verify round trip that mints the ephemeral secret. That round trip fires only
> when something calls `tick()` / `ensureSecret()` / `keyProvider()`. Two consequences a consumer
> MUST design for:
>
> 1. **Activation is MULTI-STEP, so a single tick can't complete it.** Each half's first prove
>    returns `202 pending` and merely RECORDS the proof; Pythia's own activation resolver then fires
>    the Cronoton-signed `A_LinkDualApiKey`; only a SUBSEQUENT prove (after the link is active
>    on-chain) returns `200` with the secret. The pair therefore converges over SEVERAL ticks — it
>    is not "tick once and read the key."
> 2. **The request-time `keyProvider()` pattern (Step 3) mints on demand ONLY when a real gated
>    request actually flows through `PythiaClient`.** The parenthetical "…which needs no loop at
>    all" in the 2026-08-02 correction above is true ONLY when live gated traffic is already flowing.
>    A consumer whose gated `PythiaClient` is not yet consumed anywhere — or an admin STATUS PANEL
>    viewed with no gated traffic behind it — will sit at `{pending, pending}` **forever** and never
>    show a key, even though the pair is perfectly linked. (This is exactly what Mnemosyne shipped
>    first: correct wiring, dormant client, panel stuck "pending / not yet minted.")
>
> **The rule: any consumer that DISPLAYS connector status — or that needs its gated key kept warm
> independent of request traffic — MUST drive the connector itself.** Do all of: (a) a periodic
> `tick()` loop started at server boot (with the immediate-tick-on-start fix above), a no-op before a
> key is pasted, so a linked pair converges and refreshes unattended; (b) an immediate `tick()` the
> moment a key is linked, so activation starts on the paste not on the next interval; and (c) a
> `tick()` on each status-poll request, so the pair converges promptly while an operator watches the
> panel (once active this is cheap — the connector returns its cached secret with no round trip until
> near expiry). Reference: Mnemosyne's `automatons/Mnemosyne/lib/pythia/connectorLoop.ts`
> (`startPythiaConnectorLoop` in `instrumentation.ts`, `tickPythiaConnectorOnce` from the link route
> and the status route). See `automatons/Mnemosyne/docs/work/pythia-connector-rework/design.md`.

**Step 1 — obtain an active dual-link-key.** Unchanged from §2d above, just cross-referenced here,
not rewritten: deploy both Apollo halves and link them via Codex's own account-management flow
(`C_DeployApolloPythiaApiKey` ×2 + `C_LinkDualApiKey`, real STOA, human-initiated), then prove
ownership of both halves — either by driving the raw `C_Link`/challenge-verify round trip yourself,
or through Pythia's own browser Link-verify flow — until Pythia's Cronoton-signed
`A_LinkDualApiKey` flips the pair active on-chain (§1b step 3). The result is a **composite
`dual-link-key`** string: `<standard-apollo>|<smart-apollo>` (the literal `PYTHIA|T|DualLinks` table
key, 325 chars, `|` as `DUAL_LINK_BAR`) — the one thing this section's wiring needs as input.

**Step 2 — construct a `DualLinkConnector`.** Published from `@ancientpantheon/pythia-client` as of
`2.5.0` (the package is `2.6.0` as of this writing). It takes the pasted key plus **one
`ApolloSigner` per half** — built the same way §2b describes, bridged to wherever each half's key
material actually lives:

```ts
import { DualLinkConnector } from "@ancientpantheon/pythia-client";

const dualLink = new DualLinkConnector({
  baseUrl: "https://pythia.ancientholdings.eu",
  dualLinkKey: pastedDualLinkKey, // "<standard-apollo>|<smart-apollo>", 325 chars
  standardSigner, // ApolloSigner for the standard half — §2b
  smartSigner,    // ApolloSigner for the smart half — §2b
  // fetchImpl / intervalMs / onError all optional; see the package README.
});
```

A malformed key (wrong length, missing/misplaced `|`, a half not starting with the expected ₱/Π
sigil) throws `PythiaConnectorValidationError` **synchronously, at construction time** — before any
network call — via the package's own `splitDualLinkKey` (also directly importable, alongside the
`DUAL_LINK_BAR` separator constant, if a consumer wants to validate or assemble a key string before
handing it to `DualLinkConnector`).

**Step 3 — wire `keyProvider()` into `PythiaClient`.** Exactly the same shape as §2c's single-account
`PythiaConnector`, just off the dual-link instance instead:

```ts
import { PythiaClient } from "@ancientpantheon/pythia-client";

const client = new PythiaClient({
  baseUrl: "https://pythia.ancientholdings.eu",
  pythiaKey: dualLink.keyProvider(), // resolved fresh per request, no manual refresh loop
});

const gatedRead = await client.read({ code: "(coin.get-balance \"k:abc\")" });
```

Internally, `DualLinkConnector` holds one `PythiaConnector` per half, ticks both independently with
per-half error isolation (one half's signer/network failure never blocks the other's), and reports a
single `secret`/`expiresAt` via `dualLink.status()` — whichever half is active first, since Pythia's
gate never cares which half issued the secret. `status()` also carries each half's own state
separately as `status().standard` / `status().smart` (each `{status: "pending"}` or
`{status: "active", secret, expiresAt}`) — **that per-half shape happens to carry its own `secret`
too (unchanged SDK internals, out of scope for this doc's UI guidance), but step 4 below reads only
the top-level `secret`/`expiresAt` for display — never the per-half ones.** The per-half shape exists
for diagnosing which half is currently serving the credential, not for a second display of it.

**Step 4 — for any UI a consumer builds around this: ONE consolidated masked secret + countdown,
never a per-half display.** Never render the raw ephemeral secret, and — the point this section now
states explicitly, after correcting a real instance of getting it wrong (see the correction callout
above) — **never render TWO secrets, one per half.** Only `dualLink.status()`'s own top-level
`secret`/`expiresAt` (§1 above: standard preferred, smart fallback, both `null` if neither half is
active) is the value that ever reaches `x-pythia-key` for a real gated request; a per-half secret
display implies two independent credentials exist when the gate only ever honors one, which is
actively misleading, not just unpolished. `@ancientpantheon/pythia-client` ships a tiny, pure
`maskSecret(secret)` helper (published `2.6.0`) that returns
`` `${secret.slice(0, 7)}...${secret.slice(-7)}` `` for any secret of realistic length, and the
string unchanged for anything under 14 characters (never produces overlapping/negative-slice garbage
on a short input) — so a consumer's admin UI doesn't have to reimplement this slicing itself:

```ts
import { maskSecret } from "@ancientpantheon/pythia-client";

const st = dualLink.status(); // top-level secret/expiresAt — the ONE consolidated value
if (st.secret) {
  const display = `${maskSecret(st.secret)} — expires in ${formatCountdown(st.expiresAt - Date.now())}`;
}
```

(`formatCountdown` is a small, un-published, UI-local helper — not part of the SDK — that turns a
millisecond delta into e.g. `"23h 58m 41s"`/`"42m 10s"`/`"17s"`/`"expired"`. **Always include seconds,
even alongside hours** (a correction from live use, `self-connector-boot-tick-and-layout` topic): an
earlier version dropped seconds once an hour or more remained, showing e.g. just `"23h 58m"` — which
only visibly changes once a minute, reading as static/frozen rather than live. A countdown that
visibly ticks down every second is the operator's actual at-a-glance proof the loop behind it is
alive, not stale. Write your own the same shape as the reference implementation below.)

Per-half state (`st.standard.status`/`st.smart.status`, each `"pending"` or `"active"`) is still
worth showing **separately, as diagnostic state only** — e.g. a small chip per half, so a struggling
half (one whose signer or network keeps failing) stays visible even though the gate is still served
fine by the other half — but that per-half display must never carry a `secret` or `expiresAt` value
of its own. State only, never a second secret.

**Concrete, working reference implementation:** Pythia's own now-redesigned Self Connector admin
panel — `constructors/Pythia/apps/pythia/public/admin.html` (the `data-view="self-connector"`
section, `.deploy-card`-framed) and `constructors/Pythia/apps/pythia/public/admin.js`
(`selfConnectorHalfView`, `formatCountdown`, `renderSelfConnector`, `wireSelfConnector`) — does
exactly this corrected pattern. Server-side, `apps/pythia/src/admin/routes.ts`'s
`SelfConnectorStatus` type mirrors the consolidated shape directly: top-level
`maskedSecret: string | null` / `expiresAt: number | null` (computed once, server-side, from
`DualLinkConnector.status()`'s own top-level `secret`/`expiresAt` via `maskSecret` — masked before it
ever reaches the browser, mirroring this doc's own no-raw-secret-over-the-wire posture throughout),
while `SelfConnectorHalfView` (`status.standard`/`status.smart`) carries **only**
`{ state: "not-linked" | "pending" | "active" }` — no secret data at the per-half level at all. The
browser renders this as: two `.acct-card` zones (one per half — a bordered box with the label + state
chip on their own top line and the account address on its own line below, ellipsis-truncated to fit;
NOT a single-line `.deploy-row`, which can't safely hold an unbreakable 162-char address next to a
chip without the two visually colliding — a real bug this reference implementation shipped once and
corrected, see the correction callout above), state text only — `"Not linked"` / `"Pending"` /
`"Active"` — plus exactly ONE `.ttl-card` (shown only when `maskedSecret` is non-null) holding the
single masked secret, a depleting horizontal timer bar, and the text countdown
— all three re-rendered once a second off the last fetched status (no extra network call per tick). A
consumer's own UI does not have to mask server-side the way Pythia's does (that choice reflects
Pythia's own no-raw-secret-over-the-wire convention, not a hard requirement of the SDK), and does not
have to build a timer bar (Pythia's is the first one in this codebase, purely a visual nicety) — but
the ONE-consolidated-secret shape itself is not optional: it is the corrected, recommended starting
point for any UI built around either `PythiaConnector` (§2c) or `DualLinkConnector` (this section),
and a per-half secret display is the one pattern this reference implementation explicitly does NOT
use, on purpose, having already built and then corrected it once.
See `constructors/Pythia/docs/work/self-connector-panel-redesign/{design,plan}.md` for the full
correction record (Topic 4, following Topics 2 and 3 referenced above).

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
  secretStorage}.ts` — the single-account SDK (§2c). `constructors/Pythia/packages/pythia-client/
  src/{dualLinkConnector,dualLinkKey,maskSecret}.ts` — the dual-link-key SDK (§2e): `DualLinkConnector`,
  `splitDualLinkKey`/`DUAL_LINK_BAR`, and `maskSecret`.
- **Server-side protocol** (deployed with the Pythia service, NOT part of the npm package):
  `constructors/Pythia/apps/pythia/src/connectors/auth/*`, `constructors/Pythia/apps/pythia/src/
  automaton/khronoton/dualLinkActivateResolver.ts`, `constructors/Pythia/apps/pythia/src/routes/
  connectorAuth.ts`.
- **§2e's own reference implementation** (Pythia as her own dual-link-key consumer):
  `constructors/Pythia/apps/pythia/src/automaton/{selfApollo,selfConnectorLoop,codexApolloSigner}.ts`
  (server-side — `SelfApolloVault.setDualLinkKey` validates a pasted key against Codex's own
  `ouroAccounts` snapshot via `codexApolloSigner.ts`'s `codexHoldsAccount`; `SelfConnectorLoop` wraps
  `DualLinkConnector`; `codexApolloSigner.ts`'s `createCodexApolloSigner` is the `ApolloSigner`
  implementation that delegates every `sign()` call to Codex's `autoSignApolloChallenge`),
  `constructors/Pythia/apps/pythia/public/{admin.html,admin.js}` (browser-side — the paste-in Link
  control + the ONE consolidated masked-secret/timer-bar/countdown display, plus two per-half
  diagnostic state chips; generation itself happens in this same admin page's separate, pre-existing
  Codex tab, not here).
- **Build rationale + full design decisions:** `constructors/Pythia/docs/work/
  pythia-connector-protocol/design.md` (umbrella), `constructors/Pythia/docs/work/
  connector-auth-core/`, `constructors/Pythia/docs/work/connector-activation-resolver/`,
  `constructors/Pythia/docs/work/pythia-client-connector-sdk/` (`design.md`/`plan.md`/`review.md`
  each — the original `PythiaConnector`/`ApolloSigner` SDK), `constructors/Pythia/docs/work/
  pythia-dual-link-connector/design.md` (umbrella) → `constructors/Pythia/docs/work/
  pythia-client-dual-link-sdk/design.md` (Topic 1 — `DualLinkConnector`/`splitDualLinkKey`),
  `constructors/Pythia/docs/work/self-connector-dual-link/{design,plan}.md` (Topic 2 — Pythia
  wiring herself up as the first proof, §2e's reference implementation),
  `constructors/Pythia/docs/work/self-connector-codex-signing/{design,plan}.md` (Topic 3 —
  correcting §2e's reference implementation from a bespoke local vault to Codex-backed generation +
  unattended signing, after direct operator feedback), `constructors/Pythia/docs/work/
  self-connector-panel-redesign/{design,plan}.md` (Topic 4 — correcting §2e's reference
  implementation, and this doc's own UI guidance, from a per-half masked-secret display to the ONE
  consolidated top-level `secret`/`expiresAt` display, plus a visual redesign to the codebase's
  established framed-card language), and `constructors/Pythia/docs/work/
  self-connector-boot-tick-and-layout/design.md` (Topic 5 — two more live-use corrections: an
  immediate tick on `start()` so a redeploy never shows a false "not-linked" for an already-linked
  pair, and the `.acct-card` account-zone layout replacing `.deploy-row` for the reasons above).

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

## 6 · Pythia is the Pantheon's on-chain METER — every entity's traffic must flow through her

**Principle (load-bearing):** Pythia is the single meter of Pantheon on-chain activity. Two counters,
two DIFFERENT rules — do not conflate them:

**PETITIONS + PONDUS = reads Pythia SERVES to a client.** A "client read" is any read any client asks
of Pythia through her `/read` gateway — including **Pythia's own frontend** reading chain data to
display it, **OuronetUI**, **StoaExplorer**, **Mnemosyne**, any consumer. Every one of those counts a
petition (+ pondus). **EXCLUSION — Pythia's OWN internal dirty reads do NOT count**: the reads her
machinery performs for itself and never serves to a client — the automaton's pre-fire safety-simulates,
gas calibration, verify-flow trust-anchor reads, cache polls, health checks. Counting those would
inflate petitions with Pythia's own plumbing. Rule of thumb: **served to a client → counts; Pythia
reading for her own purposes → does not.** (Metering lives at the `/read` gateway middleware, which
only sees client-served reads. The automaton's Khronoton runtime `dirtyRead` is deliberately passed
through UNMETERED — see `meterChainRuntime`.)

**TRANSACTIONS + GAS-RESERVED = every send/fire that touches the chain through Pythia.** Here the rule
IS exhaustive — nothing hits the chain on the Pantheon's behalf without being counted:

- **Consumers** broadcasting through Pythia's `/send` gateway — metered by the gateway middleware
  (`recordSend`).
- **Pythia's OWN automaton fires** (her Khronoton cronotons — `A_Link`, `A_Flush`, …). These submit
  straight to a node via Khronoton's chain runtime, which would otherwise bypass the meter — so Pythia
  wraps that runtime (`meterChainRuntime`) to count each `submit → recordSend`. (Only the submit; NOT
  the dirtyRead, per the read rule above.)
- **Every OTHER automaton / daimon** (Mnemosyne, OuronetUI, future **Aletheia**). The rule generalizes:
  **an automaton must not fire directly to a node unmetered** — either broadcast *through* Pythia's
  `/send` gateway (e.g. via `@ancientpantheon/pythia-client`), or, if it runs its own embedded
  Khronoton, wrap that engine's chain runtime with the same `meterChainRuntime` seam. Firing unmetered
  is a conformance bug.

**Hub reporting:** the per-slot usage report to the hub (the operator-earning "money path") carries the
client-served READS (keyed + anon requests, keyed pondus) — Pythia's own excluded dirty reads never
enter it because they were never counted. Reference: `constructors/Pythia` —
`apps/pythia/src/pyth/{ledger,meter,pondus}.ts` (the meter), `apps/pythia/src/stats/{slotUsage,
usageReporter}.ts` (the hub report), and `apps/pythia/src/automaton/khronoton/meteredRuntime.ts` (the
automaton-fire seam — meters submit only).

### 6a · The trap when a consumer submits through a LOADED CODEX (do not guess this)

A consumer that surfaces the codex-ouronet dashboard (`@ancientpantheon/codex`) — Mnemosyne, OuronetUI —
has a **non-obvious send bypass**, proven live in Mnemosyne (`pythia-write-routing`). Wiring the Pythia
`global` connection (§2c / `createPythiaConnection`) routes **reads** through Pythia (petitions climb),
which makes it *look* metered. But the codex's **writes do NOT go through that connection.** The
on-chain broadcast is done by codex-ouronet's `CodexSigningStrategy`, which submits via a
`@stoachain/kadena-stoic-legacy` pact client **straight to a chainweb node** (`…/pact/api/v1/send`) —
never through Pythia. So `petitions` moves while `transactions` stays flat. Being "connected" and having
reads count is NOT proof the send path is metered — verify `transactions`/`failedTransactions` MOVE
after a real fire.

**The fix (the supported seam — no forking codex):** `<CodexProvider>` takes a **`signingClient`** prop.
It becomes the strategy's `clientOverride`; the strategy calls exactly two methods on it —
`dirtyRead(sim)` (simulate/gas) and `submit(signed)` (broadcast, must return `{ requestKey }`). Inject a
client whose:

- **`submit`** relays the SIGNED command through Pythia's `POST /stoachain/send` (via
  `@ancientpantheon/pythia-client`'s `client.send({ cmds })`) — this is what makes the tx COUNT + be
  attributed by key. Map Pythia's `503 { code:"pythia_no_tx_sender" }` to a clear error; **never** fall
  back to a node. (`pythia_no_tx_sender` is NOT one of the client's thrown-envelope codes, so `send()`
  returns it as a verbatim body — inspect the result, don't just catch.)
- **`dirtyRead`** stays a direct-node `/local`: it is a full-command simulation whose gas (incl.
  caps/signers) must be accurate, and `/stoachain/read` is code-only. A `/local` mutates nothing and is
  not what the transaction meter counts.

**Keying is a SERVER concern.** The codex signs in the browser, but the connector's `x-pythia-key` is a
server secret (minted by the server-side connector loop). So the browser `submit` must POST to a
**consumer-owned, auth-gated server relay** that attaches the key (the server-side gated `PythiaClient`)
and forwards to Pythia — not call Pythia directly from the browser (which would be unkeyed →
`byConsumer["direct"]`, and would leak nothing useful). Gate that relay so it is not an open
Pythia-keyed relay under the automaton's attribution. Reference implementation (Mnemosyne, operator
codex only): `app/api/pythia/relay/route.ts` (ancient-gated relay) + `app/codex/codexRelaySigningClient.ts`
(the browser `signingClient`) + the `signingClient=` prop on the `<CodexProvider>` in
`app/admin/codex/MnemosyneCodex.tsx`.

**Embedded-Khronoton fires are the OTHER path** (§6 bullet 3): a consumer that runs its own Khronoton
(Mnemosyne does) also submits scheduled fires direct-to-node via khronoton-core's chain runtime. Route
those the same way — wrap the runtime's `submit` to relay through Pythia's `/stoachain/send` (the
consumer analogue of Pythia's own `meterChainRuntime`). Do not assume the codex fix covers it — it is a
separate submit seam.
