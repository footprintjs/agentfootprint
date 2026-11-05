'use client';

import { useMemo } from 'react';
import type { FeatureId } from '@/lib/features/beats';
import { SceneFrame } from '../home/stand/SceneFrame';

/* Every scene has finished by here. */
const LENGTH = 2.14;

export function FeatureScene({ id }: { id: FeatureId }) {
  const load = useMemo(
    () => () =>
      import('./sceneEngine').then(
        ({ FeatureScenes }) =>
          (canvas: HTMLCanvasElement) =>
            new FeatureScenes(canvas, id),
      ),
    [id],
  );
  return <SceneFrame load={load} labels={null} from={0} to={LENGTH} />;
}
