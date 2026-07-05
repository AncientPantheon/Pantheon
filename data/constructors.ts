// The three Constructors — the chain-agnostic primitives every entity composes.
// Each has a signature colour + thematic glyph used as the composition badge
// on every entity, and its own detail on the /constructors page.

import type { Lifecycle, Tier } from "@/data/registry";

export type ConstructorId = "pythia" | "codex" | "khronoton";

export interface ConstructorMeta {
  id: ConstructorId;
  name: string;
  /** thematic glyph name, e.g. "the eye" */
  glyph: string;
  /** one-word essence, e.g. "reads" */
  tagline: string;
  /** full role for the Constructors page */
  role: string;
  color: string;
  /** Optional path to a square logo (e.g. "/logos/pythia.svg") from /public.
   * When absent, the thematic glyph stands in. */
  logo?: string;
  /** Optional portrait/identity image (e.g. "/constructors/pythia.jpg") from
   * /public, shown in the photo zone at the bottom of the card. */
  photo?: string;
  npm: string;
  repo: string;
  site?: string;
  lifecycle: Lifecycle;
}

export const constructors: ConstructorMeta[] = [
  {
    id: "pythia",
    name: "Pythia",
    glyph: "the eye",
    tagline: "reads",
    role:
      "Multi-chain read gateway — the ecosystem's eyes and ears. Answers “what is the state of the world?” across chain state and the external world.",
    color: "#f0a500",
    npm: "@ancientpantheon/pythia-client",
    repo: "https://github.com/AncientPantheon/Pythia",
    site: "https://pythia.ancientholdings.eu",
    photo: "/constructors/pythia.jpg",
    lifecycle: "live",
  },
  {
    id: "codex",
    name: "Codex",
    glyph: "the key",
    tagline: "signs",
    role:
      "Multi-chain wallet primitive — holds seeds encrypted at rest and signs transactions, chain-aware. The universal transaction layer.",
    color: "#4aa8ff",
    npm: "@ancientpantheon/codex-core",
    repo: "https://github.com/AncientPantheon/Codex",
    photo: "/constructors/codex.jpg",
    lifecycle: "building",
  },
  {
    id: "khronoton",
    name: "Khronoton",
    glyph: "the heartbeat",
    tagline: "time",
    role:
      "Scheduler / trigger primitive — fires actions on time-based intervals or event-based triggers. What makes an Automaton move on its own.",
    color: "#a888ff",
    npm: "@ancientpantheon/khronoton-core",
    repo: "https://github.com/AncientPantheon/Khronoton",
    photo: "/constructors/khronoton.jpg",
    lifecycle: "live",
  },
];

/** Which Constructors each tier composes (the architecture, made visible).
 * Ordered so Pythia is always rightmost and Codex next — right-aligned in the
 * UI, this makes the three primitives line up into consistent columns across
 * every entry (Khronoton · Codex · Pythia). */
export const COMPOSITION: Record<Tier, ConstructorId[]> = {
  constructor: [],
  automaton: ["khronoton", "codex", "pythia"],
  daimon: ["codex", "pythia"],
  seer: ["pythia"],
};
