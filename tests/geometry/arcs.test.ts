import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makeSketchFeature } from '../../src/domain/document';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addArc, addConstraint, emptySketch, findArc, pointPosition } from '../../src/sketch/model';
import { extractProfiles } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';
import { stadium } from '../helpers/shapes';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;
describe('arcs de cercle', () => {
  it('un contour segments + arcs a l’aire exacte et donne un solide valide', () => {
    const { sketch } = stadium();
    const profile = extractProfiles(sketch);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;
    expect(profile.regions).toHaveLength(1);
    expect(profile.regions[0]!.area).toBeCloseTo(800 + Math.PI * 100, 9);
    expect(profile.regions[0]!.outer.segments.map((s) => s.kind).sort()).toEqual(['arc', 'arc', 'line', 'line']);

    let doc = createDocument('Oblong');
    const part = doc.parts[0]!;
    const sk = makeSketchFeature(doc, part, XY);
    doc = addFeature(doc, part.id, { ...sk, params: { ...sketch, support: XY } });
    doc = addFeature(doc, part.id, makeExtrudeFeature(doc, findPart(doc, part.id)!, sk.id, 5));
    const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
    expect(res!.statuses.map((s) => s.state)).toEqual(['ok', 'ok']);
    expect(res!.analysis!.valid).toBe(true);
    expect(res!.analysis!.volume).toBeCloseTo(5 * (800 + Math.PI * 100), 4);
    expect(res!.analysis!.bbox!.min.x).toBeCloseTo(-10, 6);
    expect(res!.analysis!.bbox!.max.x).toBeCloseTo(50, 6);

    // Aller-retour du format natif.
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok && parsed.doc).toEqual(doc);
  });

  it('le point d’arrivée reste sur le cercle de l’arc et une cote de rayon pilote l’arc', () => {
    const a = addArc(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 7 });
    let s = solveSketch(a.sketch).sketch;
    const [c0, st, en] = [a.center, a.start, a.end].map((id) => pointPosition(s, id)!);
    expect(Math.hypot(en!.x - c0!.x, en!.y - c0!.y)).toBeCloseTo(Math.hypot(st!.x - c0!.x, st!.y - c0!.y), 9);
    s = addConstraint(s, { type: 'radius', circle: a.arcId, value: 4 }).sketch;
    const res = solveSketch(s);
    expect(res.converged).toBe(true);
    const arc = findArc(res.sketch, a.arcId)!;
    for (const id of [arc.start, arc.end]) {
      const p = pointPosition(res.sketch, id)!;
      const c = pointPosition(res.sketch, arc.center)!;
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(4, 9);
    }
  });
});
