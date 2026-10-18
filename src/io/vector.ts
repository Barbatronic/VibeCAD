/**
 * Fichiers vectoriels pour la découpe laser : SVG (en mm, échelle 1:1) et DXF (R12, unités mm).
 * Convention des couleurs : rouge = découpe, bleu = gravure, vert en tirets = lignes de pli d'une
 * tôle (à marquer légèrement, ou à désactiver). Les plaques sont posées côte à côte,
 * séparées de 20 mm.
 */
import type { Vec2 } from '../math/vec';

export interface VectorSheetItem {
  loops: Vec2[][];
  label?: { at: Vec2; text: string };
  /** Tôle : lignes de pli (repères, en tirets verts ; calque PLIAGE). */
  bends?: { a: Vec2; b: Vec2 }[];
}

export interface VectorDocument {
  sheet: { w: number; h: number };
  sheets: { items: VectorSheetItem[] }[];
  /** Graver le nom des pièces (texte bleu). */
  engraveNames: boolean;
}

const GAP = 20;
const fmt = (v: number) => {
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toSvg(doc: VectorDocument): string {
  const count = Math.max(doc.sheets.length, 1);
  const width = count * doc.sheet.w + (count - 1) * GAP;
  const height = doc.sheet.h;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(height)}mm" viewBox="0 0 ${fmt(width)} ${fmt(height)}">`);
  out.push('  <title>Découpe laser — VibeCAD (rouge : découpe, bleu : gravure, vert en tirets : lignes de pli)</title>');
  doc.sheets.forEach((sheet, i) => {
    const ox = i * (doc.sheet.w + GAP);
    // L'axe Y du SVG descend : on retourne les coordonnées pour garder l'orientation de la pièce.
    const pt = (p: Vec2) => `${fmt(ox + p.x)},${fmt(height - p.y)}`;
    out.push(`  <g id="plaque-${i + 1}">`);
    out.push(`    <rect x="${fmt(ox)}" y="0" width="${fmt(doc.sheet.w)}" height="${fmt(doc.sheet.h)}" fill="none" stroke="#999999" stroke-width="0.2" stroke-dasharray="2 2"/>`);
    for (const item of sheet.items) {
      for (const loop of item.loops) out.push(`    <polygon points="${loop.map(pt).join(' ')}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`);
      for (const b of item.bends ?? []) out.push(`    <line x1="${fmt(ox + b.a.x)}" y1="${fmt(height - b.a.y)}" x2="${fmt(ox + b.b.x)}" y2="${fmt(height - b.b.y)}" stroke="#00a000" stroke-width="0.1" stroke-dasharray="2 1"/>`);
      if (doc.engraveNames && item.label) {
        out.push(
          `    <text x="${fmt(ox + item.label.at.x)}" y="${fmt(height - item.label.at.y)}" font-family="sans-serif" font-size="4" text-anchor="middle" fill="#0000ff">${esc(item.label.text)}</text>`,
        );
      }
    }
    out.push('  </g>');
  });
  out.push('</svg>');
  return out.join('\n');
}

/** DXF R12 : polylignes fermées (calque DECOUPE, rouge), textes (GRAVURE, bleu), lignes de pli (PLIAGE, vert). */
export function toDxf(doc: VectorDocument): string {
  const lines: string[] = [];
  const g = (code: number, value: string | number) => lines.push(String(code), typeof value === 'number' ? fmt(value) : value);
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$INSUNITS');
  lines.push('70', '4');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  lines.push('70', '3');
  for (const [name, color] of [
    ['DECOUPE', 1],
    ['GRAVURE', 5],
    ['PLIAGE', 3],
  ] as const) {
    g(0, 'LAYER');
    g(2, name);
    lines.push('70', '0', '62', String(color));
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  doc.sheets.forEach((sheet, i) => {
    const ox = i * (doc.sheet.w + GAP);
    for (const item of sheet.items) {
      for (const loop of item.loops) {
        g(0, 'POLYLINE');
        g(8, 'DECOUPE');
        lines.push('66', '1', '70', '1');
        g(10, 0);
        g(20, 0);
        g(30, 0);
        for (const p of loop) {
          g(0, 'VERTEX');
          g(8, 'DECOUPE');
          g(10, ox + p.x);
          g(20, p.y);
          g(30, 0);
        }
        g(0, 'SEQEND');
        g(8, 'DECOUPE');
      }
      for (const b of item.bends ?? []) {
        g(0, 'LINE');
        g(8, 'PLIAGE');
        g(10, ox + b.a.x);
        g(20, b.a.y);
        g(30, 0);
        g(11, ox + b.b.x);
        g(21, b.b.y);
        g(31, 0);
      }
      if (doc.engraveNames && item.label) {
        g(0, 'TEXT');
        g(8, 'GRAVURE');
        g(10, ox + item.label.at.x);
        g(20, item.label.at.y);
        g(30, 0);
        g(40, 4);
        g(1, item.label.text.normalize('NFD').replace(/[^\x20-\x7e]/g, ''));
        lines.push('72', '1', '11', fmt(ox + item.label.at.x), '21', fmt(item.label.at.y), '31', '0');
      }
    }
  });
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return `${lines.join('\n')}\n`;
}
