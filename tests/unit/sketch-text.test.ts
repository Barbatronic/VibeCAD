import { describe, expect, it } from 'vitest';
import { FONT_GLYPHS } from '../../src/sketch/font-data';
import { addRectangle, addText, emptySketch, removeEntities, updateText } from '../../src/sketch/model';
import { extractProfiles } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';
import { layoutText, textWidth, unsupportedChars } from '../../src/sketch/text';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

describe('texte d’esquisse', () => {
  it('chaque lettre de la police donne un contour valide', () => {
    const bad: string[] = [];
    for (const ch of Object.keys(FONT_GLYPHS)) {
      if (ch.trim() === '') continue;
      const res = extractProfiles(addText(emptySketch(XY), { x: 0, y: 0 }, ch, 10).sketch);
      if (!res.ok) bad.push(`${ch} (${res.code})`);
    }
    expect(bad).toEqual([]);
  });

  it('un mot donne une région par lettre, avec les trous des boucles', () => {
    const res = extractProfiles(addText(emptySketch(XY), { x: 0, y: 0 }, 'Bob', 10).sketch);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.regions).toHaveLength(3);
    expect(res.regions.map((r) => r.holes.length)).toEqual([2, 1, 1]);
  });

  it('la hauteur est celle des majuscules, depuis le point d’ancrage', () => {
    const contours = layoutText('H', { x: 5, y: 7 }, 20);
    const ys = contours.flatMap((c) => c.pieces.flatMap((p) => (p.kind === 'line' ? [p.start.y, p.end.y] : p.bezier.map((q) => q.y))));
    expect(Math.min(...ys)).toBeCloseTo(7, 6);
    expect(Math.max(...ys)).toBeCloseTo(27, 6);
    expect(textWidth('HH', 20)).toBeCloseTo(2 * textWidth('H', 20), 9);
  });

  it('le texte peut être gravé dans une plaque (trous de la région)', () => {
    let s = addRectangle(emptySketch(XY), { x: -5, y: -10 }, { x: 80, y: 25 }).sketch;
    s = addText(s, { x: 0, y: 0 }, 'VibeCAD', 10).sketch;
    const res = extractProfiles(s);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // La plaque, percée de 8 contours (7 lettres, dont le point du i) ; les îlots (b, e, A, D) redeviennent matière.
    const plate = res.regions.reduce((a, b) => (b.area > a.area ? b : a));
    expect(plate.holes.length).toBe(8);
    // Îlots : b, e, A, D (un chacun) ; les autres régions sont ces îlots.
    expect(res.regions).toHaveLength(1 + 4);
  });

  it('identifiants stables par morceau, et caractères inconnus signalés', () => {
    const c = layoutText('ab', { x: 0, y: 0 }, 10, 0, 'txt1');
    const ids = c.flatMap((k) => k.pieces.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^txt1:0\.0\.0$/);
    expect(unsupportedChars('Ωa✓')).toEqual(['Ω', '✓']);
  });

  it('le point d’ancrage se résout, se modifie et part avec le texte', () => {
    const r = addText(emptySketch(XY), { x: 3, y: 4 }, 'A', 10);
    const solved = solveSketch(r.sketch);
    expect(solved.converged).toBe(true);
    expect(solved.dof).toBe(2);
    const changed = updateText(r.sketch, r.textId, { text: 'AB', height: 12, angle: 30 });
    expect(changed.entities.find((e) => e.id === r.textId)).toMatchObject({ text: 'AB', height: 12, angle: 30 });
    expect(removeEntities(r.sketch, [r.textId]).entities).toHaveLength(0);
  });
});
