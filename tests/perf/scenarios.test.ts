/**
 * Mesures des fonctions récentes (npm run bench) : répétitions, congés, import STL, mises en
 * plan, vue en coupe, collisions. Résultats : tests/output/scenarios.json et docs/performance.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { addFeature, findPart, makeFilletFeature, makePatternFeature } from '../../src/domain/document';
import type { CadDocument } from '../../src/domain/model';
import { DISPLAY_MESH } from '../../src/domain/tolerances';
import { technicalDrawing, VIEW_ORDER, VIEWS } from '../../src/app/drawings';
import { RecomputeEngine } from '../../src/features/engine';
import { loadOpenCascade } from '../../src/geometry/occt/loader';
import { OcctKernel } from '../../src/geometry/occt/occt-kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { meshesToBinaryStl } from '../../src/io/stl';
import { GeometryService, meshOptionsFor } from '../../src/workers/geometry-service';
import { buildPlateDocument, cornerEdge, setDimension } from '../helpers/plate';

function median(fn: () => void, n: number): number {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  out.sort((a, b) => a - b);
  return +out[Math.floor(n / 2)]!.toFixed(1);
}

it('scénarios des fonctions récentes', async () => {
  const kernel = new OcctKernel(await loadOpenCascade());
  const noRes = { get: () => undefined };
  const r: Record<string, number> = {};

  // Plaque percée + répétition du trou en grille 6 × 3, puis congé sur un coin.
  const { doc: plate, ids } = buildPlateDocument();
  let grid: CadDocument = plate;
  const pat = makePatternFeature(grid, findPart(grid, ids.partId)!, ids.pocket, 'linear');
  grid = addFeature(grid, ids.partId, { ...pat, params: { ...pat.params, count: 6, spacing: 8, second: { axis: { kind: 'axis', axis: 'Y' }, count: 3, spacing: 7, reversed: false } } });
  grid = addFeature(grid, ids.partId, makeFilletFeature(grid, findPart(grid, ids.partId)!, [cornerEdge(grid, ids.sketch1, ids.extrude)], 2));
  r.gridFilletColdMs = median(() => {
    const e = new RecomputeEngine(kernel, noRes);
    e.evaluateDocument(grid);
    e.clear();
  }, 5);
  const engine = new RecomputeEngine(kernel, noRes);
  engine.evaluateDocument(grid);
  let w = 60;
  r.gridFilletWidthChangeMs = median(() => {
    w = w >= 90 ? 60 : w + 1;
    engine.evaluateDocument(setDimension(grid, ids.sketch1, ids.widthConstraint, w));
  }, 10);
  const [gridPart] = engine.evaluateDocument(grid);
  const gridMesh = engine.meshOf(gridPart!, meshOptionsFor(gridPart!.analysis!.bbox, DISPLAY_MESH))!;
  r.gridDisplayMeshMs = median(() => kernel.mesh(gridPart!.shape!, meshOptionsFor(gridPart!.analysis!.bbox, DISPLAY_MESH)), 5);
  r.gridDrawingMs = median(() => technicalDrawing(gridMesh, { partName: 'Grille', projectName: 'Banc' }), 5);
  const hlrViews = VIEW_ORDER.map((v) => ({ u: VIEWS[v].u, toViewer: VIEWS[v].toViewer }));
  r.gridExactViewsMs = median(() => kernel.hiddenLineViews(gridPart!.shape!, hlrViews), 3);

  // Vue en coupe et collisions (service du worker).
  const service = new GeometryService(kernel);
  const forWorker = documentForWorker(grid);
  r.gridSectionMs = median(() => service.section(forWorker, { plane: 'XZ', offset: 15, flip: false }), 5);
  r.collisions2PartsMs = median(
    () =>
      service.collisions(forWorker, [
        { instanceId: 'a', partId: ids.partId, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        { instanceId: 'b', partId: ids.partId, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 5, 2, 1] },
      ]),
    5,
  );

  // Import STL d'une boule facettée (≈ 4 000 et 10 000 triangles), maillage et mise en plan.
  for (const [label, defl] of [['4k', 0.05], ['10k', 0.02]] as const) {
    const ball = kernel.makePrimitive({ featureId: 'b', shape: 'sphere', position: { x: 0, y: 0, z: 0 }, width: 1, depth: 1, height: 1, diameter: 40, thickness: 1 });
    const stl = meshesToBinaryStl([kernel.mesh(ball, { linearDeflection: defl, angularDeflection: 0.15 })]);
    kernel.dispose(ball);
    let solid = null as ReturnType<typeof kernel.readStl>['solids'][number] | null;
    r[`stl${label}ReadMs`] = median(() => {
      if (solid) kernel.dispose(solid);
      solid = kernel.readStl(stl).solids[0]!;
    }, 3);
    let mesh = null as ReturnType<typeof kernel.mesh> | null;
    r[`stl${label}MeshMs`] = median(() => (mesh = kernel.mesh(solid!, { linearDeflection: 0.1, angularDeflection: 0.3 })), 3);
    r[`stl${label}DrawingMs`] = median(() => technicalDrawing(mesh!, { partName: 'Boule', projectName: 'Banc' }), 3);
    if (label === '4k') r.stl4kExactViewsMs = median(() => kernel.hiddenLineViews(solid!, hlrViews), 1);
    kernel.dispose(solid!);
  }

  mkdirSync('tests/output', { recursive: true });
  writeFileSync('tests/output/scenarios.json', JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
  // Garde-fous larges (voir docs/performance.md, audit du 11 octobre 2026).
  expect(r.gridFilletWidthChangeMs).toBeLessThan(400);
  expect(r.stl4kMeshMs).toBeLessThan(5000);
}, 900_000);
