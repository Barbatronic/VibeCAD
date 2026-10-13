import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeHoleFeature } from '../../src/domain/document';
import type { CadDocument, Feature, HoleFeature, SketchFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import { standardHead } from '../../src/features/hole/definition';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, holeSketch } from '../helpers/plate';

const PLATE = 60 * 30 * 5;

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Plaque 60 × 30 × 5 (sans la poche) et deux cercles sur la face du dessus (ou sur le plan XY, dessous). */
function withHole(params: Partial<HoleFeature['params']>, options: { holeOnFace?: boolean } = {}) {
  const { doc, ids } = buildPlateDocument(options);
  let next: CadDocument = { ...doc, parts: doc.parts.map((p) => ({ ...p, features: p.features.filter((f) => f.id !== ids.pocket) })) };
  next = {
    ...next,
    parts: next.parts.map((p) => ({
      ...p,
      features: p.features.map((f): Feature => (f.id === ids.sketch2 ? { ...(f as SketchFeature), params: holeSketch((f as SketchFeature).params, 45, 15, 2) } : f)),
    })),
  };
  const hole = makeHoleFeature(next, findPart(next, ids.partId)!, ids.sketch2);
  next = addFeature(next, ids.partId, { ...hole, params: { ...hole.params, ...params } });
  return next;
}

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;
const cylinder = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;

describe('perçage normalisé, au centre de chaque cercle', () => {
  it('trou de passage M3 traversant (série normale Ø 3,4) : la taille du cercle dessiné ne compte pas', () => {
    const part = evaluate(withHole({ kind: 'clearance', size: 'M3', fit: 'medium', through: true }));
    expect(part.failedFeatureId).toBeNull();
    expect(part.analysis!.volume).toBeCloseTo(PLATE - 2 * cylinder(3.4, 5), 3);
  });

  it('trou lamé M4 : logement Ø 8 sur 4,4 mm puis passage Ø 4,5', () => {
    const head = standardHead('counterbore', 'M4');
    expect(head).toEqual({ headDiameter: 8, headDepth: 4.4 });
    const part = evaluate(withHole({ kind: 'counterbore', size: 'M4', ...head }));
    expect(part.analysis!.volume).toBeCloseTo(PLATE - 2 * (cylinder(8, 4.4) + cylinder(4.5, 0.6)), 3);
  });

  it('trou fraisé M3 : cône à 90° de Ø 6,9 jusqu’au trou Ø 3,4', () => {
    const head = standardHead('countersink', 'M3');
    const part = evaluate(withHole({ kind: 'countersink', size: 'M3', ...head }));
    const R = 6.9 / 2;
    const r = 1.7;
    const h = R - r;
    const cone = ((Math.PI * h) / 3) * (R * R + R * r + r * r);
    expect(part.analysis!.volume).toBeCloseTo(PLATE - 2 * (cone + cylinder(3.4, 5 - h)), 3);
  });

  it('trou à tarauder M5 borgne de 3 mm (perçage Ø 4,2)', () => {
    const part = evaluate(withHole({ kind: 'tapped', size: 'M5', through: false, depth: 3 }));
    expect(part.analysis!.volume).toBeCloseTo(PLATE - 2 * cylinder(4.2, 3), 3);
  });

  it('esquisse sous la pièce (plan XY) : percé de l’autre côté ; dans le mauvais sens, rien n’est retiré', () => {
    const ok = evaluate(withHole({ through: false, depth: 2, reversed: true }, { holeOnFace: false }));
    expect(ok.analysis!.volume).toBeCloseTo(PLATE - 2 * cylinder(3.4, 2), 3);
    const wrong = evaluate(withHole({ through: false, depth: 2, reversed: false }, { holeOnFace: false }));
    expect(wrong.statuses.find((s) => s.code === 'HOLE_REMOVES_NOTHING')).toBeDefined();
  });
});
