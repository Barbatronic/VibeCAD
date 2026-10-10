import { describe, expect, it } from 'vitest';
import { FORMAT_ID, parseNativeFile, SCHEMA_VERSION, serializeDocument, type Migration } from '../../src/io/native-format';
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
