import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import { billOfMaterials, bomCsv, DEFAULT_DIMENSIONS, dragDimension, linearAt, nearestAnchor, nearestCircle, projectView, roundNotes, technicalDrawing, templatePages, VIEWS } from '../../src/app/drawings';
import { addFeature, addInstance, addPart, createDocument, makeBeamFeature, makeGearFeature } from '../../src/domain/document';
import { RecomputeEngine } from '../../src/features/engine';
import type { CadDocument, PartDrawing } from '../../src/domain/model';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { drawingsToPdf, drawingToDxf, drawingToSvg } from '../../src/io/drawing';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
let mesh: MeshData;
let doc: CadDocument;
let partId: string;
let volume: number;
beforeAll(async () => {
  kernel = await getKernel();
  const built = buildPlateDocument();
  doc = built.doc;
  partId = built.ids.partId;
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(doc);
  mesh = engine.meshOf(res!, { linearDeflection: 0.02, angularDeflection: 0.2 })!;
  volume = res!.analysis!.volume;
});

/** Écrit un fichier d'inspection dans tests/output (ignoré par git). */
function keep(name: string, data: string | Uint8Array) {
  mkdirSync('tests/output', { recursive: true });
  writeFileSync(`tests/output/${name}`, data);
}

describe('mise en plan modifiable', () => {
  const info = { partName: 'Plaque', projectName: 'Plaque percée', material: 'Aluminium 5 mm' };
  const texts = (settings?: PartDrawing) => technicalDrawing(mesh, info, undefined, settings).page.texts.map((t) => t.text);

  it('sans réglage : A4, échelle qui tient, trois cotes d’encombrement, matière au cartouche', () => {
    const { layout, scale, page } = technicalDrawing(mesh, info);
    expect([layout.format, layout.width, scale]).toEqual(['A4', 297, 2]);
    expect(layout.dimensions.map((d) => [d.dim.id, d.detached, d.texts[0]?.text])).toEqual([
      ['auto-largeur', false, '60'],
      ['auto-hauteur', false, '5'],
      ['auto-profondeur', false, '30'],
    ]);
    expect(page.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['Plaque', 'Aluminium 5 mm', 'A4', '2:1']));
  });

  it('feuille, échelle et cartouche choisis', () => {
    const { layout, scale, page } = technicalDrawing(mesh, info, undefined, { partId, format: 'A3', scale: 1, title: { title: 'Platine moteur', number: 'P-012', author: 'A. Martin', date: '16/11/2026', material: 'PMMA 5 mm', note: 'Casser les angles' } });
    expect([layout.format, page.width, page.height, scale]).toEqual(['A3', 420, 297, 1]);
    const all = page.texts.map((t) => t.text);
    expect(all).toEqual(expect.arrayContaining(['Platine moteur', 'P-012', 'A. Martin', '16/11/2026', 'PMMA 5 mm', '1:1', 'A3', 'Cotes en mm · projection européenne · Casser les angles']));
    expect(all).not.toContain('Plaque');
    expect(all).not.toContain('Aluminium 5 mm');
  });

  it('vues déplacées : la vue de dessus reste sous la vue de face, la vue de gauche à sa droite', () => {
    const base = technicalDrawing(mesh, info).layout.views;
    const moved = technicalDrawing(mesh, info, undefined, { partId, views: { face: { x: 10, y: -4 }, dessus: { x: 99, y: -6 }, gauche: { x: 7, y: 99 } } }).layout.views;
    const delta = (name: 'face' | 'dessus' | 'gauche') => [moved[name].box.x - base[name].box.x, moved[name].box.y - base[name].box.y];
    expect(delta('face')).toEqual([10, -4]);
    expect(delta('dessus')).toEqual([10, -10]);
    expect(delta('gauche')).toEqual([17, -4]);
  });

  it('accroches : les sommets de la pièce et le cercle du trou, dans la vue où il est vu de face', () => {
    const { layout } = technicalDrawing(mesh, info);
    const { face, dessus } = layout.views;
    expect(face.anchors.circles).toEqual([]);
    expect(dessus.anchors.circles).toHaveLength(1);
    expect(dessus.anchors.circles[0]).toMatchObject({ radius: 3, full: true });
    const corner = dessus.toPaper({ x: dessus.min.x, y: dessus.min.y });
    expect(nearestAnchor(layout, { x: corner.x + 0.4, y: corner.y - 0.3 }, 1)).toMatchObject({ view: 'dessus', point: { x: dessus.min.x, y: dessus.min.y } });
    expect(nearestAnchor(layout, { x: corner.x - 8, y: corner.y - 8 }, 1)).toBeNull();
    const c = dessus.toPaper(dessus.anchors.circles[0]!.center);
    expect(nearestCircle(layout, { x: c.x + 3 * layout.scale + 0.3, y: c.y }, 1)?.view).toBe('dessus');
    expect(nearestCircle(layout, c, 1)).toBeNull();
  });

  it('cotes ajoutées : linéaire selon l’endroit où on la pose, diamètre du trou', () => {
    const { layout } = technicalDrawing(mesh, info);
    const v = layout.views.dessus;
    const a = { x: v.min.x, y: v.min.y };
    const b = { x: v.max.x, y: v.max.y };
    const [pa, pb] = [v.toPaper(a), v.toPaper(b)];
    // Au-dessus des points : horizontale ; à côté : verticale ; entre les deux : alignée.
    expect(linearAt(v, a, b, { x: (pa.x + pb.x) / 2, y: pb.y + 12 })).toEqual({ axis: 'x', offset: 12 });
    expect(linearAt(v, a, b, { x: pa.x - 9, y: (pa.y + pb.y) / 2 })).toEqual({ axis: 'y', offset: -9 });
    expect(linearAt(v, a, b, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }).axis).toBe('aligned');
    const hole = v.anchors.circles[0]!;
    const dimensions: PartDrawing['dimensions'] = [
      ...DEFAULT_DIMENSIONS,
      { id: 'cote-1', view: 'dessus', kind: 'linear', a, b, axis: 'x', offset: 12 },
      { id: 'cote-2', view: 'dessus', kind: 'linear', a, b, axis: 'aligned', offset: 6 },
      { id: 'cote-3', view: 'dessus', kind: 'linear', a: { x: v.min.x, y: v.min.y }, b: hole.center, axis: 'y', offset: -14 },
      { id: 'cote-4', view: 'dessus', kind: 'diameter', a: hole.center, radius: hole.radius, angle: 45, offset: 6 },
    ];
    const placed = technicalDrawing(mesh, info, undefined, { partId, dimensions }).layout.dimensions;
    expect(placed.map((d) => [d.dim.id, d.detached, d.texts[0]?.text]).slice(3)).toEqual([
      ['cote-1', false, '60'],
      ['cote-2', false, '67,08'],
      ['cote-3', false, '15'],
      ['cote-4', false, 'Ø 6'],
    ]);
    // La ligne de la cote horizontale est 12 mm au-dessus du point le plus haut.
    expect(placed[3]!.grip.map((p) => p.y)).toEqual([pb.y + 12, pb.y + 12]);
    expect(texts({ partId, dimensions: [] })).not.toContain('60');
  });

  it('cote glissée : le décalage suit le pointeur, le repère d’un diamètre tourne par pas de 5°', () => {
    const { layout, scale } = technicalDrawing(mesh, info);
    const v = layout.views.face;
    expect(dragDimension(DEFAULT_DIMENSIONS[0]!, v, scale, { x: v.box.x + 5, y: v.box.y - 15 })).toEqual({ offset: -15 });
    expect(dragDimension(DEFAULT_DIMENSIONS[0]!, v, scale, { x: v.box.x + 5, y: v.box.y + v.box.h + 11 })).toEqual({ offset: 11 });
    // Dans la vue : la cote reste à 2 mm au moins de ce qu'elle mesure.
    expect(dragDimension(DEFAULT_DIMENSIONS[1]!, v, scale, { x: v.box.x + 1, y: v.box.y })).toEqual({ offset: -2 });
    const d = layout.views.dessus;
    const hole = d.anchors.circles[0]!;
    const c = d.toPaper(hole.center);
    expect(dragDimension({ id: 'k', view: 'dessus', kind: 'diameter', a: hole.center, radius: 3, angle: 45, offset: 6 }, d, scale, { x: c.x - 10, y: c.y + 10.4 })).toEqual({ angle: 135, offset: 8.4 });
  });

  it('cote détachée quand la pièce change : signalée, pas exportée', () => {
    const dimensions: PartDrawing['dimensions'] = [
      { id: 'cote-1', view: 'dessus', kind: 'linear', a: { x: -3, y: -2 }, b: { x: 30, y: 15 }, axis: 'x', offset: 8 },
      { id: 'cote-2', view: 'dessus', kind: 'diameter', a: { x: 15, y: 15 }, radius: 4, angle: 45, offset: 6 },
    ];
    const { layout, page } = technicalDrawing(mesh, info, undefined, { partId, dimensions });
    expect(layout.dimensions.map((d) => d.detached)).toEqual([true, true]);
    expect(page.texts.map((t) => t.text)).not.toContain('Ø 8');
  });

  it('les retouches suivent le projet dans son fichier ; celles d’une pièce disparue sont retirées', () => {
    const drawing: PartDrawing = {
      partId,
      format: 'A3',
      scale: 0.5,
      views: { face: { x: 4, y: -2 }, gauche: { x: 6, y: 0 } },
      dimensions: [
        { id: 'auto-largeur', view: 'face', kind: 'overall', axis: 'x', offset: 9 },
        { id: 'cote-1', view: 'dessus', kind: 'linear', a: { x: 0, y: 0 }, b: { x: 60, y: 30 }, axis: 'aligned', offset: 6 },
        { id: 'cote-2', view: 'dessus', kind: 'diameter', a: { x: 15, y: 15 }, radius: 3, angle: 135, offset: 6 },
      ],
      title: { author: 'A. Martin', number: 'P-012' },
    };
    const fabrication = { print: { bed: { x: 220, y: 220, z: 250 }, spacing: 5, items: [] }, laser: { materials: [], spacing: 3, items: [] }, drawings: [drawing, { partId: 'part-disparue', format: 'A3' as const }] };
    const text = serializeDocument({ ...doc, fabrication }, '2026-11-16T10:00:00.000Z');
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
    const parsed = parseNativeFile(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.doc.fabrication?.drawings).toEqual([drawing]);
    const bad = parseNativeFile(serializeDocument({ ...doc, fabrication: { ...fabrication, drawings: [{ partId, scale: -1 }] } }, '2026-11-16T10:00:00.000Z'));
    expect(bad.ok).toBe(false);
  });

  it('export DXF : traits par calque, traits cachés interrompus, textes avec accents', () => {
    const dxf = drawingToDxf(technicalDrawing(mesh, info, undefined, { partId, title: { author: 'Hélène' } }).page);
    const codes = dxf.split('\n');
    const layerOf = (i: number) => codes[codes.indexOf('8', i) + 1];
    const lines = codes.flatMap((c, i) => (c === 'LINE' && codes[i - 1] === '0' ? [layerOf(i)] : []));
    expect(new Set(lines)).toEqual(new Set(['CONTOUR', 'CACHE', 'COTE']));
    expect(dxf).toContain('DASHED');
    expect(dxf).toContain('H\\U+00E9l\\U+00E8ne');
    expect(dxf).toContain('\\U+00D8 6');
    expect(dxf.endsWith('EOF')).toBe(true);
    keep('mise-en-plan.dxf', dxf);
  });
});

describe('mise en plan', () => {
  it('vue de face de la plaque : 60 × 5, le trou apparaît en traits cachés', () => {
    const v = projectView(mesh, VIEWS.face);
    expect(v.max.x - v.min.x).toBeCloseTo(60, 3);
    expect(v.max.y - v.min.y).toBeCloseTo(5, 3);
    const hidden = v.lines.filter((l) => l.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    // Contours apparents du trou (cylindre vertical) : traits cachés verticaux.
    const vertical = hidden.filter((l) => Math.abs(l.a.x - l.b.x) < 1e-6 && Math.abs(l.a.y - l.b.y) > 4.9);
    expect(vertical.length).toBeGreaterThanOrEqual(2);
    // Le contour extérieur est vu.
    expect(v.lines.some((l) => !l.hidden && Math.abs(l.a.y - l.b.y) < 1e-6 && Math.abs(l.a.x - l.b.x) > 59)).toBe(true);
  });

  it('vue de dessus : le trou est vu (cercle), rien de caché', () => {
    const v = projectView(mesh, VIEWS.dessus);
    expect(v.max.x - v.min.x).toBeCloseTo(60, 3);
    expect(v.max.y - v.min.y).toBeCloseTo(30, 3);
    // Les arêtes du dessous coïncident avec celles du dessus : seules elles sont cachées.
    const visibleLength = v.lines.filter((l) => !l.hidden).reduce((s, l) => s + Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y), 0);
    expect(visibleLength).toBeGreaterThan(180 + Math.PI * 6 * 0.98);
  });

  it('liste le trou Ø 6 une seule fois', () => {
    const notes = roundNotes(mesh);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'diameter', count: 1 });
    expect(notes[0]!.value).toBeCloseTo(6, 3);
  });

  it('page A4 paysage avec cotes 60, 5 et 30 et une échelle normalisée', () => {
    const { page, scale } = technicalDrawing(mesh, { partName: 'Plaque', projectName: 'Plaque percée' });
    expect(page.width).toBe(297);
    expect(scale).toBe(2);
    const texts = page.texts.map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(['60', '5', '30', 'Vue de face', 'Vue de dessus', 'Vue de gauche', 'Échelle', '2:1', 'Ø 6']));
    for (const l of page.lines) {
      for (const p of [l.a, l.b]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(297);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(210);
      }
    }
    const svg = drawingToSvg(page, 'Plaque');
    expect(svg).toContain('width="297mm"');
    expect(svg).toContain('stroke-dasharray');
    keep('mise-en-plan.svg', svg);
    const pdf = drawingsToPdf([page], 'Mise en plan — Plaque');
    keep('mise-en-plan.pdf', pdf);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 841.89 595.276]');
    // Table des renvois : chaque objet commence bien à l'octet annoncé.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // Accents en WinAnsi : « É » (0xC9) écrit en octal.
    expect(text).toContain('(\\311chelle)');
  });
});

describe('gabarit 1:1', () => {
  it('contour de la grande face, centré sur un A4 portrait, avec trait de contrôle', () => {
    const res = templatePages([{ id: partId, name: 'Plaque' }], () => mesh, () => -1);
    expect(res.warnings).toEqual([]);
    expect(res.formats).toEqual(['A4']);
    const page = res.pages[0]!;
    expect([page.width, page.height]).toEqual([210, 297]);
    // Contour 60 × 30 à l'échelle 1 : étendue des traits épais hors trait de contrôle.
    const outline = page.lines.filter((l) => l.style === 'thick' && l.a.y > 30);
    const xs = outline.flatMap((l) => [l.a.x, l.b.x]);
    const ys = outline.flatMap((l) => [l.a.y, l.b.y]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(60, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(30, 3);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(105, 3);
    expect(page.texts.some((t) => t.text.includes('50 mm'))).toBe(true);
    keep('gabarit.pdf', drawingsToPdf(res.pages, 'Gabarit'));
  });

  it('refuse une pièce plus grande qu’un A3', () => {
    const big = { ...mesh, positions: mesh.positions.map((v) => v * 10), edgePositions: mesh.edgePositions.map((v) => v * 10) };
    const faces = big.faces.map((f) => (f.plane ? { ...f, plane: { ...f.plane, origin: { x: f.plane.origin.x * 10, y: f.plane.origin.y * 10, z: f.plane.origin.z * 10 } } } : f));
    const res = templatePages([{ id: partId, name: 'Grande' }], () => ({ ...big, faces }), () => -1);
    expect(res.pages).toHaveLength(0);
    expect(res.warnings[0]).toContain('dépasse le format A3');
  });
});

describe('nomenclature', () => {
  it('une de chaque pièce sans assemblage, quantités de l’assemblage sinon', () => {
    const solid = () => true;
    const bom = billOfMaterials(doc, solid, () => mesh, () => volume);
    expect(bom.source).toBe('parts');
    expect(bom.rows).toMatchObject([{ mark: 1, name: doc.parts[0]!.name, quantity: 1 }]);
    expect(bom.rows[0]!.size!.x).toBeCloseTo(60, 3);
    let withAsm = addInstance(doc, partId, { x: 0, y: 0, z: 0 }).doc;
    withAsm = addInstance(withAsm, partId, { x: 0, y: 0, z: 0 }).doc;
    withAsm = addInstance(withAsm, partId, { x: 0, y: 0, z: 0 }).doc;
    const asm = billOfMaterials(withAsm, solid, () => mesh, () => volume);
    expect(asm.source).toBe('assembly');
    expect(asm.rows[0]!.quantity).toBe(3);
    const csv = bomCsv(asm);
    expect(csv.startsWith('﻿Repère;Désignation;Quantité')).toBe(true);
    expect(csv).toContain(';3;60 × 30 × 5;');
    expect(csv).toContain(';8,86;Fabriquée\r\n');
  });

  it('profilés et courroie : pièces achetées, regroupées par désignation', () => {
    let d = createDocument('Châssis');
    const first = d.parts[0]!.id;
    d = addFeature(d, first, makeBeamFeature(d, d.parts[0]!));
    const second = addPart(d, 'Traverse');
    d = second.doc;
    d = addFeature(d, second.partId, makeBeamFeature(d, d.parts[1]!));
    const third = addPart(d, 'Courroie');
    d = third.doc;
    d = addFeature(d, third.partId, makeGearFeature(d, d.parts[2]!, 'belt'));
    const bom = billOfMaterials(d, () => true, () => null, () => null);
    expect(bom.rows).toHaveLength(2);
    expect(bom.rows[0]).toMatchObject({ mark: 1, quantity: 2, bought: true });
    expect(bom.rows[0]!.name).toMatch(/^Profilé V-slot 20 × 20, /);
    expect(bom.rows[1]!.name).toMatch(/^Courroie GT2, pas 2 mm, \d+ dents, largeur /);
    expect(bomCsv(bom)).toContain(';Achetée\r\n');
  });
});
