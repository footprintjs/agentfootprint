import Link from 'next/link';
import type { Metadata } from 'next';
import { Chapters } from '@/components/home/Chapters';
import { ChapterRail } from '@/components/home/ChapterRail';
import { HeroTrace } from '@/components/home/HeroTrace';
import {
  HomeViewProvider,
  HomeViewSwitcher,
  HomeViewText,
} from '@/components/home/HomeView';
import { SiteFooter } from '@/components/SiteFooter';
import { siteJsonLd } from '@/lib/jsonld';
import { SITE, asset } from '@/lib/site';
import './home.css';

const HOME_TITLE = 'agentfootprint — Find the context that made your agent answer wrong';
const HOME_DESC =
  'The explainable agent framework. When an agent takes a decision a person used to make, the reasoning stops surviving — so every run records its own causal trace, states what it could not check, and lets you confirm a cause by re-running without it. Why is a query, not a guess.';

export const metadata: Metadata = {
  // `absolute` bypasses the layout's "%s · agentfootprint" template — the home title
  // already leads with the brand, so we don't want it appended twice.
  title: { absolute: HOME_TITLE },
  description: HOME_DESC,
  alternates: { canonical: `${SITE.url}/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/`,
    siteName: SITE.name,
    title: HOME_TITLE,
    description: HOME_DESC,
    images: [{ url: `${SITE.url}/opengraph-image`, width: 1200, height: 630, alt: HOME_TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    site: SITE.twitter,
    creator: SITE.twitter,
    title: HOME_TITLE,
    description: HOME_DESC,
    images: [`${SITE.url}/opengraph-image`],
  },
};

// Structured data lives in lib/jsonld.ts (siteJsonLd) so the SAME author/org/software graph
// renders on the home page AND every docs page — one source of truth.

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <HomeViewProvider>
      <main className="af-home">
        {/* eslint-disable-next-line react/no-danger */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }} />
        <HomeViewSwitcher />
      {/* hero — mascot centered on top, then two columns: the claim (left) + live trace (right) */}
      <section className="af-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/mascot-400.webp')}
          srcSet={`${asset('/mascot-200.webp')} 200w, ${asset('/mascot-400.webp')} 400w`}
          sizes="(max-width: 600px) 160px, 200px"
          width={400}
          height={400}
          alt="agentfootprint mascot — it pulls scattered context in and hands back clean, traceable slots"
          className="af-hero-mascot"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        <div className="af-hero-grid">
          <div className="af-hero-text">
            <span className="af-pill">
              <span className="af-pill-dot" /> open source · MIT · mock-first
            </span>
            <h1>
              <HomeViewText
                product={<>Your agent decides what a person used to. <em>Only one of them leaves a reason.</em></>}
                technical={<>Context provenance for every <em>agent decision.</em></>}
              />
            </h1>
            <p className="lede">
              <HomeViewText
                product={<>When a human held that seat, the reason came with the decision. Now it doesn&apos;t. agentfootprint records why the agent decided what it did, states what it could not check, and proves a fix by re-running without the cause.</>}
                technical={<>Record context injections, model calls, tool decisions, state, and cost as typed evidence you can slice, ablate, and replay — beside a coverage ledger that states what was never checked, and refusals where the answer would have been a guess.</>}
              />
            </p>
            <p className="tagline">
              <HomeViewText
                product={<><em>Why</em> is a query, not a guess.</>}
                technical={<>Inline recording is truth. <em>Post-processing is reconstruction.</em></>}
              />
            </p>
            <div className="af-hero-cta">
              <Link className="af-cta" href="/docs" prefetch={false}>
                Get started →
              </Link>
              <Link className="af-cta-ghost" href="https://github.com/footprintjs/agentfootprint">
                <GitHubMark /> Star on GitHub
              </Link>
            </div>
          </div>
          <div className="af-hero-visual">
            <HeroTrace />
            <div className="af-codepeek" aria-hidden="true">
              <div className="af-codepeek-install">
                <span className="pr">$</span> npm i agentfootprint
              </div>
              <div className="af-codepeek-code">
                <div className="af-cp-line"><span className="k">const</span> agent = Agent.<span className="m">create</span>(<span className="s2">{'{ provider, model }'}</span>)</div>
                <div className="af-cp-line af-cp-i">.<span className="m">system</span>(<span className="s">{`'You are a refunds agent.'`}</span>)</div>
                <div className="af-cp-line af-cp-i">.<span className="m">skill</span>(billing)</div>
                <div className="af-cp-line af-cp-i">.<span className="m">build</span>();</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* value band — the outcome props, full-width below the hero */}
      <section className="af-valueband">
        <p className="af-value-tag">
          <HomeViewText
            product={<>Inject less. <em>Trace more.</em></>}
            technical={<>Record inline. <em>Debug causally.</em></>}
          />
        </p>
        <div className="af-valuestrip">
          <div className="af-vs">
            <HomeViewText
              product={<><b>Faster debugging</b><span>trace any answer to its exact cause</span></>}
              technical={<><b>Typed provenance</b><span>keep each context source attached to the call it shaped</span></>}
            />
          </div>
          <div className="af-vs">
            <HomeViewText
              product={<><b>Provable cause</b><span>proven by replay, not guessed</span></>}
              technical={<><b>Backward slicing</b><span>trace an output through decisions to influencing context</span></>}
            />
          </div>
          <div className="af-vs">
            <HomeViewText
              product={<><b>Lower token cost</b><span>context shrinks to what the step needs</span></>}
              technical={<><b>Counterfactual replay</b><span>remove a source, rerun, and measure what changed</span></>}
            />
          </div>
        </div>
      </section>

      {/* the business case — the one band on this page that is deliberately audience-neutral.
          Product and Technical are two ways of describing the same machinery; this is the
          argument that pays for it, and it reads the same to either reader, so it uses no
          HomeViewText. Copy derives from docs/design/product-narrative.md (canon) and follows
          its honesty rule: the case study is named as customer-reported and the general claim
          is left open until the 2×2 comparison is actually run. */}
      <section className="af-buscase" id="af-business-case" aria-labelledby="af-buscase-h">
        <span className="af-pill">
          <span className="af-pill-dot" /> the business case
        </span>
        <h2 id="af-buscase-h" className="af-bc-head">
          Structure, where a <em>bigger model</em> used to be.
        </h2>
        <p className="af-bc-statement">
          agentfootprint helps AI-product teams achieve equal or better response quality with
          lower-cost models by dynamically loading the right procedures and tools — and provides
          the infrastructure to deploy, debug, and scale that behavior.
        </p>

        <table className="af-bc-chain">
          <caption className="af-bc-caption">The value chain</caption>
          <thead>
            <tr>
              <th scope="col">Layer</th>
              <th scope="col">The customer&apos;s situation</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">End-customer benefit</th>
              <td>Higher-quality responses</td>
            </tr>
            <tr>
              <th scope="row">Business outcome</th>
              <td>Equal or better quality using a lower-cost model</td>
            </tr>
            <tr>
              <th scope="row">Mechanism</th>
              <td>
                The skill graph selects the operating procedure and exposes only the relevant
                tools, instead of showing the model dozens of tools at once
              </td>
            </tr>
            <tr>
              <th scope="row">Supporting activity</th>
              <td>
                Infrastructure to integrate, deploy, debug, and scale that behavior — roughly 20
                lines of declarations instead of hundreds of lines of hand-written orchestration
              </td>
            </tr>
            <tr>
              <th scope="row">Economic benefit</th>
              <td>Lower model spend, less engineering time, lower cognitive load</td>
            </tr>
          </tbody>
        </table>

        {/* the reconfiguration, side by side. Two stacked lists rather than one ASCII block:
            the same four steps, but they reflow on a phone instead of scrolling sideways. */}
        <div className="af-bc-diagram">
          <figure className="af-bc-side">
            <figcaption>Before</figcaption>
            <ol>
              <li>flat ~40-tool surface</li>
              <li>frontier model</li>
              <li>substantial orchestration code</li>
              <li>high inference + engineering cost</li>
            </ol>
          </figure>
          <span className="af-bc-turn" aria-hidden="true">
            →
          </span>
          <figure className="af-bc-side af-bc-after">
            <figcaption>After</figcaption>
            <ol>
              <li>task → relevant skill-graph node</li>
              <li>relevant procedure + small tool surface</li>
              <li>lower-cost model</li>
              <li>better observed response</li>
            </ol>
          </figure>
        </div>
        <p className="af-bc-note">
          The line count is the demonstration, not the point. The runtime takes the activity
          over: you describe the graph and its rules, it performs the per-iteration
          orchestration — and records why every handoff happened.
        </p>

        <blockquote className="af-bc-evidence">
          <p>
            In one customer implementation, replacing a flat ~40-tool agent that required a
            frontier model with the dynamic skill graph enabled a lower-cost model to produce
            better evaluated responses at lower operating cost.
          </p>
          <footer>
            That is a <b>customer-reported case study</b>, not a controlled benchmark. The general
            claim needs the 2×2 — flat tool surface vs. skill graph × small model vs. frontier
            model, scored on cost per successful task, never token cost alone. Until that
            comparison is run, this page says nothing stronger.
          </footer>
        </blockquote>

        <p className="af-bc-more">
          Every library in the family makes the same trade.{' '}
          <a href="https://footprintjs.github.io/?view=business">
            The ecosystem through the business lens →
          </a>
        </p>
      </section>

      <div className="af-scrollcue-wrap">
        <p className="af-bridge-line">
          <HomeViewText
            product={<>Don&apos;t take the claim on faith. Scroll the story — a wrong answer <b>traced to its cause</b>, <b>the context</b> that built it, and <b>the engine</b> that recorded it all.</>}
            technical={<>Follow the full provenance path: <b>backward slice</b> a wrong output, inspect the <b>slot × trigger × cache</b> model, then see how the <b>runtime records evidence inline</b>.</>}
          />
        </p>
        <div className="af-scrollcue" aria-hidden="true">
          scroll the story
          <svg className="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* home-only sticky jump-nav, then the storyboard — 01 problem · 02 solution · 03 benefits · 04 how · 05 payoff */}
      <ChapterRail />
      <Chapters />

      {/* attribution footer — shared with docs (components/SiteFooter); recap + CTA live in ch05 */}
      <SiteFooter />
      </main>
    </HomeViewProvider>
  );
}
