import { describe, expect, it } from 'vitest';
import { mergeAlignedSegments } from '../../src/sketch/merge-segments';
import type { ProfileSegment } from '../../src/sketch/profiles';

const line = (id: string, a: [number, number], b: [number, number]): ProfileSegment => ({ kind: 'line', entityId: id, start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] } });

describe('contours : segments alignés réunis', () => {
  it('deux segments alignés deviennent un seul, avec les deux éléments', () => {
    const out = mergeAlignedSegments([line('l1', [0, 0], [10, 0]), line('l2', [10, 0], [20, 0]), line('l3', [20, 0], [20, 20]), line('l4', [20, 20], [0, 0])], true);
    expect(out.length).toBe(3);
    expect(out[0]!.entityIds).toEqual(['l1', 'l2']);
    expect(out[0]!.segment.kind === 'line' && out[0]!.segment.end).toEqual({ x: 20, y: 0 });
  });

  it('contour fermé : le dernier segment prolonge le premier', () => {
    const out = mergeAlignedSegments([line('a', [5, 0], [20, 0]), line('b', [20, 0], [20, 10]), line('c', [20, 10], [0, 10]), line('d', [0, 10], [0, 0]), line('e', [0, 0], [5, 0])], true);
    expect(out.length).toBe(4);
    expect(out[0]!.entityIds).toEqual(['e', 'a']);
  });

  it('un coin, des segments repliés ou un chemin ouvert ne sont pas mélangés à tort', () => {
    expect(mergeAlignedSegments([line('a', [0, 0], [10, 0]), line('b', [10, 0], [10, 10])], false).length).toBe(2);
    // Demi-tour : alignés mais en sens contraire.
    expect(mergeAlignedSegments([line('a', [0, 0], [10, 0]), line('b', [10, 0], [5, 0])], false).length).toBe(2);
    // Chemin ouvert : pas de raccord entre le dernier et le premier.
    expect(mergeAlignedSegments([line('a', [5, 0], [10, 0]), line('b', [10, 0], [10, 5]), line('c', [10, 5], [0, 0]), line('d', [0, 0], [5, 0])], false).length).toBe(4);
  });

  it('arcs consécutifs d’un même cercle réunis, sans jamais faire un tour complet', () => {
    const arc = (id: string, a0: number, a1: number): ProfileSegment => ({
      kind: 'arc',
      entityId: id,
      center: { x: 0, y: 0 },
      radius: 10,
      clockwise: false,
      start: { x: 10 * Math.cos(a0), y: 10 * Math.sin(a0) },
      end: { x: 10 * Math.cos(a1), y: 10 * Math.sin(a1) },
    });
    const two = mergeAlignedSegments([arc('a1', 0, Math.PI / 2), arc('a2', Math.PI / 2, Math.PI)], false);
    expect(two.length).toBe(1);
    expect(two[0]!.entityIds).toEqual(['a1', 'a2']);
    const full = mergeAlignedSegments([arc('a1', 0, Math.PI), arc('a2', Math.PI, 2 * Math.PI)], true);
    expect(full.length).toBe(2);
  });
});
