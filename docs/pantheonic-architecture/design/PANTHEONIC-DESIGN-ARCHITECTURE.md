# Pantheonic Design Architecture

**Version 1.0 — 2026-07-17.** The UI/UX law for every AncientPantheon surface (the Pantheon website,
constructor-services like Pythia, automatons like Mnemosyne/Caduceus/Aletheia). Follow it so every
site is **instantly recognizable as one family**: identical shape, layout, header, and identity flow —
**only the colour theme differs.** This is a living document; record changes in `../CHANGELOG.md`.

> **Theme-agnostic by construction.** Every rule below is about *structure and token names*, never
> literal colours. A site keeps the token **names + roles** and swaps only the **values**. Same
> skeleton, different skin.

Reference implementation: **Pythia** (`constructors/Pythia/apps/pythia/public/{admin.html,admin.js,styles.css}`)
— the clean vanilla reference for the header + sidebar admin, **live at
`pythia.ancientholdings.eu/admin`**. Key anchors: the `.admin-header` + `renderAuthbox()` identity
block (§3); the `.admin-layout` sidebar+pane, `renderSidebar()` + `routeFromHash()` (§4); the
`.role-badge` / `--accent` alias (§2, §5). Cited concretely per section below.

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

## 3. The Pantheonic Header

One standardized header on **every** surface (public + admin), because AncientHub login appears
everywhere. It has **fixed control slots**; a surface fills the slots it needs and omits the rest —
it never rearranges them. Left is navigation/identity-of-place; right is identity-of-person.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ [◄ back]  BRAND vX.Y.Z   · · · nav · · ·        Signed in as <name> · <role>  ▸  │
│                                                 [Admin] [Log out] [site-action]  │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Left cluster (in order):**
1. **Back control** — always the leftmost element when a back action exists (`◄ <Where>`, e.g.
   `◄ Pythia` from admin → home). Styled as a ghost button. Never place "back" on the right.
2. **Brand + version** — the wordmark, then a small mono version chip immediately right of it
   (`vX.Y.Z`, bordered, `--ink-mute`). The version is the running app version.
3. **Primary nav** (public surfaces) — inline section links; a trailing right-aligned link (e.g.
   `Documentation →`) may push to the far right of the nav row.

**Right cluster — the identity block (the part to get consistent):** a single component that reads
`GET /api/me` and renders one of two states:
- **Signed out:** a `Login with AncientHub` button.
- **Signed in:** `Signed in as <b>{name}</b> · <RoleBadge role>` followed by, in order:
  - **Admin / Dashboard** link — a real `<a href="/admin">` **only if** `roles` includes `ancient`;
    otherwise a **disabled greyed chip** with `aria-disabled="true"` + `title="Requires the ancient role"`.
  - **Log out** → `/admin/logout`.
  - **Optional site action** (e.g. `Launch Codex`) — the accent-filled primary button, rightmost.

**Rules:**
- The identity block is **one implementation** per site (a shared partial/component), used on both
  the public and admin headers — not coded twice (Mnemosyne's duplication is the anti-pattern).
- Render identity via `textContent`, never `innerHTML` — the hub-supplied name/role must not be able
  to inject markup.
- The block renders nothing until the first `/api/me` resolves (no wrong-state flash).
- **Admin variant:** same header, but the left cluster is `◄ back` + the **page/section title**
  (breadcrumb-style) instead of the public nav, and the right identity block omits the Admin link
  (you're already in admin). Everything else is identical.

Reference: Pythia `apps/pythia/public/admin.html` header + the `authbox` renderer in `admin.js`.

---

## 4. The Admin architecture — sidebar + content pane

Admin is a **two-column master–detail**: a fixed **left sidebar menu** and a **right content pane**.
This replaces both the tile-grid and the lined-list patterns; it uses the full `--maxw` efficiently
(menu + content) instead of one narrow column in a wide page.

```
┌── Pantheonic Header (admin variant) ───────────────────────────────────────────┐
├──────────────┬──────────────────────────────────────────────────────────────────┤
│  SIDEBAR      │  CONTENT PANE                                                     │
│  ▸ Section A  │                                                                   │
│  ▸ Section B  │   (the selected section renders here)                             │
│  ▸ Section C  │                                                                   │
│  ▸ …          │                                                                   │
│  ⌁ Planned    │                                                                   │
└──────────────┴──────────────────────────────────────────────────────────────────┘
```

### 4.1 Routing model (exact)
- **`/admin` (no hash) = the UNSELECTED state.** The sidebar is shown; the content pane shows an
  **empty prompt**: *"Select a section from the left to begin."* This is a real, addressable state —
  the natural landing on a fresh visit. It is its own URL (the bare `/admin`), not a menu item.
- **`/admin#<section>` = a section selected.** The sidebar highlights the active item; the pane
  renders that section. Deep-linkable and back-navigable; browser Back returns to the previous
  hash (or to the unselected `/admin`).
- **Nested sections** use `/admin#<section>/<sub>` and render sub-navigation *inside the pane*
  (tabs or a sub-list) — the sidebar holds top-level sections only.
- A **planned/disabled** section shows in the sidebar greyed with a badge (e.g. `PLANNED`) and is
  inert — clicking posts a short "coming later" note in the pane, never a broken view.

### 4.2 Sidebar
- Vertical list of top-level sections; each row = icon + label. The active section is highlighted
  (accent left-border + raised background). Full height of the admin area; its own scroll if long.
- The sidebar is defined by a **static section-config array** (`{id, icon, label, hash, enabled}`),
  rendered once — the single source of the menu (Pythia: the `TILES`/section array in `admin.js`).

### 4.3 Content pane
- Renders exactly one section at a time (or the empty prompt). Section bodies reuse the site's panel
  vocabulary (`--panel`, `.panel-note`, forms, rows). A section may carry in-pane tabs for sub-areas.

### 4.4 Gate
The whole admin sits behind the shared **AdminGate** with four states, resolved from `/api/me`:
*checking* (before it resolves) → *signed-out* (login prompt) → *signed-in-not-ancient* ("requires
the ancient role") → *ancient* (the sidebar + pane). Client gating is UX only; **every admin
mutation re-gates server-side.**

### 4.5 Responsive
At narrow widths (`≤ 820px`) the sidebar collapses above the pane as a horizontal, scrollable row of
section chips (or a toggle drawer); the content pane takes full width beneath. The routing model is
unchanged — only the sidebar's placement adapts.

---

## 5. Identity & roles

- Roles come from the AncientHub OIDC `roles` claim, surfaced by `GET /api/me` →
  `{ authenticated, name, roles }` (an array).
- **`ancient`** is the only cross-site special-case: it gates the admin surface (`requireAncient`
  server-side; the Admin link + gate client-side). Promote `ancient` to the front when picking the
  displayed role.
- **RoleBadge:** render the role as a small pill next to the name. Default style = a neutral bordered
  chip (`--line` border, `--ink-soft` text). **`ancient`** renders in the site accent
  (`--accent`). Other hub roles (e.g. `observer`, `baron`, `client`) render with the neutral badge
  unless a site opts to map a specific colour — but the **badge shape is shared**. Treat roles as
  hub-supplied: render whatever comes; never hardcode an allow-list that would hide a new role.

---

## 6. Conformance checklist (a new site is "Pantheonic" when…)

- [ ] Content is capped at `--maxw: 1536px`, same on public + admin.
- [ ] The `:root` token set uses the canonical names; only values differ.
- [ ] The Pantheonic Header is present on public + admin, one identity-block implementation, back
      control on the left, ancient-gated Admin link, identity via `textContent`.
- [ ] Admin is sidebar + content pane; `/admin` shows the unselected prompt, `/admin#x` shows a
      section, both deep-linkable; planned sections are greyed + inert.
- [ ] The AdminGate's four states are correct; every admin mutation is server-gated.
- [ ] Roles render as shared-shape badges, `ancient` accented.

---

*This is v1.0. Extend it — add sections (forms, tables, empty states, toasts, motion) as patterns
surface — and log every change in `../CHANGELOG.md`.*
