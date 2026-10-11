import { beforeAll, describe, expect, it } from 'vitest';
import { technicalDrawing, VIEW_ORDER, VIEWS, viewFromLines, type ProjectedView, type ViewName } from '../../src/app/drawings';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { buildPlateDocument } from '../helpers/plate';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Plaque 60 × 30 × 5 percée d'un trou Ø 6 en (15, 15) : ses trois vues exactes. */
function plateViews() {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(buildPlateDocument().doc);
  const raw = kernel.hiddenLineViews(res!.shape!, VIEW_ORDER.map((v) => ({ u: VIEWS[v].u, toViewer: VIEWS[v].toViewer })));
  const views = Object.fromEntries(VIEW_ORDER.map((v, i) => [v, viewFromLines(raw[i]!)])) as Record<ViewName, ProjectedView>;
  return { views, mesh: engine.meshOf(res!, { linearDeflection: 0.05, angularDeflection: 0.3 })! };
}

describe('mise en plan : traits cachés exacts (HLR)', () => {
  it('encombrement exact des trois vues', () => {
    const { views } = plateViews();
    expect(views.face.min).toEqual({ x: expect.closeTo(0, 6), y: expect.closeTo(0, 6) });
    expect(views.face.max).toEqual({ x: expect.closeTo(60, 6), y: expect.closeTo(5, 6) });
    expect(views.dessus.max).toEqual({ x: expect.closeTo(60, 6), y: expect.closeTo(30, 6) });
    expect(views.gauche.min.x).toBeCloseTo(-30, 6);
  });

  it('vue de face : le trou n’est qu’en traits cachés ; vue de dessus : un cercle vu, exact', () => {
    const { views } = plateViews();
    const visibleFront = views.face.lines.filter((l) => !l.hidden);
    // Les traits vus de face ne sont que le contour de la plaque.
    for (const l of visibleFront) for (const p of [l.a, l.b]) expect(Math.min(Math.abs(p.y), Math.abs(p.y - 5), Math.abs(p.x), Math.abs(p.x - 60))).toBeLessThan(1e-6);
    const hiddenFront = views.face.lines.filter((l) => l.hidden);
    expect(hiddenFront.some((l) => Math.abs(l.a.x - 12) < 1e-6 && Math.abs(l.b.x - 12) < 1e-6)).toBe(true);
    // Le cercle vu de dessus : tous ses points à 3 mm du centre (pas de facettes).
    const circle = views.dessus.lines.filter((l) => !l.hidden && Math.hypot(l.a.x - 15, l.a.y - 15) < 4);
    expect(circle.length).toBeGreaterThan(8);
    for (const l of circle) expect(Math.hypot(l.a.x - 15, l.a.y - 15)).toBeCloseTo(3, 9);
  });

  it('la mise en plan utilise les vues exactes quand elles sont fournies', () => {
    const { views, mesh } = plateViews();
    const exact = technicalDrawing(mesh, { partName: 'Plaque', projectName: 'Test' }, views);
    const approx = technicalDrawing(mesh, { partName: 'Plaque', projectName: 'Test' });
    expect(exact.scale).toBe(approx.scale);
    const count = (d: typeof exact) => JSON.stringify(d.page).length;
    expect(count(exact)).not.toBe(count(approx));
  });
});
