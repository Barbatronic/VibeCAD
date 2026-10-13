/**
 * Gel du format (schéma 1, 12 octobre 2026) : le projet de référence enregistré ce jour-là doit
 * toujours s'ouvrir à l'identique, sans avertissement, valider le schéma publié, se reconstruire
 * avec le même volume et se réécrire avec le même contenu (à la version du logiciel près). Si ce test
 * échoue après une modification, c'est que le format a changé : ajouter une migration et passer au
 * schéma 2 (voir docs/format-natif.md, « Stabilité du format »).
 */
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { fastenerGroups } from '../../src/app/fasteners';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, SCHEMA_VERSION, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';

const TEXT = readFileSync('tests/fixtures/reference-schema-1.vibecad', 'utf8');
const SAVED_AT = '2026-10-12T08:00:00.000Z';
/** Contenu du fichier, sans la version du logiciel qui l'a écrit (l'ordre des clés JSON est libre). */
const content = (t: string) => {
  const f = JSON.parse(t);
  delete f.generator;
  return f;
};

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('gel du format : projet de référence du schéma 1', () => {
  it('s’ouvre sans avertissement et valide le schéma publié', () => {
    expect(SCHEMA_VERSION).toBe(1);
    const parsed = parseNativeFile(TEXT);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.migratedFrom).toBeNull();
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(TEXT));
    expect(validate.errors ?? []).toEqual([]);
  });

  it('garde tout son contenu : historique, assemblage, visserie, fabrication, simulation', () => {
    const parsed = parseNativeFile(TEXT);
    if (!parsed.ok) throw new Error(parsed.error);
    const d = parsed.doc;
    expect(d.parts[0]!.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'sketch', 'pocket']);
    expect(d.assembly!.joints.map((j) => [j.kind, j.angle, j.angleLimits])).toEqual([['revolute', 30, [0, 90]]]);
    expect(fastenerGroups(d.assembly).map((g) => [g.name, g.ids.length])).toEqual([
      ['Rondelle plate ISO 7089 M6', 1],
      ['Vis CHC ISO 4762 M6 × 16', 1],
      ['Écrou H ISO 4032 M6', 1],
    ]);
    expect(d.fabrication!.laser.materials.map((m) => m.name)).toContain('Acrylique 5 mm');
    expect(d.simulation!.studies.map((s) => s.partId)).toEqual([d.parts[0]!.id, '@assembly']);
  });

  it('se réécrit avec exactement le même contenu (hors version du logiciel)', () => {
    const parsed = parseNativeFile(TEXT);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(content(serializeDocument(parsed.doc, SAVED_AT))).toEqual(content(TEXT));
  });

  it('se reconstruit : plaque 60 × 30 × 5 percée Ø 6', () => {
    const parsed = parseNativeFile(TEXT);
    if (!parsed.ok) throw new Error(parsed.error);
    const [part] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(parsed.doc);
    expect(part!.failedFeatureId).toBeNull();
    const expected = 60 * 30 * 5 - Math.PI * 9 * 5;
    expect(Math.abs(part!.analysis!.volume - expected) / expected).toBeLessThan(1e-6);
  });

  it('un champ venu d’une version plus récente est signalé (il serait perdu à l’enregistrement)', () => {
    const f = JSON.parse(TEXT);
    f.document.futurChamp = { a: 1 };
    const parsed = parseNativeFile(JSON.stringify(f));
    expect(parsed.ok && parsed.warnings.join(' ')).toMatch(/version plus récente.*futurChamp/);
  });
});
