import { beforeAll, describe, expect, it } from 'vitest';
import { printItemOf, printLayout, printUp, PLA_DENSITY, DEFAULT_FABRICATION, seriesMark, variantKey, type PrintVariant } from '../../src/app/fabrication';
import { applyParameters } from '../../src/features/parameters';
import { findPart } from '../../src/domain/document';
import type { CadDocument, Id } from '../../src/domain/model';
import { RecomputeEngine, type PartEvaluation } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { readZip } from '../../src/io/zip';
import { transformPoint4 } from '../../src/math/mat4';
import { GeometryService } from '../../src/workers/geometry-service';
import { textWidth } from '../../src/sketch/text';
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
  it('couches : empilées vers le haut du plateau, face choisie dessous', () => {
    const { doc, ids } = buildPlateDocument();
    const { meshes } = evaluate(doc);
    const mesh = meshes.get(ids.partId)!;
    const down = { partId: ids.partId, copies: 1, scale: 100, downFace: { featureId: ids.extrude, role: 'end' as const } };
    expect(printUp(mesh, undefined)).toBeNull();
    const up = printUp(mesh, down)!;
    // Face du dessus de l'extrusion posée sur le plateau : la pièce est retournée, les couches montent vers −Z.
    expect(up.z).toBeCloseTo(-1, 6);
    const layout = printLayout({ ...DEFAULT_FABRICATION.print, items: [down] }, [{ id: ids.partId, name: 'P' }], () => mesh, () => null);
    const m = layout.placements[0]!.matrix;
    const o = transformPoint4(m, { x: 0, y: 0, z: 0 });
    const tip = transformPoint4(m, up);
    expect(tip.z - o.z).toBeCloseTo(1, 6);
    // Plateau choisi d'abord, sinon le premier qui porte la pièce.
    const print = { ...DEFAULT_FABRICATION.print, plates: [{ id: 'a', name: 'A', items: [{ ...down, downFace: undefined }] }, { id: 'b', name: 'B', items: [down] }] };
    expect(printItemOf(print, ids.partId, 'b')?.downFace).toBeDefined();
    expect(printItemOf(print, ids.partId, 'zz')?.downFace).toBeUndefined();
    expect(printItemOf(print, 'autre', 'b')).toBeUndefined();
  });

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

  it('série d’essais : une version par valeur, posée dans l’ordre, exportée telle quelle en 3MF', async () => {
    const { doc: base, ids } = buildPlateDocument();
    const part = base.parts[0]!;
    // Épaisseur de la plaque = paramètre « ep ».
    const doc = applyParameters({
      ...base,
      parts: [{ ...part, features: part.features.map((f) => (f.id === ids.extrude ? { ...f, expressions: { distance: 'ep' } } : f)) }],
      parameters: [{ name: 'ep', expression: '5' }],
    });
    const svc = new GeometryService(kernel);
    const main = svc.evaluate(documentForWorker(doc));
    const values = [3, 4, 6];
    const variants = new Map<string, PrintVariant>();
    for (const v of values) {
      const r = svc.variant(documentForWorker(doc), ids.partId, 'ep', v);
      expect(r.failed).toBeNull();
      expect(r.analysis!.bbox!.max.z - r.analysis!.bbox!.min.z).toBeCloseTo(v, 6);
      variants.set(variantKey(ids.partId, { parameter: 'ep' }, v), { mesh: r.mesh, meshKey: r.meshKey, analysis: r.analysis });
    }
    // Calcul à part : le projet ouvert garde son cache (même clé de maillage au recalcul suivant).
    const again = svc.evaluate(documentForWorker(doc), main.parts.map((p) => p.meshKey!));
    expect(again.parts[0]!.meshKey).toBe(main.parts[0]!.meshKey);
    expect(again.parts[0]!.mesh).toBeNull();

    const settings = { ...DEFAULT_FABRICATION.print, items: [{ partId: ids.partId, copies: 1, scale: 100, series: { parameter: 'ep', mode: 'list' as const, values: [6, 3, 4] } }] };
    const parts = doc.parts.map((p) => ({ id: p.id, name: p.name }));
    const pending = printLayout(settings, parts, () => main.parts[0]!.mesh, () => main.parts[0]!.analysis);
    expect(pending.placements.map((p) => p.variant)).toEqual(values.map((value) => ({ parameter: 'ep', value, pending: true })));
    const layout = printLayout(settings, parts, () => main.parts[0]!.mesh, () => main.parts[0]!.analysis, (id, series, value) => variants.get(variantKey(id, series, value)));
    expect(layout.warnings).toEqual([]);
    expect(layout.placements.map((p) => p.name)).toEqual(['Pièce 1 — ep 3', 'Pièce 1 — ep 4', 'Pièce 1 — ep 6']);
    expect(layout.placements.map((p) => Math.round(p.size.z))).toEqual(values);
    expect(layout.placements.every((p) => !p.variant!.pending && p.mesh)).toBe(true);
    // Rangées de gauche à droite dans l'ordre croissant.
    const xs = layout.placements.map((p) => transformPoint4(p.matrix, { x: 0, y: 0, z: 0 }).x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);

    const { bytes } = await svc.export3mf(
      documentForWorker(doc),
      [ids.partId],
      layout.placements.map((p) => ({ partId: p.partId, name: p.name, matrix: p.matrix, variant: { parameter: p.variant!.parameter, value: p.variant!.value } })),
    );
    const model = new TextDecoder().decode((await readZip(bytes)).get('3D/3dmodel.model'));
    expect(model).toContain('name="Pièce 1 — ep 3"');
    const objects = model.split('<object ').slice(1);
    expect(objects).toHaveLength(3);
    const heights = objects.map((o) => {
      const zs = Array.from(o.matchAll(/ z="([^"]+)"/g), (m) => Number(m[1]));
      return Math.max(...zs) - Math.min(...zs);
    });
    heights.forEach((h, i) => expect(h).toBeCloseTo(values[i]!, 3));
  });

  it('série d’essais marquée : la valeur est gravée au centre de la face choisie', () => {
    const { doc: base, ids } = buildPlateDocument();
    const part = base.parts[0]!;
    const doc = applyParameters({
      ...base,
      parts: [{ ...part, features: part.features.map((f) => (f.id === ids.extrude ? { ...f, expressions: { distance: 'ep' } } : f)) }],
      parameters: [{ name: 'ep', expression: '5' }],
    });
    const svc = new GeometryService(kernel);
    const main = svc.evaluate(documentForWorker(doc));
    const series = { parameter: 'ep', mode: 'list' as const, values: [4], mark: { face: { featureId: ids.extrude, role: 'end' as const }, height: 6, depth: 0.4 } };
    const mark = seriesMark(main.parts[0]!.mesh, series, 4)!;
    expect(mark.text).toBe('4');
    expect(mark.tooSmall).toBe(false);
    // Plaque 60 × 30 : le texte (6 mm de haut) est au milieu de la face, vers (30, 15).
    expect(mark.height).toBeCloseTo(6, 6);
    expect(mark.anchor.y + 0.35 * mark.height).toBeCloseTo(15, 0);
    const plain = svc.variant(documentForWorker(doc), ids.partId, 'ep', 4);
    const marked = svc.variant(documentForWorker(doc), ids.partId, 'ep', 4, mark);
    expect(marked.failed).toBeNull();
    expect(marked.analysis!.bbox!.max.z).toBeCloseTo(4, 6);
    // Le chiffre est creusé : un peu de matière en moins, plus de faces.
    expect(marked.analysis!.volume).toBeLessThan(plain.analysis!.volume - 1);
    expect(marked.analysis!.volume).toBeGreaterThan(plain.analysis!.volume - 30);
    expect(marked.mesh!.faces.length).toBeGreaterThan(plain.mesh!.faces.length);
    // Face trop petite : le texte rétrécit et le signale.
    const tiny = seriesMark(main.parts[0]!.mesh, { ...series, mark: { ...series.mark, height: 6, face: { featureId: ids.extrude, role: 'side', index: 0 } } }, 4.25);
    if (tiny) expect(tiny.height).toBeLessThanOrEqual(0.6 * 5 + 1e-6);
  });

  it('test croisé : le diamètre du trou dans le 3MF suit la valeur essayée (et l’échelle du plateau)', async () => {
    // Plaque percée dont le diamètre du trou est le paramètre « d ».
    const { doc: base, ids } = buildPlateDocument();
    const part = base.parts[0]!;
    const features = part.features.map((f) =>
      f.id === ids.sketch2 && f.type === 'sketch' ? { ...f, params: { ...f.params, constraints: f.params.constraints.map((c) => (c.type === 'diameter' ? { ...c, expression: 'd' } : c)) } } : f,
    );
    const doc = applyParameters({ ...base, parts: [{ ...part, features }], parameters: [{ name: 'd', expression: '6' }] });
    const svc = new GeometryService(kernel);
    const main = svc.evaluate(documentForWorker(doc));
    const values = [5, 7, 7.5];
    /** Diamètre du trou de chaque objet du 3MF : sommets intérieurs, distance au centre du trou. */
    const holeDiameters = async (scale: number) => {
      const settings = { ...DEFAULT_FABRICATION.print, items: [{ partId: ids.partId, copies: 1, scale, series: { parameter: 'd', mode: 'list' as const, values } }] };
      const layout = printLayout(settings, doc.parts, () => main.parts[0]!.mesh, () => main.parts[0]!.analysis);
      const { bytes } = await svc.export3mf(
        documentForWorker(doc),
        [ids.partId],
        layout.placements.map((p) => ({ partId: p.partId, name: p.name, matrix: p.matrix, variant: { parameter: 'd', value: p.variant!.value } })),
      );
      const model = new TextDecoder().decode((await readZip(bytes)).get('3D/3dmodel.model'));
      return model
        .split('<object ')
        .slice(1)
        .map((o) => {
          const v = Array.from(o.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g), (m) => ({ x: Number(m[1]), y: Number(m[2]) }));
          const [x0, x1, y0, y1] = [Math.min(...v.map((p) => p.x)), Math.max(...v.map((p) => p.x)), Math.min(...v.map((p) => p.y)), Math.max(...v.map((p) => p.y))];
          const inner = v.filter((p) => p.x > x0 + 0.5 && p.x < x1 - 0.5 && p.y > y0 + 0.5 && p.y < y1 - 0.5);
          const cx = (Math.min(...inner.map((p) => p.x)) + Math.max(...inner.map((p) => p.x))) / 2;
          const cy = (Math.min(...inner.map((p) => p.y)) + Math.max(...inner.map((p) => p.y))) / 2;
          return 2 * Math.max(...inner.map((p) => Math.hypot(p.x - cx, p.y - cy)));
        });
    };
    (await holeDiameters(100)).forEach((d, i) => expect(d).toBeCloseTo(values[i]!, 3));
    // Échelle 110 % sur le plateau : tout est agrandi, le trou aussi.
    (await holeDiameters(110)).forEach((d, i) => expect(d).toBeCloseTo(values[i]! * 1.1, 3));
  });

  it('zone d’essai : seule la matière autour du trou est gardée, à l’affichage comme dans le 3MF', async () => {
    const { doc: base, ids } = buildPlateDocument();
    const part = base.parts[0]!;
    const features = part.features.map((f) =>
      f.id === ids.sketch2 && f.type === 'sketch' ? { ...f, params: { ...f.params, constraints: f.params.constraints.map((c) => (c.type === 'diameter' ? { ...c, expression: 'd' } : c)) } } : f,
    );
    const doc = applyParameters({ ...base, parts: [{ ...part, features }], parameters: [{ name: 'd', expression: '6' }] });
    const svc = new GeometryService(kernel);
    const main = svc.evaluate(documentForWorker(doc));
    // Face du trou : la face cylindrique de la plaque.
    const hole = main.parts[0]!.mesh!.faces.find((f) => f.cylinder)!;
    const zone = { face: { featureId: hole.tags[0]!.featureId, role: hole.tags[0]!.role, ...(hole.tags[0]!.entityId ? { entityId: hole.tags[0]!.entityId } : {}), ...(hole.tags[0]!.index !== undefined ? { index: hole.tags[0]!.index } : {}) }, margin: 3 };
    for (const d of [5, 8]) {
      const r = svc.variant(documentForWorker(doc), ids.partId, 'd', d, undefined, zone);
      expect(r.zone).toBeUndefined();
      const b = r.analysis!.bbox!;
      // Carré de d + 2 × 3 mm autour du trou (centre 15, 15), toute l'épaisseur de la plaque.
      expect(b.max.x - b.min.x).toBeCloseTo(d + 6, 1);
      expect(b.max.y - b.min.y).toBeCloseTo(d + 6, 1);
      expect(b.max.z - b.min.z).toBeCloseTo(5, 4);
      expect(r.analysis!.volume).toBeCloseTo(((d + 6) ** 2 - Math.PI * (d / 2) ** 2) * 5, -1);
    }
    // Export : le même anneau carré, au diamètre essayé.
    const series = { parameter: 'd', mode: 'list' as const, values: [5, 8], zone };
    const settings = { ...DEFAULT_FABRICATION.print, items: [{ partId: ids.partId, copies: 1, scale: 100, series }] };
    const layout = printLayout(settings, doc.parts, () => main.parts[0]!.mesh, () => main.parts[0]!.analysis);
    const { bytes, warnings } = await svc.export3mf(
      documentForWorker(doc),
      [ids.partId],
      layout.placements.map((p) => ({ partId: p.partId, name: p.name, matrix: p.matrix, variant: { parameter: 'd', value: p.variant!.value, zone } })),
    );
    expect(warnings).toEqual([]);
    const model = new TextDecoder().decode((await readZip(bytes)).get('3D/3dmodel.model'));
    const widths = model.split('<object ').slice(1).map((o) => {
      const xs = Array.from(o.matchAll(/<vertex x="([^"]+)"/g), (m) => Number(m[1]));
      return Math.max(...xs) - Math.min(...xs);
    });
    expect(widths[0]).toBeCloseTo(11, 1);
    expect(widths[1]).toBeCloseTo(14, 1);
    // Marquage dans la zone : centré sur la partie imprimée du dessus.
    const mark = seriesMark(main.parts[0]!.mesh, { ...series, mark: { face: { featureId: ids.extrude, role: 'end' }, height: 5, depth: 0.3 } }, 5)!;
    // Le texte rétrécit pour tenir dans la bande de matière autour du trou, sans le chevaucher.
    expect(mark.height).toBeGreaterThan(1);
    expect(mark.height).toBeLessThan(3);
    const w = textWidth(mark.text, mark.height);
    const rect = { x0: mark.anchor.x, x1: mark.anchor.x + w, y0: mark.anchor.y - 0.3 * mark.height, y1: mark.anchor.y + mark.height };
    const nearest = { x: Math.min(Math.max(15, rect.x0), rect.x1), y: Math.min(Math.max(15, rect.y0), rect.y1) };
    expect(Math.hypot(nearest.x - 15, nearest.y - 15)).toBeGreaterThan(6 / 2);
    // Et reste dans la zone (carré de 12 mm autour du trou du projet, Ø 6).
    expect(rect.x0).toBeGreaterThan(9 - 1e-6);
    expect(rect.x1).toBeLessThan(21 + 1e-6);
    expect(rect.y0).toBeGreaterThan(9 - 1e-6);
    expect(rect.y1).toBeLessThan(21 + 1e-6);
    // Face introuvable : signalé.
    expect(svc.variant(documentForWorker(doc), ids.partId, 'd', 5, undefined, { face: { featureId: 'absent', role: 'side' }, margin: 3 }).zone).toBe('lost');
  });
});
