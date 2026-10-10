/**
 * Non-régression mémoire (npm run bench) : des centaines de recalculs ne doivent pas faire croître
 * la mémoire WASM sans limite (voir docs/performance.md, « Mémoire »).
 */
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DISPLAY_MESH } from '../../src/domain/tolerances';
import { RecomputeEngine } from '../../src/features/engine';
import { loadOpenCascade } from '../../src/geometry/occt/loader';
import { OcctKernel } from '../../src/geometry/occt/occt-kernel';
import { meshOptionsFor } from '../../src/workers/geometry-service';
import { buildPlateDocument, setDimension } from '../helpers/plate';

it('la mémoire WASM se stabilise après de nombreux recalculs', async () => {
  const kernel = new OcctKernel(await loadOpenCascade());
  const { doc, ids } = buildPlateDocument();
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const marks: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const [part] = engine.evaluateDocument(setDimension(doc, ids.sketch1, ids.widthConstraint, 60 + (i % 50) * 0.5));
    // Comme le worker : maillage d'affichage de chaque nouveau résultat.
    engine.meshOf(part!, meshOptionsFor(part!.analysis!.bbox, DISPLAY_MESH));
    if (i % 250 === 249) marks.push(kernel.memoryBytes() / 2 ** 20);
  }
  writeFileSync('tests/output/memory.json', JSON.stringify({ evaluations: 1500, wasmMiBEvery250: marks }, null, 2));
  // Après la mise en route, la mémoire ne doit plus augmenter.
  expect(marks[marks.length - 1]! - marks[1]!).toBeLessThanOrEqual(32);
}, 900_000);
