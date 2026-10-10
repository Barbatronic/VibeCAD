import { describe, expect, it } from 'vitest';
import { jointFreedoms, jointMatrix } from '../../src/app/assembly';
import { identity4, transformDirection4, transformPoint4 } from '../../src/math/mat4';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { buildPlateDocument } from '../helpers/plate';

const frame = (origin = { x: 0, y: 0, z: 0 }) => ({ origin, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } });
const deg = (v: { x: number; y: number; z: number }, w: { x: number; y: number; z: number }) =>
  (Math.acos((v.x * w.x + v.y * w.y + v.z * w.z) / (Math.hypot(v.x, v.y, v.z) * Math.hypot(w.x, w.y, w.z))) * 180) / Math.PI;

describe('liaison rotule', () => {
  it('tourne dans tous les sens autour du point d’accroche, qui reste fixe', () => {
    expect(jointFreedoms('spherical')).toEqual({ angle: true, offset: false, tilt: true });
    const base = frame({ x: 10, y: 5, z: 2 });
    const moving = frame();
    const upright = jointMatrix({ kind: 'spherical', angle: 0, offset: 0, flip: true, tilt: 0 }, identity4(), base, moving);
    const leaning = jointMatrix({ kind: 'spherical', angle: 0, offset: 0, flip: true, tilt: 30, tiltDirection: 90 }, identity4(), base, moving);
    // Le point d'accroche ne bouge pas.
    expect(transformPoint4(leaning, { x: 0, y: 0, z: 0 })).toEqual(expect.objectContaining({ x: expect.closeTo(10, 9), y: expect.closeTo(5, 9), z: expect.closeTo(2, 9) }));
    // L'axe de la pièce s'incline de 30°, vers la direction 90° (vers +Y).
    const axis = transformDirection4(leaning, { x: 0, y: 0, z: 1 });
    expect(deg(axis, transformDirection4(upright, { x: 0, y: 0, z: 1 }))).toBeCloseTo(30, 9);
    expect(axis.y).toBeGreaterThan(0.4);
    expect(axis.x).toBeCloseTo(0, 9);
  });

  it('les réglages de la rotule sont conservés dans le fichier', () => {
    const { doc, ids } = buildPlateDocument();
    const withAsm = {
      ...doc,
      assembly: {
        instances: [
          { id: 'i1', partId: ids.partId, name: 'A', position: { x: 0, y: 0, z: 0 } },
          { id: 'i2', partId: ids.partId, name: 'B', position: { x: 80, y: 0, z: 0 } },
        ],
        joints: [
          {
            id: 'j1',
            name: 'Liaison 1',
            kind: 'spherical' as const,
            moving: { instanceId: 'i2', lcs: { kind: 'face' as const, face: { featureId: ids.extrude, role: 'start' as const } } },
            base: { instanceId: 'i1', lcs: { kind: 'face' as const, face: { featureId: ids.extrude, role: 'end' as const } } },
            flip: false,
            angle: 10,
            offset: 0,
            tilt: 25,
            tiltDirection: -40,
            tiltLimit: 45,
          },
        ],
      },
    };
    const parsed = parseNativeFile(serializeDocument(withAsm, '2026-10-10T12:00:00.000Z'));
    expect(parsed.ok && parsed.doc.assembly).toEqual(withAsm.assembly);
  });
});
