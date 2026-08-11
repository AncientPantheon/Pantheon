# Pantheonic Architecture

The single, canonical authority for how every **AncientPantheon** site is built and how it looks —
functionality, implementation, AND UI. If you are constructing a new Pantheon thing (an automaton
like Caduceus/Aletheia, a constructor-service like Pythia, the website itself), **read this folder
first.** The goal: no guessing. Same shape, same organization, same identity flow across every
site — only the colour theme changes.

> **Living document.** This library grows as new patterns surface. Every change is recorded in
> [`CHANGELOG.md`](./CHANGELOG.md) and in this repo's git history. When you learn a Pantheon-wide
> lesson worth recording, add it here — this is the accumulated wisdom, not a snapshot.

## How to use it — building a new Pantheon site

Read in this order:

1. **[`design/`](./design)** — how it must *look and feel*: the fixed content width, the shared
   colour-token contract (swap values, keep names), the standardized **Pantheonic Header**, and the
   **sidebar + content-pane admin** layout. This is what makes the family instantly recognizable.
   **On phones, see [`mobile/`](./mobile)** — the app-shell + fixed-zone standard that turns these
   same sites into native-feeling phone apps (fixed frame, no page scroll/zoom, swipeable zones).
2. **[`automaton/`](./automaton)** — how an automaton is *structured*: the Pantheonic Automaton
   Blueprint (container, tokenless deploy, AncientHub login, versioning), the master-key
   sealed-vault crypto every automaton reuses, and the **Deploy Panel standard** (status readout +
   always-moving progress) every on-box deploy must implement.
3. **[`identity/`](./identity)** — hub login + ownership verification, which appear *everywhere*: the
   central AncientHub SSO service, the "Login with AncientHub in any consumer" recipe, the
   generic Apollo-ownership verifier (`/apollo-verify`), and **how an entity becomes a Pythia
   verifier** (`how-an-entity-becomes-a-pythia-verifier.md` — the entity-level trust-anchor standard,
   naming Mnemosyne + OuronetUI as the first two).
4. **[`organs/`](./organs)** — the shared constructor packages you consume — **all three now
   finalized**: `@ancientpantheon/codex`, `@ancientpantheon/khronoton-core`, and
   `@ancientpantheon/pythia-client`: the package-structure blueprint, how to wire the Khronoton
   engine in, the codex re-key primitive, how to host the Codex in any consumer, **how to wire in
   Pythia's connector protocol** (`06-pythia-client-wire-in.md` — gated/attributed chain access via
   a dual-Apollo identity), and the **organ dependency contract** (publishing organs + adopting a
   new organ version without breaking consumers).
5. **[`patterns/`](./patterns)** — worked cross-repo *feature* references. Currently empty — its
   former Pythia consumer-key doc turned out to describe a protocol that was never built; the
   current, shipped protocol now lives in `organs/06-pythia-client-wire-in.md` instead (a wire-in
   handoff, not a "worked example"). New cross-repo feature references land here as they're written.
6. **[`archive/`](./archive)** — superseded or point-in-time docs kept for historical reference. Not
   current standards; consult only for lineage.

## Sections at a glance

| Section | Holds | Status |
|---|---|---|
| `design/` | width · tokens · header · admin layout · theming | the desktop UI/UX standard |
| `mobile/` | app-shell frame · `min-h-0` chain · `SwipeDeck` · page-conversion recipe · full-screen modals | the mobile UI standard |
| `automaton/` | the blueprint · master-key sealed-vault · deploy-panel + progress standard | how to build an automaton |
| `identity/` | SSO · consumer-login · Apollo verifier · **how an entity becomes a Pythia verifier** | login/verification everywhere |
| `organs/` | package blueprint · khronoton wire-in · codex re-key · consumer integration · **pythia-client connector wire-in** · dependency contract | the shared packages — 3 organs, all finalized |
| `patterns/` | *(empty — see §5 above)* | reference feature implementations |
| `archive/` | superseded khronoton package draft · Codex v2 plan · 3 superseded Pythia consumer-key docs | historical / example |

## Reference implementations

The standards point at real, running code so nobody builds from prose alone:

- **Pythia** (`constructors/Pythia`) — the vanilla-JS reference for `design/` (sidebar admin +
  standardized header), the constructor-service shape (`automaton/` §13), the **deploy panel**
  (`automaton/05` — status readout + always-moving progress), and (as of `2.3.0`) the reference
  implementation of the **connector protocol** itself — both the server side (`apps/pythia`) and the
  published consumer SDK (`packages/pythia-client`, see `organs/06-pythia-client-wire-in.md`).
- **Mnemosyne** (`automatons/Mnemosyne`) — the React reference for the automaton organs (Codex UI,
  sealed vault, on-box deploy). *(Mnemosyne predates this standard and still has drift — 3 widths, 2
  token sets — that it will align up to; treat Pythia as the clean `design/` reference.)*
- **OuronetUI** (`OuroborosNetwork/daimons/OuronetUI`) — the reference for **[`mobile/`](./mobile)**:
  the app-shell (fixed frame + bottom tab-bar + footer riser), the `SwipeDeck` primitive, and the
  first fully mobile-converted page (the Dashboard, as fixed swipeable zones). v2.4.0 → **v2.8.0**.

## Theme-agnostic by construction

Every site keeps the **same token names and roles** and swaps only the **values**, so the shape is
shared and the colour identity is per-site. The canonical token set lives in `design/`.
