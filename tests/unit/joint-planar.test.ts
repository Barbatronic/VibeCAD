import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jointFreedoms, jointMatrix } from '../../src/app/assembly';
import { parseNativeFile } from '../../src/io/native-format';
import type { Frame3D } from '../../src/math/frame';
import { identity4 } from '../../src/math/mat4';

const frame: Frame3D = { origin: { x: 0, y: 0, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };

describe('liaison appui plan', () => {
  it('laisse libres la rotation et le glissement dans le plan', () => {
    expect(jointFreedoms('planar')).toEqual({ angle: true, offset: false, tilt: false, slide: true });
  });

  it('fait glisser la pièce dans le plan du repère de référence, sans la décoller', () => {
    const at = (slideX: number, slideY: number, angle = 0) => jointMatrix({ kind: 'planar', angle, offset: 0, flip: true, slideX, slideY }, identity4(), frame, frame);
    const m = at(12, -7, 30);
    expect([m[12], m[13], m[14]].map((x) => Math.round(x! * 1e6) / 1e6)).toEqual([12, -7, 0]);
    // La rotation se fait sur place : l'origine de la pièce ne bouge pas avec l'angle.
    const turned = at(12, -7, 120);
    expect(turned[12]).toBeCloseTo(12, 9);
    expect(turned[13]).toBeCloseTo(-7, 9);
    // Un autre type de liaison ignore le glissement.
    const pivot = jointMatrix({ kind: 'revolute', angle: 0, offset: 0, flip: true, slideX: 12, slideY: -7 }, identity4(), frame, frame);
    expect(pivot[12]).toBeCloseTo(0, 9);
  });

  it('est relue depuis un fichier et conforme au schéma', () => {
    const file = JSON.parse(readFileSync('tests/fixtures/mechanism-arm.vibecad', 'utf8'));
    const joint = file.document.assembly.joints[0];
    Object.assign(joint, { kind: 'planar', slideX: 4.5, slideY: -2 });
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    expect(validate(file), JSON.stringify(validate.errors)).toBe(true);
    const parsed = parseNativeFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.assembly!.joints[0]).toMatchObject({ kind: 'planar', slideX: 4.5, slideY: -2 });
  });
});
