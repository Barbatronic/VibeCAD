import { describe, expect, it } from 'vitest';
import { addArc, addCircle, addLine, emptySketch } from '../../src/sketch/model';
import { extractPath } from '../../src/sketch/path';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

describe('chemin de balayage', () => {
  it('segment, arc puis segment, dans le sens du parcours', () => {
    let s = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 0, y: 20 }).sketch;
    // Arc de (0, 20) à (10, 30) autour de (10, 20), enregistré dans le sens trigonométrique de (10, 30) vers (0, 20).
    s = addArc(s, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 20 }).sketch;
    s = addLine(s, { x: 10, y: 30 }, { x: 30, y: 30 }).sketch;
    const r = extractPath(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.closed).toBe(false);
    expect(r.segments.map((g) => g.kind)).toEqual(['line', 'arc', 'line']);
    // Chaque morceau commence où finit le précédent.
    for (let i = 1; i < r.segments.length; i++) {
      const prev = r.segments[i - 1]! as { end: { x: number; y: number } };
      const cur = r.segments[i]! as { start: { x: number; y: number } };
      expect(Math.hypot(prev.end.x - cur.start.x, prev.end.y - cur.start.y)).toBeLessThan(1e-9);
    }
  });

  it('cercle seul : chemin fermé ; branches et morceaux séparés refusés', () => {
    expect(extractPath(addCircle(emptySketch(XY), { x: 0, y: 0 }, 10).sketch)).toMatchObject({ ok: true, closed: true });
    let t = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 }).sketch;
    t = addLine(t, { x: 10, y: 0 }, { x: 20, y: 0 }).sketch;
    t = addLine(t, { x: 10, y: 0 }, { x: 10, y: 10 }).sketch;
    expect(extractPath(t)).toEqual({ ok: false, reason: 'branched' });
    let u = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 }).sketch;
    u = addLine(u, { x: 20, y: 0 }, { x: 30, y: 0 }).sketch;
    expect(extractPath(u)).toEqual({ ok: false, reason: 'several' });
    expect(extractPath(emptySketch(XY))).toEqual({ ok: false, reason: 'empty' });
  });
});
