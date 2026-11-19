import type { Metadata } from 'next';
import {
  WeatherRunDiagram,
  quickStartDemoPath,
  quickStartFlowchartPath,
} from '@/components/AgentFlowchart';
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
    </main>
  );
}
