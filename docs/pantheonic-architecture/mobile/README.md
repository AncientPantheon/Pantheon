# Pantheonic Mobile UI

How every **AncientPantheon** consumer UI becomes a phone app — not a narrow desktop page, but a
**fixed native-app shell** with fixed zones. This is the mobile counterpart to [`design/`](../design)
(which is the desktop look-and-feel). If you are making an existing Pantheon site work on phones, or
building a new one mobile-first, **read this folder first** so you don't repeat the mistakes we made
learning it.

> **Reference implementation:** **OuronetUI** (`OuroborosNetwork/daimons/OuronetUI`), from **v2.4.0**
> (the mobile header + bottom tab-bar chrome) through **v2.8.0** (the full app-shell + the first
> page — the Dashboard — rebuilt as fixed swipeable zones). Every rule below points at real code
> there. Breakpoint everywhere: **`< 1024px` = mobile** (`useIsMobile()` in JS, `1023.98px` in CSS).

---

## 0. The law (read this first)

A Pantheonic mobile screen is a **fixed frame**, never a scrolling document:

1. **Fixed chrome.** A top header and a bottom tab bar are pinned. They never scroll away.
2. **One content stage** between them. The **page never scrolls or pinch-zooms.** Only a *zone
   inside* the stage scrolls, and only when its own content overflows.
3. **Fixed zones = rectangles.** A page is an arrangement of rectangles that each fill their
   allotted area. Some can **collapse/expand** to hand space to a neighbor.
4. **Swipe between rectangles is discrete.** A swipe brings the **whole** next pane in and the
   current one out — **there is no in-between scroll position** showing halves of two panes.
5. **Redesign dense, don't shrink.** If a desktop component doesn't fit its zone, give it a compact
   mobile layout. Do **not** `zoom`/`scale` it — that's a hack, not a fit.

If you catch yourself letting the whole page scroll like a browser, stop — that's the desktop model
and it is wrong here.

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

- The **frame height is `calc(100dvh - var(--mobile-tabbar-h))`** so it ends exactly at the top of
  the fixed tab bar — no overlap, no reserved padding guesswork. The tab bar publishes its own
  height into `--mobile-tabbar-h` via a `ResizeObserver`.
- The **stage** (`<main>`) is the *only* scroll container (`flex-1 min-h-0 overflow-y-auto
  overscroll-contain`). Pages not yet converted to fixed zones scroll here (never the page); a
  converted page fills it exactly and nothing scrolls.
- **Lock zoom** in `index.html`:
  `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />`
- **No page footer on mobile.** The version/build · connector-status · copyright footer leaves the
  flow and becomes a **one-line riser drawer** off a small up-arrow handle above the tab bar. The
  persistent handle + bar are measured together as `--mobile-tabbar-h`; the drawer floats above.

Branch the layout by `useIsMobile()` (desktop keeps the sidebar/`min-h-screen` scroll model). The
desktop header stays **mounted-but-hidden** on mobile so its portaled modals / first-visit logic
keep working.

*Reference:* `src/layouts/main-layout.tsx` (frame + stage), `src/components/core/MobileHeader.tsx`,
`src/components/core/MobileTabBar.tsx` (tab bar + tier-2 drawer + footer riser), `index.html`.

---

## 2. THE CRITICAL RULE — the `min-h-0` flex-height chain

**This is the single thing that will waste your afternoon if you miss it.**

The whole fixed frame depends on an **unbroken bounded-height chain** from the frame (which has a
concrete `height`) down to every leaf scroll zone. In a CSS flex column, a `flex: 1` child defaults
to `min-height: auto`, which means it **refuses to shrink below its content** and instead **grows**.
The moment one ancestor in the chain lacks `min-height: 0`, every `flex-1` / `h-full` below it stops
being bounded and **balloons to a giant content-driven height** — panes render 3–4× the screen,
`h-full` cards get enormous empty tails, action buttons get shoved off-screen, and the page scrolls.

**Rule:** every flex container between the frame and a scroll zone must carry **`min-h-0`** (Tailwind
`min-h-0`), and the frame itself must have a **concrete height**. Miss it on *one* wrapper and the
whole screen inflates. (In OuronetUI this exact bug was a single missing `min-h-0` on the stage's
inner content wrapper.)

Chain checklist (top → bottom), each link `flex ... min-h-0` unless noted:

```
frame (concrete height, overflow-hidden)
  → stage <main> (flex-1 min-h-0, overflow-y-auto)
    → content wrapper (flex-1 min-h-0)          ← the one everyone forgets
      → PageRoot (flex-1 min-h-0 flex-col)
        → zone (flex-1 min-h-0)  |  fixed zone (flex-none)
          → card (h-full min-h-0 flex-col, overflow-hidden)
            → scroll region (flex-1 min-h-0 overflow-y-auto)
```

Prefer flexbox (`flex-1` + `min-h-0`) over percentage heights; `h-full` only resolves correctly when
**every** ancestor already has a definite height via this chain.

---

## 3. The `SwipeDeck` primitive

One small, dependency-free component powers every rectangle-to-rectangle swipe (horizontal *and*
vertical). It uses native CSS scroll-snap, so touch feels right and there's no carousel library.

Non-negotiable properties (this is what makes a swipe discrete, per §0.4):

- `scroll-snap-type: {x|y} mandatory` on the scroller **and** `scroll-snap-stop: always` on each
  pane — a swipe advances exactly one pane, never skips, never rests between two.
- **`min-w-0` (horizontal) / `min-h-0` (vertical) on every pane** — so a pane is exactly its
  flex-basis (one screen), **not** its content width/height. Without this the pane grows to its
  content and you get the same overflow/free-scroll the `min-h-0` chain bug produces, but on the
  swipe axis. Pair with `overflow-hidden` on the pane so content clips to it.

Props: `vertical` (up/down swipe, dots on the right; else horizontal with ‹ › arrows + bottom dots),
`fill` (fill the parent's height — implied by `vertical`), `peek` (default true shows a sliver of the
neighbor; **set `peek={false}` for the true "one full pane, swipe to the next" feel**),
`initialIndex` (open on a chosen pane, e.g. the last). Indicator dots are tappable; the active pane
is tracked from scroll position.

*Reference:* `src/components/ui/SwipeDeck.tsx`.

---

## 4. Converting a page — the recipe

1. **Branch by `useIsMobile()`.** Leave the desktop render untouched; add a mobile render.
2. **Make the page root a fixed-zone column:** `flex min-h-0 flex-1 flex-col`. Split into
   **fixed-height zones** (`flex-none`) and a **filling zone** (`flex-1 min-h-0`). (Dashboard:
   header-data deck = `flex-none`; account/primordials = `flex-1`.)
3. **Wrap horizontally-sibling rectangles in a `SwipeDeck`** (`fill peek={false}`), so one fills the
   zone and a swipe replaces it entirely. Use a **vertical** `SwipeDeck` when a zone holds a list of
   equal panes to page through (Dashboard Primordials = 8 token panes, vertical, dots on the right).
4. **Redesign heavy components dense** so they fit their zone: compact stat chips instead of tall
   boxes, wrap long strings to use available width, essentials fixed at the top and only the
   *detail* (e.g. addresses) scrolling inside the card. **No `zoom`/`transform: scale`.**
5. **Verify the `min-h-0` chain** (§2) end-to-end, then test on a real device: no page scroll, no
   pinch-zoom, each pane fits, swipes are discrete.

*Reference:* `src/routes/logged-in/dashboard.tsx` (fixed zones),
`src/components/dashboard/DashboardInfoHeader.tsx` (horizontal deck, opens on the last panel),
`src/components/home/AccountCards.tsx` (horizontal deck + vertical Primordials deck),
`src/components/home/overview.tsx` (dense mobile Account Overview).

---

## 5. Modals / signing zones (ZBOMs) go full-screen on mobile

Every transaction/confirm popup opens as a **full-screen immersive sheet** on phones — one change to
the **shared modal component** flips *all* of them at once (in OuronetUI, all 47 CFM/ZBOM modals go
through one `<Modal>`). At `≤ 1023.98px`: the dialog fills the viewport (covers the tab bar for a
focused signing task), the body scrolls internally, and the ✕ is pinned. Do the heavy lifting in CSS
with `!important` at the mobile breakpoint; keep the component's inline styles in agreement.

*Reference:* `src/assets/styles/components/_dialog.css` (mobile full-screen block),
`src/components/ui/Modal/Modal.tsx`.

---

## 6. Touch gotchas (learned the hard way)

- **Radix menu/dropdown flashes open then closes on a quick tap.** Radix triggers toggle on
  `pointerdown`; on touch, the browser's emulated "ghost" mouse `pointerdown` right after a quick tap
  fires a *second* toggle and closes it — so it only "sticks" on a long press. **Fix:** suppress the
  ghost events with `onTouchEnd={(e) => e.preventDefault()}` on the trigger. (`touch-action:
  manipulation` removes the 300 ms delay but does **not** stop ghost events.)
- **`user-scalable=no`** is what kills pinch/double-tap zoom app-wide; `touch-action: manipulation`
  complements it on individual controls.
- **`overscroll-behavior: contain`** on the stage stops scroll-chaining/rubber-banding past a zone.

*Reference:* `src/components/core/HeaderAccountWidget.tsx` (the touchend fix).

---

## 7. Conformance checklist

A page is "Pantheonic-mobile" when, on a phone:

- [ ] The **page does not scroll**; header and tab bar stay pinned. Zoom is disabled.
- [ ] Content is **fixed zones** that fill the stage; scrolling happens **only inside** an
      overflowing zone.
- [ ] Rectangle-to-rectangle navigation is a **discrete swipe** (snap-per-swipe, no in-between,
      no peek unless intentional).
- [ ] Every dense component was **redesigned to fit**, not `zoom`/`scale`-hacked.
- [ ] The **`min-h-0` chain** is unbroken (no giant empty tails / off-screen content).
- [ ] Modals/ZBOMs open **full-screen**.
- [ ] The footer is **off the flow** (riser off the tab bar), not a scrolling page footer.

---

## 8. Status

- **Chrome (header + bottom tab bar): standardized** — the shared mobile shell every Pantheon site
  reuses (only the theme changes).
- **Page conversion: in progress** — the **Dashboard** is the first fully-converted reference. Every
  other page (and every other daimon: Mnemosyne, Explorer, …) converts by following §4 against the
  same shell. This folder grows as more page patterns are proven.
