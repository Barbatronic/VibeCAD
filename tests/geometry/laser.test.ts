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

  it('range les exemplaires sur une plaque du matériau de même épaisseur et écrit SVG et DXF', () => {
    const materials = DEFAULT_FABRICATION.laser.materials.map((m) => ({ ...m, kerf: 0.2 }));
    const settings = { ...DEFAULT_FABRICATION.laser, materials, items: [{ partId, copies: 3 }] };
    const layout = laserLayout(settings, [{ id: partId, name: 'Plaque' }], () => mesh);
    expect(layout.warnings).toEqual([]);
    expect(layout.placed).toHaveLength(3);
    // Pièce de 5 mm : matériau « 5 mm » choisi automatiquement, une seule plaque de 300 × 200.
    expect(layout.materialOf[partId]).toBe('mat-5');
    expect(layout.materials.map((g) => [g.material.id, g.sheets, g.placed.length])).toEqual([
      ['mat-3', 0, 0],
      ['mat-5', 1, 3],
      ['mat-acr-3', 0, 0],
      ['mat-acr-5', 0, 0],
    ]);
    // Acrylique choisi pour la pièce : même épaisseur, aucun avertissement.
    const acrylic = laserLayout({ ...settings, items: [{ partId, copies: 1, materialId: 'mat-acr-5' }] }, [{ id: partId, name: 'Plaque' }], () => mesh);
    expect(acrylic.warnings).toEqual([]);
    expect(acrylic.materials.find((g) => g.material.id === 'mat-acr-5')!.placed).toHaveLength(1);
    expect(loopArea(layout.placed[0]!.loops[0]!)).toBeCloseTo(60.2 * 30.2, 1);
    const xs = layout.placed.map((p) => Math.min(...p.loops[0]!.map((q) => q.x)));
    expect(xs[1]! - xs[0]!).toBeCloseTo(60.2 + settings.spacing, 3);
    // Matériau imposé d'une autre épaisseur : avertissement.
    const forced = laserLayout({ ...settings, items: [{ partId, copies: 1, materialId: 'mat-3' }] }, [{ id: partId, name: 'Plaque' }], () => mesh);
    expect(forced.warnings[0]).toMatch(/5 mm d’épaisseur et le matériau « Contreplaqué 3 mm » 3 mm/);
    const group = layout.materials[1]!;
    const doc = { sheet: group.material.sheet, sheets: [{ items: group.placed.map((p) => ({ loops: p.loops, label: { at: p.labelAt, text: p.name } })) }], engraveNames: true };
    const svg = toSvg(doc);
    expect(svg).toContain('width="300mm" height="200mm"');
    expect((svg.match(/<polygon /g) ?? []).length).toBe(6);
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('fill="#0000ff">Plaque');
    const dxf = toDxf(doc);
    expect((dxf.match(/\nPOLYLINE\n/g) ?? []).length).toBe(6);
    expect(dxf).toContain('$INSUNITS\n70\n4');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('passe sur une seconde plaque quand la première est pleine', () => {
    const materials = [{ id: 'm', name: 'Petite plaque', thickness: 5, sheet: { w: 150, h: 80 }, kerf: 0 }];
    const layout = laserLayout({ ...DEFAULT_FABRICATION.laser, materials, items: [{ partId, copies: 5 }] }, [{ id: partId, name: 'Plaque' }], () => mesh);
    expect(layout.materials[0]!.sheets).toBe(2);
    expect(layout.placed.filter((p) => p.sheet === 0)).toHaveLength(4);
  });

  it('sépare les pièces de 3 mm et de 5 mm sur les plaques de leur matériau', () => {
    // Même plaque, amincie à 3 mm.
    const thin: MeshData = {
      ...mesh,
      positions: mesh.positions.map((v, i) => (i % 3 === 2 ? v * 0.6 : v)),
      edgePositions: mesh.edgePositions.map((v, i) => (i % 3 === 2 ? v * 0.6 : v)),
      faces: mesh.faces.map((f) => (f.plane ? { ...f, plane: { ...f.plane, origin: { ...f.plane.origin, z: f.plane.origin.z * 0.6 } } } : f)),
    };
    const parts = [
      { id: partId, name: 'Épaisse' },
      { id: 'thin', name: 'Fine' },
    ];
    const layout = laserLayout(
      { ...DEFAULT_FABRICATION.laser, items: [{ partId, copies: 2 }, { partId: 'thin', copies: 1 }] },
      parts,
      (id) => (id === 'thin' ? thin : mesh),
    );
    expect(layout.warnings).toEqual([]);
    expect(layout.thickness.thin).toBeCloseTo(3, 6);
    expect(layout.materials.map((g) => g.placed.map((p) => p.name))).toEqual([['Fine'], ['Épaisse 1', 'Épaisse 2'], [], []]);
    // Chaque matériau commence sa propre plaque, à l’espacement du bord.
    expect(layout.materials.map((g) => g.sheets)).toEqual([1, 1, 0, 0]);
    expect(Math.min(...layout.materials[0]!.placed[0]!.loops[0]!.map((p) => p.x))).toBeCloseTo(4, 3);
  });

  it('sans matériau : avertissement, rien n’est posé', () => {
    const layout = laserLayout({ ...DEFAULT_FABRICATION.laser, materials: [], items: [{ partId, copies: 1 }] }, [{ id: partId, name: 'Plaque' }], () => mesh);
    expect(layout.placed).toHaveLength(0);
    expect(layout.warnings).toEqual(['Aucun matériau : ajoutez-en un pour découper les pièces.']);
  });
});
