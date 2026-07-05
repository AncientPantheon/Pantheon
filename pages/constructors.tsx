import Head from "next/head";
import { constructors } from "@/data/constructors";
import { Composition, ConstructorIcon, Footer, Nav } from "@/components/ui";

export default function ConstructorsPage() {
  return (
    <>
      <Head>
        <title>Constructors — The Pantheon</title>
        <meta
          name="description"
          content="The three chain-agnostic primitives every Pantheon entity is built from — Pythia (reads), Codex (signs), Khronoton (time)."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="page">
        <Nav />

        <header className="hero hero-sub">
          <div className="eyebrow">the primitives</div>
          <h1 className="title title-sub">The Constructors</h1>
          <p className="subtitle">
            The three chain-agnostic primitives every entity is built from — reads,
            keys, and time.
          </p>
        </header>

        <div className="cgrid">
          {constructors.map((c) => (
            <article key={c.id} className="ccard" style={{ borderTopColor: c.color }}>
              <div className="ccard-top">
                <ConstructorIcon id={c.id} size={52} />
                <div className="ccard-id">
                  <h3 className="ccard-name">{c.name}</h3>
                  <div className="ccard-tag">
                    {c.glyph} · {c.tagline}
                  </div>
                </div>
                <span className={`tag is-${c.lifecycle}`}>{c.lifecycle}</span>
              </div>
              <p className="ccard-role">{c.role}</p>
              <div className="tile-meta">
                <code className="npm">{c.npm}</code>
              </div>
              <div className="tile-links">
                <a href={c.repo} target="_blank" rel="noreferrer">
                  repo ↗
                </a>
                {c.site && (
                  <a href={c.site} target="_blank" rel="noreferrer">
                    site ↗
                  </a>
                )}
              </div>
              <div className="ccard-photo" style={{ borderColor: `${c.color}33` }}>
                {c.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo} alt={`${c.name} — ${c.glyph}`} />
                ) : (
                  <div className="ccard-photo-ph" style={{ color: c.color }}>
                    <ConstructorIcon id={c.id} size={40} />
                    <span>portrait coming soon</span>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <section className="comp-note">
          <h2>How they compose</h2>
          <p className="comp-lead">
            Every entity is a composition of these primitives — you can read its kind
            off the icons.
          </p>
          <div className="comp-rows">
            <div className="comp-row">
              <Composition ids={["khronoton", "codex", "pythia"]} size={18} />
              <span>
                <b>Automaton</b> — all three, autonomous (Khronoton-triggered).
              </span>
            </div>
            <div className="comp-row">
              <Composition ids={["codex", "pythia"]} size={18} />
              <span>
                <b>Daimon</b> — Pythia + Codex, human-driven.
              </span>
            </div>
            <div className="comp-row">
              <Composition ids={["pythia"]} size={18} />
              <span>
                <b>Seer</b> — Pythia alone, read-only.
              </span>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
