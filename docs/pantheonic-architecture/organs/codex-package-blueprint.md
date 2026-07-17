# Codex Package Blueprint — structural template for Khronoton's UI package

Sources: `D:/_Claude/AncientPantheon/Codex` (monorepo behind `@ancientpantheon/codex`) + `D:/_Claude/AncientPantheon/Mnemosyne` (a real consumer). This is the pattern to mirror for the Khronoton UI/handlers layer.

## 0. Topology
`@ancientpantheon/codex` is a thin **aggregator** at `packages/codex/` bundling 4 private members: `codex-core` (React-free, chain-free substrate), `codex-ui` (chain-generic React: generic `<CodexProvider>`, 16 hooks, token-styled leaves + `tokens.css`), `codex-ouronet` (Kadena/Pact edge: concrete store, resolver, account tabs), `codex-arweave`. The six barrels are 1-line re-exports; `/provider` `/hooks` `/ui` resolve to `codex-ouronet`, which re-exports the generic base from `codex-ui` and adds the chain edge locally.

**Khronoton note:** Khronoton's scope is one domain (cronotons), smaller than Codex's multi-chain split. Likely a SINGLE package (`khronoton-core`) with added subpaths, NOT a 4-member aggregator — but the exports/theming/provider/adapter shape below is copied 1:1.

## 1. Packaging & build
- **ESM-only**: `type: module`, tsup `format:["esm"]`, `dts:true`, `splitting`, `treeshake`, target es2020.
- **Exports map**: `.` (headless core, React-free) · `./provider` · `./hooks` · `./ui` · `./ui.css` (string export, no conditions) · per-domain subpaths. Every JS subpath pairs `types`+`import`.
- **`"sideEffects": ["**/*.css"]`** — critical so bundlers don't tree-shake the CSS import.
- **Build = tsup + a CSS concat script**: `tsup && node scripts/bundle-css.mjs`. tsup `noExternal: [/^@ancientpantheon\/codex-(core|ui|ouronet|arweave)/]` force-inlines private members (JS+dts) so consumers never resolve them. `bundle-css.mjs` concatenates member `dist/ui.css` sheets into one `dist/ui.css` (idempotent, later-wins) AFTER tsup.
- **React = peerDependency** (`^18||^19`), alongside other heavy shared libs (lucide-react, @stoachain, @noble/curves). Private members = devDependencies (build inputs). Runtime third-party libs (zustand, CodeMirror, radix, sonner, clsx, tailwind-merge) = dependencies.
- **Self-contained assets** — never reference host `public/` (the 0.5.1 regression: inline glyphs).
- **NOTE for khronoton-core:** current package builds with plain `tsc` (root `.` + `/server`). Adding `.tsx` + CSS UI subpaths requires **tsup** (or equivalent) for the UI entries. Decision: keep `.`/`/server`/`/handlers` on tsc, add tsup for `/provider` `/hooks` `/ui` + the CSS concat — OR migrate the whole package to tsup. The root `.` and `/server` outputs MUST stay byte-stable (published 0.2.0 consumers).

## 2. Provider + adapter seam (the drop-in mechanism)
Two nested injection layers:
- **Generic `<CodexProvider>`** (codex-ui) takes seams as props: `createStore` (Zustand factory), `resolverFactory`, a toast slot, `adapter`, `deviceVariant`, config. SSR-safe: browser-only init effect (`typeof window` guard), per-mount store via `useRef`, exposes 3 React contexts. First-boot UI overrides only when `schemaVersion===0`.
- **Thin domain wrapper `<CodexProvider>`** (codex-ouronet) pre-fills the seams; this is what a consumer uses. Public props: `adapter` (REQUIRED), `deviceVariant?`, `passwordCacheMinutes?`, `initialUiSettings?`, `onCodexDirty?`, `signingClient?`, `children`.
- **The adapter seam = what the CONSUMER implements** (equivalent to Khronoton's engine seams, but for UI↔backend). `CodexAdapter`: `name`, `loadAll()`, `saveAll(snapshot)`, per-slice writers (each may just patch an in-memory copy + re-call `saveAll`), `touch()`, `getSchemaVersion`/`setSchemaVersion`, encrypted-sidecar pair (may be no-op), `clearAll()`. Ship reference `MemoryCodexAdapter` (SSR/tests) + `LocalStorageCodexAdapter` (browser). Provide `emptySnapshot()` + `assertAdapter()` guard. Secrets are encrypted BEFORE reaching the adapter — adapter never sees plaintext.
- **Concrete consumer example**: `Mnemosyne/lib/codex-dropin/MnemosyneServerCodexAdapter.ts` — `implements CodexAdapter`, persists the whole snapshot server-side (master-key sealed) by GET/POST/DELETE against `/api/admin/codex`. Every per-slice writer = `saveAll({...current, slice})`.

**Khronoton mapping:** the UI adapter = "how the UI reads/mutates cronotons" (list/get/create/edit/pause/resume/delete/trigger/fires/manual-batch) — the consumer implements it by calling its own API routes, which wrap `khronoton-core/handlers`.

## 3. Hooks surface
16 byte-locked hooks read via an internal `useStore()` context, each with a paired `*View`/`*Fn` type: `useCodex()` (isReady/isLocked/initError + actions), `useCodexAuth()` (authenticate/lock), `useCodexBackup()` (download/import), CRUD hooks per entity, `useGetKeypair`/`useSignTransaction` (consume the injected resolver seam). Khronoton analogs: `useKhronoton()` (ready/error), `useCronotons()` (list CRUD), `useCronoton(id)` (one + its fires), `useCronotonFires(id)` (paginated), action hooks (create/trigger/pause/resume).

## 4. UI surface + theming (THE key pattern the user wants)
- Components exported from `./ui`; a **`<UiRoot>`** wrapper applies the `.codex-ui` scope (theming boundary).
- **Theming = CSS custom properties, NO Tailwind in the package.** `tokens.css` declares a `--codex-*` block on **`:root, .codex-ui`**; components style EXCLUSIVELY via inline `style={{ color: "var(--codex-text)" }}`. Tokens: surfaces (`--codex-bg` `#0a0a0a`, `--codex-surface` `#18181b`, `--codex-surface-2`, `--codex-border`), text (`--codex-text`, `--codex-text-dim`), accent (`--codex-accent` `#ceac5f` gold, `--codex-accent-strong`), status (`--codex-success/error/warning`), radii, shadow, fonts.
- **How Mnemosyne recolors** (`app/codex/app.css`): overrides tokens at **`body .codex-ui`** (specificity `(0,1,1)`) so it beats the package's `.codex-ui` `(0,1,0)` **regardless of load order** — overriding only ~5 of ~20 tokens; the rest inherit. This IS the "consumers add their own colors on top" mechanism.
- **Khronoton must reproduce:** a `--khronoton-*` block on `:root, .khronoton-ui`, a `<KhronotonUiRoot>` scope wrapper, inline `var(...)` styling only, and DOCUMENT that consumers override at `body .khronoton-ui`.

## 5. Public vs admin mount
Both surfaces render the IDENTICAL package tree; only the adapter + top-bar action differ (a shared `Shell`).
- **Public `/codex`**: server component (`force-dynamic`) → `'use client'` wrapper → `dynamic(() => import("./App"), { ssr:false })` (mandatory — tree pulls Buffer/window/browser-crypto) → ephemeral `MemoryCodexAdapter`, NO auth. (Codex's is upload-driven; Khronoton's public view is read-only observe + explorer links.)
- **Admin `/admin/codex`**: same `ssr:false` discipline → role-gated (client gate is UX-only; the REAL boundary is the ancient-gated API routes) → server-custody adapter with auto-unlock helpers.

## 6. Consumer API routes (server side of the drop-in)
`app/api/admin/codex*`, all `force-dynamic`, `requireAncient`-gated, `Cache-Control: no-store`, opaque-blob contract: GET `{ backup?: string|null }`, POST `{ backup: string }`, DELETE clears; a lean `/unlock` sibling; version/update endpoints. Server never parses codex internals.

## 7. Documented wire-in (README/CHANGELOG)
Install `@ancientpantheon/codex`, provide peers (react/react-dom/etc.), import from subpaths + `import "@ancientpantheon/codex/ui.css"`, mount `<CodexProvider adapter={...}>`. CHANGELOG lesson: a bundled UI package must ship its own assets (0.5.1).

## Khronoton UI package — replication checklist
- [ ] Subpaths: `.` (have) · `/server` (have) · `/handlers` (framework-agnostic route handlers over the store/executor) · `/provider` (KhronotonProvider + adapter seam) · `/hooks` · `/ui` · `/ui.css`.
- [ ] Build: add tsup for the `.tsx`/CSS entries + a `bundle-css.mjs`; keep `.`/`/server` byte-stable; `sideEffects:["**/*.css"]`; React as peerDependency.
- [ ] Provider with injected adapter seam; ship Memory + fetch-based reference adapters; `emptySnapshot`/`assertAdapter`.
- [ ] Theming: `--khronoton-*` on `:root, .khronoton-ui`, inline `var()` only, `<KhronotonUiRoot>` scope, document `body .khronoton-ui` override.
- [ ] Public (read-only observe + explorer links) + admin (full CRUD) mount, both `ssr:false` dynamic-import.
- [ ] Self-contained assets; no host `public/` refs.

## Risks
- Restore-after-mount ordering (hydrate must wait for `isReady`).
- SSR poison → `ssr:false` from a client component mandatory; keep server pages import-free except a version read.
- Client gate ≠ security (gate in server API).
- Token specificity: consumers override at `body .khronoton-ui` or fight load-order.
- CSS merge idempotency (later-wins).
