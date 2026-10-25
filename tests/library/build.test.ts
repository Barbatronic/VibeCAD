/**
 * Bibliothèque de composants : chaque composant se calcule (un solide, aucune erreur). Avec
 * LIBRARY_OUT=<dépôt VibeCAD-Components>, écrit aussi ses fichiers : <collection>/<id>.vibecad,
 * .step et .json, et collection.json. Les vignettes .png : tests/e2e/library-previews.spec.ts.
 *   npm run library:build
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { partMaterial, partMaterialId } from '../../src/domain/part-material';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import type { CadDocument } from '../../src/domain/model';
import { GeometryService } from '../../src/workers/geometry-service';
import { getKernel } from '../helpers/kernel';
import { COLLECTIONS, COMPONENTS } from './components';

const OUT = process.env.LIBRARY_OUT ? resolve(process.env.LIBRARY_OUT) : null;
/** Date fixe : les fichiers ne changent que si le modèle change. */
const SAVED_AT = '2026-10-25T00:00:00.000Z';

/**
 * Identifiants tirés au hasard (`sk-60u517wj`) renumérotés dans l'ordre d'apparition (`sk-1`) : le
 * fichier ne change que si le modèle change. Chaque identifiant est remplacé partout à l'identique.
 */
function stableIds(text: string): string {
  const map = new Map<string, string>();
  const counts = new Map<string, number>();
  return text.replace(/"([a-z]+)-([a-z0-9]{8})"/g, (_whole, prefix: string, rest: string) => {
    const key = `${prefix}-${rest}`;
    if (!map.has(key)) {
      const n = (counts.get(prefix) ?? 0) + 1;
      counts.set(prefix, n);
      map.set(key, `${prefix}-${n}`);
    }
    return `"${map.get(key)}"`;
  });
}

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('bibliothèque de composants', () => {
  it.each(COMPONENTS.map((c) => [`${c.collection}/${c.id}`, c] as const))('%s se calcule', (_key, spec) => {
    const doc = spec.build();
    const [result] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
    expect(result!.statuses.filter((s) => s.state !== 'ok').map((s) => s.message ?? s.state)).toEqual([]);
    expect(result!.analysis?.solidCount).toBe(1);
    // Esquisses entièrement cotées : vertes à l'insertion, modifiables par leurs cotes.
    expect(result!.sketches).toHaveLength(doc.parts[0]!.features.filter((f) => f.type === 'sketch').length);
    expect(result!.sketches.map((k) => ({ sketch: k.featureId, dof: k.dof, converged: k.converged }))).toEqual(
      result!.sketches.map((k) => ({ sketch: k.featureId, dof: 0, converged: true })),
    );
    if (!OUT) return;

    const dir = join(OUT, spec.collection);
    mkdirSync(dir, { recursive: true });
    const part = doc.parts[0]!;
    const analysis = result!.analysis!;
    const material = partMaterial(partMaterialId(part));
    writeFileSync(join(dir, `${spec.id}.vibecad`), stableIds(serializeDocument({ ...doc, createdAt: SAVED_AT, modifiedAt: SAVED_AT }, SAVED_AT)) + '\n');
    // Le fichier écrit se relit sans avertissement et redonne le même volume.
    const reread = parseNativeFile(readFileSync(join(dir, `${spec.id}.vibecad`), 'utf8'));
    expect(reread.ok && reread.warnings).toEqual([]);
    const [again] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument((reread as { doc: CadDocument }).doc);
    expect(again!.analysis!.volume).toBeCloseTo(analysis.volume, 3);
    const step = new GeometryService(kernel).exportStep(documentForWorker(doc), [part.id]);
    // L'en-tête STEP porte une date : fixée, pour des fichiers reproductibles.
    writeFileSync(join(dir, `${spec.id}.step`), step.text.replace(/'\d{4}-\d{2}-\d{2}T[\d:.]+'/, `'${SAVED_AT.slice(0, 19)}'`));
    const bbox = analysis.bbox!;
    const round = (v: number) => Math.round(v * 100) / 100;
    const sheet = {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      tags: spec.tags,
      dimensions: spec.dimensions,
      material: material.id,
      volume: round(analysis.volume),
      mass: round((analysis.volume / 1000) * material.density),
      size: [round(bbox.max.x - bbox.min.x), round(bbox.max.y - bbox.min.y), round(bbox.max.z - bbox.min.z)],
      files: { vibecad: `${spec.id}.vibecad`, step: `${spec.id}.step`, preview: `${spec.id}.png` },
    };
    writeFileSync(join(dir, `${spec.id}.json`), JSON.stringify(sheet, null, 2) + '\n');
  });

  it.runIf(!!OUT)('fiches des collections', () => {
    for (const c of COLLECTIONS) {
      mkdirSync(join(OUT!, c.id), { recursive: true });
      writeFileSync(join(OUT!, c.id, 'collection.json'), JSON.stringify({ name: c.name, description: c.description }, null, 2) + '\n');
    }
  });
});
