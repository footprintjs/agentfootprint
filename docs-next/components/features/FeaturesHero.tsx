'use client';

import { FEATURE_BEATS, FEATURES_TAGLINE } from '@/lib/features/beats';

/**
 * The /features hero: the eight verbs as a numbered grid that IS the page's in-page nav, and the
 * tagline — the page's actual promise, so it's the <h1> — settling last.
 *
 * Heading outline: one <h1> (the tagline) + eight <h2>s (the beat verbs, in Beat.tsx). The verb
 * grid is a <nav>, not a heading, because that is what it does.
 *
 * Why a client component for what looks like eight anchors: the jump has to be smooth AND land
 * under the sticky site header. Plain `href="#build"` gives neither — global.css deliberately keeps
 * `scroll-behavior` instant on <html> (the home page is 30 screens tall; a smooth jump would
 * animate THROUGH every pinned animation), and the global `scroll-padding-top` is sized for the
 * home page's chapter rail, which this page doesn't have. So the click scrolls explicitly: smooth,
 * offset by the real measured header height, and instant when the visitor asks for reduced motion.
 *
 * The `href` stays on the element, so each verb is a real link — focusable, middle-clickable, and
 * still functional if the JS never runs (`preventDefault` happens only inside the handler).
 */
export function FeaturesHero() {
  const jump = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    // let the browser handle modified clicks (new tab/window) exactly as it would any link
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();

    const header = document.getElementById('af-header');
    const offset = (header?.offsetHeight ?? 56) + 8;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY - offset,
      behavior: reduce ? 'auto' : 'smooth',
    });
    // keep the URL shareable / back-navigable without letting the browser re-jump
    history.replaceState(null, '', `#${id}`);
  };

  return (
    <section className="aff-hero">
      <div className="aff-eyebrow">agentfootprint</div>
      <nav className="aff-verbgrid" aria-label="The eight features">
        {FEATURE_BEATS.map((beat) => (
          <a
            key={beat.id}
            className="aff-verb"
            href={`#${beat.id}`}
            onClick={(e) => jump(e, beat.id)}
          >
            <span className="aff-verb-ix">{beat.ix}</span>
            <span className="aff-verb-word">{beat.verb}</span>
          </a>
        ))}
      </nav>
      <h1 className="aff-tagline">{FEATURES_TAGLINE}</h1>
    </section>
  );
}
