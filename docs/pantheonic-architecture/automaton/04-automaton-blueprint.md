# Handoff 04 — The Pantheonic Automaton Blueprint

**Audience:** the agent (or human) creating any NEW Pantheonic Automaton — Caduceus,
Aletheia, and every one after. This is the canonical "how an automaton is built" so
there is **no guessing** from the get-go.

**Authored from:** Mnemosyne (`codex.ancientholdings.eu`) — the first automaton, where
every piece below was learned the hard way. Mnemosyne is the reference implementation;
read its code alongside this doc.

**Companion handoffs:** `02-automaton-master-key-codex-protection.md` (the sealed-codex
+ rotation crypto — canonical, follow it verbatim) and
`03-khronoton-automaton-package.md` (the scheduling/execution engine package).

> **Keep this updated.** When a new automaton surfaces a lesson worth recording, add it
> here. This doc is the accumulated wisdom, not a snapshot.

---

## 0. What a Pantheonic Automaton IS

An automaton = **Codex** (sealed keys + signing) + **Pythia** (chain reads) +
**Khronoton** (scheduled autonomous signing) + its own domain logic — packaged as a
**single Docker container**, gated behind AncientHub login, operated by an ancient
admin, self-updating and self-redeploying with **no expiring tokens**.

The three organs are **"constructors"** — reusable npm packages the automaton consumes.
The automaton itself is an **app**, not a library: its artifact is a **container image**,
never an npm package.

**Three shapes use this blueprint — know which you are before reading on:**
- **Pure constructor** — an npm package only, no deployed surface (e.g. `khronoton-core`).
  This doc barely applies: publish + version it, done.
- **Automaton** — a deployed container that consumes constructors (e.g. Mnemosyne). The
  whole doc applies.
- **Constructor-service** — a constructor that is ALSO a deployed app with its own webpage +
  admin (e.g. **Pythia**: automatons *import* it AND humans *operate* it live). It takes the
  **infrastructure core** — §3 container + tokenless Deploy, §5 AncientHub login, §6 sealed
  operator secrets, §9 Hub-style admin, §10 versioning — but ships **two** artifacts (an npm
  package AND a container) and SKIPS the organs it doesn't have (no operator Codex UI, no
  Khronoton). **If you're Pythia, read §13 first, then the infra sections it points to.**

```
        ┌───────────────────────── the Automaton (a Docker container) ─────────────────────────┐
        │  AncientHub OIDC login (ancient gate)                                                 │
        │  ┌── admin (Hub-style, one page per function) ──────────────────────────────────────┐ │
        │  │  Own sealed Codex (master-key)   Pythia connector   Khronoton (scheduled tx)      │ │
        │  │  Update Constructors + Deploy    Codex Security (rotate)    …domain functions      │ │
        │  └───────────────────────────────────────────────────────────────────────────────────┘ │
        │  consumes:  @ancientpantheon/codex   @ancientpantheon/khronoton-*   (npm, baked in)    │
        │  persists:  host volume → sealed codex + master key + secrets + Pythia creds           │
        └───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Repo, registry, org (settle this first)

- **Source** lives in a GitHub repo under the **`AncientPantheon`** org (public), e.g.
  `github.com/AncientPantheon/<automaton>`.
- **Runtime artifact = a Docker image** on **`ghcr.io/ancientpantheon/<automaton>`**
  (GitHub Container Registry — shows under the repo's *Packages* tab). Built + pushed
  by CI on release using the workflow's **automatic `GITHUB_TOKEN`** (no user PAT, never
  expires).
- **An automaton is NOT an npm package** — deployed, not imported; only *constructors* are
  npm packages. **Exception — a constructor-service (Pythia) is BOTH:** it publishes an npm
  package for consumers AND ships a container for its own live surface (§13).
- The repo is **public**, so the box pulls source + npm packages with **zero credentials**.

---

## 2. The constructor model

Every organ is an npm package with `core / server / ui` subpath exports, consumed at
**build time** and **baked into the image**:

- **`@ancientpantheon/codex`** — the codex (keys, signing, the codex-ui). Already shipped
  as a bundled aggregate (subpaths `. /provider /hooks /ui /ouronet /arweave /ui.css`).
- **`@ancientpantheon/khronoton-*`** — the scheduler/executor + builder UI (being built
  per handoff 03: `core` published, `server` + `ui` TBD).

**The load-bearing fact:** constructors ship **browser code** (React components run in the
user's browser), which is **bundled at build time**. You CANNOT hot-swap a compiled
component library at runtime. → **Adopting a new constructor version = a rebuild.** Every
update mechanism is really "how/where the rebuild happens." Do not fight this.

Both the consumer's own codex surface AND any consumer-facing surface mount the SAME
installed package — one install, one shared shell (see Mnemosyne `app/codex/CodexShell.tsx`:
`/codex` and `/admin/codex` render through ONE component; only the adapter + top-bar action
differ). Never fork the codex layout per surface.

---

## 3. Container + the deploy/renewal mechanic (tokenless)

The automaton is a **Docker image** (Next `output: "standalone"` → a slim image; the whole
app+website+API in one). Two complementary, **credential-free** paths:

1. **Primary — the on-box Deploy button** (ancient-gated, in the admin panel). On click,
   the box runs: `git pull` (public repo, no cred) → `npm install @ancientpantheon/*@latest`
   (public npm) → `docker build` (local) → **blue-green swap**. 100% tokenless. A single
   button, **lit whenever any constructor (or the app source) has a newer version**.
   BUILT + PROVEN live in Mnemosyne v0.3.2 (see `deploy/host/` + `deploy/DOCKER.md`).
   - **Least privilege (do NOT mount the docker socket).** The container holds no
     Docker/nginx power. `POST /api/admin/deploy` only drops a request file in a spool on
     the shared host volume; a **systemd path unit** on the host runs the privileged
     deployer (`mnemosyne-deploy.sh`, as root) — build, container swap, nginx reload. A
     socket-mount would hand container-escape-equivalent power to the web app; the
     host-signal keeps the blast radius on the host side.
   - **Zero-downtime (blue-green):** build the new image → start the new container on a
     second port (blue 3005 ↔ green 3006) → health-check → rewrite an nginx `upstream`
     include + `nginx -s reload` → stop the old. The site never drops a request.
   - **Streamed progress:** the deployer writes its log to the spool; the browser tails it
     over SSE (`/api/admin/deploy/stream/<id>`), reconnecting across the swap (the log
     lives on the host volume, so the new container resumes the tail). The nginx `location`
     for the stream needs `proxy_buffering off; proxy_read_timeout 1800s;`. A live
     terminal, exactly like the hub's website-update button.
2. **Add-on — CI → ghcr.io on release.** On a git tag/push, GitHub Actions builds + pushes
   a **versioned** image (automatic `GITHUB_TOKEN`) → gives rollback + the Packages
   presence. The dashboard deploy does not depend on it.
   - **Two setup gotchas (both bit Mnemosyne's first release):** (a) the **org** must allow
     Actions write permissions — AncientPantheon's org Actions setting (Settings → Actions →
     General → Workflow permissions) caps every repo, so "Read and write" must be enabled
     there or the push is denied even with `permissions: packages: write` in the workflow;
     (b) the image job MUST run **`docker/setup-buildx-action`** before `build-push-action`
     if it uses `cache-from/to: type=gha` — without Buildx the step fails in ~1s. Actions-
     published packages default to **private** (make public in the package settings if you
     want anonymous pulls; not needed if the box builds its own image).

**No user-managed token anywhere.** Dashboard deploy = local + public; registry publish =
CI's built-in token.

**Persistence (critical):** a container swap discards the image but MUST keep operator
state. Mount a **host volume** into the container so these survive every deploy:
```
host:/srv/<automaton>/data       → the sealed codex (MNEMOSYNE_CODEX_DIR equivalent)
host:/srv/<automaton>/.env.local → master key + session/OIDC secrets + Pythia connector
```
Never bake secrets into the image. The volume makes "wire Pythia once → it persists
across all deploys" true by construction.

**Runtime-user ownership (learned on Mnemosyne):** the image runs as a NON-ROOT user
(uid 1001). The mounted host state (`.env.local` + `data/`) MUST be owned by that uid or
the container can't read the `drwx------` sealed-codex dir — the site is up but the codex
"fails to load". `chown -R 1001:1001 <host-state>` on first setup.

---

## 4. Localhost vs live — clean segregation (do not mix)

| | **Local dev** | **Live production** |
|---|---|---|
| Run | `npm run dev` (webpack HMR, no Docker) | the Docker container |
| Constructor update | `npm install @latest` → **auto-restart the dev server** (webpack caches node_modules at boot, so a pull needs a restart, not just reload) | the on-box Deploy (git pull + npm latest + `docker build` + blue-green swap) |
| Secrets/state | repo-root `.env.local` + `data/` (gitignored) | **host volume** (`.env.local` + `data/` in the mount) |
| The Deploy button action | "Update & restart" (auto-restarts dev) | "Deploy" (rebuild + swap) — **deploy-mode-aware, same button** |

The app decides its mode from `NODE_ENV` (`production` = bundle/container; else dev). Every
deploy-mode-aware surface (the version panels, the Deploy button, the codex "compiled-in vs
pullable" note) branches on this. **Never** let a dev-only pull path run on the live bundle
(it updates node_modules but not the built chunks → a no-op that looks like it worked).

---

## 5. Ancient-admin login (this is what we stumbled on — get it exactly right)

The automaton delegates human login to the **AncientHub OIDC IdP** and gates admin on the
`ancient` role. Reference: Mnemosyne `lib/auth/*` + `app/admin/{login,callback,logout}`.

- **Flow:** auth-code + **PKCE (S256)**, `client_secret_basic` token exchange, **RS256
  id_token** verified against the hub's JWKS (issuer + `aud`=client_id + nonce), roles gated
  on `roles.includes("ancient")`. The automaton signs its OWN first-party session cookie
  (HS256 over `SESSION_SECRET`), separate from the hub's id_token.
- **Config (env, in the volume `.env.local`):** `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
  `OIDC_CLIENT_SECRET` (confidential, server-only), `SESSION_SECRET` (≥32 chars). Each
  automaton registers its OWN confidential client with the hub, with its callback
  `https://<automaton-host>/admin/callback` in the allowed-redirects list.
- **THE TWO TRAPS (both bit Mnemosyne):**
  1. **`redirect_uri` must be derived from the request host, never hard-coded** — a static
     default silently sends prod logins to `localhost`. See `resolveRedirect()`.
  2. **EVERY same-site redirect (login/callback/logout → `/`) must also be host-derived**,
     not `new URL("/", request.url)` — behind nginx `request.url` reflects the internal
     `127.0.0.1:3005` bind host, so a "return home" bounces the operator to localhost even
     after auth succeeds. Use `resolveOrigin(request)` / `siteUrl(request, path)` honoring
     `X-Forwarded-Host` / `X-Forwarded-Proto`.
- **Cookies:** `HttpOnly`, `SameSite=Lax` (Lax so the top-level nav BACK from the hub
  carries the login-state cookie), `Secure` derived from the request scheme (https prod /
  http localhost — a Secure cookie over http://localhost is dropped). The login-state
  cookie is path-scoped to `/admin` (must reach `/admin/callback`); the session cookie is
  path `/`.
- **Gate helper:** `requireAncient(request)` → `{ok, session}` or a ready 401/403 Response.
  Every admin API route calls it first.

---

## 6. Master-key sealed operator secrets (follow handoff 02)

The service holds its OWN operator secrets, **sealed under a server master key** and
**auto-unlocked** for the ancient admin (no password) and for self-execution. **What the
sealed payload IS depends on the service:** Mnemosyne seals an **operator codex** (keys +
signing, §7); a constructor-service like **Pythia** seals **its own credentials** (upstream
node connections, API keys, the dual-key halves) — *same vault, different contents*. The
master-key vault + rotation mechanics below are generic; "codex" is just Mnemosyne's payload,
and §7 (the codex-ui server-custody adapter) is Mnemosyne-specific — a service with no codex
seals a plain JSON secrets blob instead, reusing the same Vault/rotation code.

- Master key `<AUTOMATON>_MASTER_KEY` (base64 of 32 random bytes) in the volume `.env.local`.
- Sealing = libsodium `crypto_secretbox`; the codex is stored as sealed files in the volume
  data dir (`<AUTOMATON>_CODEX_DIR`), NOT a DB, NOT the image.
- **Rotation = a generic vault re-seal, never a key swap** (handoff 02 §4). A swap bricks the
  codex. Mnemosyne: `lib/mnemosyne{Vault,CodexStore,Rotation}.ts` + `lib/envFile.ts`
  (atomic temp→fsync→rename `.env.local` write) + `POST /api/admin/security/rotate-master-key`
  (ancient + `acknowledgedExport`). Ship a codex-survives-rotation regression test.
- The sealed codex + master key live in the host **volume** → survive every container deploy.

---

## 7. Codex storage + the server-custody adapter

The codex UI is mounted with a **server-custody adapter** (not localStorage): every mutation
seals the whole snapshot server-side (master-key), auto-loaded + auto-unlocked. Model on
Mnemosyne `lib/codex-dropin/MnemosyneServerCodexAdapter.ts` + `app/admin/codex/MnemosyneCodex.tsx`
(the hub's `CodexDropIn` pattern). Empty on first open → the ancient populates it on the spot
→ real-time sealed save. No upload.

### 7a. Portability: download + load-and-adopt (server-custody re-key) — SHIPPED

A server-custody codex is sealed under the master key and encrypted at the inner layer under a
**machine-generated password the operator never sees**, so the plain codex Export/Load (which
preserve the current password) aren't usable — both directions need a **re-key**. Mnemosyne
v0.4.0 ships two ancient-gated flows (`app/api/admin/codex/{export,import}` + `app/admin/codex/
CodexPortabilityControls.tsx`):
- **Download** — prompt a new password (twice) → re-key *machine-pw → the new password* →
  the operator downloads a portable codex encrypted under a password THEY chose. Live codex
  untouched.
- **Load-and-adopt** — pick a codex + its password → re-key *file-pw → machine-pw* → seal under
  the master key (`saveBackup`) → auto-unlocks as usual. It **replaces** the current codex →
  gate behind a confirm + "download a backup first".
- Do the re-key **server-side** (Node): the master key + machine password never leave the box;
  only the passwords the operator types travel (over TLS).

**The re-key primitive is the codex package's, NOT the automaton's.** Consume
`rekeyCodex(snapshot, oldPw, newPw)` (codex 0.6.0, from `@ancientpantheon/codex/ouronet`) — it
owns the drift-proof secret-field walk (its `CODEX_IDENTITY_SECRET_FIELDS` + a `rekey-inventory`
guard test keep it in lockstep with the snapshot shape, so a future secret field can't be
silently left under the old password). Mnemosyne only ferries the opaque `backup.sealed` blob
(`JSON.stringify(snapshot)`) through `lib/mnemosyneCodexRekey.ts` and never touches plaintext.
Reject wallet-**envelope** uploads (`kadenaWallets`/`ouronetWallets`) up front — Load takes the
raw-snapshot format; envelope import awaits a codex `snapshotFromExport` (handoff 07 follow-up).
The story of why this belongs in the package: `07-codex-rekey-primitive.md`.

---

## 8. Pythia credentials (wired into the codex; persistent; embeddable)

- Pythia is wired via credentials the ancient sets: a **global connector URL** (injected into
  every codex surface, from `/api/config`) + the codex's own Pythia/Apollo keys (inside the
  sealed codex).
- **Persistence:** the connector config (admin-settings) + the sealed codex both live in the
  **host volume** → **wire Pythia once, it survives all deploys.**
- **Embed option (v2 nicety):** a toggle at deploy time to fold the current Pythia config into
  the image build so a fresh container starts pre-wired. The volume already makes persistence
  work from day one; embedding is optional.
- The per-user Network-tab node override is browser-local (localStorage) — it only affects
  that operator; the global Pythia wins.

---

## 9. Gated admin functions (Hub-style)

The admin surface is a **landing with a tile per function**, each on its own ancient-gated
page, all wrapping their section in ONE shared `AdminGate` (the gate — not each section —
owns the checking/login/not-authorized/ancient states). Reference Mnemosyne `app/admin/*`:

- `/admin` landing (tiles) · `AdminGate.client.tsx` (the shared gate) ·
- one page per function: the automaton's own **Codex**, **Update Constructors + Deploy**,
  **Pythia connector**, **Codex Security** (rotate), **Khronoton** (scheduled tx), **Network**,
  + domain-specific pages.
- Every mutating/signing route is ancient-gated server-side (`requireAncient`); the gate is UX.

---

## 10. Versioning + docs discipline

`package.json` `version` is the single source of truth (shown in the app header). **Every bump
ships a matching `CHANGELOG.md` top entry in the same commit — enforced by a test**
(`tests/changelog-version.test.ts`: package version === newest changelog entry, so a bump can't
merge undocumented). Procedure in `docs/RELEASING.md`. TDD throughout; the full test suite is
the safety net for the deploy button.

---

## 11. New-automaton checklist

> **Constructor-service (Pythia)?** Do the infra items but skip the ones marked *(automaton
> only)*, seal your own creds instead of a codex, and ADD "publish the npm package on release"
> (§13).

- [ ] Repo under `AncientPantheon` (public); image → `ghcr.io/ancientpantheon/<name>`.
      *(constructor-service: ALSO publish an npm package — §13.)*
- [ ] Next.js `output: "standalone"`; Dockerfile (multi-stage) + compose with a **host volume**
      for `.env.local` + `data/`.
- [ ] AncientHub OIDC login + `ancient` gate — **host-derived `redirect_uri` AND all same-site
      redirects** (`resolveOrigin`/`siteUrl`); Lax/Secure-per-scheme cookies. Register the
      client + its callback with the hub.
- [ ] Master-key sealed operator secrets in the volume + rotation per handoff 02 + a
      survives-rotation test (Mnemosyne: a codex; constructor-service: its own creds — §6).
- [ ] Server-custody codex adapter + the shared CodexShell *(automaton only — needs a codex)*.
- [ ] Pythia connector (global + per-user), persisted in the volume *(automaton consumers only;
      Pythia itself IS the service)*.
- [ ] Constructors consumed as npm (`@ancientpantheon/*`, core/server/ui), baked into the image
      *(if it consumes any)*.
- [ ] Khronoton wired once its package ships (handoff 03) *(automaton only)*.
- [ ] Hub-style admin (landing + per-function pages + `AdminGate`).
- [ ] Deploy: on-box tokenless button (git pull + npm latest + docker build + blue-green +
      streamed logs), deploy-mode-aware (dev = npm + restart); CI → ghcr.io on release.
- [ ] Versioning gate + CHANGELOG + RELEASING.md.
- [ ] Clean localhost/live segregation; never run a dev-only pull on the live bundle.

## 12. Where Mnemosyne implements each piece (read these)

| Concern | Mnemosyne file(s) |
| --- | --- |
| OIDC login + host-derived redirects | `lib/auth/*`, `app/admin/{login,callback,logout}/route.ts` |
| Sealed codex + rotation | `lib/mnemosyne{Vault,CodexStore,Rotation}.ts`, `lib/envFile.ts`, `app/api/admin/security/*` |
| Server-custody adapter + shared shell | `lib/codex-dropin/MnemosyneServerCodexAdapter.ts`, `app/codex/CodexShell.tsx`, `app/admin/codex/*` |
| Pythia connector | `lib/adminSettings.ts`, `lib/pythiaUrl.ts`, `app/api/{config,admin/pythia}` |
| Hub-style admin | `app/admin/AdminGate.client.tsx`, `app/admin/AdminLanding.client.tsx`, `app/admin/*/` |
| Constructor version/update surface | `lib/codexVersion.ts`, `app/api/admin/{codex,khronoton}-version`, `app/admin/update-constructors/*` |
| Versioning gate | `tests/changelog-version.test.ts`, `docs/RELEASING.md`, `CHANGELOG.md` |
| Deploy (BUILT) | `Dockerfile`, `docker-compose.yml`, `deploy/host/*` (systemd blue-green deployer + install script), `app/api/admin/deploy/*` (trigger + SSE stream), `app/admin/update-constructors/*` |
| Sealed-config portability (download/load) | `lib/mnemosyneCodexRekey.ts`, `app/api/admin/codex/{export,import}`, `app/admin/codex/CodexPortabilityControls.tsx` (§7a) |

---

## 13. Constructor-services — a constructor that is ALSO a deployed app (Pythia)

**Pythia** is the reference constructor-service: automatons **import** it as a chain-reads
constructor (an npm package baked into their image at build time), AND it runs as a **live
deployed service** with its own webpage + ancient admin (the backend the connector URL points
at). So there are effectively two faces of Pythia — the **npm client** consumers bake in, and
the **deployed service** humans operate — and this section is about making the *deployed
service* an admin-driven container exactly like Mnemosyne.

**Reuse verbatim (the infra core):**
- **§3 container + tokenless on-box Deploy** (blue-green, SSE, least-privilege host-signal
  deployer, host-volume persistence, uid-1001 ownership). Identical.
- **§5 AncientHub OIDC login + `ancient` gate** — both redirect traps, Lax/Secure cookies,
  `requireAncient`. Identical. Register Pythia's own confidential client + callback with the hub.
- **§6 master-key sealed operator secrets** — Pythia seals **its own** credentials (upstream
  node connections, API keys, the dual-key halves), NOT a codex. Same Vault + generic rotation;
  the sealed payload is a plain JSON secrets blob. (§7's codex-ui adapter does NOT apply.)
- **§9 Hub-style admin** (landing + tile per function + shared `AdminGate`) and **§10 versioning
  gate**. Identical.

**Skip:** §7 the codex-ui server-custody adapter, §7a codex portability (unless Pythia wants an
analogous "download/load my sealed config" — trivially the same server-side re-seal pattern),
Khronoton (handoff 03), and the "consumes other organs" framing (Pythia may consume none).

**The one genuinely new thing — TWO artifacts, ONE version, TWO release lanes:**
Unlike an automaton (one artifact: a container), a constructor-service ships **both**:
1. the **npm package** `@ancientpantheon/pythia*` (what automatons import), and
2. the **container image** `ghcr.io/ancientpantheon/pythia` (the live service).

Keep them in lockstep with the **single `package.json` version** (the §10 gate). A release is:
- **npm publish on tag** (CI, like the constructor triplet) — so downstream automatons (Mnemosyne
  et al.) see a new *constructor* version on THEIR Deploy panels and rebuild. This is the
  existing cross-constructor flow — nothing new downstream.
- **the container** — Pythia's OWN on-box Deploy button rebuilds its live service from source
  (git pull + `npm install @latest` for any constructors it consumes + docker build + blue-green),
  AND CI → ghcr.io on release for a rollback image. Same §3 mechanic.

So Pythia's admin has the **same "Update Constructors + Deploy" surface** as Mnemosyne (rebuilds
its container, and shows Pythia's *own* version as the automaton row — see §7-style app-version
tracking via a GitHub-raw `package.json` read). The extra discipline vs an automaton: **a Pythia
release must publish the npm package too**, not just redeploy the container — otherwise consumers
never get the new client. Wire the npm publish into the release CI so the two lanes can't drift.

**Net for the Pythia agent:** build the deployed service as a Mnemosyne-shaped container (§§1,3,5,
6,9,10,11), seal Pythia's own creds instead of a codex, skip Codex-UI/Khronoton, and add the npm
publish lane so every version ships both artifacts. Everything else is copy-the-Mnemosyne-pattern.
