import { describe, expect, it } from 'vitest';
import { originPlaneFrame } from '../../src/math/frame';
import { addCircle, addRectangle, emptySketch } from '../../src/sketch/model';
import { clearSelection, createSession, pointerDown, pointerMove, pointerUp, sessionPreview, setPixelSize, type SketchSession } from '../../src/sketch/session';
import { solveSketch } from '../../src/sketch/solver';

/** Rectangle 0 → 40 × 0 → 20 et cercle Ø 10 centré en (60, 10). */
function session(): SketchSession {
  const r = addRectangle(emptySketch({ kind: 'plane', plane: 'XY', offset: 0 }), { x: 0, y: 0 }, { x: 40, y: 20 });
  const c = addCircle(r.sketch, { x: 60, y: 10 }, 5);
  const s = createSession({ featureId: 'sk-1', partId: 'pt-1', isNew: false, frame: originPlaneFrame('XY'), sketch: solveSketch(c.sketch).sketch });
  return setPixelSize(s, 0.1);
}

const click = (s: SketchSession, x: number, y: number, double = false) => pointerUp(pointerDown(pointerMove(s, { x, y }), { x, y }, { double }));

describe('esquisse : sélection', () => {
  it('chaque clic ajoute un élément, un second clic le retire', () => {
    let s = click(session(), 20, 0);
    s = click(s, 40, 10);
    expect(s.selection.length).toBe(2);
    s = click(s, 20, 0);
    expect(s.selection.length).toBe(1);
  });

  it('cadre glissé dans le vide : les éléments entièrement dedans sont ajoutés, avec un aperçu', () => {
    let s = pointerDown(pointerMove(session(), { x: -5, y: -5 }), { x: -5, y: -5 });
    s = pointerMove(s, { x: 45, y: 25 });
    expect(sessionPreview(s).lines.length).toBe(4);
    s = pointerUp(s);
    // Quatre segments et leurs huit extrémités (reliées deux à deux) ; le cercle, dehors, n'est pas pris.
    expect(s.selection.length).toBe(12);
    expect(s.box).toBeNull();
    s = pointerUp(pointerMove(pointerDown(pointerMove(s, { x: 50, y: 0 }), { x: 50, y: 0 }), { x: 70, y: 20 }));
    // Le cercle et son centre.
    expect(s.selection.length).toBe(14);
  });

  it('un simple clic dans le vide ne vide pas la sélection ; un double-clic ou Espace la vide', () => {
    let s = click(session(), 20, 0);
    s = click(s, 20, 50);
    expect(s.selection.length).toBe(1);
    s = click(s, 20, 50, true);
    expect(s.selection).toEqual([]);
    s = clearSelection(click(s, 20, 0));
    expect(s.selection).toEqual([]);
  });

  it('glisser un élément déjà choisi le déplace sans le retirer de la sélection', () => {
    let s = click(session(), 60, 15);
    expect(s.selection.length).toBe(1);
    s = pointerDown(pointerMove(s, { x: 60, y: 15 }), { x: 60, y: 15 });
    s = pointerUp(pointerMove(s, { x: 60, y: 25 }));
    expect(s.selection.length).toBe(1);
  });
});
