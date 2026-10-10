import { beforeAll, describe, expect, it } from 'vitest';
import { printLayout, PLA_DENSITY, DEFAULT_FABRICATION } from '../../src/app/fabrication';
import { findPart } from '../../src/domain/document';
import type { CadDocument, Id } from '../../src/domain/model';
import { RecomputeEngine, type PartEvaluation } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { readZip } from '../../src/io/zip';
import { transformPoint4 } from '../../src/math/mat4';
import { GeometryService } from '../../src/workers/geometry-service';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function evaluate(doc: CadDocument): { meshes: Map<Id, MeshData>; results: Map<Id, PartEvaluation> } {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const meshes = new Map<Id, MeshData>();
  const results = new Map<Id, PartEvaluation>();
  for (const r of engine.evaluateDocument(doc)) {
    results.set(r.partId, r);
    meshes.set(r.partId, engine.meshOf(r, { linearDeflection: 0.05, angularDeflection: 0.3 })!);
  }
  return { meshes, results };
}

const PLATE = 9000 - Math.PI * 9 * 5;

describe('fabrication : plateau d’impression', () => {
  it('pose la pièce sur la face choisie, range les exemplaires, estime la matière', () => {
    const { doc, ids } = buildPlateDocument();
    const { meshes, results } = evaluate(doc);
    const parts = doc.parts.map((p) => ({ id: p.id, name: p.name }));
    const settings = { ...DEFAULT_FABRICATION.print, items: [{ partId: ids.partId, copies: 3, scale: 100, downFace: { featureId: ids.extrude, role: 'end' as const } }] };
    const layout = printLayout(settings, parts, (id) => meshes.get(id), (id) => results.get(id)?.analysis);
    expect(layout.warnings).toEqual([]);
    expect(layout.placements).toHaveLength(3);
    // Face du dessus vers le bas : le point (30, 15, 5) du dessus vient à z = 0.
    expect(transformPoint4(layout.placements[0]!.matrix, { x: 30, y: 15, z: 5 }).z).toBeCloseTo(0, 6);
    expect(layout.placements[0]!.size.z).toBeCloseTo(5, 6);
    // Deux pièces de 60 mm tiennent côte à côte, la troisième aussi (220 mm) : une seule rangée.
    const xs = layout.placements.map((p) => transformPoint4(p.matrix, { x: 0, y: 0, z: 0 }).x);
    expect(new Set(xs.map((v) => Math.round(v))).size).toBe(3);
    expect(layout.grams).toBeCloseTo((3 * PLATE * PLA_DENSITY) / 1000, 6);
    // Échelle 200 % : la pièce (120 mm) déborde du plateau si on en met 2 par rangée → deux rangées.
    const big = printLayout({ ...settings, items: [{ ...settings.items[0]!, copies: 2, scale: 200 }] }, parts, (id) => meshes.get(id), (id) => results.get(id)?.analysis);
    const ys = big.placements.map((p) => transformPoint4(p.matrix, { x: 0, y: 0, z: 0 }).y);
    expect(Math.abs(ys[1]! - ys[0]!)).toBeGreaterThan(50);
    expect(big.grams).toBeCloseTo((2 * 8 * PLATE * PLA_DENSITY) / 1000, 4);
  });

  it('passe sur un deuxième plateau quand le premier est plein', () => {
    const { doc, ids } = buildPlateDocument();
    const { meshes, results } = evaluate(doc);
    const parts = doc.parts.map((p) => ({ id: p.id, name: p.name }));
    // 60 × 30 mm sur 220 × 220 (espacement 5) : 3 par rangée, 6 rangées → 18 par plateau.
    const layout = printLayout({ ...DEFAULT_FABRICATION.print, items: [{ partId: ids.partId, copies: 20, scale: 100 }] }, parts, (id) => meshes.get(id), (id) => results.get(id)?.analysis);
    expect(layout.warnings).toEqual([]);
    expect(layout.plates).toBe(2);
    expect(layout.placements.filter((p) => p.plate === 0)).toHaveLength(18);
    expect(layout.placements.filter((p) => p.plate === 1)).toHaveLength(2);
    // Le deuxième plateau recommence au coin.
    const first = layout.placements.find((p) => p.plate === 1)!;
    const corner = transformPoint4(first.matrix, { x: 0, y: 0, z: 0 });
    expect(corner.x).toBeCloseTo(0, 6);
    expect(corner.y).toBeCloseTo(0, 6);
    // Chaque exemplaire reste dans le plateau.
    for (const p of layout.placements) {
      const far = transformPoint4(p.matrix, { x: 60, y: 30, z: 5 });
      expect(far.x).toBeLessThanOrEqual(220 + 1e-6);
      expect(far.y).toBeLessThanOrEqual(220 + 1e-6);
    }
    expect(layout.placements.reduce((g, p) => g + p.grams, 0)).toBeCloseTo(layout.grams, 6);
  });

  it('exporte le plateau en 3MF avec l’échelle et l’orientation appliquées', async () => {
    const { doc, ids } = buildPlateDocument();
    const { meshes, results } = evaluate(doc);
    const parts = doc.parts.map((p) => ({ id: p.id, name: p.name }));
    const layout = printLayout(
      { ...DEFAULT_FABRICATION.print, items: [{ partId: ids.partId, copies: 1, scale: 50 }] },
      parts,
      (id) => meshes.get(id),
      (id) => results.get(id)?.analysis,
    );
    const svc = new GeometryService(kernel);
    const { bytes } = await svc.export3mf(documentForWorker(doc), [ids.partId], layout.placements.map((p) => ({ partId: p.partId, name: p.name, matrix: p.matrix })));
    const model = new TextDecoder().decode((await readZip(bytes)).get('3D/3dmodel.model'));
    const xsv = Array.from(model.matchAll(/<vertex x="([^"]+)"/g), (m) => Number(m[1]));
    expect(Math.max(...xsv) - Math.min(...xsv)).toBeCloseTo(30, 3);
    expect(findPart(doc, ids.partId)!.name).toBe('Pièce 1');
  });
});
