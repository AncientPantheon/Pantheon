# Retainer 01 — Pantheon Session Handoff

> Handoff written 2026-07-08 to carry context into a fresh conversation. Retainers
> are numbered (01, 02, 03…); write the next one when this gets stale.

## 0. TL;DR

Pantheon is a **Next.js 14 static-export** observability site for the "Ancient
Pantheon" ecosystem, **live at https://pantheon.ancientholdings.eu**. This session
built the whole site UI, generated AI **portrait art** for the three Constructors,
added a **temple favicon**, **deployed** to the production box, and **backed up all 5
workspace repos** to GitHub. Everything committed is pushed; the site is live and
current.

---

## 1. Critical environment facts (don't rediscover these)

- **Local dev runs on `http://localhost:3004`, NOT 3000.** `npm run dev` invokes
  `scripts/localhost-dev.mjs`, which reads the port from a central registry at
  `D:/_Claude/LocalHost/registry.json` (user maintains it to stop port collisions
  across many local sites). `pantheon` → port 3004 (also the script's fallback).
  Port 3000 is a *different* project — checking `:3000` gives misleading results.
- **Platform:** Windows 10, working dir `D:\_Claude\AncientPantheon\Pantheon`. Shells:
  PowerShell (process mgmt) + Git Bash (POSIX). `python` is **Python 2.7** and has
  **Pillow 6.2.2**; there is **no** ImageMagick/sharp/cwebp/ffmpeg and pip has **no
  network**. Image work uses Pillow on py2.7.
- **SSH hosts** (in `~/.ssh/config`):
  - `ancientholdings` = **StoaMasterTwo** = `root@85.215.122.215:22000`, hostname
    `87897C`. **This is where Pantheon (and Caduceus) live.** Occasional transient
    SSH timeouts all session — just retry.
  - `stoanodeprime` = `root@85.215.141.198:22`, hostname `70B25A9` — a *different*
    box (codex/explorer/ouro sites). **Not** where Pantheon lives.
- **Auto-memory** already holds two facts: `local-dev-port.md` and
  `production-deploy.md` (in the Claude project memory dir). This retainer supersedes
  nothing there; it adds detail.

---

## 2. Production deploy — the verified procedure

Live site is a **static export served by nginx** (no Node process), on StoaMasterTwo,
mirroring the Caduceus setup.

**Server layout:**
- Web root: `/home/ancientholdings/pantheon/web` (files root:root, dirs 755, files 644)
- nginx conf: `/etc/nginx/sites-available/pantheon.ancientholdings.eu.conf`
  (ACME challenge → `/var/www/html`, `try_files`, `error_page 404 /404.html`,
  immutable cache on `/_next/static/`)
- TLS: Let's Encrypt via `certbot --nginx` (auto-renew; cert valid to ~Oct 2026)
- DNS: `pantheon.ancientholdings.eu` A record → 85.215.122.215 (user controls DNS)

**⚠️ The `.next` gotcha:** running `next build` while the dev server is up **corrupts
the dev server's `.next/`** (export overwrites it) → dev 500s with
`Cannot find module './chunks/vendor-chunks/next.js'`. **Do NOT** try to isolate the
build with a `node_modules` junction — webpack fails resolving `next/dist/client/next.js`
through the junction on Windows (tried, doesn't work).

**Reliable deploy sequence (verified 2026-07-06):**
1. Stop the dev server on 3004 (PowerShell: `Get-NetTCPConnection -LocalPort 3004` →
   `Stop-Process -Force`).
2. `rm -rf .next out && npm run build` (produces `out/`).
3. `tar czf out.tar.gz -C out .` → `scp out.tar.gz ancientholdings:/tmp/pantheon-out.tar.gz`
4. On server: `rm -rf $DIR/* && tar xzf /tmp/pantheon-out.tar.gz -C $DIR &&
   chown -R root:root /home/ancientholdings/pantheon && chmod dirs 755 / files 644`
5. Restart dev: `npm run dev &` (comes back on 3004).
6. Verify live with forced IP:
   `curl --resolve pantheon.ancientholdings.eu:443:85.215.122.215 https://pantheon.ancientholdings.eu/...`

---

## 3. Architecture & key files

Next.js 14 **Pages Router**, TypeScript, `output: "export"`, `trailingSlash: true`,
`images.unoptimized`. Config-driven — edit data, rebuild, redeploy; no CMS.

- `data/registry.ts` — the composed **entities** (Automatons/Daimons/Seers). Type
  `Entity { name, tier, role, lifecycle, logo?, links?, statusEndpoint? }`.
- `data/constructors.ts` — the three **Constructors** + `COMPOSITION` map per tier.
  Type adds `color, glyph, tagline, npm, repo, site?, logo?, photo?`.
- `components/ui.tsx` — `Nav`, `Footer`, `Composition`, `ConstructorIcon` (square
  tile), `LogoZone` (entity square, image-or-monogram w/ `hueFromName`).
- `pages/index.tsx` — home; entity `Row` = LogoZone + `row-body` (head + role) +
  `row-aside` (links stacked above constructor tiles, right-anchored).
- `pages/constructors.tsx` — Constructor cards with portrait `ccard-photo` zone.
- `pages/_document.tsx` — favicon links + theme-color.
- `styles/globals.css` — all styling (dark theme, gold accents).
- `public/favicon.svg` — gold **temple** icon on dark tile.
- `public/constructors/{pythia,codex,khronoton}.jpg` — 720×1080 portraits.

---

## 4. Design decisions made this session (so they're not undone)

- **Entity rows**: 110px square logo zone left; multi-line body (name 22px + lifecycle
  chip + role that wraps fully, no ellipsis); `row-aside` on the right holds the
  repo/site/activity links **stacked directly above** the constructor tiles, both
  right-anchored to the card edge.
- **Constructor composition order = Khronoton · Codex · Pythia** (Pythia always
  rightmost, Codex middle). Right-aligning makes them form consistent vertical columns
  across every row. Set in `COMPOSITION` and the two hardcoded `Composition` uses.
- **Constructor icons are square tiles** (`ConstructorIcon`), 44px in rows.
- **Constructor cards**: 2:3 portrait `ccard-photo` at bottom; `ccard` is a flex-column
  with `.ccard-role { flex: 1 }` so medallion + links + photo share a baseline across
  cards. `photo?` field renders the image, else a "portrait coming soon" placeholder.
- **Signature colors** (the "energy" color per constructor): Pythia **gold #f0a500**,
  Codex **blue #4aa8ff**, Khronoton **violet #a888ff**. Applied in the portrait art.
- **Lifecycle status**: Pythia = `live`, Khronoton = `live`, Codex = `building`.
- **Favicon**: gold classical temple (pediment + 5 columns + steps) on a dark rounded
  tile — fits "Pantheon".

---

## 5. Constructor portrait art — how it's made

The three portraits are AI-generated (ChatGPT image gen) at **1024×1536 (2:3)**, then
**downscaled to 720×1080 JPEG q85** for the web. Family aesthetic: black-obsidian-and-
gold, dark starfield, each on the same **Ouronet+Stoa pedestal**, ringed by blockchain
emblems, with the constructor's signature-color energy. Pythia = hooded oracle
character; Codex = levitating rune-book object; Khronoton = horologist automaton
forging a chain of transaction-blocks. (*character · object · character*.)

**Source PNGs** live in each repo's `.media/` folder (Pythia/.media, Codex/.media,
Khronoton/.media). **These are gitignored** (user chose to keep art out of git — see
§6), so the **full-res originals are local-only, not backed up.**

**Processing command (Pillow, py2.7):**
```python
from PIL import Image
im = Image.open(SRC)                      # 1024x1536 PNG
im = im.convert('RGB')                    # (composite RGBA on (10,10,15) if alpha)
w = 720; h = int(round(im.size[1]*(w/float(im.size[0]))))
im = im.resize((w, h), Image.LANCZOS)
im.save('public/constructors/<name>.jpg', 'JPEG', quality=85, optimize=True, progressive=True)
```
Then set `photo: "/constructors/<name>.jpg"` on the constructor in `data/constructors.ts`.

**The blockchain emblem set (13)** used across the art: BTC, ETH, BNB, TRX, SOL, XMR,
ZEC, XRP, XLM, KASPA, ARWEAVE, COSMOS, TAU (τ). The Codex prompt placed them precisely
(5 on the **spine**: ETH/BNB/SOL/TRX/TAU; 4 corners: XMR/ZEC/XRP/XLM; BTC top-center;
right margin: KAS/AR/COSMOS). Pedestal = Ouronet triquetra center (signature-color
beam up) + 4 Stoa emblems on the rim at 12/3/6/9 pointing inward/up with yellow light.
Full prompts are in this conversation's history if art needs regenerating.

---

## 6. Multi-repo backup status (as of 2026-07-08)

All 5 AncientPantheon workspace repos: **0 unpushed, 0 uncommitted**, all on GitHub
(`github.com/AncientPantheon/*`).

| Repo | Branch | Notes |
|---|---|---|
| Pantheon | main | the website (this repo) |
| Pythia | main | added `scripts/localhost-dev.mjs` + dev script; `pythia-stats.json` gitignored (generated) |
| Codex | feat/codex-migration-c-d | work on a feature branch, not main; its `.media` **is** tracked (4 files) |
| Khronoton | main | `.media` now gitignored |
| Aletheia | main | scaffold + planning docs |

**Convention conflict noted:** Codex tracks `.media`; Pythia & Khronoton gitignore it.
Per user decision, **art stays out of git** for Pythia/Khronoton → full-res portrait
PNGs are **local-only**. Open item: back those originals up elsewhere (external drive,
cloud, or a dedicated assets repo/release) if they matter.

---

## 7. Open items / next steps

- **Full-res art backup** — Pythia & Khronoton `.media` PNGs are not in git. Decide on
  a backup path if desired.
- **`feed.json` / `feed.rss`** — the footer (`components/ui.tsx`) links to these but no
  files exist (no feed generated) → they 404. Either generate real feeds from the
  registry or drop the links.
- **Entity logos** — entities use generated monograms (`LogoZone`); no real per-entity
  logo images yet. `Entity.logo?` supports dropping images into `/public` when ready.
- **Fresh-conversation note:** user loaded a new plugin (nectar/bee present); this
  retainer exists so the new session has full context without re-deriving it.

---

## 8. Quick-start for the next conversation

1. Dev: `npm run dev` → open **http://localhost:3004** (not 3000).
2. Edit content in `data/*.ts`; styling in `styles/globals.css`.
3. To ship: follow the **§2 deploy sequence** (stop dev → build → tar/scp/unpack →
   restart dev → verify via forced-IP curl).
4. To add a portrait: drop the 2:3 PNG in the repo's `.media`, process per **§5**,
   set `photo:`, rebuild, redeploy.
5. Commit to `main` and push (`origin`) — the user works directly on main for these
   solo repos.
