# Pantheonic Design Architecture

**Version 1.2 — 2026-07-18.** The UI/UX law for every AncientPantheon surface (the Pantheon website,
constructor-services like Pythia, automatons like Mnemosyne/Caduceus/Aletheia). Follow it so every
site is **instantly recognizable as one family**: identical shape, layout, header, and identity flow —
**only the colour theme differs.** This is a living document; record changes in `../CHANGELOG.md`.

> **Theme-agnostic by construction.** Every rule below is about *structure and token names*, never
> literal colours. A site keeps the token **names + roles** and swaps only the **values**. Same
> skeleton, different skin.

Reference implementation: **Pythia** (`constructors/Pythia/apps/pythia/public/{index.html,app.js,admin.html,admin.js,styles.css}`)
— the clean vanilla reference for the 3-level header (§3), the **single-screen fixed landing (Form A,
§4.A)**, and the sidebar admin (§5), **live at `pythia.ancientholdings.eu`**. Key anchors: the `.ph`
header + `renderIdentity()` (shared `pantheon-header.js`) for the identity block (§3); the
`.landing-mid` / `.stage` / `.work-area` fixed page + `renderTier2()` header-owned sub-nav (§4.A); the
`.admin-layout` sidebar+pane + `routeFromHash()` (§5); the `.role-badge` / `--accent` alias (§2, §6).
The **scrolled landing (Form B, §4.B)** is the other sanctioned shape and has no vanilla reference yet.

---

## 1. Width — the load-bearing constant

**`--maxw: 1536px`.** One content max-width, identical on the public site AND the admin. Centre it
and gutter it; never hardcode a different width per surface (Mnemosyne's 860/1080/1280 drift is the
anti-pattern this fixes).

```css
:root { --maxw: 1536px; }
.shell { width: 100%; max-width: var(--maxw); margin: 0 auto; padding: 0 24px; }
```

Everything — header, hero, admin — lays out inside a `.shell` (or equivalent) capped at `--maxw`.
Full-bleed backgrounds (starfield, gradients) may span the viewport, but *content* stops at `--maxw`.

> **Sanctioned exception — the hero-portrait landing.** A Form-A landing built around a full-height
> hero portrait (§4.A) may widen to a second constant, **`--landing-maxw`** (Pythia: `1760px`), so the
> content column beside the portrait stays usable on wide screens. When a site takes the exception it
> applies `--landing-maxw` to the landing `.shell`, its header inner, AND its footer inner so all
> three left-edges align. `--maxw` still governs every other surface (admin, sub-pages). This is the
> *only* width a site may add, and only for this case.

---

## 2. Colour tokens — the theme contract

Define this **exact set of CSS custom properties** at `:root`. The **names are fixed across all
sites**; each site supplies its own **values** (its colour identity). This is the entire theming
mechanism — no site invents new token names.

| Token | Role | Pythia value (example theme) |
|---|---|---|
| `--bg` | page background (deepest) | `#080b16` |
| `--bg-2` | secondary background | `#0d1226` |
| `--panel` | panel/card surface | `#10162e` |
| `--panel-2` | raised panel surface | `#131a34` |
| `--line` | borders / dividers | `#24304f` |
| `--ink` | primary text | `#e8ecf6` |
| `--ink-soft` | secondary text | `#a9b2c9` |
| `--ink-mute` | muted text / captions | `#6f7a96` |
| `--accent` | brand accent (the site's signature colour) | `#e6be6a` (gold) |
| `--accent-dim` | dimmed accent (hover/borders) | `#b8912f` |
| `--danger` | destructive / error | `#ff6b7d` |
| `--radius` | corner radius | `16px` |

> Pythia historically names its accent `--gold`/`--gold-dim`; the **canonical name is
> `--accent`/`--accent-dim`** (gold is Pythia's *value*, not the contract). New sites use `--accent`;
> Pythia aliases `--gold: var(--accent)` during migration. A site's identity = its `--accent` +
> background family; the *shape* is identical.

**Theming a new site** = copy this `:root` block, change the values, done. Do not restyle components
per-site beyond the token values.

---

## 3. The Pantheonic Header — three fixed levels

One standardized header on **every** surface (public + admin), because AncientHub login appears
everywhere. It is a **sticky, full-width bar** with a **full-chrome-width bottom separator** and up to
**three levels** of a fixed height. A surface fills the levels it needs; the header's height never
changes as content within a level appears or disappears.

```
┌─ .ph (full width, sticky, border-bottom spans the whole chrome) ─────────────────────┐
│ .ph-inner (capped at --maxw / --landing-maxw, centred) :                              │
│  L1  ◆ Brand vX.Y.Z            [◄ back]        Signed in as <name> · <role>            │
│                                                [Login] · [Admin] · [Log out]           │
│  L2  [ Section ][ Section ][ Section ]                        [ Memorable action ↗ ]   │
│  L3  [ sub-view ][ sub-view ]                                 [ (reserved) ]           │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 The separator is full-width
The `border-bottom` lives on **`.ph`** (spans the whole viewport width), NOT on the width-capped
`.ph-inner`. A separator that stops at the content width is the anti-pattern this fixes.

### 3.2 Level 1 — identity of place + identity of person
- **Left:** a **medallion** — the brand wordmark (`.ph-name`, links home) with a small mono version
  chip immediately right of it (`vX.Y.Z`, bordered, `--ink-mute`; links to the version notes). When a
  back action exists (admin → home) a **ghost back button** sits immediately right of the medallion —
  never on the right side.
- **Right — the identity block (the part to get consistent):** ONE shared implementation
  (`renderIdentity()` in a shared `pantheon-header.js`), used on public + admin, reading `GET /api/me`:
  - **Signed out:** a `Login with AncientHub` button.
  - **Signed in:** `Signed in as <b>{name}</b> · <RoleBadge>` then, in order: **Admin / Dashboard**
    (a real `<a href="/admin">` only if `roles` includes `ancient`; else a disabled greyed chip with
    `aria-disabled="true"` + a "requires the ancient role" title) → **Log out**.
  - Render name/role via `textContent`, never `innerHTML` (the hub-supplied strings must not inject
    markup). Render nothing until the first `/api/me` resolves (no wrong-state flash).

### 3.3 Level 2 — Tier-1 sections + one memorable action
- **Left:** the site's **Tier-1 section buttons** (Pythia: Chains / Activity / For developers /
  Connectors) as **strong squared buttons** (`.ph-btn` — 8px radius, deliberately bolder than a pill).
- **Right:** exactly **one memorable action** — the single accent-worthy link for the surface
  (Pythia: `Client SDK ↗`). One, not a row.

### 3.4 Level 3 — Tier-2 sub-navigation (a fixed, reserved zone)
- L3 holds the **active Tier-1 section's Tier-2 sub-views** (Pythia: Chains → StoaChain / Arweave;
  Activity → StoaChain / Arweave; Connectors → Full API Keys / Register). Sections without sub-views leave it **empty but still
  present** — L3 reserves a full button-row height always, so switching sections never grows or
  shrinks the header. The tier-2 buttons *fill into and out of* the fixed zone.
- **The header is the single home for navigation.** Tier-2 sub-navigation is **never duplicated inside
  the content panel** — the header buttons ARE the controls (they call the switch directly), and there
  is no mirrored in-panel button row. (Anti-pattern: a hidden in-panel `<nav>` the header proxies to.)

### 3.5 Strong squared buttons
Header buttons (`.ph-btn`) are squared (≈8px radius), padded (≈8×16), weight 600. Variants:
`--primary` (accent fill, the memorable action + the ancient Admin link), `--ghost` (transparent —
back, inactive sections), `--active` (accent border + tint — the current section/sub-view). A disabled
control uses `aria-disabled` and reads visibly muted.

### 3.6 Admin variant
Same `.ph` bar, but admin uses **only Level 1** (medallion + `◄ back` on the left, identity block on
the right) — its navigation is the **sidebar** (§5), not L2/L3. Everything else is identical.

---

## 4. The Landing — two sanctioned forms

The public landing takes **one of two shapes**, and a site chooses whichever fits its content. Both
are equally Pantheonic — neither is the "correct" one, and a site is not less conformant for picking
either:

- **Form A — the single-screen fixed page (§4.A).** A fixed-size page, like a PDF page: fixed header,
  fixed footer, one scroll region between them, sized to sit on a single screen. The reference is
  Pythia. Choose it when the landing is self-contained enough to fit one poster-like stage.
- **Form B — the scrolled display (§4.B).** A normal page that scrolls, where the Tier-1 section links
  scroll the relevant section down into view. Choose it when the landing has more to say than one
  screen holds — sequential sections, longer-form content.

> **The hero portrait is optional — in both forms.** When present it is a visual *etalon* (in Form A
> it also sizes the stage, §4.A.2); it is never a requirement. A landing with no portrait is fully
> conformant. Everything else in this document — `--maxw`, the tokens (§2), the 3-level header (§3),
> the admin (§5), the identity flow (§6) — is identical whichever form and whether or not a portrait
> is used.

---

### 4.A Form A — the single-screen fixed page

A landing built around a hero portrait is a **fixed-size page, like a PDF page** — not a
viewport-filling layout that stretches, and not a long marketing scroll. The portrait (when present)
is the size **etalon**; the page is a fixed height; the window scrolls to it when short.

```
┌─ .ph (sticky header) ────────────────────────────────────────────────┐
├─ .landing-mid (the ONLY scroll region) ──────────────────────────────┤
│  .shell → .stage  (fixed height = --stage-h) :                        │
│  ┌ .stage-left (grid col 1) ───────┐   ┌ .stage-art (grid col 2) ──┐  │
│  │ .hero-id  (compact identity)    │   │                           │  │
│  │  eyebrow / title / lede /       │   │   the hero portrait,      │  │
│  │  status medallions              │   │   fixed height = --stage-h │  │
│  │ ── divider ──                   │   │   (width from its aspect  │  │
│  │ .work-area (active .tabpanel;   │   │   ≈ a third of the page), │  │
│  │  fills to portrait height,      │   │   never letterboxed;      │  │
│  │  scrolls INSIDE only on         │   │   a ⇥ collapse toggle in  │  │
│  │  overflow)                      │   │   its upper-right corner  │  │
│  └─────────────────────────────────┘   └───────────────────────────┘  │
├─ .foot (fixed footer, full-width) ───────────────────────────────────┤
└───────────────────────────────────────────────────────────────────────┘
```

### 4.A.1 Fixed page, not fluid
- The page is `body { height: 100vh; overflow: hidden; display: flex; flex-direction: column }` with a
  **fixed header, a fixed footer, and a single scroll region between them** (`.landing-mid`,
  `flex: 1; overflow-y: auto`).
- The `.stage` has a **fixed height, `--stage-h`** (the etalon; Pythia: `960px`). It does **not** grow
  to fill a taller window (the leftover space below it is simply empty) nor shrink on a shorter one
  (`.landing-mid` scrolls to reveal it). Nothing collapses.

### 4.A.2 The portrait is the etalon (when present)
> A Form-A landing **without** a portrait drops the second grid column entirely: `.stage` becomes a
> single full-width column of `.hero-id` + `.work-area`, still at fixed `--stage-h`. The rest of this
> subsection applies only when a portrait is used.

- `.stage` is a two-column grid, `grid-template-columns: minmax(0,1fr) auto` — the left column takes
  the remaining width; the right (`auto`) is exactly the portrait's own width.
- The portrait is `height: 100%` (of the fixed row, pinned with `grid-template-rows: minmax(0,1fr)`),
  `width: auto` — a **fixed box at native aspect, never `object-fit`-letterboxed**. Given a 2:3
  portrait, at `--stage-h` tall it lands at ≈ a third of the page width.
- A **collapse toggle** pinned to the portrait's upper-right corner hides it and expands the content to
  the full page width; the choice persists (localStorage).

### 4.A.3 The work-area is the display surface
- The left column stacks a **compact identity block** (`.hero-id` — eyebrow, title, one-line tagline,
  a full-width lede, status medallions; kept minimal so the work-area gets the height) over the
  **`.work-area`**.
- The active section renders as one `.tabpanel` in the work-area; it **fills the left column down to
  the portrait's height** and becomes an **internal scroll viewport only when its own content
  overflows** that height. The Tier-1/Tier-2 header (§3) drives which section/sub-view shows — the
  work-area holds no navigation of its own.

### 4.A.4 Responsive
Below a width that can't seat the portrait beside a usable content column (Pythia: `900px`), the stage
**unlocks** to a normal scrolling page: portrait on top (height-capped), content beneath at full
width, header/footer no longer pinned. (A portrait-less Form-A stage simply keeps its single column
and unlocks its fixed height into normal flow at the same breakpoint.)

---

### 4.B Form B — the scrolled display

When the landing has more than one screen of content, use a normal scrolling page instead of the
fixed stage. This is the ordinary "the links scroll you down the page" layout — sanctioned and equal
to Form A, not a fallback.

```
┌─ .ph (sticky header) ────────────────────────────────────────────────┐
│  (optional hero portrait band — top of page, height-capped)           │
├─ page scrolls normally (the body IS the scroll surface) ──────────────┤
│  .shell → #section-a   ← Tier-1 "Section A" scrolls here              │
│  .shell → #section-b   ← Tier-1 "Section B" scrolls here              │
│  .shell → #section-c   …                                              │
├─ .foot (full-width footer, in normal flow) ──────────────────────────┤
└───────────────────────────────────────────────────────────────────────┘
```

- **The document scrolls, not an inner region.** There is **no** `.landing-mid` single scroll region
  and **no** `--stage-h` — the body itself scrolls and the header (§3) stays `position: sticky` on
  top. The footer sits in normal flow at the end.
- **The Tier-1 links drive scroll position.** Each Tier-1 section (§3.3) is an anchored block down the
  page; clicking a section scrolls it into view (`scrollIntoView` / anchor), and the active section
  updates as the reader scrolls past it (scroll-spy). **The header stays the single home for
  navigation (§3.4)** — the sections are still never mirrored as an in-content nav row.
- **Width is `--maxw` (§1).** Each section's content caps at `--maxw` inside its own `.shell`. The
  `--landing-maxw` exception does **not** apply to Form B — it exists only to seat a fixed portrait
  beside a content column in Form A.
- **The hero portrait, if used, is a top band** — full-width or `.shell`-capped, height-capped, above
  the first section — not pinned beside the content. Without one the page opens straight into the
  identity block and first section.
- Tier-2 sub-views (§3.4), when a section has them, still live in the header's L3 zone; in Form B they
  switch the content shown within that section's block (they do not have to be separate anchors).

---

## 5. The Admin architecture — sidebar + content pane

Admin is a **two-column master–detail**: a fixed **left sidebar menu** and a **right content pane**.
This uses the full width efficiently (menu + content) instead of one narrow column in a wide page.

```
┌── Pantheonic Header (admin variant — Level 1 only) ─────────────────────────────┐
├──────────────┬──────────────────────────────────────────────────────────────────┤
│  SIDEBAR      │  CONTENT PANE                                                     │
│  ▸ Section A  │   (the selected section renders here)                             │
│  ▸ Section B  │                                                                   │
│  ⌁ Planned    │                                                                   │
└──────────────┴──────────────────────────────────────────────────────────────────┘
```

### 5.1 Routing model (exact)
- **`/admin` (no hash) = the UNSELECTED state.** Sidebar shown; the pane shows an empty prompt
  (*"Select a section from the left to begin."*). A real, addressable state — the bare `/admin`.
- **`/admin#<section>` = a section selected.** Sidebar highlights the active item; the pane renders it.
  Deep-linkable and back-navigable.
- **Nested sections** use `/admin#<section>/<sub>` and render sub-navigation *inside the pane* (tabs or
  a sub-list) — the sidebar holds top-level sections only.
- A **planned/disabled** section shows greyed in the sidebar with a badge and is inert — clicking posts
  a short "coming later" note in the pane, never a broken view.

### 5.2 Sidebar & pane
- Sidebar: a vertical list of top-level sections (icon + label), the active one highlighted (accent
  left-border + raised background), full height with its own scroll if long, driven by a **static
  section-config array** (`{id, icon, label, hash, enabled}`) — the single source of the menu.
- Pane: renders exactly one section at a time (or the empty prompt), reusing the site's panel
  vocabulary (`--panel`, `.panel-note`, forms, rows); a section may carry in-pane tabs for sub-areas.

### 5.3 Gate & responsive
The whole admin sits behind the shared **AdminGate**, four states resolved from `/api/me`: *checking*
→ *signed-out* → *signed-in-not-ancient* → *ancient* (the sidebar + pane). Client gating is UX only;
**every admin mutation re-gates server-side.** At `≤ 820px` the sidebar collapses above the pane as a
horizontal scrollable row of chips; the routing model is unchanged.

> **The `[hidden]`-wins rule.** Any element toggled by the `hidden` attribute (gate states, mirrored
> nav, tab panels) MUST have its own `[hidden] { display: none }` guard when a `display:` rule would
> otherwise beat it (e.g. `.subtabs { display:flex }`). A `display` rule silently overrides `hidden`
> and re-shows the element — the class of bug behind both the admin-gate ghost and the duplicated
> landing sub-nav.

---

## 6. Identity & roles

- Roles come from the AncientHub OIDC `roles` claim, surfaced by `GET /api/me` →
  `{ authenticated, name, roles }` (an array).
- **`ancient`** is the only cross-site special-case: it gates the admin surface (`requireAncient`
  server-side; the Admin link + gate client-side). Promote `ancient` to the front when picking the
  displayed role.
- **RoleBadge:** a small pill next to the name. Default = neutral bordered chip (`--line` border,
  `--ink-soft` text). **`ancient`** renders in the site accent (`--accent`). Other hub roles (e.g.
  `observer`, `baron`, `client`) use the neutral badge unless a site maps a specific colour — the
  **badge shape is shared**. Treat roles as hub-supplied: render whatever comes; never hardcode an
  allow-list that would hide a new role.

---

## 7. Conformance checklist (a site is "Pantheonic" when…)

- [ ] Content is capped at `--maxw: 1536px` on every surface; a hero-portrait landing may additionally
      use `--landing-maxw`, applied to its `.shell` + header inner + footer inner alike.
- [ ] The `:root` token set uses the canonical names; only values differ.
- [ ] The header is the sticky 3-level `.ph`: full-chrome-width separator; L1 medallion + one shared
      identity block (`textContent`, ancient-gated Admin); L2 Tier-1 sections + one memorable action;
      L3 a fixed-height Tier-2 zone that never resizes the header.
- [ ] Tier-2 navigation lives ONLY in the header — never duplicated in the content panel.
- [ ] The landing takes **one of the two sanctioned forms** (§4). Form A — a single-screen fixed page:
      fixed header + footer, one `.landing-mid` scroll region, a `--stage-h` stage that neither grows
      nor collapses, and (when a portrait is used) a fixed-box portrait (no letterbox) with a collapse
      toggle over a work-area that fills to portrait height and scrolls only on overflow. OR Form B — a
      scrolled display: the body scrolls, header sticky, and Tier-1 links scroll their section into
      view. **The hero portrait is optional in both**, and either form is fully conformant.
- [ ] Admin is sidebar + content pane; `/admin` shows the unselected prompt, `/admin#x` a section,
      both deep-linkable; planned sections greyed + inert; every `hidden` toggle has its `[hidden]`
      guard.
- [ ] The AdminGate's four states are correct; every admin mutation is server-gated.
- [ ] Roles render as shared-shape badges, `ancient` accented.

---

*This is v1.2. Extend it — add sections (forms, tables, empty states, toasts, motion) as patterns
surface — and log every change in `../CHANGELOG.md`.*
