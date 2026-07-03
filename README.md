# Pantheon

> *The temple where every entity is enshrined.*

**Public observability for the whole ecosystem.** A single page where
anyone — user, auditor, third-party monitor — can see what every
autonomous and human-driven entity in the StoaChain / Ouronet
ecosystem is doing, in real time:

- **The three Constructors** — Pythia (gateway health, backends,
  request stats), Codex (published versions, adapter list), Khronoton
  (published versions, active schedules).
- **Automatons** — Aletheia, Caduceus-Automaton, Dalos-Automaton,
  Mnemosyne-Automaton — each with live transaction history, next
  scheduled action, and pause state.
- **Daimons** — OuronetUI, StoaWallet, StreamingPlatform — the
  human-driven applications, with metadata and activity.
- **Seers** — StoaExplorer, OuronetExplorer — the read-only
  observers, with monitoring scope and health.

Plus **machine-readable feeds** (`/feed.json`, `/feed.rss`) so
independent monitors can build their own alerts on top. Trust through
transparency: in a single-operator ecosystem, the concrete answer to
"why should I trust the operator?" is *you can watch everything the
operator's machines do, live, without asking permission.*

Deployed at **pantheon.ancientholdings.eu**.

## The Automaton status wire contract

This repo is also the canonical home of the **`/automaton/status`
JSON schema** — the endpoint shape every Automaton exposes (health,
last action, next scheduled action, pause state) so this site can
display them uniformly. It is a wire format, not a package: documented
here, implemented by each Automaton.

## The entity taxonomy (quick reference)

| Tier | Composition | Trigger |
| ---- | ----------- | ------- |
| **Automaton** | Pythia + Codex + Khronoton + logic | Khronoton (autonomous) |
| **Daimon** | Pythia + Codex + human + logic | A human |
| **Seer** | Pythia only | none — read-only |

## Status

**Scaffold.** No code yet. Building this site is Phase 7 of the
AncientPantheon kickstart plan — it follows Aletheia (Phase 6), whose
status endpoint it generalises into the documented contract.

## License

See [LICENSE](LICENSE) — all rights reserved pending a final
(expected permissive) license decision before first release.
