/**
 * Dessins techniques simples (mise en plan, gabarit 1:1) : une page en millimètres avec des
 * traits (continus, interrompus, fins) et des textes, écrite en SVG ou en PDF.
 * Le PDF est produit sans dépendance (PDF 1.4, police Helvetica, encodage WinAnsi).
 */
import type { Vec2 } from '../math/vec';

export type LineStyle = 'thick' | 'thin' | 'hidden' | 'cut';

export interface DrawingPage {
  /** Format de la page (mm), origine en bas à gauche. */
  width: number;
  height: number;
  lines: { a: Vec2; b: Vec2; style: LineStyle }[];
  /** Textes : `size` = taille de police (mm), `angle` en degrés (sens trigonométrique). */
  texts: { at: Vec2; text: string; size: number; anchor?: 'start' | 'middle' | 'end'; angle?: number }[];
}

const STROKES: Record<LineStyle, { width: number; color: string; dash?: number[] }> = {
  thick: { width: 0.5, color: '#000000' },
  thin: { width: 0.25, color: '#000000' },
  hidden: { width: 0.25, color: '#555555', dash: [2, 1.2] },
  cut: { width: 0.2, color: '#ff0000' },
};

const f = (v: number) => {
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Une page en SVG (unités : mm). */
export function drawingToSvg(page: DrawingPage, title: string): string {
  const y = (v: number) => page.height - v;
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(page.width)}mm" height="${f(page.height)}mm" viewBox="0 0 ${f(page.width)} ${f(page.height)}">`,
    `  <title>${esc(title)}</title>`,
    `  <rect width="${f(page.width)}" height="${f(page.height)}" fill="#ffffff"/>`,
  ];
  for (const l of page.lines) {
    const s = STROKES[l.style];
    out.push(
      `  <line x1="${f(l.a.x)}" y1="${f(y(l.a.y))}" x2="${f(l.b.x)}" y2="${f(y(l.b.y))}" stroke="${s.color}" stroke-width="${s.width}"${s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : ''} stroke-linecap="round"/>`,
    );
  }
  for (const t of page.texts) {
    const rotate = t.angle ? ` transform="rotate(${f(-t.angle)} ${f(t.at.x)} ${f(y(t.at.y))})"` : '';
    out.push(
      `  <text x="${f(t.at.x)}" y="${f(y(t.at.y))}" font-family="Helvetica, Arial, sans-serif" font-size="${f(t.size)}" text-anchor="${t.anchor ?? 'start'}"${rotate}>${esc(t.text)}</text>`,
    );
  }
  out.push('</svg>');
  return out.join('\n');
}

const MM = 72 / 25.4;

/** Texte PDF en WinAnsi (accents français conservés). */
function pdfString(s: string): string {
  let out = '(';
  for (const ch of s) {
    const code = ch === '’' ? 0x92 : ch === '×' ? 0xd7 : ch === 'Ø' ? 0xd8 : ch === '°' ? 0xb0 : ch === '—' ? 0x97 : ch === '…' ? 0x85 : ch === '«' ? 0xab : ch === '»' ? 0xbb : ch.charCodeAt(0);
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${(code > 255 ? 63 : code).toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

/** Largeur approximative d'un texte Helvetica (pour centrer). */
const textWidth = (s: string, size: number) => s.length * size * 0.5;

/** Plusieurs pages en PDF (une page par dessin). */
export function drawingsToPdf(pages: DrawingPage[], title: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  const contents: { id: number; page: DrawingPage }[] = [];
  for (const page of pages) {
    const ops: string[] = ['1 J 1 j'];
    for (const l of page.lines) {
      const s = STROKES[l.style];
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16) / 255);
      ops.push(`${f(r!)} ${f(g!)} ${f(b!)} RG ${f(s.width * MM)} w [${(s.dash ?? []).map((d) => f(d * MM)).join(' ')}] 0 d`);
      ops.push(`${f(l.a.x * MM)} ${f(l.a.y * MM)} m ${f(l.b.x * MM)} ${f(l.b.y * MM)} l S`);
    }
    for (const t of page.texts) {
      const size = t.size * MM;
      const w = textWidth(t.text, size);
      const shift = t.anchor === 'middle' ? w / 2 : t.anchor === 'end' ? w : 0;
      const a = ((t.angle ?? 0) * Math.PI) / 180;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      const x = t.at.x * MM - shift * c;
      const y = t.at.y * MM - shift * s;
      ops.push(`0 0 0 rg BT /F1 ${f(size)} Tf ${f(c)} ${f(s)} ${f(-s)} ${f(c)} ${f(x)} ${f(y)} Tm ${pdfString(t.text)} Tj ET`);
    }
    const stream = ops.join('\n');
    const id = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contents.push({ id, page });
  }
  // Les objets « page » suivent les contenus, puis vient l'objet « pages » qui les regroupe.
  const pagesObj = objects.length + 1 + contents.length;
  for (const c of contents) {
    pageIds.push(
      add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(c.page.width * MM)} ${f(c.page.height * MM)}] /Contents ${c.id} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`),
    );
  }
  const pagesRef = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const info = add(`<< /Title ${pdfString(title)} /Producer (VibeCAD) >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Octets bruts (latin-1) : les offsets ci-dessus comptent un caractère par octet.
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
