import Head from "next/head";
import Link from "next/link";
import { registry, type Entity, type Tier } from "@/data/registry";
import { COMPOSITION } from "@/data/constructors";
import { Composition, Footer, LogoZone, Nav } from "@/components/ui";

const TIERS: { key: Exclude<Tier, "constructor">; label: string; rule: string }[] = [
  {
    key: "automaton",
    label: "Automatons",
    rule: "Autonomous — all three Constructors, triggered by Khronoton. Every action is shown here in real time.",
  },
  {
    key: "daimon",
    label: "Daimons",
    rule: "Human-driven — Pythia + Codex. A person is the animating force.",
  },
  {
    key: "seer",
    label: "Seers",
    rule: "Read-only — Pythia alone. Passive perception.",
  },
];

const LIFECYCLE: Record<Entity["lifecycle"], string> = {
  live: "live",
  building: "building",
  planned: "planned",
};

function Row({ e }: { e: Entity }) {
  return (
    <div className="row">
      <LogoZone name={e.name} logo={e.logo} size={110} />
      <div className="row-body">
        <div className="row-head">
          <span className="row-name">{e.name}</span>
          <span className={`row-life is-${e.lifecycle}`}>{LIFECYCLE[e.lifecycle]}</span>
        </div>
        <p className="row-role">{e.role}</p>
      </div>
      <div className="row-aside">
        {e.links && e.links.length > 0 && (
          <span className="row-links">
            {e.links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            ))}
          </span>
        )}
        <Composition ids={COMPOSITION[e.tier]} />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <Head>
        <title>The Pantheon — Ancient Pantheon observability</title>
        <meta
          name="description"
          content="Public observability for the Ancient Pantheon — every Automaton, Daimon, and Seer, and the three Constructors they are built from."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="page">
        <Nav />

        <header className="hero">
          <div className="eyebrow">pantheon.ancientholdings.eu</div>
          <h1 className="title">The Pantheon</h1>
          <p className="subtitle">
            Public observability for the Ancient Pantheon — every entity, and the
            three Constructors it&apos;s built from.
          </p>
          <p className="trust">
            The bridge is single-operator. Its safety is <em>observable</em>: every
            Automaton&apos;s action is shown here in real time, so anomalies surface
            publicly before they can be denied.
          </p>
        </header>

        <Link href="/constructors" className="callout">
          <Composition ids={["khronoton", "codex", "pythia"]} size={18} />
          <span className="callout-text">
            Built from three Constructors — <b>Pythia</b> · <b>Codex</b> ·{" "}
            <b>Khronoton</b>
          </span>
          <span className="callout-arrow">→</span>
        </Link>

        <div className="legend">
          <span>
            <span className="dot is-live" /> live
          </span>
          <span>
            <span className="dot is-building" /> building
          </span>
          <span>
            <span className="dot is-planned" /> planned
          </span>
        </div>

        <main className="tiers">
          {TIERS.map((t) => {
            const items = registry.filter((e) => e.tier === t.key);
            return (
              <section key={t.key} className={`tier tier-${t.key}`}>
                <div className="tier-head">
                  <h2>
                    {t.label}
                    <span className="count">{items.length}</span>
                  </h2>
                  <div className="tier-rule">
                    <Composition ids={COMPOSITION[t.key]} size={26} />
                    <span>{t.rule}</span>
                  </div>
                </div>
                <div className="rows">
                  {items.map((e) => (
                    <Row key={e.name} e={e} />
                  ))}
                </div>
              </section>
            );
          })}
        </main>

        <Footer />
      </div>
    </>
  );
}
