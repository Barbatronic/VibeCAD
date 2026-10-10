/**
 * Mesures de durée et de mémoire (npm run bench). Résultats : tests/output/bench.json et
 * tableau dans la console. Les valeurs de référence sont reportées dans docs/performance.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makeSketchFeature } from '../../src/domain/document';
import { DISPLAY_MESH } from '../../src/domain/tolerances';
import { RecomputeEngine } from '../../src/features/engine';
import { loadOpenCascade } from '../../src/geometry/occt/loader';
import { OcctKernel } from '../../src/geometry/occt/occt-kernel';
import { addConstraint, addRectangle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { meshOptionsFor } from '../../src/workers/geometry-service';
import { buildPlateDocument, setDimension } from '../helpers/plate';

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  return { mean: +mean.toFixed(2), median: +sorted[Math.floor(sorted.length / 2)]!.toFixed(2), max: +sorted[sorted.length - 1]!.toFixed(2), n: samples.length };
}

function time(fn: () => void, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return out;
}

it('mesures de référence', async () => {
  const results: Record<string, unknown> = {};
  results.machine = {
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
    platform: `${os.type()} ${os.release()}`,
    node: process.version,
    date: new Date().toISOString(),
  };

  const t0 = performance.now();
  const oc = await loadOpenCascade();
  const kernel = new OcctKernel(oc);
  results.kernelInitMs = +(performance.now() - t0).toFixed(1);
  const memStart = kernel.memoryBytes();

  const { doc, ids } = buildPlateDocument();
  const noRes = { get: () => undefined };

  // Recalcul complet à froid (moteur neuf, sans cache).
  results.plateColdEvaluationMs = stats(
    time(() => {
      const e = new RecomputeEngine(kernel, noRes);
      e.evaluateDocument(doc);
      e.clear();
    }, 20),
  );

  // Modification de la largeur : seules les étapes en aval sont recalculées.
  const engine = new RecomputeEngine(kernel, noRes);
  engine.evaluateDocument(doc);
  let w = 60;
  results.widthChangeEvaluationMs = stats(
    time(() => {
      w = w >= 100 ? 60 : w + 1;
      engine.evaluateDocument(setDimension(doc, ids.sketch1, ids.widthConstraint, w));
    }, 40),
  );

  // Maillage d'affichage et échanges de fichiers.
  const [part] = engine.evaluateDocument(doc);
  const options = meshOptionsFor(part!.analysis!.bbox, DISPLAY_MESH);
  results.displayMeshMs = stats(time(() => kernel.mesh(part!.shape!, options), 20));
  let step = '';
  results.stepExportMs = stats(time(() => (step = kernel.exportStep([{ name: 'Plaque', color: '#4f86c6', shape: part!.shape! }])), 20));
  const bytes = new TextEncoder().encode(step);
  results.stepImportMs = stats(
    time(() => {
      const r = kernel.readStep(bytes);
      r.solids.forEach((s) => kernel.dispose(s));
    }, 20),
  );

  // Solveur d'esquisse : rectangle coté, puis esquisse de 40 rectangles cotés (≈ 480 inconnues).
  const plateSketch = doc.parts[0]!.features[0]!;
  if (plateSketch.type !== 'sketch') throw new Error('esquisse attendue');
  results.solvePlateSketchMs = stats(time(() => solveSketch(plateSketch.params), 200));
  let big = makeSketchFeature(createDocument(), createDocument().parts[0]!, { kind: 'plane', plane: 'XY', offset: 0 }).params;
  for (let i = 0; i < 40; i++) {
    const r = addRectangle(big, { x: (i % 8) * 20, y: Math.floor(i / 8) * 20 }, { x: (i % 8) * 20 + 9, y: Math.floor(i / 8) * 20 + 9 });
    big = addConstraint(r.sketch, { type: 'length', line: r.lines[0], value: 10 }).sketch;
    big = addConstraint(big, { type: 'length', line: r.lines[3], value: 10 }).sketch;
  }
  results.solve40RectanglesMs = stats(time(() => solveSketch(big), 5));

  // Pièce plus chargée : 20 extrusions successives (escalier).
  let stairs = createDocument();
  const partId = stairs.parts[0]!.id;
  for (let i = 0; i < 20; i++) {
    const p = findPart(stairs, partId)!;
    const sk = makeSketchFeature(stairs, p, { kind: 'plane', plane: 'XY', offset: i * 2 });
    const r = addRectangle(sk.params, { x: i * 3, y: 0 }, { x: 60, y: 30 });
    stairs = addFeature(stairs, partId, { ...sk, params: solveSketch(r.sketch).sketch });
    stairs = addFeature(stairs, partId, makeExtrudeFeature(stairs, findPart(stairs, partId)!, sk.id, 2));
  }
  results.stairs20ExtrusionsColdMs = stats(
    time(() => {
      const e = new RecomputeEngine(kernel, noRes);
      e.evaluateDocument(stairs);
      e.clear();
    }, 5),
  );

  // Mémoire : 300 recalculs avec des largeurs différentes (création et libération de solides).
  const memBefore = kernel.memoryBytes();
  const leakEngine = new RecomputeEngine(kernel, noRes);
  const checkpoints: number[] = [];
  for (let i = 0; i < 300; i++) {
    leakEngine.evaluateDocument(setDimension(doc, ids.sketch1, ids.widthConstraint, 60 + (i % 50) * 0.5));
    if (i === 99 || i === 299) checkpoints.push(kernel.memoryBytes());
  }
  leakEngine.clear();
  results.memory = {
    wasmAtStartMiB: +(memStart / 2 ** 20).toFixed(1),
    beforeLoopMiB: +(memBefore / 2 ** 20).toFixed(1),
    after100EvaluationsMiB: +(checkpoints[0]! / 2 ** 20).toFixed(1),
    after300EvaluationsMiB: +(checkpoints[1]! / 2 ** 20).toFixed(1),
  };

  mkdirSync('tests/output', { recursive: true });
  writeFileSync('tests/output/bench.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  // Garde-fous larges : l'interface reste fluide pour la pièce du parcours.
  expect((results.widthChangeEvaluationMs as { median: number }).median).toBeLessThan(250);
  expect(checkpoints[1]! - checkpoints[0]!).toBeLessThan(64 * 2 ** 20);
}, 600_000);
