import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FABRICATION } from '../../src/app/fabrication';
import { faceOutline, laserLayout, largestPlanarFace, loopArea, offsetLoop } from '../../src/app/laser';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { toDxf, toSvg } from '../../src/io/vector';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
let mesh: MeshData;
let partId: string;
beforeAll(async () => {
  kernel = await getKernel();
  const { doc, ids } = buildPlateDocument();
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(doc);
  mesh = engine.meshOf(res!, { linearDeflection: 0.02, angularDeflection: 0.2 })!;
  partId = ids.partId;
});

describe('découpe laser', () => {
  it('contour de la grande face : rectangle 60 × 30 et trou Ø 6, épaisseur 5 mm', () => {
    const outline = faceOutline(mesh, largestPlanarFace(mesh))!;
    expect(outline.thickness).toBeCloseTo(5, 6);
    expect(loopArea(outline.outer)).toBeCloseTo(1800, 3);
    expect(outline.holes).toHaveLength(1);
    expect(Math.abs(loopArea(outline.holes[0]!))).toBeCloseTo(Math.PI * 9, 0);
    expect(loopArea(outline.holes[0]!)).toBeLessThan(0);
  });

  it('compense le trait de coupe : l’extérieur grandit, le trou rétrécit', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(loopArea(offsetLoop(square, 0.1))).toBeCloseTo(10.2 * 10.2, 9);
    const hole = [...square].reverse();
    expect(Math.abs(loopArea(offsetLoop(hole, 0.1)))).toBeCloseTo(9.8 * 9.8, 9);
  });

  it('range les exemplaires sur la plaque et écrit SVG et DXF', () => {
    const settings = { ...DEFAULT_FABRICATION.laser, thickness: 5, kerf: 0.2, items: [{ partId, copies: 3 }] };
    const layout = laserLayout(settings, [{ id: partId, name: 'Plaque' }], () => mesh);
    expect(layout.warnings).toEqual([]);
    expect(layout.placed).toHaveLength(3);
    expect(layout.sheets).toBe(1);
    expect(loopArea(layout.placed[0]!.loops[0]!)).toBeCloseTo(60.2 * 30.2, 1);
    const xs = layout.placed.map((p) => Math.min(...p.loops[0]!.map((q) => q.x)));
    expect(xs[1]! - xs[0]!).toBeCloseTo(60.2 + settings.spacing, 3);
    // Matériau différent de la pièce : avertissement.
    expect(laserLayout({ ...settings, thickness: 3 }, [{ id: partId, name: 'Plaque' }], () => mesh).warnings[0]).toMatch(/5 mm d’épaisseur/);
    const doc = { sheet: settings.sheet, sheets: [{ items: layout.placed.map((p) => ({ loops: p.loops, label: { at: p.labelAt, text: p.name } })) }], engraveNames: true };
    const svg = toSvg(doc);
    expect(svg).toContain('width="600mm" height="400mm"');
    expect((svg.match(/<polygon /g) ?? []).length).toBe(6);
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('fill="#0000ff">Plaque');
    const dxf = toDxf(doc);
    expect((dxf.match(/\nPOLYLINE\n/g) ?? []).length).toBe(6);
    expect(dxf).toContain('$INSUNITS\n70\n4');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('passe sur une seconde plaque quand la première est pleine', () => {
    const settings = { ...DEFAULT_FABRICATION.laser, sheet: { w: 150, h: 80 }, thickness: 5, kerf: 0, items: [{ partId, copies: 5 }] };
    const layout = laserLayout(settings, [{ id: partId, name: 'Plaque' }], () => mesh);
    expect(layout.sheets).toBe(2);
    expect(layout.placed.filter((p) => p.sheet === 0)).toHaveLength(4);
  });
});
