/**
 * Génère src/sketch/font-data.ts : contours des lettres d'une police TrueType, pour l'outil Texte
 * de l'esquisse. Usage : node scripts/generate-font.mjs [police.ttf]
 *
 * Police par défaut : Open Sans Bold (licence Apache 2.0, voir THIRD_PARTY_NOTICES.md). Seuls les
 * caractères de CHARS sont repris. Chaque contour est écrit en unités de la police, sous la forme
 * d'une suite compacte « M x y L x y Q cx cy x y … » (droites et courbes quadratiques), fermée.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FONT = process.argv[2] ?? '/usr/share/fonts/truetype/open-sans/OpenSans-Bold.ttf';
const OUT = fileURLToPath(new URL('../src/sketch/font-data.ts', import.meta.url));

// ASCII imprimable et lettres du français (accents, ligatures, guillemets, euro, degré).
const CHARS =
  Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + 'àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ«»€°’';

const buf = readFileSync(FONT);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const u16 = (o) => dv.getUint16(o);
const i16 = (o) => dv.getInt16(o);
const u32 = (o) => dv.getUint32(o);

const tables = {};
for (let i = 0, n = u16(4); i < n; i++) {
  const r = 12 + i * 16;
  tables[String.fromCharCode(buf[r], buf[r + 1], buf[r + 2], buf[r + 3])] = u32(r + 8);
}
const head = tables.head;
const unitsPerEm = u16(head + 18);
const longLoca = i16(head + 50) === 1;
const numGlyphs = u16(tables.maxp + 4);
const numHMetrics = u16(tables.hhea + 34);
const capHeight = tables['OS/2'] && u16(tables['OS/2']) >= 2 ? i16(tables['OS/2'] + 88) : 0;

const locaAt = (g) => (longLoca ? u32(tables.loca + g * 4) : u16(tables.loca + g * 2) * 2);
const advanceOf = (g) => u16(tables.hmtx + Math.min(g, numHMetrics - 1) * 4);

/** Table cmap (format 4, Unicode BMP) : caractère → glyphe. */
function glyphIndex(code) {
  const cmap = tables.cmap;
  for (let i = 0, n = u16(cmap + 2); i < n; i++) {
    const r = cmap + 4 + i * 8;
    const platform = u16(r);
    const encoding = u16(r + 2);
    const sub = cmap + u32(r + 4);
    if (u16(sub) !== 4 || !((platform === 3 && encoding === 1) || platform === 0)) continue;
    const segX2 = u16(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const offsets = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      if (code > u16(ends + s)) continue;
      if (code < u16(starts + s)) return 0;
      const ro = u16(offsets + s);
      if (ro === 0) return (code + i16(deltas + s)) & 0xffff;
      const g = u16(offsets + s + ro + (code - u16(starts + s)) * 2);
      return g === 0 ? 0 : (g + i16(deltas + s)) & 0xffff;
    }
  }
  return 0;
}

/** Contours d'un glyphe : listes de points { x, y, on }. Les glyphes composés sont dépliés. */
function glyphContours(g, depth = 0) {
  const start = locaAt(g);
  if (locaAt(g + 1) === start) return [];
  const o = tables.glyf + start;
  const nc = i16(o);
  if (nc < 0) {
    if (depth > 4) return [];
    const out = [];
    let p = o + 10;
    for (;;) {
      const flags = u16(p);
      const child = u16(p + 2);
      p += 4;
      let dx, dy;
      if (flags & 1) {
        dx = i16(p);
        dy = i16(p + 2);
        p += 4;
      } else {
        dx = dv.getInt8(p);
        dy = dv.getInt8(p + 1);
        p += 2;
      }
      if (!(flags & 2)) throw new Error(`glyphe ${g} : placement par points non pris en charge`);
      let m = [1, 0, 0, 1];
      const f2 = (q) => i16(q) / 16384;
      if (flags & 8) {
        m = [f2(p), 0, 0, f2(p)];
        p += 2;
      } else if (flags & 0x40) {
        m = [f2(p), 0, 0, f2(p + 2)];
        p += 4;
      } else if (flags & 0x80) {
        m = [f2(p), f2(p + 2), f2(p + 4), f2(p + 6)];
        p += 8;
      }
      for (const c of glyphContours(child, depth + 1)) {
        out.push(c.map((q) => ({ x: Math.round(m[0] * q.x + m[2] * q.y + dx), y: Math.round(m[1] * q.x + m[3] * q.y + dy), on: q.on })));
      }
      if (!(flags & 0x20)) break;
    }
    return out;
  }
  const endPts = [];
  for (let i = 0; i < nc; i++) endPts.push(u16(o + 10 + i * 2));
  const n = nc ? endPts[nc - 1] + 1 : 0;
  let p = o + 10 + nc * 2;
  p += 2 + u16(p);
  const flags = [];
  while (flags.length < n) {
    const f = buf[p++];
    flags.push(f);
    if (f & 8) {
      let r = buf[p++];
      while (r--) flags.push(f);
    }
  }
  const coords = (short, same) => {
    const out = [];
    let v = 0;
    for (const f of flags) {
      if (f & short) {
        const d = buf[p++];
        v += f & same ? d : -d;
      } else if (!(f & same)) {
        v += i16(p);
        p += 2;
      }
      out.push(v);
    }
    return out;
  };
  const xs = coords(2, 16);
  const ys = coords(4, 32);
  const contours = [];
  let s = 0;
  for (const e of endPts) {
    contours.push(Array.from({ length: e - s + 1 }, (_, k) => ({ x: xs[s + k], y: ys[s + k], on: !!(flags[s + k] & 1) })));
    s = e + 1;
  }
  return contours;
}

/** Contour TrueType → « M … L … Q … » (points hors courbe implicites restitués). */
function contourPath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  let k = pts.findIndex((q) => q.on);
  let first;
  if (k < 0) {
    first = { x: Math.round((pts[0].x + pts[1].x) / 2), y: Math.round((pts[0].y + pts[1].y) / 2), on: true };
    k = 0;
  } else first = pts[k];
  const cmds = [`M${first.x} ${first.y}`];
  let ctrl = null;
  let last = first;
  const emit = (q) => {
    if (q.x === last.x && q.y === last.y) return;
    if (ctrl) cmds.push(`Q${ctrl.x} ${ctrl.y} ${q.x} ${q.y}`);
    else cmds.push(`L${q.x} ${q.y}`);
    last = q;
  };
  const startIndex = pts[k] === first ? k + 1 : k;
  for (let i = 0; i < n; i++) {
    const q = pts[(startIndex + i) % n];
    if (q === first) continue;
    if (q.on) {
      emit(q);
      ctrl = null;
    } else if (ctrl) {
      emit({ x: Math.round((ctrl.x + q.x) / 2), y: Math.round((ctrl.y + q.y) / 2), on: true });
      ctrl = q;
    } else ctrl = q;
  }
  emit(first);
  // Le retour au premier point est implicite (contour fermé) : on retire un « L » final redondant.
  if (cmds[cmds.length - 1] === `L${first.x} ${first.y}`) cmds.pop();
  return cmds.length > 1 ? cmds.join('') : '';
}

const glyphs = {};
let capH = capHeight;
for (const ch of CHARS) {
  const g = glyphIndex(ch.codePointAt(0));
  if (g === 0 && ch !== ' ') {
    console.warn(`caractère absent de la police : ${ch}`);
    continue;
  }
  const raw = glyphContours(g);
  // Cédille (ç, Ç) : dans la police, elle chevauche le bas de la lettre ; un profil d'esquisse
  // refuse les contours qui se chevauchent, on la détache donc d'un petit écart.
  const ys = raw.map((c) => c.map((q) => q.y));
  raw.forEach((c, i) => {
    const top = Math.max(...ys[i]);
    if (top > 0) return;
    const others = raw.flatMap((_, j) => (j !== i && Math.max(...ys[j]) > 0 ? ys[j] : []));
    if (others.length === 0) return;
    const low = Math.min(...others);
    if (top > low - 40) for (const q of c) q.y -= top - (low - 40);
  });
  const contours = raw.map(contourPath).filter(Boolean);
  glyphs[ch] = [advanceOf(g), ...contours];
}
if (!capH) {
  // Pas de hauteur des majuscules dans OS/2 : celle du « H ».
  capH = Math.max(...glyphContours(glyphIndex(72)).flat().map((q) => q.y));
}
if (numGlyphs === 0) throw new Error('police vide');

const lines = [
  '/**',
  ' * Contours des lettres pour l’outil Texte de l’esquisse. Fichier généré par',
  ' * scripts/generate-font.mjs : ne pas modifier à la main.',
  ' *',
  ' * Police : Open Sans Bold, « Digitized data copyright (c) 2010-2011, Google Corporation. », licence Apache 2.0 (voir THIRD_PARTY_NOTICES.md). Contours extraits ; la cédille de ç et Ç est légèrement abaissée (détachée de la lettre).',
  ' * Pour chaque caractère : avance horizontale puis contours (unités de la police, « M x y L x y',
  ' * Q cx cy x y », chaque contour fermé implicitement).',
  ' */',
  `export const FONT_UNITS_PER_EM = ${unitsPerEm};`,
  '/** Hauteur des majuscules (unités de la police) : la « hauteur » du texte dans l’esquisse. */',
  `export const FONT_CAP_HEIGHT = ${capH};`,
  'export const FONT_GLYPHS: Readonly<Record<string, readonly [number, ...string[]]>> = {',
  ...Object.entries(glyphs).map(([ch, v]) => `  ${JSON.stringify(ch)}: ${JSON.stringify(v)},`),
  '};',
  '',
];
writeFileSync(OUT, lines.join('\n'));
console.log(`${Object.keys(glyphs).length} caractères écrits dans ${OUT}`);
