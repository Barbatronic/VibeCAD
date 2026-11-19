/**
 * Loi de pilotage (calculs purs, testables) : à partir d'un scénario de mouvement, les réglages à
 * donner aux pilotantes (les commandes, des servomoteurs par exemple) pour obtenir des positions
 * voulues des liaisons pilotées. Loi « inverse » : positions voulues → commandes.
 *
 * 1. Balayage direct : grille régulière des commandes (1 ou 2), position obtenue pour chacune
 *    (le calcul est fourni par l'appelant, voir `forwardOrder`).
 * 2. Inversion : grille régulière des positions voulues ; chaque point est retrouvé dans un
 *    triangle de la grille directe et ses commandes interpolées. Les zones où le mécanisme se
 *    replie (deux réglages pour une même position) et les blocages sont écartés.
 * 3. Export : en-tête C (tableau en mémoire flash et interpolation, pour un microcontrôleur) et CSV.
 */
import type { ControlLawSpec, MotionDof } from '../domain/model';

/** Points par axe : bornes (une grille plus fine alourdit la mémoire du microcontrôleur). */
export const LAW_STEPS_MIN = 5;
export const LAW_STEPS_MAX = 101;

/** Valeurs des commandes balayées sur un axe (de `min` à `max`, `steps` points). */
export function axisValues(min: number, max: number, steps: number): number[] {
  const n = Math.max(2, Math.round(steps));
  return Array.from({ length: n }, (_v, i) => min + ((max - min) * i) / (n - 1));
}

/**
 * Ordre de balayage de la grille directe : en serpentin, pour que chaque point parte de la position
 * du point voisin (le mécanisme reste sur la même branche). Indices [i] ou [i, j].
 */
export function forwardOrder(spec: ControlLawSpec): number[][] {
  const n = Math.max(2, Math.round(spec.steps));
  if (spec.inputs.length === 1) return Array.from({ length: n }, (_v, i) => [i]);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) out.push([i, i % 2 === 0 ? k : n - 1 - k]);
  return out;
}

/** Grille directe : commandes → positions obtenues (null : mécanisme bloqué). Indexée i * n + j. */
export interface ForwardGrid {
  axes: number[][];
  outputs: (number[] | null)[];
}

/** Axe des positions voulues de la loi. */
export interface LawAxis {
  min: number;
  max: number;
  n: number;
}

export interface ControlLaw {
  /** Axes des positions voulues (1 ou 2). */
  axes: LawAxis[];
  /** Commandes de chaque point de la grille (une table par commande, i * n2 + j) ; NaN : inaccessible. */
  tables: Float64Array[];
  /** Part des points de la grille qui sont accessibles (0 à 1). */
  coverage: number;
  /** Remarques pour l'utilisateur (repli du mécanisme, blocages…). */
  notes: string[];
}

/** Point de la loi : positions voulues et commandes (NaN si inaccessible). */
export function lawPoint(law: ControlLaw, index: number): { targets: number[]; commands: number[] } {
  const [a1, a2] = law.axes;
  const n2 = a2?.n ?? 1;
  const i = Math.floor(index / n2);
  const j = index % n2;
  const at = (a: LawAxis, k: number) => (a.n > 1 ? a.min + ((a.max - a.min) * k) / (a.n - 1) : a.min);
  return { targets: a2 ? [at(a1!, i), at(a2, j)] : [at(a1!, i)], commands: law.tables.map((t) => t[index]!) };
}

/** Inverse la grille directe (1 ou 2 commandes) sur une grille régulière de `steps` points par axe. */
export function invertLaw(spec: ControlLawSpec, grid: ForwardGrid): ControlLaw {
  return spec.inputs.length === 1 ? invert1(spec, grid) : invert2(spec, grid);
}

function invert1(spec: ControlLawSpec, grid: ForwardGrid): ControlLaw {
  const xs = grid.axes[0]!;
  const ys = grid.outputs.map((o) => (o ? o[0]! : null));
  // Plus longue portion où la sortie varie toujours dans le même sens (une seule commande par position).
  let best = { from: 0, to: 0 };
  let start = -1;
  let dir = 0;
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] === null) {
      start = -1;
      continue;
    }
    if (start < 0) {
      start = i;
      dir = 0;
    } else {
      const d = Math.abs(ys[i]! - ys[i - 1]!) < 1e-9 ? 0 : Math.sign(ys[i]! - ys[i - 1]!);
      if (d === 0) {
        start = i;
        dir = 0;
      } else if (dir === 0) dir = d;
      else if (d !== dir) {
        start = i - 1;
        dir = d;
      }
    }
    if (i - start > best.to - best.from) best = { from: start, to: i };
  }
  const notes: string[] = [];
  const n = Math.max(2, Math.round(spec.steps));
  if (best.to - best.from < 1) return { axes: [{ min: 0, max: 0, n }], tables: [new Float64Array(n).fill(NaN)], coverage: 0, notes: ['La position relevée ne varie pas avec cette commande sur la plage balayée.'] };
  if (best.from > 0 || best.to < ys.length - 1) notes.push(`Seule la plage de commande ${fmt(xs[best.from]!)} à ${fmt(xs[best.to]!)} est gardée : ailleurs, la position revient en arrière ou le mécanisme se bloque.`);
  const seg = ys.slice(best.from, best.to + 1) as number[];
  const lo = Math.min(...seg);
  const hi = Math.max(...seg);
  const table = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const y = lo + ((hi - lo) * k) / (n - 1);
    let value = NaN;
    for (let i = best.from; i < best.to; i++) {
      const [y0, y1] = [ys[i]!, ys[i + 1]!];
      if ((y - y0) * (y - y1) <= 1e-12) {
        const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
        value = xs[i]! + t * (xs[i + 1]! - xs[i]!);
        break;
      }
    }
    table[k] = value;
  }
  return { axes: [{ min: lo, max: hi, n }], tables: [table], coverage: 1, notes };
}

function invert2(spec: ControlLawSpec, grid: ForwardGrid): ControlLaw {
  const [us, vs] = [grid.axes[0]!, grid.axes[1]!];
  const nf = vs.length;
  const out = (i: number, j: number) => grid.outputs[i * nf + j] ?? null;
  // Triangles de la grille directe (deux par case), dans l'espace des positions obtenues.
  type Tri = { p: number[][]; c: number[][] };
  const all: (Tri & { area: number })[] = [];
  let blocked = 0;
  for (let i = 0; i + 1 < us.length; i++) {
    for (let j = 0; j + 1 < nf; j++) {
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
      const ps = corners.map(([a, b]) => out(a, b));
      if (ps.some((p) => !p)) {
        blocked++;
        continue;
      }
      const cs = corners.map(([a, b]) => [us[a]!, vs[b]!]);
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]] as const) {
        const p = [ps[a]!, ps[b]!, ps[c]!];
        const area = (p[1]![0]! - p[0]![0]!) * (p[2]![1]! - p[0]![1]!) - (p[2]![0]! - p[0]![0]!) * (p[1]![1]! - p[0]![1]!);
        all.push({ p, c: [cs[a]!, cs[b]!, cs[c]!], area });
      }
    }
  }
  const n = Math.max(2, Math.round(spec.steps));
  const empty = (note: string): ControlLaw => ({ axes: [{ min: 0, max: 0, n }, { min: 0, max: 0, n }], tables: [new Float64Array(n * n).fill(NaN), new Float64Array(n * n).fill(NaN)], coverage: 0, notes: [note] });
  if (all.length === 0) return empty('Le mécanisme se bloque sur toute la plage balayée.');
  // Sens dominant : les triangles retournés sont ceux d'une zone où le mécanisme se replie.
  const scale = Math.max(...all.map((t) => Math.abs(t.area)));
  const positive = all.filter((t) => t.area > 1e-9 * scale).length;
  const negative = all.filter((t) => t.area < -1e-9 * scale).length;
  if (positive === 0 && negative === 0) return empty('Les deux positions relevées ne varient pas indépendamment : il faut deux commandes qui agissent chacune à sa façon.');
  const sign = positive >= negative ? 1 : -1;
  const kept = all.filter((t) => t.area * sign > 1e-9 * scale);
  const notes: string[] = [];
  if (kept.length < all.length * 0.98) notes.push('Une partie de la plage balayée est écartée : le mécanisme s’y replie (deux réglages donnent la même position).');
  if (blocked > 0) notes.push('Le mécanisme se bloque sur une partie de la plage balayée : ces positions sont inaccessibles.');
  // Grille des positions voulues : l'encombrement des positions obtenues.
  const xs = kept.flatMap((t) => t.p.map((q) => q[0]!));
  const ys = kept.flatMap((t) => t.p.map((q) => q[1]!));
  const ax: LawAxis = { min: Math.min(...xs), max: Math.max(...xs), n };
  const ay: LawAxis = { min: Math.min(...ys), max: Math.max(...ys), n };
  // Cases de recherche : chaque triangle est rangé dans les cases qu'il couvre.
  const cell = (a: LawAxis, v: number) => Math.min(n - 1, Math.max(0, Math.floor(((v - a.min) / (a.max - a.min || 1)) * n)));
  const buckets: Tri[][] = Array.from({ length: n * n }, () => []);
  for (const t of kept) {
    const [x0, x1] = [Math.min(...t.p.map((q) => q[0]!)), Math.max(...t.p.map((q) => q[0]!))];
    const [y0, y1] = [Math.min(...t.p.map((q) => q[1]!)), Math.max(...t.p.map((q) => q[1]!))];
    for (let a = cell(ax, x0); a <= cell(ax, x1); a++) for (let b = cell(ay, y0); b <= cell(ay, y1); b++) buckets[a * n + b]!.push(t);
  }
  const t1 = new Float64Array(n * n).fill(NaN);
  const t2 = new Float64Array(n * n).fill(NaN);
  let reached = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = ax.min + ((ax.max - ax.min) * i) / (n - 1);
      const y = ay.min + ((ay.max - ay.min) * j) / (n - 1);
      for (const t of buckets[cell(ax, x) * n + cell(ay, y)]!) {
        const [p0, p1, p2] = t.p as [number[], number[], number[]];
        const d = (p1[1]! - p2[1]!) * (p0[0]! - p2[0]!) + (p2[0]! - p1[0]!) * (p0[1]! - p2[1]!);
        const w0 = ((p1[1]! - p2[1]!) * (x - p2[0]!) + (p2[0]! - p1[0]!) * (y - p2[1]!)) / d;
        const w1 = ((p2[1]! - p0[1]!) * (x - p2[0]!) + (p0[0]! - p2[0]!) * (y - p2[1]!)) / d;
        const w2 = 1 - w0 - w1;
        const eps = -1e-7;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        t1[i * n + j] = w0 * t.c[0]![0]! + w1 * t.c[1]![0]! + w2 * t.c[2]![0]!;
        t2[i * n + j] = w0 * t.c[0]![1]! + w1 * t.c[1]![1]! + w2 * t.c[2]![1]!;
        reached++;
        break;
      }
    }
  }
  if (reached < n * n) notes.push('Certaines combinaisons de positions voulues sont inaccessibles (marquées dans le fichier).');
  return { axes: [ax, ay], tables: [t1, t2], coverage: reached / (n * n), notes };
}

const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 2, useGrouping: false });

/** Points de contrôle : jusqu'à `count` points accessibles, répartis sur la grille. */
export function checkPoints(law: ControlLaw, count = 60): number[] {
  const reachable: number[] = [];
  const size = law.tables[0]!.length;
  for (let k = 0; k < size; k++) if (law.tables.every((t) => Number.isFinite(t[k]))) reachable.push(k);
  if (reachable.length <= count) return reachable;
  const step = reachable.length / count;
  return Array.from({ length: count }, (_v, k) => reachable[Math.floor(k * step)]!);
}

/** Nom de liaison et sa grandeur, pour l'export. */
export interface LawLabel {
  name: string;
  dof: MotionDof;
}

const unit = (dof: MotionDof) => (dof === 'angle' ? '°' : 'mm');
/** Valeurs entières en mémoire : dixièmes de degré, centièmes de millimètre. */
const scaleOf = (dof: MotionDof) => (dof === 'angle' ? 10 : 100);

/** Identifiant C (ASCII, minuscules, chiffres et _), à partir d'un nom. */
export function cIdentifier(name: string, fallback = 'loi'): string {
  const id = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return !id ? fallback : /^[0-9]/.test(id) ? `${fallback}_${id}` : id;
}

/**
 * En-tête C de la loi (compatible Arduino) : tables en entiers (dixièmes de degré, centièmes de
 * mm) en mémoire flash sur AVR, et une fonction qui interpole entre les points de la grille. Elle
 * renvoie false si la position voulue est hors de la grille ou inaccessible.
 */
export function lawHeader(law: ControlLaw, meta: { scenario: string; outputs: LawLabel[]; inputs: LawLabel[]; application: string; maxError: number[] | null }): string {
  const p = cIdentifier(meta.scenario);
  const P = p.toUpperCase();
  const two = law.axes.length === 2;
  const n1 = law.axes[0]!.n;
  const n2 = two ? law.axes[1]!.n : 1;
  const L: string[] = [];
  L.push(`/*`);
  L.push(` * Loi de pilotage « ${meta.scenario} » — générée par ${meta.application}.`);
  L.push(` * Positions voulues → commandes à donner :`);
  meta.outputs.forEach((o, k) => L.push(` *   position ${k + 1} : ${o.name} (${unit(o.dof)}), de ${fmt(law.axes[k]!.min)} à ${fmt(law.axes[k]!.max)}, ${law.axes[k]!.n} points`));
  meta.inputs.forEach((c, k) => L.push(` *   commande ${k + 1} : ${c.name} (${unit(c.dof)})`));
  L.push(` * Interpolation linéaire entre les points de la grille.`);
  if (meta.maxError) L.push(` * Écart vérifié sur des points de contrôle : ${meta.outputs.map((o, k) => `${o.name} ± ${fmt(meta.maxError![k]!)} ${unit(o.dof)}`).join(', ')}.`);
  L.push(` */`);
  L.push(`#pragma once`);
  L.push(`#include <stdint.h>`);
  L.push(`#include <stdbool.h>`);
  L.push(`#ifdef __AVR__`);
  L.push(`#include <avr/pgmspace.h>`);
  L.push(`#define ${P}_LIRE(t, k) ((int16_t)pgm_read_word(&(t)[k]))`);
  L.push(`#else`);
  L.push(`#ifndef PROGMEM`);
  L.push(`#define PROGMEM`);
  L.push(`#endif`);
  L.push(`#define ${P}_LIRE(t, k) ((t)[k])`);
  L.push(`#endif`);
  L.push('');
  L.push(`#define ${P}_INACCESSIBLE INT16_MIN`);
  L.push(`#define ${P}_N1 ${n1}`);
  L.push(`#define ${P}_N2 ${n2}`);
  law.axes.forEach((a, k) => {
    L.push(`#define ${P}_MIN${k + 1} ${cNum(a.min)}f`);
    L.push(`#define ${P}_PAS${k + 1} ${cNum(a.n > 1 ? (a.max - a.min) / (a.n - 1) : 1)}f`);
  });
  L.push('');
  meta.inputs.forEach((c, k) => {
    const s = scaleOf(c.dof);
    L.push(`/* ${c.name}, en ${s === 10 ? 'dixièmes de degré' : 'centièmes de mm'}. */`);
    L.push(`static const int16_t ${p}_commande${k + 1}[${n1 * n2}] PROGMEM = {`);
    const t = law.tables[k]!;
    for (let i = 0; i < n1; i++) {
      const row = Array.from({ length: n2 }, (_v, j) => {
        const v = t[i * n2 + j]!;
        return Number.isFinite(v) ? String(Math.max(-32767, Math.min(32767, Math.round(v * s)))) : `${P}_INACCESSIBLE`;
      });
      L.push(`  ${row.join(', ')},`);
    }
    L.push(`};`);
    L.push('');
  });
  const args = two ? 'float position1, float position2' : 'float position1';
  const outs = meta.inputs.map((_c, k) => `float *commande${k + 1}`).join(', ');
  L.push(`/* Commandes pour les positions voulues ; false si la position est hors de la grille ou inaccessible. */`);
  L.push(`static inline bool ${p}_commandes(${args}, ${outs}) {`);
  L.push(`  float f1 = (position1 - ${P}_MIN1) / ${P}_PAS1;`);
  L.push(`  if (f1 < 0.0f || f1 > ${P}_N1 - 1) return false;`);
  L.push(`  int i = (int)f1;`);
  L.push(`  if (i > ${P}_N1 - 2) i = ${P}_N1 - 2;`);
  L.push(`  float a = f1 - i;`);
  if (two) {
    L.push(`  float f2 = (position2 - ${P}_MIN2) / ${P}_PAS2;`);
    L.push(`  if (f2 < 0.0f || f2 > ${P}_N2 - 1) return false;`);
    L.push(`  int j = (int)f2;`);
    L.push(`  if (j > ${P}_N2 - 2) j = ${P}_N2 - 2;`);
    L.push(`  float b = f2 - j;`);
  }
  // Coins de la case et leurs poids ; un coin inaccessible n'est refusé que s'il compte.
  if (two) {
    L.push(`  const int k[4] = { i * ${P}_N2 + j, (i + 1) * ${P}_N2 + j, i * ${P}_N2 + j + 1, (i + 1) * ${P}_N2 + j + 1 };`);
    L.push(`  const float w[4] = { (1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b };`);
  } else {
    L.push(`  const int k[2] = { i, i + 1 };`);
    L.push(`  const float w[2] = { 1 - a, a };`);
  }
  const corners = two ? 4 : 2;
  meta.inputs.forEach((_c, n) => {
    const t = `${p}_commande${n + 1}`;
    L.push(`  float v${n} = 0.0f;`);
    L.push(`  for (int c = 0; c < ${corners}; c++) {`);
    L.push(`    if (w[c] < 1e-6f) continue;`);
    L.push(`    int16_t q = ${P}_LIRE(${t}, k[c]);`);
    L.push(`    if (q == ${P}_INACCESSIBLE) return false;`);
    L.push(`    v${n} += w[c] * q;`);
    L.push(`  }`);
  });
  meta.inputs.forEach((c, k) => L.push(`  *commande${k + 1} = v${k} / ${scaleOf(c.dof)}.0f;`));
  L.push(`  return true;`);
  L.push(`}`);
  return `${L.join('\n')}\n`;
}

const cNum = (v: number) => {
  const s = (Math.round(v * 1e6) / 1e6).toString();
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

/** CSV de la loi (séparateur ;, virgule décimale) : positions voulues puis commandes ; vide si inaccessible. */
export function lawCsv(law: ControlLaw, meta: { outputs: LawLabel[]; inputs: LawLabel[] }): string {
  const head = [...meta.outputs.map((o) => `${o.name} voulue (${unit(o.dof)})`), ...meta.inputs.map((c) => `${c.name} (${unit(c.dof)})`)];
  const lines = [head.map((h) => (/[;"\n]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h)).join(';')];
  const size = law.tables[0]!.length;
  const num = (v: number) => (Number.isFinite(v) ? v.toLocaleString('fr-FR', { maximumFractionDigits: 4, useGrouping: false }) : '');
  for (let k = 0; k < size; k++) {
    const pt = lawPoint(law, k);
    lines.push([...pt.targets, ...pt.commands].map(num).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
