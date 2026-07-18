# Pantheonic Architecture — Changelog

Human-readable log of what the library gains or changes, on top of git history. Newest first.

## 2026-07-18 — `design/` v1.2 — the landing has two sanctioned forms; the hero portrait is optional

Clarified that the fixed single-screen stage is **one** valid landing, not the only one, so v1.1 is
not read as mandating it.

- **`design/PANTHEONIC-DESIGN-ARCHITECTURE.md` → v1.2.** Rewrote §4 (the Landing) to open with the
  choice between **two sanctioned forms**, equal in standing: **Form A** — the single-screen fixed
  page (the former §4 spec, now §4.A, Pythia as reference); and **Form B** — a **scrolled display**
  where the Tier-1 section links scroll the relevant section down the page (new §4.B). A site picks
  whichever fits its content; neither is more conformant.
- **The hero portrait is now explicitly optional** in both forms — a visual etalon when present
  (still the stage-sizing etalon in Form A), never a requirement. §4.A.2 documents the portrait-less
  Form-A stage (single full-width column); §4.B carries an optional top portrait band.
- Repointed the §1 `--landing-maxw` exception and the Pythia reference block at **§4.A** (the
  exception applies to Form A with a portrait only; it does not apply to Form B). Reworded the §7
  conformance item so either form passes, and noted Form B has no vanilla reference yet.

## 2026-07-17 — `design/` v1.1 — 3-level header + the single-screen landing stage

The header and landing shape settled through live iteration on Pythia and are now law.

- **`design/PANTHEONIC-DESIGN-ARCHITECTURE.md` → v1.1.** Rewrote §3 (the Header) into the definitive
  **three-level** header — L1 medallion + one shared identity block, L2 Tier-1 sections + a single
  memorable action, L3 a **fixed-height** Tier-2 zone that never resizes the header — with a
  **full-chrome-width separator** (on `.ph`, not `.ph-inner`) and strong squared `.ph-btn` buttons.
  Ruled that **Tier-2 nav lives only in the header, never duplicated in the content panel**.
- **New §4 — The Landing Stage.** A hero-portrait landing is a **fixed-size page (PDF-style)**: fixed
  header + footer, one `.landing-mid` scroll region, a `--stage-h` stage that neither grows nor
  collapses, a **fixed-box portrait** (native aspect, no `object-fit` letterbox) as the size etalon
  with a collapse toggle, and a work-area that fills to the portrait height and scrolls only on
  overflow.
- **§1 — sanctioned width exception `--landing-maxw`** for hero-portrait landings (applied to the
  landing `.shell` + header inner + footer inner alike); `--maxw: 1536px` still governs everything else.
- **§5 — the `[hidden]`-wins rule**: any `hidden`-toggled element needs its own `[hidden]{display:none}`
  guard when a `display:` rule would beat it (the class of bug behind the admin-gate ghost and the
  duplicated landing sub-nav).
- Pythia (`apps/pythia/public/{index.html,app.js,styles.css}`) is the live reference for all of the
  above, deployed at `pythia.ancientholdings.eu`.

## 2026-07-17 — Library established

Centralized the scattered Pantheon-wide standards into this one authority (folder created in the
Pantheon website repo — the central authority every site follows).

**Relocated in** (each left a pointer stub in its origin repo; references repointed):
- `automaton/` — the Pantheonic Automaton Blueprint (04) + Master-Key Codex Protection (02), from Mnemosyne.
- `identity/` — AncientHub SSO service + consumer-login recipe + generic Apollo-ownership verifier (from Pythia) + dual-Apollo consumer identity (from Codex).
- `organs/` — constructor-package blueprint (from Khronoton) + codex re-key primitive (07) + khronoton engine wire-in (05, from Mnemosyne) + Codex consumer-integration (from Codex).
- `patterns/` — the Pythia consumer-key model + its interface-control doc (from Pythia).
- `archive/` — superseded khronoton package draft (03, superseded by 05) + Codex v2 architecture plan (kept as a worked example).

**Added:**
- `design/PANTHEONIC-DESIGN-ARCHITECTURE.md` **v1.0** — the UI/UX law: the `--maxw: 1536px` width
  constant, the canonical colour-token contract (theme-agnostic), the standardized Pantheonic Header
  (back-left, one identity block, ancient-gated Admin link, role badges), and the sidebar + content-
  pane admin architecture (unselected `/admin` prompt → `/admin#section` detail, nested routing,
  responsive collapse). Includes a conformance checklist.

**Reference implementation landed:**
- Pythia's admin rebuilt to `design/` v1.0 — standardized Pantheonic Header + sidebar/content-pane
  master-detail (unselected `/admin` prompt → `/admin#section` detail, nested routing), role badges,
  `--accent` token — and **deployed live** (`pythia.ancientholdings.eu/admin`) via Pythia's own
  blue-green Deploy pipeline. The guideline now cites it. Pythia is the working template for `design/`.
