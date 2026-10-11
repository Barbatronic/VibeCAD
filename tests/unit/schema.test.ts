import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FABRICATION } from '../../src/app/fabrication';
import { addResource, newResourceId } from '../../src/domain/document';
import { serializeDocument } from '../../src/io/native-format';
import { buildPlateDocument } from '../helpers/plate';

const schema = JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8'));

describe('schéma JSON publié du format .vibecad', () => {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

  it('valide un projet réel (esquisses, extrusion, poche, ressource importée)', () => {
    let { doc } = buildPlateDocument();
    doc = addResource(doc, {
      id: newResourceId(doc),
      kind: 'step',
      fileName: 'piece.step',
      encoding: 'utf8',
      data: 'ISO-10303-21;\nEND-ISO-10303-21;\n',
      byteLength: 32,
      sha256: 'a'.repeat(64),
      importedAt: '2026-10-09T12:00:00.000Z',
    });
    const file = JSON.parse(serializeDocument(doc));
    const ok = validate(file);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('valide les réglages de fabrication (matériaux de découpe)', () => {
    const { doc, ids } = buildPlateDocument();
    const fabrication = { ...DEFAULT_FABRICATION, laser: { ...DEFAULT_FABRICATION.laser, items: [{ partId: ids.partId, copies: 1, materialId: 'mat-3' }] } };
    const file = JSON.parse(serializeDocument({ ...doc, fabrication }));
    validate(file);
    expect(validate.errors ?? []).toEqual([]);
  });

  it('valide les études de simulation', () => {
    const { doc, ids } = buildPlateDocument();
    const face = { featureId: ids.extrude, role: 'start' as const };
    const simulation = { studies: [{ partId: ids.partId, materialId: 'pla', quality: 'fine' as const, fixed: [face], load: { faces: [face], kind: 'force' as const, value: 50, direction: 'push' as const } }] };
    validate(JSON.parse(serializeDocument({ ...doc, simulation })));
    expect(validate.errors ?? []).toEqual([]);
  });

  it('refuse un fichier incohérent', () => {
    const { doc } = buildPlateDocument();
    const file = JSON.parse(serializeDocument(doc));
    file.document.units = 'inch';
    file.document.parts[0].color = 'bleu';
    expect(validate(file)).toBe(false);
  });
});
