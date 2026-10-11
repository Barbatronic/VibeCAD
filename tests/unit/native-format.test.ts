import { describe, expect, it } from 'vitest';
import { FORMAT_ID, parseNativeFile, SCHEMA_VERSION, serializeDocument, type Migration } from '../../src/io/native-format';
import { DEFAULT_FABRICATION } from '../../src/app/fabrication';
import { solveSketch } from '../../src/sketch/solver';
import { buildPlateDocument, setDimension } from '../helpers/plate';

describe('format natif .vibecad', () => {
  it('fait un aller-retour sans perte et conserve les dépendances', () => {
    const { doc, ids } = buildPlateDocument();
    const text = serializeDocument(doc, '2026-10-09T12:00:00.000Z');
    const file = JSON.parse(text);
    expect(file.format).toBe(FORMAT_ID);
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.document.units).toBe('mm');
    const features = file.document.parts[0].features;
    expect(features.map((f: { type: string }) => f.type)).toEqual(['sketch', 'extrude', 'sketch', 'pocket']);
    expect(features[1].dependsOn).toEqual([ids.sketch1]);
    expect(features[2].dependsOn).toEqual([ids.extrude]);
    expect(features[3].dependsOn).toEqual([ids.sketch2]);
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc).toEqual(doc);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.savedAt).toBe('2026-10-09T12:00:00.000Z');
  });

  it('conserve les matériaux de découpe et lit l’ancien réglage à une seule plaque', () => {
    const { doc, ids } = buildPlateDocument();
    const fabrication = {
      ...DEFAULT_FABRICATION,
      laser: { ...DEFAULT_FABRICATION.laser, items: [{ partId: ids.partId, copies: 2, materialId: 'mat-5' }] },
    };
    const withFab = { ...doc, fabrication };
    const parsed = parseNativeFile(serializeDocument(withFab, '2026-10-10T12:00:00.000Z'));
    expect(parsed.ok && parsed.doc.fabrication).toEqual(fabrication);
    // Fichier des premières versions : plaque, épaisseur et kerf uniques.
    const legacy = JSON.parse(serializeDocument(withFab, '2026-10-10T12:00:00.000Z'));
    legacy.document.fabrication.laser = { sheet: { w: 600, h: 400 }, thickness: 4.5, kerf: 0.1, spacing: 3, items: [{ partId: ids.partId, copies: 1 }] };
    const old = parseNativeFile(JSON.stringify(legacy));
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(old.doc.fabrication!.laser).toEqual({
      materials: [{ id: 'mat-1', name: 'Plaque 4,5 mm', thickness: 4.5, sheet: { w: 600, h: 400 }, kerf: 0.1 }],
      spacing: 3,
      items: [{ partId: ids.partId, copies: 1 }],
    });
  });

  it('conserve les études de simulation et ignore celles d’une pièce disparue', () => {
    const { doc, ids } = buildPlateDocument();
    const face = (role: 'start' | 'end') => ({ featureId: ids.extrude, role });
    const study = { partId: ids.partId, materialId: 'pla', quality: 'normal' as const, fixed: [face('start')], load: { faces: [face('end')], kind: 'mass' as const, value: 2, direction: '-z' as const } };
    const simulation = { studies: [study, { ...study, partId: 'disparue' }] };
    const parsed = parseNativeFile(serializeDocument({ ...doc, simulation }));
    expect(parsed.ok && parsed.doc.simulation).toEqual({ studies: [study] });
  });

  it('conserve la visserie de l’assemblage et refuse une longueur hors norme', () => {
    const { doc, ids } = buildPlateDocument();
    const edge = { faces: [{ featureId: ids.pocket, role: 'side' as const }, { featureId: ids.extrude, role: 'end' as const }] as [never, never] };
    const assembly = {
      instances: [{ id: 'i1', partId: ids.partId, name: 'Plaque', position: { x: 0, y: 0, z: 0 } }],
      joints: [],
      fasteners: [
        { id: 'fs1', kind: 'iso4762' as const, size: 'M3' as const, length: 12, at: { instanceId: 'i1', edge } },
        { id: 'fs2', kind: 'iso4032' as const, size: 'M3' as const, at: { instanceId: 'i1', edge }, flip: true },
      ],
    };
    const text = serializeDocument({ ...doc, assembly });
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc.assembly).toEqual(assembly);
    const bad = JSON.parse(text);
    bad.document.assembly.fasteners[0].length = 13;
    const refused = parseNativeFile(JSON.stringify(bad));
    expect(refused.ok).toBe(false);
  });

  it('permet de modifier la première esquisse après réouverture', () => {
    const { doc, ids } = buildPlateDocument();
    const parsed = parseNativeFile(serializeDocument(doc));
    if (!parsed.ok) throw new Error(parsed.error);
    const edited = setDimension(parsed.doc, ids.sketch1, ids.widthConstraint, 80);
    const sketch = edited.parts[0]!.features[0]!;
    if (sketch.type !== 'sketch') throw new Error('esquisse attendue');
    const res = solveSketch(sketch.params);
    expect(res.converged).toBe(true);
    const xs = res.sketch.entities.flatMap((e) => (e.type === 'point' ? [e.x] : []));
    expect(Math.max(...xs)).toBeCloseTo(80, 9);
  });

  it('refuse proprement les fichiers invalides', () => {
    expect(parseNativeFile('pas du json').ok).toBe(false);
    const other = parseNativeFile(JSON.stringify({ format: 'autre' }));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error).toMatch(/n’est pas un projet/);
    const future = parseNativeFile(JSON.stringify({ format: FORMAT_ID, schemaVersion: SCHEMA_VERSION + 1, document: {} }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toMatch(/plus récente/);
    const { doc } = buildPlateDocument();
    const file = JSON.parse(serializeDocument(doc));
    file.document.parts[0].features[1].params.distance = 'cinq';
    const damaged = parseNativeFile(JSON.stringify(file));
    expect(damaged.ok).toBe(false);
    if (!damaged.ok) expect(damaged.details.join('\n')).toMatch(/features\[1\]\.params\.distance : nombre attendu/);
  });

  it('applique les migrations explicites dans l’ordre', () => {
    const { doc } = buildPlateDocument();
    const current = JSON.parse(serializeDocument(doc));
    // Format fictif « 1 » où les pièces s'appelaient « bodies » ; la version courante simulée est 2.
    const old = { ...current, schemaVersion: 1, document: { ...current.document, bodies: current.document.parts } };
    delete old.document.parts;
    const migrations: Record<number, Migration> = {
      1: (raw) => {
        const d = raw.document as Record<string, unknown>;
        const { bodies, ...rest } = d;
        return { ...raw, document: { ...rest, parts: bodies } };
      },
    };
    const parsed = parseNativeFile(JSON.stringify(old), migrations, 2);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migratedFrom).toBe(1);
    expect(parsed.doc.parts).toHaveLength(1);
    const missing = parseNativeFile(JSON.stringify(old), {}, 2);
    expect(missing.ok).toBe(false);
  });

  it('signale sans bloquer une référence vers une étape absente', () => {
    const { doc } = buildPlateDocument();
    const file = JSON.parse(serializeDocument(doc));
    file.document.parts[0].features.splice(0, 1);
    const parsed = parseNativeFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.warnings.length).toBeGreaterThan(0);
  });
});
