import React from "react";
import Link from "next/link";
import { constructors, type ConstructorId } from "@/data/constructors";

const ICON_PATHS: Record<ConstructorId, React.ReactNode> = {
  // eye
  pythia: (
    <>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // key
  codex: (
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  ),
  // clock
  khronoton: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </>
  ),
};

export function ConstructorIcon({
  id,
  size = 44,
}: {
  id: ConstructorId;
  size?: number;
}) {
  const c = constructors.find((x) => x.id === id);
  if (!c) return null;
  const glyph = Math.round(size * 0.52);
  return (
    <span
      className="cicon"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.22)),
        color: c.color,
      }}
      title={`${c.name} — ${c.tagline}`}
    >
      {c.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.logo} alt={`${c.name} logo`} className="logo-img" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          width={glyph}
          height={glyph}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-label={c.name}
        >
          {ICON_PATHS[id]}
        </svg>
      )}
    </span>
  );
}

// Deterministic hue from a name — gives every entity a stable, distinct accent
// even before a real logo file exists. Same name → same colour, every render.
function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return h;
}

/**
 * Square identity zone shown at the left of an entry. Renders the entity's
 * logo image when `logo` is set, otherwise a generated monogram tile so each
 * entity carries its own identity from day one.
 */
export function LogoZone({
  name,
  logo,
  size = 44,
}: {
  name: string;
  logo?: string;
  size?: number;
}) {
  const radius = Math.round(size * 0.16);
  if (logo) {
    return (
      <span className="logo-zone" style={{ width: size, height: size, borderRadius: radius }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={`${name} logo`} className="logo-img" />
      </span>
    );
  }
  const hue = hueFromName(name);
  const initial = name.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase() || "◆";
  return (
    <span
      className="logo-zone logo-mono"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.42),
        color: `hsl(${hue} 70% 68%)`,
        background: `hsl(${hue} 55% 12%)`,
        borderColor: `hsl(${hue} 45% 30%)`,
      }}
      aria-label={`${name} logo`}
      title={name}
    >
      {initial}
    </span>
  );
}

export function Composition({ ids, size }: { ids: ConstructorId[]; size?: number }) {
  return (
    <span className="composition">
      {ids.map((id) => (
        <ConstructorIcon key={id} id={id} size={size} />
      ))}
    </span>
  );
}

export function Nav() {
  return (
    <nav className="nav">
      <Link href="/" className="nav-brand">
        <span className="nav-star">✦</span> Pantheon
      </Link>
      <div className="nav-links">
        <Link href="/">Entities</Link>
        <Link href="/constructors">Constructors</Link>
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-links">
        <a href="/feed.json">feed.json</a>
        <a href="/feed.rss">feed.rss</a>
        <a href="https://github.com/AncientPantheon" target="_blank" rel="noreferrer">
          github ↗
        </a>
      </div>
      <div className="foot-note">AncientPantheon · observably-trusted</div>
    </footer>
  );
}
