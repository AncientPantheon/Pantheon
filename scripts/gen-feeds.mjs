// Build-time feed generator. The footer and README advertise machine-readable
// feeds at /feed.json and /feed.rss so independent monitors can build their own
// alerts on top of the Pantheon. Those files are derived entirely from the same
// registry + constructor data the site renders, so we generate them here rather
// than hand-maintaining a second copy that would drift.
//
// Runs on `predev` and `prebuild` (see package.json), writing into /public so
// the static export copies them verbatim. Output is gitignored — it is a pure
// function of data/registry.ts + data/constructors.ts.
//
// Node imports the .ts data directly: type-stripping is on by default in Node
// 22.18+/24, and the only alias import in those files is a type-only import
// (erased at load), so no @/ path resolution is needed at runtime.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { registry } from "../data/registry.ts";
import { constructors } from "../data/constructors.ts";

const SITE = "https://pantheon.ancientholdings.eu";
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "../public");

// One flat list of everything the Pantheon enshrines: the three Constructors
// first (the headline primitives), then the composed entities. Each becomes one
// feed item carrying its tier, lifecycle, role, and best canonical link.
function bestLink(links) {
  if (!links?.length) return undefined;
  const by = (label) => links.find((l) => l.label === label)?.href;
  return by("site") ?? by("repo") ?? links[0].href;
}

const items = [
  ...constructors.map((c) => ({
    name: c.name,
    tier: "constructor",
    lifecycle: c.lifecycle,
    role: c.role,
    url: c.site ?? c.repo,
  })),
  ...registry.map((e) => ({
    name: e.name,
    tier: e.tier,
    lifecycle: e.lifecycle,
    role: e.role,
    url: bestLink(e.links),
    statusEndpoint: e.statusEndpoint,
  })),
];

// A stable per-entity permalink into the Pantheon (anchor on the relevant page).
function permalink(item) {
  const anchor = encodeURIComponent(item.name);
  return item.tier === "constructor"
    ? `${SITE}/constructors/#${anchor}`
    : `${SITE}/#${anchor}`;
}

// ── JSON Feed 1.1 (https://jsonfeed.org/version/1.1) ────────────────────────
const jsonFeed = {
  version: "https://jsonfeed.org/version/1.1",
  title: "Ancient Pantheon",
  home_page_url: `${SITE}/`,
  feed_url: `${SITE}/feed.json`,
  description:
    "Every entity in the StoaChain / Ouronet ecosystem — Constructors, " +
    "Automatons, Daimons, and Seers — with its tier, lifecycle, and role.",
  items: items.map((item) => ({
    id: permalink(item),
    url: item.url ?? permalink(item),
    title: `${item.name} — ${item.tier}`,
    content_text: item.role,
    _pantheon: {
      tier: item.tier,
      lifecycle: item.lifecycle,
      ...(item.statusEndpoint ? { status_endpoint: item.statusEndpoint } : {}),
    },
  })),
};

// ── RSS 2.0 ─────────────────────────────────────────────────────────────────
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const rssItems = items
  .map((item) => {
    const link = item.url ?? permalink(item);
    return [
      "    <item>",
      `      <title>${xmlEscape(`${item.name} — ${item.tier}`)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      `      <guid isPermaLink="false">${xmlEscape(permalink(item))}</guid>`,
      `      <category>${xmlEscape(item.tier)}</category>`,
      `      <category domain="lifecycle">${xmlEscape(item.lifecycle)}</category>`,
      `      <description>${xmlEscape(item.role)}</description>`,
      "    </item>",
    ].join("\n");
  })
  .join("\n");

const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Ancient Pantheon</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/feed.rss" rel="self" type="application/rss+xml" />
    <description>Every entity in the StoaChain / Ouronet ecosystem — Constructors, Automatons, Daimons, and Seers — with its tier, lifecycle, and role.</description>
    <generator>pantheon gen-feeds</generator>
${rssItems}
  </channel>
</rss>
`;

writeFileSync(resolve(publicDir, "feed.json"), JSON.stringify(jsonFeed, null, 2) + "\n");
writeFileSync(resolve(publicDir, "feed.rss"), rssFeed);

console.log(`gen-feeds: wrote feed.json + feed.rss (${items.length} entities) to public/`);
