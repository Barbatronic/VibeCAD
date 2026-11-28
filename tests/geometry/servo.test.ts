import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeServoFeature } from '../../src/domain/document';
import type { CadDocument, ServoFeature, ServoTarget, SketchFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import { SERVO_SPLINES, servoTargetInSketch } from '../../src/features/servo/definition';
import { splineOutline } from '../../src/features/servo/evaluate';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

const PLATE = 60 * 30 * 5;

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;
const disc = (d: number) => Math.PI * (d / 2) ** 2;
/** Aire de l'étoile : 2 × teeth triangles (centre, pointe, creux). */
const starArea = (teeth: number, tip: number, root: number) => teeth * (tip / 2) * (root / 2) * Math.sin(Math.PI / teeth);

/** Plaque 60 × 30 × 5 ; avec `keepHole`, son trou Ø 6 traversant en (15, 15) ; la cannelure sur `target`. */
function plateWithServo(target: (ids: ReturnType<typeof buildPlateDocument>['ids'], doc: CadDocument) => ServoTarget, params: Partial<ServoFeature['params']> = {}, keepHole = false) {
  const { doc: base, ids } = buildPlateDocument();
  const doc = keepHole ? base : { ...base, parts: base.parts.map((p) => ({ ...p, features: p.features.filter((f) => f.id !== ids.pocket) })) };
  const servo = makeServoFeature(doc, findPart(doc, ids.partId)!, target(ids, doc));
  return { doc: addFeature(doc, ids.partId, { ...servo, params: { ...servo.params, ...params } }), ids, servo };
}

const circleTarget = (ids: { sketch2: string }, doc: CadDocument) => servoTargetInSketch(doc.parts[0]!.features.find((f) => f.id === ids.sketch2) as SketchFeature)!;

describe('cannelure de servo', () => {
  it('l’étoile alterne les pointes extérieures et intérieures', () => {
    const pts = splineOutline(21, 5.25, 4.4);
    expect(pts).toHaveLength(42);
    expect(Math.hypot(pts[0]!.x, pts[0]!.y)).toBeCloseTo(2.625, 9);
    expect(Math.hypot(pts[1]!.x, pts[1]!.y)).toBeCloseTo(2.2, 9);
  });

  it('MG90S au centre d’un cercle d’esquisse : 21 crans sur 3 mm, puis la vis Ø 2,8 jusqu’au dessous', () => {
    const { doc } = plateWithServo(circleTarget);
    const part = evaluate(doc);
    expect(part.failedFeatureId).toBeNull();
    const s = SERVO_SPLINES.mg90s;
    expect(part.analysis!.volume).toBeCloseTo(PLATE - starArea(21, s.tipDiameter, s.rootDiameter) * 3 - disc(2.8) * 2, 3);
  });

  it('25 dents (MG996R) : 4 mm de crans et vis Ø 3,2', () => {
    const s = SERVO_SPLINES['25t'];
    const { doc } = plateWithServo(circleTarget, { standard: '25t', teeth: s.teeth, tipDiameter: s.tipDiameter, rootDiameter: s.rootDiameter, depth: s.depth, screwDiameter: s.screwDiameter });
    const part = evaluate(doc);
    expect(part.analysis!.volume).toBeCloseTo(PLATE - starArea(25, 6.35, 5.5) * 4 - disc(3.2) * 1, 3);
  });

  it('côté opposé de l’esquisse du dessus : rien n’est retiré (avertissement)', () => {
    const part = evaluate(plateWithServo(circleTarget, { reversed: true }).doc);
    expect(part.statuses.find((x) => x.code === 'SERVO_REMOVES_NOTHING')).toBeDefined();
  });

  it('bord rond d’un trou, dessus ou dessous : la cannelure entre toujours dans la matière', () => {
    const custom = { standard: 'custom' as const, teeth: 20, tipDiameter: 8, rootDiameter: 7, depth: 2, screwDiameter: 0 };
    const removed = (starArea(20, 8, 7) - disc(6)) * 2;
    const circleId = (doc: CadDocument, sketchId: string) => servoTargetInSketch(doc.parts[0]!.features.find((f) => f.id === sketchId) as SketchFeature)!;
    for (const role of ['end', 'start'] as const) {
      const { doc } = plateWithServo(
        (ids, d) => {
          const c = circleId(d, ids.sketch2);
          return { kind: 'edge', edge: { faces: [{ featureId: ids.extrude, role }, { featureId: ids.pocket, role: 'side', entityId: c.kind === 'sketch' ? c.entityId : '' }] } };
        },
        custom,
        true,
      );
      const part = evaluate(doc);
      expect(part.failedFeatureId).toBeNull();
      expect(part.analysis!.volume).toBeCloseTo(PLATE - disc(6) * 5 - removed, 3);
      const bbox = part.analysis!.bbox!;
      expect(bbox.max.z).toBeCloseTo(5, 6);
      expect(bbox.min.z).toBeCloseTo(0, 6);
    }
  });

  it('bord droit : erreur claire', () => {
    const lineOf = (d: CadDocument, sketchId: string) => (d.parts[0]!.features.find((f) => f.id === sketchId) as SketchFeature).params.entities.find((e) => e.type === 'line')!.id;
    const { doc } = plateWithServo((ids, d) => ({ kind: 'edge', edge: { faces: [{ featureId: ids.extrude, role: 'end' }, { featureId: ids.extrude, role: 'side', entityId: lineOf(d, ids.sketch1) }] } }));
    const part = evaluate(doc);
    expect(part.statuses.find((x) => x.code === 'SERVO_NOT_ROUND')).toBeDefined();
  });

  it('aller-retour du format natif, conforme au schéma', () => {
    for (const keepHole of [false, true]) {
      const { doc } = plateWithServo(
        keepHole ? (ids) => ({ kind: 'edge', edge: { faces: [{ featureId: ids.extrude, role: 'end' }, { featureId: ids.pocket, role: 'side', entityId: 'c1' }] } }) : circleTarget,
        { reversed: keepHole },
        keepHole,
      );
      const text = serializeDocument(doc);
      const parsed = parseNativeFile(text);
      expect(parsed.ok && parsed.doc).toEqual(doc);
      const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
      expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
    }
  });
});

