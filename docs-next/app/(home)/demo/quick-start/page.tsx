import type { Metadata } from 'next';
import {
  WeatherRunDiagram,
  quickStartDemoPath,
  quickStartFlowchartPath,
} from '@/components/AgentFlowchart';
import { dynamicReactViews } from '@/components/DynamicReactFigure';
import { skillGraphViews } from '@/components/SkillGraphFigure';
import { replayDemoViews } from '@/lib/replay-demo';
import { abs, asset } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Quick Start weather trace',
  description: 'The recorded run of the Quick Start mock weather agent.',
  alternates: { canonical: abs(quickStartDemoPath) },
};

export default function QuickStartWeatherFallback() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <p>
        <a className="underline" href={asset(quickStartFlowchartPath)}>
          ← Back to Quick Start
        </a>
      </p>
      <h1 className="mt-4 text-3xl font-semibold">Quick Start weather trace</h1>
      <p className="mt-4">
        The interactive viewer is unavailable on this deployment. The diagram below shows the
        recorded mock run, including the LLM context slots and the weather-tool loop.
      </p>
      <WeatherRunDiagram />
      {Object.values(skillGraphViews).map(({ id, title, guide }) => (
        <section key={id} id={id} className="mt-8 scroll-mt-24">
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="mt-3">The interactive viewer is unavailable on this deployment.</p>
          <p className="mt-2"><a className="underline" href={asset(guide)}>See the recorded skill graph in the guide</a></p>
        </section>
      ))}
      {[...Object.values(dynamicReactViews), ...Object.values(replayDemoViews)].map(({ id, title, guide, fallback }) => (
        <section key={id} id={id} className="mt-8 scroll-mt-24">
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="mt-3">The interactive viewer is unavailable on this deployment.</p>
          <p className="mt-2"><a className="underline" href={asset(guide)}>{fallback}</a></p>
        </section>
      ))}
    </main>
  );
}
