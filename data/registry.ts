// The Pantheon entity registry — the COMPOSED entities (Automatons, Daimons,
// Seers). The three Constructors themselves live in data/constructors.ts and
// have their own page. Config-driven: edit here + redeploy; no code change.
// Seed data from StoaOuronet/MIGRATION-HANDOFF-Pantheon.md (canonical taxonomy).

export type Tier = "constructor" | "automaton" | "daimon" | "seer";
export type Lifecycle = "live" | "building" | "planned";

export interface EntityLink {
  label: string;
  href: string;
}

export interface Entity {
  name: string;
  tier: Tier;
  /** One-line role. */
  role: string;
  /** Optional live status endpoint (wired in a later pass; drives the dot when present). */
  statusEndpoint?: string;
  lifecycle: Lifecycle;
  /**
   * Optional path to a square logo (e.g. "/logos/caduceus.svg"), served from
   * /public. When absent, a generated monogram stands in for identity.
   */
  logo?: string;
  links?: EntityLink[];
}

export const registry: Entity[] = [
  // ── Automatons — autonomous mechanisms · repo / site / activity ─────────────
  {
    name: "Caduceus",
    tier: "automaton",
    role:
      "The autonomous execution loop of the Ouronet ↔ foreign-chain bridge. It watches both sides for lock and burn events, then mints or releases the mirrored assets on the opposite chain — every action published here in real time so the bridge's behaviour is auditable the moment it happens.",
    statusEndpoint: "https://caduceus.ancientholdings.eu/automaton/status",
    lifecycle: "planned",
    links: [
      { label: "repo", href: "https://github.com/StoaChain/Caduceus" },
      { label: "site", href: "https://caduceus.ancientholdings.eu" },
      { label: "activity", href: "https://explorer.stoachain.com/automaton/caduceus" },
    ],
  },
  {
    name: "Aletheia",
    tier: "automaton",
    role:
      "The price-oracle Automaton. On a fixed schedule it reads market data through Pythia, signs the result with the Codex, and publishes the canonical price on-chain — a steady heartbeat of verifiable truth the rest of the ecosystem prices against.",
    statusEndpoint: "https://aletheia.ancientholdings.eu/automaton/status",
    lifecycle: "planned",
    links: [
      { label: "repo", href: "https://github.com/AncientPantheon/Aletheia" },
      { label: "site", href: "https://aletheia.ancientholdings.eu" },
      { label: "activity", href: "https://explorer.stoachain.com/automaton/aletheia" },
    ],
  },
  {
    name: "Dalos",
    tier: "automaton",
    role:
      "The hub's autonomous agent. It drives StoicPower mints, settles pool payments, and issues Ouroboros mints on schedule — the mechanical heart that keeps the hub's economy moving without a human ever touching the lever.",
    lifecycle: "planned",
    links: [
      { label: "site", href: "https://dalos.ancientholdings.eu" },
      { label: "activity", href: "https://explorer.stoachain.com/automaton/dalos" },
    ],
  },
  {
    name: "Mnemosyne",
    tier: "automaton",
    role:
      "The codex vault's autonomous agent. It provisions new codices, rotates keys on a cadence, and runs recovery flows when a seed must be re-derived — the ecosystem's custodian of memory, handling custody so no human has to hold the keys.",
    lifecycle: "planned",
    links: [
      { label: "repo", href: "https://github.com/OuroborosNetwork/Mnemosyne" },
      { label: "activity", href: "https://explorer.stoachain.com/automaton/mnemosyne" },
    ],
  },

  // ── Daimons — human-driven agents · repo / site ─────────────────────────────
  {
    name: "OuronetUI",
    tier: "daimon",
    role:
      "The Ouronet web wallet and dApp surface. A person clicks; the Codex signs. It is the primary human doorway into the ecosystem — balances, transfers, staking, and contract calls gathered into one interface, with a real operator behind every transaction.",
    lifecycle: "live",
    links: [
      { label: "repo", href: "https://github.com/DemiourgosHoldings/OuronetUI" },
      { label: "site", href: "https://wallet.ouro.network" },
    ],
  },
  {
    name: "StoaWallet",
    tier: "daimon",
    role:
      "A browser-extension wallet that injects a Codex-backed signing API into any dApp. Sites request signatures the familiar way, but each action is chain-aware and only ever executes once the human approves it in the extension popup.",
    lifecycle: "building",
    links: [
      { label: "repo", href: "https://github.com/DemiourgosHoldings/StoaWallet" },
      { label: "chrome store", href: "https://chromewebstore.google.com" },
    ],
  },
  {
    name: "StreamingPlatform",
    tier: "daimon",
    role:
      "An upcoming video-streaming product where every consumer is quietly handed a codex through Mnemosyne. Payments, subscriptions, and creator payouts all settle on-chain behind a streaming experience that feels completely ordinary to the viewer.",
    lifecycle: "planned",
  },

  // ── Seers — read-only observers · repo / site ───────────────────────────────
  {
    name: "StoaExplorer",
    tier: "seer",
    role:
      "The StoaChain block explorer — pure read-only perception. Blocks, transactions, accounts, and contract state surfaced for anyone to inspect, with no key and no signature ever required. It only ever looks; it never acts.",
    lifecycle: "live",
    links: [
      { label: "repo", href: "https://github.com/StoaChain/StoaExplorer" },
      { label: "site", href: "https://explorer.stoachain.com" },
    ],
  },
  {
    name: "OuronetExplorer",
    tier: "seer",
    role:
      "The Ouronet-specific explorer, still a work in progress. It decodes accounts, contracts, and StoicPower events into a human-readable view — the same read-only lens as StoaExplorer, tuned to Ouronet's own semantics.",
    lifecycle: "live",
    links: [
      { label: "repo", href: "https://github.com/StoaChain/OuronetExplorer" },
      { label: "site", href: "https://explorer.ouro.network" },
    ],
  },
];
