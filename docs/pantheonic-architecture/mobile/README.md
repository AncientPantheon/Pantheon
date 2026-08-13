# Pantheonic Mobile UI

How every **AncientPantheon** consumer UI becomes a phone app — not a narrow desktop page, but a
**fixed native-app shell** with fixed zones that a deterministic engine **fills to cover every screen
size**. This is the mobile counterpart to [`design/`](../design) (the desktop look-and-feel). If you
are making an existing Pantheon site work on phones, or building a new one mobile-first, **read this
folder first** so you don't repeat the mistakes we made learning it.

> **Reference implementation:** **OuronetUI** (`OuroborosNetwork/daimons/OuronetUI`), from **v2.4.0**
> (mobile header + bottom tab-bar chrome) → **v2.8.0** (the full app-shell + the Dashboard as fixed
> swipeable zones) → **v2.9.0** (the **adaptive-layout engine** — `AdaptiveFit`/`AdaptiveDeck` — that
> makes the Dashboard fill phones, tablets, and iPad Pro deterministically). Every rule below points at
> real code there.
>
> **Breakpoint: `< 1280px` = mobile/tablet shell** (`useIsMobile()` in JS = the `xl` line). It was
> `1024` until v2.9.0; we raised it because the desktop 3-tier header needs room (content law
> `--maxw: 1536px`) and the **iPad Pro 12.9" is exactly 1024px in portrait** — it belongs in the mobile
> shell. Keep the JS breakpoint and any CSS `xl:` gates in agreement so they never disagree at the edge.

---

## 0. The law (read this first)

A Pantheonic mobile screen is a **fixed frame**, never a scrolling document:

1. **Fixed chrome.** A top header and a bottom tab bar are pinned. They never scroll away.
2. **One content stage** between them. The **page never scrolls or pinch-zooms.** Only a *zone inside*
   the stage scrolls, and only when its own content overflows.
3. **Fixed zones = rectangles.** A page is an arrangement of rectangles that each fill their allotted
   area. Some can **collapse/expand** to hand space to a neighbor.
4. **Swipe between rectangles is discrete.** A swipe brings the **whole** next pane in and the current
   one out — **no in-between scroll position** showing halves of two panes.
5. **Fill the space deterministically — measure, don't guess, and never blind-`zoom`.** Give a dense
   component a compact mobile layout, then let the **adaptive engine (§4)** measure the zone and
   scale/ghost/pack it to **COVER** the area: scale **up** to fill spare room, **down** (optionally
   ghosting non-essential buttons) when tight — and **guarantee it never clips**. This *measured* fill is
   the opposite of the old anti-pattern: it is computed from the actual rendered size and verified, not a
   blind `transform: scale` slapped on a desktop layout. **No data is ever lost** — only relocated
   (buttons → Controls, §5) or resized.

If you catch yourself letting the whole page scroll like a browser, stop — that's the desktop model and
it is wrong here.

---

## 1. The app-shell frame

The shell is three flex rows in a viewport-tall, `overflow: hidden` frame:

```
┌ frame: height calc(100dvh - <tabbar>), overflow:hidden, flex-col ┐
│  MobileHeader           (flex-none — pinned top)                 │
│  ┌ stage: flex-1 min-h-0 overflow-y-auto ───────────────────┐   │
│  │   <Outlet/> — the page fills this                         │   │
│  └───────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
   MobileTabBar            (position:fixed bottom — below the frame)
```

- **Frame height `calc(100dvh - var(--mobile-tabbar-h))`** so it ends exactly at the top of the fixed
  tab bar — no overlap, no reserved-padding guesswork. The tab bar publishes its own height into
  `--mobile-tabbar-h` via a `ResizeObserver`.
- The **stage** (`<main>`) is the *only* scroll container (`flex-1 min-h-0 overflow-y-auto
  overscroll-contain`). A converted page fills it exactly and nothing scrolls.
- **Lock zoom** in `index.html`:
  `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />`
- **No page footer on mobile.** The version/build · connector-status · copyright footer leaves the flow
  and becomes a **one-line riser drawer** off a small up-arrow handle above the tab bar.
- **Risers bulge UP from the tab bar and reserve no space** (`absolute; bottom: var(--mobile-tabbar-h)`)
  — e.g. the Controls riser (§5) bottom-left, the footer handle bottom-right. Because they overlap the
  stage's bottom edge, **give the bottom-most zone a little bottom padding** so a deck's swipe dots don't
  crowd into the riser band (learned the hard way — the bottom frame looked "mangled").
- **Branch the layout by `useIsMobile()`.** Desktop keeps the sidebar / `min-h-screen` scroll model.
  The desktop header stays **mounted-but-hidden** on mobile so its portaled modals / first-visit logic
  keep working. Shell-only components (`MobileHeader`, `MobileTabBar`, the Controls drawer) are gated to
  the **same** breakpoint as `useIsMobile()` (`xl:hidden`) so JS and CSS never disagree at 1280.

*Reference:* `src/layouts/main-layout.tsx`, `src/components/core/MobileHeader.tsx`,
`src/components/core/MobileTabBar.tsx`, `src/hooks/use-mobile.ts`, `index.html`.

---

## 2. THE CRITICAL RULE — the `min-h-0` flex-height chain

**This is the single thing that will waste your afternoon if you miss it.**

The fixed frame depends on an **unbroken bounded-height chain** from the frame (which has a concrete
`height`) down to every leaf scroll/measure zone. In a CSS flex column, a `flex: 1` child defaults to
`min-height: auto` — it **refuses to shrink below its content** and instead **grows**. The moment one
ancestor lacks `min-height: 0`, every `flex-1` / `h-full` below it stops being bounded and **balloons to
a giant content-driven height** — panes render 3–4× the screen, cards get enormous empty tails, buttons
get shoved off-screen, the page scrolls. **It also breaks the adaptive engine (§4): a zone that reports
a content-driven height instead of the real screen height packs the wrong grid.**

**Rule:** every flex container between the frame and a zone must carry **`min-h-0`**, and the frame
itself must have a **concrete height**. Miss it on *one* wrapper and the whole screen inflates.

```
frame (concrete height, overflow-hidden)
  → stage <main> (flex-1 min-h-0, overflow-y-auto)
    → content wrapper (flex-1 min-h-0)          ← the one everyone forgets
      → PageRoot (flex-1 min-h-0 flex-col)
        → zone (flex-1 min-h-0)  |  fixed zone (flex-none)
          → card (h-full min-h-0 flex-col, overflow-hidden)
```

Prefer flexbox (`flex-1` + `min-h-0`) over percentage heights; `h-full` only resolves when **every**
ancestor already has a definite height via this chain.

---

## 3. The `SwipeDeck` primitive

One small, dependency-free component powers every rectangle-to-rectangle swipe (horizontal *and*
vertical) via native CSS scroll-snap — no carousel library.

Non-negotiable properties (this is what makes a swipe discrete, §0.4):

- `scroll-snap-type: {x|y} mandatory` on the scroller **and** `scroll-snap-stop: always` on each pane —
  a swipe advances exactly one pane, never skips, never rests between two.
- **`min-w-0` (horizontal) / `min-h-0` (vertical) on every pane** — so a pane is exactly its flex-basis
  (one screen), not its content size. Pair with `overflow-hidden` on the pane so content clips to it.

Props: `vertical` (up/down swipe, dots on the right; else horizontal with ‹ › arrows + bottom dots),
`fill` (fill the parent's height — implied by `vertical`), `peek` (default true shows a sliver of the
neighbor; **set `peek={false}` for the true "one full pane" feel**), `initialIndex`, `onActiveChange`.
Indicator dots are tappable and track the centred pane.

- **Put indicators in a reserved strip, never overlaying data.** Horizontal decks reserve a bottom `pb-4`
  strip for the ‹dots›; vertical decks reserve a right `pr-4` gutter so the right-hand dots clear the
  card numbers.
- **Indicators are a required affordance.** If a zone scrolls/swipes, it MUST show dots — users need to
  know there's more. (We removed them once during a refactor; immediate complaint.)

*Reference:* `src/components/ui/SwipeDeck.tsx`.

---

## 4. The adaptive-fit engine — `AdaptiveFit` + `AdaptiveDeck`

**This is the core of v2.9.0 and the heart of "fill every screen deterministically."** Two write-once
primitives replace hand-tuned per-breakpoint layouts. Same content + same zone → same layout, every
time.

### 4a. `AdaptiveFit` — fit ONE card to COVER its slot

Wrap any card in `<AdaptiveFit>`. It lays the card out at **`width: 100%`** (so it reflows to fill the
width — never a fixed-width card marooned in horizontal dead space), then computes **one uniform scale**
to cover the slot height:

- Content **shorter** than the slot → scale **up** (bigger fonts/elements) to fill, capped at `maxScale`.
- Content **taller** → scale **down**, floored at `minScale`.
- When even at the floor the **optional buttons** don't fit → **ghost** them (collapse to `height:0`; a
  `data-ghostable` region + a `useGhosted()` context tell the card to hide them) and re-fit the DATA
  alone. **Ghosting is the LAST resort** — buttons show whenever they fit.

Three hard-won correctness rules — all about the coupling between `scale` and `width`:

- **`width = 100/scale%` is the fill invariant.** A card at `width: 100%` can't scale up without
  overflowing horizontally; instead set the CSS width to `100/scale%` so the *post-scale* width lands
  back at exactly the slot width. This one relationship fills the width **at any scale** — and it must
  hold for the **final** scale, not an intermediate one.
- **Converge — don't single-pass.** The content **reflows** (long strings rewrap) as the width changes,
  so `scale` and `width` are mutually dependent. Iterate: set `width = 100/scale%`, measure the reflowed
  height `h`, set `scale = H/h`, repeat until it settles (~6 iterations). A single width-compensated pass
  mis-measures.
- **A verify-and-shrink safety, with width kept IN SYNC.** After converging, apply the transform and
  measure the actually-rendered `getBoundingClientRect().height`; if a residual overshoot remains (e.g. a
  `maxScale` cap), shrink in small steps — **and recompute `width = 100/scale%` on every step** so the
  card keeps filling the width as it shrinks. This is a guarantee, not a margin.

  > Two real bugs, same root cause — width left tracking a stale scale:
  > - **"the lowest frame of the card is cut off"** = either the scale overshot (reflow), OR the card
  >   filled to *exactly* the box height so subpixel rounding of the scaled height sat the border on the
  >   `overflow-hidden` clip edge. Fill to a **comfortable measured clearance** (`box − ~6px`, verified
  >   against `getBoundingClientRect`) — a flat `-2px` inset is *not* enough. Because width tracks
  >   `100/scale%`, this vertical clearance costs **no** horizontal space.
  > - **"the card doesn't span the full width"** = the shrink guard reduced `scale` but the width was
  >   still computed from the pre-shrink scale, so the post-scale width undershot the slot. Recompute
  >   width from the final scale.

**Re-measure until it settles — the first measure lies.** The initial layout runs before the dynamic
viewport (`dvh`) height and web fonts have settled, so a first-paint measure **over-estimates the slot,
over-scales, and clips** — and nothing re-fires until a resize. The tell is unmistakable: *"on this
device the frame is missing, but switch to another device and back and it's fine."* That's a stale
first measure, not a math bug. Re-fit on a `requestAnimationFrame`, on a few **staggered timeouts**
(~60 / 200 / 500 / 1000 ms), on **`document.fonts.ready`**, and via a `ResizeObserver` on the slot.
It's cheap insurance; without it the fit is a coin-flip on first load.

Measure the ghostable region's natural height via `scrollHeight` **even while it's collapsed**, so the
show/ghost decision doesn't flicker.

### 4b. `AdaptiveDeck` — pack the grid + paginate cleanly

For a *list* of cards, `AdaptiveDeck` measures the zone and builds a grid from each card's declared
**minimum comfortable size** (its "optimal size" metadata — `optimalWidth`, `optimalHeight`):

```
cols       = max(1, floor(zoneW / optimalWidth))     // MAX columns that fit
fitRows    = max(1, floor(zoneH / optimalHeight))     // rows that physically fit
totalRows  = ceil(itemCount / cols)
visibleRows= largest divisor of totalRows that is ≤ fitRows   // ← the key trick
perPage    = cols × visibleRows
```

- **The divisor trick is what makes pages clean.** Choosing `visibleRows` as a *divisor* of `totalRows`
  guarantees `totalRows / visibleRows` is a whole number, so pages are **sequential and never overlap**
  (no repeated cards) and **never leave a sparse tail**. Showing fewer rows than physically fit is
  absorbed by `AdaptiveFit` scaling the cards **up** to fill — no waste. This is the fix for the two
  failure modes we cycled through: *end-aligning* a partial last page **repeats** cards (visible as you
  scroll); *sequential* partial pages leave **sparse tails / placeholder-spam**. The divisor avoids both.
- **A page swipe moves one full page** (vertical `SwipeDeck` + its dots). E.g. 8 tokens, 2 cols → 4 rows
  → 2 clean pages of 4, one swipe. A big 3-col screen → 3 rows → one page of 9.
- **`padItem` fills only a genuine trailing gap** — when `itemCount` isn't a multiple of `cols`, the last
  row's empty cell(s) get a placeholder (e.g. a brand logo tile), so the grid stays a full rectangle.
- **Deck-wide ghost coordination.** Cards must ghost **all-or-none** within a rectangle — it looks broken
  if one card shows buttons and its neighbor doesn't. Each `AdaptiveFit` reports its own would-ghost
  **vote**; the deck ORs the votes and pushes a single `forceGhost` back to every card. If *any* card
  can't fit its buttons, they all ghost together.
- **Viewport-aware `active`.** The deck passes `active=true` only for cards on the **visible page** (or,
  for a scrolling variant, via `IntersectionObserver`). Wire this to Controls registration (§5) so the
  Controls list reflects **what's on screen**, not every off-screen card.

*Reference:* `src/components/ui/AdaptiveFit.tsx`, `src/components/ui/AdaptiveDeck.tsx`,
`src/components/home/AccountCards.tsx` (Primordials deck), `src/components/home/AssetItem.tsx`
(`data-ghostable` + `useGhosted`).

---

## 5. The Controls drawer — every action stays reachable

When a card is too tight to show its transaction buttons in-card, they **ghost** (§4) — but an action
must never be *lost*, only **relocated**. The Controls system is that relocation target.

- A `ControlsProvider` holds a registry. On-screen surfaces call `useRegisterControls(source, title,
  active, items, order)` to publish their write/transaction buttons while `active`.
- A bottom-left **`Controls [N]` riser** (bulging up from the tab bar) shows the live count; tapping it
  opens a **full-screen drawer** listing every registered button, full-width, full-text.
- **Reproduce the exact in-card look** — each `ControlItem` carries its `gradient`/`color`/`border`/
  `opacity`/`kind` so a disabled Firestarter looks disabled *the same way* in the drawer as in the card.
  Register **all** buttons, even disabled/unavailable ones (with their disabled styling), so the drawer
  is a complete, honest inventory.
- **Only the visible surface registers** (drive `active` from the deck's viewport/active-page flag), so
  the count reflects what you're looking at.

*Reference:* `src/context/controls-context.tsx`, `src/components/core/ControlsDrawer.tsx`,
`src/components/core/MobileTabBar.tsx` (the riser).

---

## 6. Converting a page — the recipe

1. **Branch by `useIsMobile()`.** Leave the desktop render untouched; add a mobile render.
2. **Make the page root a fixed-zone column:** `flex min-h-0 flex-1 flex-col`. Split into fixed-height
   zones (`flex-none`) and a filling zone (`flex-1 min-h-0`).
3. **Wrap each card in `AdaptiveFit`; wrap each list of cards in `AdaptiveDeck`** (§4). Give each card
   type its *optimal size* (min comfortable `w×h`) and `min/maxScale`. Let the engine pack + fill —
   don't hand-tune per breakpoint.
4. **Show full data; let the engine size it.** Prefer rendering the **complete** value (e.g. a full
   account string that *wraps*) and letting `AdaptiveFit` scale the card to fit, over truncating.
   > *Legacy:* pre-2.9.0 used a `MiddleFit` `head…tail` truncator to fit long strings on one line. It's
   > superseded — with the fill engine, wrap the full string and let the card scale. Reach for
   > middle-truncation only for a **single fixed-height line** that must not wrap (e.g. a one-line
   > account row), and even then measure the actual rendered fit (binary-search an off-screen measurer
   > with the same typography), never estimate from average character width.
5. **Verify the `min-h-0` chain** (§2) end-to-end, then **test the extremes on real devices**: the
   *smallest* phone (S8+ / 360px), a mid tablet, and **iPad Pro (1024px portrait)** and the *fullest*
   real account. Dead space, clipping, and wrong grid counts only show at the extremes.

**Clipping caveat:** `overflow: hidden` on a zone whose content might exceed it **silently loses
content**. Only use it where you can *guarantee* the fit — which for adaptive cards is exactly what the
§4a verify-and-shrink guard provides. Everywhere a detail zone could outgrow its box, give it
`overflow-y: auto` as a safety, and floor collapsible children with a `min-height`.

*Reference:* `src/routes/logged-in/dashboard.tsx`, `src/components/dashboard/DashboardInfoHeader.tsx`,
`src/components/home/AccountCards.tsx`, `src/components/home/overview.tsx`.

---

## 7. Modals / signing zones (ZBOMs) go full-screen on mobile

Every transaction/confirm popup opens as an **immersive sheet** on phones — one change to the **shared
modal component** flips *all* of them at once. At the mobile breakpoint the sheet is **full-width,
content-height, capped at `max-height: 100dvh`** (✕ pinned): a short modal is only as tall as its
content, a tall one fills the screen and scrolls its body. **Do not force `height: 100dvh`** — that
leaves dead space below a short modal.

Two gotchas that make the sheet *look* unfixable:
- **react-modal keeps a default `bottom: 40px`** on the content element, which stretches the sheet even
  with `height: auto`. **Top-anchor it** (`position: fixed; inset: 0 0 auto 0`) so `bottom` resolves to
  `auto`.
- **A component-level height cap inside the modal body overrides everything** (OuronetUI's `ZbomLayout`
  hard-capped `max-height: 82vh` for the desktop look → *every* mobile modal was ~82vh with an ~18vh
  backdrop gap). **Lift inner caps on mobile.** When chasing modal dead-space, check the modal body's own
  `max-height`, not just the dialog CSS.

Give the content-height sheet a **visible lower delimiter** (bordered/rounded bottom) — near-black card on
near-black backdrop reads as an unexplained void otherwise.

*Reference:* `src/assets/styles/components/_dialog.css`, `src/components/ui/Modal/Modal.tsx`.

---

## 8. Tablet vs phone — discrete layouts by width

The mobile shell spans phones *and* tablets (up to 1280). Some zones want a **denser layout on the wider
tablet**, decided by width:

- Detect with **`window.innerWidth`** (rock-solid), not element measurement — element-width reads in a
  freshly-laid-out flex tree were unreliable and gave wrong counts. Recompute on `resize` +
  `orientationchange`.
- **Discrete tablet grouping.** e.g. the Dashboard header shows 5 info-zones as **one per swipe on a
  phone**, but **2 + 3 across two pages on a tablet** (`innerWidth ≥ 700`). Keep it deterministic and let
  it **fall back** to the phone layout if the width read is unexpected — so a mis-read degrades, never
  breaks.
- **Wide-shell alignment.** On a wide shell, group header widgets to match desktop (e.g. debouncer +
  account **right-aligned**, not centered with gaps).

*Reference:* `src/components/dashboard/DashboardInfoHeader.tsx` (2+3 pages), `MobileHeader.tsx`.

---

## 9. Touch gotchas (learned the hard way)

- **Radix menu/dropdown flashes open then closes on a quick tap.** Radix triggers toggle on
  `pointerdown`; on touch the emulated "ghost" mouse `pointerdown` fires a *second* toggle and closes it.
  **Fix:** `onTouchEnd={(e) => e.preventDefault()}` on the trigger. (`touch-action: manipulation` removes
  the 300 ms delay but does **not** stop ghost events.)
- **`user-scalable=no`** kills pinch/double-tap zoom app-wide; `touch-action: manipulation` complements
  it on individual controls.
- **`overscroll-behavior: contain`** on the stage stops scroll-chaining/rubber-banding past a zone.

*Reference:* `src/components/core/HeaderAccountWidget.tsx`.

---

## 10. Conformance checklist

A page is "Pantheonic-mobile" when, on a phone **and** a tablet **and** iPad Pro (1024px):

- [ ] The **page does not scroll**; header and tab bar stay pinned. Zoom is disabled.
- [ ] Content is **fixed zones** that fill the stage; scrolling happens **only inside** an overflowing
      zone, and any scroll/swipe shows **indicator dots**.
- [ ] Rectangle-to-rectangle navigation is a **discrete swipe** (snap-per-swipe, no in-between, no repeat
      of cards across pages).
- [ ] Dense components are wrapped in **`AdaptiveFit`/`AdaptiveDeck`** and **fill the zone with no dead
      space and no clipping** — verified by the shrink-to-fit guard, not eyeballed.
- [ ] Cards **ghost all-or-none** within a rectangle; ghosted buttons appear in **Controls** with their
      exact colour/name/state.
- [ ] The **`min-h-0` chain** is unbroken (no giant empty tails / off-screen content / wrong grid count).
- [ ] Modals/ZBOMs open **full-screen**; the footer is a **riser**, not a page footer.
- [ ] The **`useIsMobile()` breakpoint and CSS `xl:` gates agree** (no 1-px disagreement at 1280).

---

## 11. Status

- **Chrome (header + bottom tab bar): standardized** — the shared mobile shell every Pantheon site
  reuses (only the theme changes).
- **Adaptive-fit engine: proven (v2.9.0)** — `AdaptiveFit`/`AdaptiveDeck` fill the **Dashboard**
  deterministically across S8+ (360px), phones, tablets, and iPad Pro (1024px). This is the pattern to
  copy for every other page and daimon.
- **Page conversion: ongoing** — the Dashboard is the fully-converted reference. Every other page (and
  daimon: Mnemosyne, Explorer, …) converts by following §6 against the same shell + engine. This folder
  grows as more page patterns are proven.
```
