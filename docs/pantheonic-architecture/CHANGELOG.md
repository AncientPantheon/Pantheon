# Pantheonic Architecture — Changelog

Human-readable log of what the library gains or changes, on top of git history. Newest first.

## 2026-07-17 — Library established

Centralized the scattered Pantheon-wide standards into this one authority (folder created in the
Pantheon website repo — the central authority every site follows).

**Relocated in** (each left a pointer stub in its origin repo; references repointed):
- `automaton/` — the Pantheonic Automaton Blueprint (04) + Master-Key Codex Protection (02), from Mnemosyne.
- `identity/` — AncientHub SSO service + consumer-login recipe + generic Apollo-ownership verifier (from Pythia) + dual-Apollo consumer identity (from Codex).
- `organs/` — constructor-package blueprint (from Khronoton) + codex re-key primitive (07) + khronoton engine wire-in (05, from Mnemosyne) + Codex consumer-integration (from Codex).
- `patterns/` — the Pythia consumer-key model + its interface-control doc (from Pythia).
- `archive/` — superseded khronoton package draft (03, superseded by 05) + Codex v2 architecture plan (kept as a worked example).

**Pending (next):**
- `design/` — the Pantheonic Design Architecture guideline (width · tokens · header · admin layout · theming) — being written; Pythia is the reference implementation (sidebar admin + standardized header).
