import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, addPart, findPart, makeExtrudeFeature, makeSketchFeature } from '../../src/domain/document';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { readZip } from '../../src/io/zip';
import { GeometryService } from '../../src/workers/geometry-service';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, rectangleSketch } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

interface ParsedObject {
  name: string;
  vertices: number[][];
  triangles: number[][];
}

/** Lecture simple du modèle 3MF produit (une balise par ligne). */
function parseModel(xml: string): { unit: string; colors: string[]; objects: ParsedObject[]; items: number } {
  const unit = /<model unit="([^"]+)"/.exec(xml)?.[1] ?? '';
  const colors = Array.from(xml.matchAll(/displaycolor="([^"]+)"/g), (m) => m[1]!);
  const objects = xml.split('<object ').slice(1).map((chunk) => ({
    name: /name="([^"]*)"/.exec(chunk)![1]!,
    vertices: Array.from(chunk.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g), (m) => [Number(m[1]), Number(m[2]), Number(m[3])]),
    triangles: Array.from(chunk.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g), (m) => [Number(m[1]), Number(m[2]), Number(m[3])]),
  }));
  return { unit, colors, objects, items: (xml.match(/<item /g) ?? []).length };
}

/** Maillage fermé et orienté : chaque arête orientée apparaît une fois, et son inverse une fois. */
function isClosedOriented(o: ParsedObject): boolean {
  const edges = new Map<string, number>();
  for (const [a, b, c] of o.triangles) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = `${u}>${v}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of edges) {
    const [u, v] = key.split('>');
    if (count !== 1 || edges.get(`${v}>${u}`) !== 1) return false;
  }
  return true;
}

function volumeOf(o: ParsedObject): number {
  let v = 0;
  for (const t of o.triangles) {
    const [p, q, r] = [o.vertices[t[0]!]!, o.vertices[t[1]!]!, o.vertices[t[2]!]!];
    v += (p[0]! * (q[1]! * r[2]! - q[2]! * r[1]!) - p[1]! * (q[0]! * r[2]! - q[2]! * r[0]!) + p[2]! * (q[0]! * r[1]! - q[1]! * r[0]!)) / 6;
  }
  return v;
}

describe('export 3MF', () => {
  it('produit une archive valide : unité mm, noms, couleurs, maillages fermés au bon volume', async () => {
    const { doc: plate, ids } = buildPlateDocument();
    // Seconde pièce : une cale 15 × 15 × 10.
    const added = addPart(plate);
    let doc = added.doc;
    const part2 = findPart(doc, added.partId)!;
    const sk = makeSketchFeature(doc, part2, { kind: 'plane', plane: 'XY', offset: 0 });
    doc = addFeature(doc, added.partId, { ...sk, params: rectangleSketch(sk.params, 15, 15).sketch });
    doc = addFeature(doc, added.partId, makeExtrudeFeature(doc, findPart(doc, added.partId)!, sk.id, 10));

    const svc = new GeometryService(kernel);
    const { bytes, warnings } = await svc.export3mf(documentForWorker(doc), [ids.partId, added.partId]);
    expect(warnings).toEqual([]);
    mkdirSync(resolve('tests/output'), { recursive: true });
    writeFileSync(resolve('tests/output/plaque-et-cale.3mf'), bytes);

    const files = await readZip(bytes);
    expect(Array.from(files.keys()).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    expect(new TextDecoder().decode(files.get('_rels/.rels'))).toContain('Target="/3D/3dmodel.model"');
    const model = parseModel(new TextDecoder().decode(files.get('3D/3dmodel.model')));
    expect(model.unit).toBe('millimeter');
    expect(model.items).toBe(2);
    expect(model.objects.map((o) => o.name)).toEqual([findPart(doc, ids.partId)!.name, findPart(doc, added.partId)!.name]);
    expect(model.colors).toEqual([findPart(doc, ids.partId)!.color, findPart(doc, added.partId)!.color].map((c) => `${c.toUpperCase()}FF`));
    for (const o of model.objects) expect(isClosedOriented(o)).toBe(true);
    // Le trou est facetté : volume du maillage proche du volume exact (à 0,5 % près).
    const exact = 9000 - Math.PI * 9 * 5;
    expect(Math.abs(volumeOf(model.objects[0]!) - exact) / exact).toBeLessThan(0.005);
    expect(volumeOf(model.objects[1]!)).toBeCloseTo(15 * 15 * 10, 3);
    // Compressé : bien plus petit que le XML.
    expect(bytes.length).toBeLessThan(files.get('3D/3dmodel.model')!.length / 3);
  });
});
