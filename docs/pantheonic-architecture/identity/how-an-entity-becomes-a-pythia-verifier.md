# How an entity becomes a Pythia verifier

**Standard (architecture), not a per-entity handoff.** This document says what a Pantheon **entity**
must be and do to act as a **verifier for Pythia's connector-linking flow** — the trusted third
party that proves a user controls both Apollo halves (`₱.` standard + `Π.` smart) before Pythia
autonomously activates their dual API link. It is the entity-level companion to the byte-exact
signing contract in [`HANDOFF-apollo-ownership-verifier.md`](./HANDOFF-apollo-ownership-verifier.md):
that handoff tells the **Codex agent how to build `/apollo-verify`**; this tells an **entity what it
must run and register** to be a verifier at all.

The **first two supported verifier entities are [Mnemosyne](#the-two-entities) and
[OuronetUI](#the-two-entities)** — and, for now, only these two. Expansion to further entities is
TBD (see [Who may become one](#who-may-become-a-verifier-and-why-only-two-for-now)).

---

## Why Pythia needs an external verifier at all

Pythia is **keyless by construction** — it never holds a user's key and never signs (enforced by an
in-repo invariant scanner over its own source). So Pythia *cannot* prove that whoever is linking a
pair of Apollo accounts actually controls them. It delegates that proof to an entity that **does**
hold Apollo keys in a Codex: the verifier signs Pythia's challenge, Pythia checks the signature
against the accounts' **on-chain** Apollo public keys (`Apollo.verify`, pure public data), and only
then treats the pair as proven. On both halves proven, Pythia's own `dual-link-activate` cronoton
fires `A_LinkDualApiKey` — no operator click, no key ever leaving the browser.

A verifier is therefore a **trust anchor for ownership**, nothing more: it asserts "this browser
session controls the private key for account `A`" by returning a signature Pythia can independently
verify. It is never trusted for anything Pythia can check itself.

## What an entity must satisfy to be a verifier

An entity qualifies as a Pythia verifier when **all** of the following hold. Each is independently
checkable.

1. **It runs a Codex that can hold the user's Apollo keypairs.** The verifier signs *in the user's
   browser*, inside an unlocked Codex — the private key never leaves. An entity with no Codex (no key
   custody surface) cannot verify.

2. **It serves the `/apollo-verify` route at a stable origin (`baseUrl`).** A `GET` endpoint that
   accepts `accounts`, `challenge`, `rp`, `callback`, signs the canonical message with whichever of
   the requested Apollo accounts the unlocked Codex holds, and redirects back to `callback` with the
   `proofs`. The exact wire contract, param table, and behaviour are in
   [`HANDOFF-apollo-ownership-verifier.md`](./HANDOFF-apollo-ownership-verifier.md). The reusable
   page/component lives in `packages/codex-ui` (signing from `packages/codex-ouronet`), so every
   qualifying entity mounts the *same* implementation rather than re-writing it.

3. **It signs the byte-exact canonical message.** Four `\n`-joined UTF-8 lines
   (`Apollo ownership proof` / `apollo: <A>` / `nonce: <nonce>` / `rp: <rp>`), diffed byte-for-byte
   against Pythia's `apps/pythia/src/connectors/verify/canonicalMessage.ts`. A single differing byte
   fails `Apollo.verify` on Pythia's side — the #1 integration bug.

4. **It is reachable over HTTPS at a normalized origin.** Pythia stores the verifier as an **origin
   only** (path/query/hash stripped — see `apps/pythia/src/verifiers/store.ts`
   `normalizeBaseUrl`); the browser deep-links to `<baseUrl>/apollo-verify`. The origin must be
   reachable from the operator's browser (this is a browser redirect, not a server-to-server call).

5. **It is registered in Pythia's verifier registry, enabled, by an ancient admin.** A verifier only
   appears in the operator's picker once an admin adds it — Pythia **seeds none** by default. This is
   the deliberate on-ramp: registration is the human act of trusting an entity as a verifier.

Nothing else is required. In particular a verifier does **not** need to be an automaton, does not
need Khronoton, and does not need to talk to Pythia's backend — the whole exchange is a browser
redirect out and back.

## How the registration works (the operator's on-ramp)

Pythia keeps a small, file-backed **verifier registry** (`apps/pythia/src/verifiers/store.ts`);
`{ id, label, baseUrl, enabled, addedAt }` per entry. Two surfaces:

- **Admin CRUD** (ancient-admin only) — Pythia's Admin dashboard → **Verifiers**:
  `POST /admin/verifiers` `{ label, baseUrl }` to add, `POST /admin/verifiers/:id/enabled` to
  enable/disable, `DELETE /admin/verifiers/:id` to remove.
- **Public list** — `GET /api/verifiers` returns only the **enabled** entries (`{ id, label, baseUrl }`),
  which is what fills the verifier picker in the connector Verify popup.

So the lifecycle of "entity → verifier" is: the entity stands up `/apollo-verify` at its origin → an
ancient admin adds it in Pythia's Admin → it becomes selectable in the Verify flow → operators can
choose it to prove ownership. Removing trust is symmetric: disable or delete the registry entry.

> Until at least one verifier is registered and enabled, the Verify popup's picker legitimately shows
> **"— none —"** and the round-trip can't start. That empty state is a *data* gap (no verifier added),
> not a missing feature — the entire wire is built on Pythia's side.

## The two entities {#the-two-entities}

Two entities are supported as Pythia verifiers today. Both already run a Codex with Apollo-curve key
custody; each just mounts the shared `/apollo-verify` page and gets registered.

- **Mnemosyne** (`automatons/Mnemosyne`) — the React automaton that already hosts the Codex UI + a
  sealed vault. It becomes a verifier by mounting the `codex-ui` `/apollo-verify` view at its origin
  (e.g. `codex.ancientholdings.eu`) and being registered in Pythia's admin. *Bringing Mnemosyne to
  the point where it serves this (and adopting the current Pantheonic standards it still drifts from)
  is the operator-driven step that follows this document — see below.*

- **OuronetUI** — already runs the **Ouronet-account** verifier (`OuronetUI/src/routes/verify.tsx`,
  hub `pages/api/admin/account-verification/*`) on the Ouronet Genesis curve (`Ѻ.`). Becoming a
  Pythia verifier is the **same pattern on the Apollo curve** (`dalos-apollo`) generalized to N
  accounts + an `rp` — again by mounting the shared `/apollo-verify` view and registering.

### Who may become a verifier, and why only two for now {#who-may-become-a-verifier-and-why-only-two-for-now}

The gate is **Apollo key custody**: an entity can only be a verifier if it runs a Codex that holds
users' Apollo keys and can sign in the browser. Mnemosyne and OuronetUI are the two Pantheon entities
that do this today, so they are the two supported verifiers. This is intentionally conservative — the
verifier is the ownership trust anchor, so the initial set is small and explicitly named. Whether
further entities may become verifiers is **TBD** and, if opened, is decided at the Pantheon level (a
new entity added here), not by an individual deployment. What is *not* a gate: being an automaton,
running Khronoton, or exposing any server API — those are orthogonal to serving `/apollo-verify`.

## Where this fits the Pantheon

- **Ownership proof, one contract:** the canonical message and `/apollo-verify` route are **not**
  Pythia-specific — they're scoped by a relying-party id (`rp`), so any future consumer reuses the
  same verifier entities by passing its own `rp`. This doc governs the *entity* side; the *contract*
  side is the Apollo-ownership verifier handoff.
- **Keyless RP + key-custody verifier:** the split (Pythia holds no key and verifies on-chain; the
  verifier holds keys and signs in-browser) is the same shape as AncientHub SSO's login verification —
  see the `identity/` SSO and consumer-login docs.
- **Reference implementation:** Pythia (`constructors/Pythia`) is the live RP side — verifier
  registry (`verifiers/store.ts`), the Verify popup + picker (`public/app.js` `openVerifyPopup`), the
  challenge/callback/status routes (`routes/connectorVerify.ts`), and the autonomous activation
  bridge into the `dual-link-activate` cronoton.

## For the operator, after this doc lands

This document is the prerequisite for bringing **Mnemosyne** (and OuronetUI) up to verifier status.
The next step is operator-driven: have the Mnemosyne agent scan the Pantheonic architecture (this doc
+ the `/apollo-verify` handoff), compare against Mnemosyne's implementation, mount the shared
`/apollo-verify` view, and then register Mnemosyne as a verifier in Pythia's Admin. Once registered
and enabled, it appears in the Verify picker and the end-to-end activation self-test can run.
