# The Organ Dependency Contract — publishing organs, and adopting them safely

**Status:** canonical standard. Two audiences, one contract:

- **Organ authors** — the `@ancientpantheon/*` constructor packages (Codex, Khronoton, …).
- **Automaton consumers** — every automaton/constructor that depends on them (Pythia, Mnemosyne,
  Caduceus, Aletheia, …).

Companion docs: `organs/CONSUMER-INTEGRATION.md` (runtime *wiring* of a mounted organ),
`automaton/05` §1c (how a **deploy** adopts an organ, and what the panel may advertise).

---

## 0 · Why this exists

Organ upgrades break consumers in ways the version number does not predict. Real, observed cases:

- A **patch** release (`0.6.0 → 0.6.1`) with **zero** API change — 334 exported symbols before and
  after, type declarations differing only in doc comments — that nevertheless **renamed its required
  peer dependencies** (`@stoachain/ouronet-core` → `@ouronet/ouronet-core`). The dependency graph
  changed; the API did not. A consumer diffing only exports would have seen "nothing changed."
- A release that **renamed a peer but left `peerDependenciesMeta` keyed under the old name**, so the
  real peer silently lost its `optional: true` and every consumer got a spurious unmet-peer warning.
  Fixed in the *next* patch.
- A consumer whose **required peer was satisfied only by npm's auto-peer-install**, never declared —
  working today, breaking the day anyone uses pnpm with strict peers or `--legacy-peer-deps`.

None of these are visible in a version number, and none are caught by "the tests pass."

---

## 1 · Consumer rules (the automaton adopting an organ)

### R1 · Declare every REQUIRED peer of every organ you consume

If an organ lists a peer in `peerDependencies` **without** `optional: true`, the consuming automaton
declares that package in its **own** `package.json` — even when it never imports it directly.

npm ≥7 auto-installs missing peers, so omitting the declaration *appears* to work and the lockfile
even pins a reproducible version. That is the trap: the dependency is real and required, but it
exists only as a side effect of one package manager's default behaviour. It disappears under pnpm
with strict peers, under `--legacy-peer-deps`, and under any future resolver change.

> **Rule of thumb:** the lockfile makes an install *reproducible*; the declaration makes it
> *intentional*. You need both.

Organs differ, so check per organ rather than assuming:

| Organ | Peer posture |
|---|---|
| `@ancientpantheon/codex` | peers are **REQUIRED** (incl. `@ouronet/ouronet-core`, `@ouronet/dalos-crypto`) |
| `@ancientpantheon/khronoton-core` | peers are **all optional** |

### R2 · On every organ bump, diff the PEERS — not just the exports

A rename is a *patch* release with an identical public API. Exported-symbol diffs, type-declaration
diffs, and prop diffs will all say "no change" while the dependency graph moves underneath you.
**Peer NAMES and RANGES are part of the upgrade surface.** Deprecated old names on npm usually point
at the replacement, which masks the change further.

### R3 · Verify against the PUBLISHED TARBALL, not the source repo

The source repo is not what your build installs. Check the artifact npm actually serves — a repo can
be correct while the published package is missing a file.

### R4 · Every declared `exports` subpath must resolve to a real file

Check both that a subpath is *declared* **and** that its target exists inside the tarball. A
declared-but-dangling subpath is the nastiest failure in this family: `npm install` succeeds, and the
consumer's **bundler** fails later at build time with a resolution error that names the organ, not
the missing file. Verify every subpath the automaton imports.

### R5 · Bundled organs need a rebuild, not just an install

An automaton that bundles organ UIs into browser islands (esbuild/webpack) is shipping a **build-time
copy**. Installing a new organ changes nothing in the browser until the bundle is rebuilt, and
nothing server-side until the process restarts. Any "update the organs" action must therefore be
*install → rebuild → restart/reload*, never install alone.

---

## 2 · Author rules (publishing an organ)

### A1 · `peerDependenciesMeta` keys must exactly match `peerDependencies` keys

When a peer is renamed, rename it in **both** maps. A stale meta key silently drops `optional: true`
from the real peer and every consumer starts warning. Treat a meta key with no matching peer as a
release blocker.

### A2 · Be explicit about required vs optional

Consumers must be able to answer "must I declare this?" from the manifest alone. Do not leave a peer
required by accident.

### A3 · Never drop or re-point an `exports` subpath in a patch

The exports map is public API. Removing or re-pointing a subpath is **breaking**, regardless of what
the API surface looks like, because it breaks consumer builds. Adding is fine.

### A4 · Ship the CHANGELOG inside the tarball, and tag + release

The changelog must travel with the package so a consumer can read it from `node_modules` without
network access or repo permissions. Every published version gets a matching git tag **and** GitHub
Release. State plainly when a release is behaviour-neutral — *"dependency rename, no behaviour
change"* is exactly what a consumer needs to move fast.

---

## 3 · The organ-bump checklist (consumer, copy-paste)

Run before adopting `<organ>@<new>` — against the published tarball:

```bash
ORGAN=@ancientpantheon/codex ; OLD=0.6.0 ; NEW=0.6.1

# 1. Peers — names AND ranges, plus the meta map (R2, A1)
npm view "$ORGAN@$OLD" peerDependencies peerDependenciesMeta
npm view "$ORGAN@$NEW" peerDependencies peerDependenciesMeta

# 2. Exports subpaths — declared set must not shrink (R4, A3)
npm view "$ORGAN@$OLD" exports
npm view "$ORGAN@$NEW" exports

# 3. Every subpath's target must EXIST in the tarball (R4)
npm pack "$ORGAN@$NEW" --pack-destination /tmp >/dev/null && tar -tzf /tmp/*.tgz | head -50

# 4. Runtime deps + engines drift
npm view "$ORGAN@$NEW" dependencies engines
```

Then in the consuming automaton:

- [ ] Every **required** peer of the new version is declared in the automaton's own `package.json` (R1).
- [ ] Every subpath the automaton imports still resolves (R4) — grep the imports, check the list.
- [ ] `typecheck` clean.
- [ ] **Bundles rebuild** and the server starts (R5) — an install-only check proves nothing.
- [ ] Full test suite green.
- [ ] Deploy and confirm the panel's constructor row actually goes green (`automaton/05` §1c) — the
      only check that proves the *deployed* artifact took the new organ.

---

## 4 · Worked example — Codex 0.6.1 / Khronoton 0.4.2 (2026-07-22)

Both patch releases, verified against the published tarballs:

| Check | codex 0.6.0→0.6.1 | khronoton 0.4.0→0.4.2 |
|---|---|---|
| Exported symbols | 334 → 334 (0 removed, 0 added) | 313 → 313 (0 removed, 0 added) |
| Type declarations | differ only in doc comments | byte-identical |
| React peer range | `^18 \|\| ^19` unchanged | `^18 \|\| ^19` unchanged |
| `exports` subpaths | 7, all resolving | 8, all resolving |
| **Peers** | **RENAMED** `@stoachain/{ouronet-core,dalos-crypto}` → `@ouronet/*` (ranges equivalent) | same rename; `peerDependenciesMeta` key fixed in 0.4.2 |

**Verdict:** a straight version change for consumers — *because* the peer rename was checked (R2)
and every subpath was confirmed to resolve (R4). Had only the exports been diffed, the release would
have looked like a no-op and the peer move would have been discovered later, in someone's CI.

The one open item it left, and the reason R1 exists: the consumer's required
`@ouronet/ouronet-core` peer was satisfied by **npm's auto-peer-install**, not by an explicit
declaration. Reproducible today via the lockfile; fragile under a stricter package manager.

---

## 5 · Invariants — do not break

1. A required peer is **declared by the consumer**, never left to auto-install (R1).
2. `peerDependenciesMeta` keys always match `peerDependencies` keys (A1).
3. An `exports` subpath is public API: never dropped or re-pointed in a patch (A3).
4. Verification is against the **published tarball** (R3).
5. Adopting an organ is **install → rebuild → restart**, never install alone (R5).
6. The proof an organ was adopted is the **deployed** panel row turning green, not a local install.
