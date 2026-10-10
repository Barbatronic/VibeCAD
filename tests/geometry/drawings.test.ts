import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { billOfMaterials, bomCsv, projectView, roundNotes, technicalDrawing, templatePages, VIEWS } from '../../src/app/drawings';
import { addInstance } from '../../src/domain/document';
import { RecomputeEngine } from '../../src/features/engine';
import type { CadDocument } from '../../src/domain/model';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { drawingsToPdf, drawingToSvg } from '../../src/io/drawing';
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
    expect(texts).toEqual(expect.arrayContaining(['60', '5', '30', 'Vue de face', 'Vue de dessus', 'Vue de gauche', 'Échelle 2:1', 'Ø 6']));
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
    expect(text).toContain('(\\311chelle 2:1)');
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
    expect(csv).toContain(';8,86\r\n');
  });
});
