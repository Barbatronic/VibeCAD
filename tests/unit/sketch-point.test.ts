import { describe, expect, it } from 'vitest';
import { originPlaneFrame } from '../../src/math/frame';
import { addRectangle, emptySketch, standalonePoints } from '../../src/sketch/model';
import { extractProfiles } from '../../src/sketch/profiles';
import { createSession, pointerDown, setPixelSize, setTool, type SketchSession } from '../../src/sketch/session';

function newSession(): SketchSession {
  return setPixelSize(createSession({ featureId: 'sk', partId: 'p', isNew: true, frame: originPlaneFrame('XY'), sketch: emptySketch({ kind: 'plane', plane: 'XY', offset: 0 }) }), 0.1);
}

describe('outil Point', () => {
  it('pose des points seuls, refuse un point sur un point existant, et l’outil reste actif', () => {
    let s = setTool(newSession(), 'point');
    s = pointerDown(s, { x: 12.3, y: 7.1 }, { alt: true });
    s = pointerDown(s, { x: 30, y: -4 }, { alt: true });
    expect(s.tool).toBe('point');
    expect(standalonePoints(s.sketch).map((p) => [p.x, p.y])).toEqual([
      [12.3, 7.1],
      [30, -4],
    ]);
    const again = pointerDown(s, { x: 12.3, y: 7.1 });
    expect(standalonePoints(again.sketch)).toHaveLength(2);
    expect(again.message?.text).toMatch(/déjà un point/);
  });

  it('un point seul ne gêne pas le contour fermé d’une esquisse (il ne compte pas dans le volume)', () => {
    let s = setTool(newSession(), 'point');
    s = pointerDown(s, { x: 5, y: 5 }, { alt: true });
    const sketch = addRectangle(s.sketch, { x: 0, y: 0 }, { x: 20, y: 10 }).sketch;
    const profile = extractProfiles(sketch);
    expect(profile.ok).toBe(true);
    expect(profile.ok && profile.regions).toHaveLength(1);
    expect(standalonePoints(sketch)).toHaveLength(1);
  });
});
