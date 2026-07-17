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
2. **[`automaton/`](./automaton)** — how an automaton is *structured*: the Pantheonic Automaton
   Blueprint (container, tokenless deploy, AncientHub login, versioning) and the master-key
   sealed-vault crypto every automaton reuses.
3. **[`identity/`](./identity)** — hub login + ownership verification, which appear *everywhere*: the
   central AncientHub SSO service, the "Login with AncientHub in any consumer" recipe, the generic
   Apollo-ownership verifier (`/apollo-verify`), and the dual-Apollo consumer-identity architecture.
4. **[`organs/`](./organs)** — the shared constructor packages you consume (`@ancientpantheon/codex`,
   `khronoton`, …): the package-structure blueprint, how to wire the engine in, the codex re-key
   primitive, and how to host the Codex in any consumer.
5. **[`patterns/`](./patterns)** — worked cross-repo *feature* references (e.g. the Pythia
   consumer-key model). Read for example, not required to stand up a new site.
6. **[`archive/`](./archive)** — superseded or point-in-time docs kept for historical reference. Not
   current standards; consult only for lineage.

## Sections at a glance

| Section | Holds | Status |
|---|---|---|
| `design/` | width · tokens · header · admin layout · theming | the UI/UX standard |
| `automaton/` | the blueprint · master-key sealed-vault | how to build an automaton |
| `identity/` | SSO · consumer-login · Apollo verifier · dual-Apollo identity | login/verification everywhere |
| `organs/` | package blueprint · khronoton wire-in · codex re-key · consumer integration | the shared packages |
| `patterns/` | consumer-key model + interface-control doc | reference feature implementations |
| `archive/` | superseded khronoton package draft · Codex v2 plan | historical / example |

## Reference implementations

The standards point at real, running code so nobody builds from prose alone:

- **Pythia** (`constructors/Pythia`) — the vanilla-JS reference for `design/` (sidebar admin +
  standardized header) and the constructor-service shape (`automaton/` §13).
- **Mnemosyne** (`automatons/Mnemosyne`) — the React reference for the automaton organs (Codex UI,
  sealed vault, on-box deploy). *(Mnemosyne predates this standard and still has drift — 3 widths, 2
  token sets — that it will align up to; treat Pythia as the clean `design/` reference.)*

## Theme-agnostic by construction

Every site keeps the **same token names and roles** and swaps only the **values**, so the shape is
shared and the colour identity is per-site. The canonical token set lives in `design/`.
