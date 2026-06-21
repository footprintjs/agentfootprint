import { ImageResponse } from 'next/og';
import { SITE } from '@/lib/site';

// Branded 1200×630 social card, prerendered to a static PNG at build time.
export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0e0e12',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* top: wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              width: 0,
              height: 0,
              borderLeft: '26px solid transparent',
              borderRight: '26px solid transparent',
              borderBottom: '44px solid #ffc700',
            }}
          />
          <div style={{ display: 'flex', fontSize: 38, fontWeight: 800, color: '#f5f3ec' }}>
            <span style={{ color: '#9a958a' }}>agent</span>
            <span>footprint</span>
          </div>
        </div>

        {/* middle: headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 68, fontWeight: 800, color: '#f5f3ec', lineHeight: 1.05, maxWidth: 980 }}>
            Find the context that made your agent answer wrong.
          </div>
          <div style={{ display: 'flex', fontSize: 32, color: '#b8b3a8', maxWidth: 900 }}>
            The explainable AI-agent framework. Why is a query, not a guess.
          </div>
        </div>

        {/* bottom: tagline + install */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: '#ffc700' }}>
            Inject less. Trace more.
          </div>
          <div style={{ display: 'flex', fontSize: 26, color: '#8c887e', fontFamily: 'monospace' }}>
            npm i agentfootprint
          </div>
        </div>
      </div>
    ),
    size,
  );
}
