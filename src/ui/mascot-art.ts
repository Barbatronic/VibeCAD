/**
 * Dessin de Java, le chat de VibeCAD (mascotte facultative, ce n'est pas le logo), décrit par des formes simples (grille
 * 48 × 48) : chat noir sur le dessus et blanc en dessous (ventre, museau, pattes), oreilles
 * triangulaires, queue en équerre, yeux verts. Les mêmes données servent au composant
 * d'interface et à la génération des icônes (SVG, PNG).
 */

export type CatMood = 'tip' | 'happy' | 'warning';

export type CatShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number; part: CatPart }
  | { kind: 'poly'; points: [number, number][]; part: CatPart }
  | { kind: 'line'; points: [number, number][]; part: CatPart; width: number };

/**
 * Rôle d'une forme : pelage noir ou blanc (silhouette, entourée d'un liseré clair), intérieur des
 * oreilles, yeux (iris, pupille), nez, moustaches, sourcils, accent du « ! ».
 */
export type CatPart = 'body' | 'belly' | 'inner' | 'iris' | 'pupil' | 'nose' | 'whisker' | 'brow' | 'accent' | 'mark';

/** Parties qui forment la silhouette (entourées d'un liseré pour rester lisibles sur tout fond). */
export const SILHOUETTE_PARTS: readonly CatPart[] = ['body', 'belly'];

export const CAT_COLORS: Record<CatPart | 'outline' | 'bellyEdge', string> = {
  body: '#1f2126',
  belly: '#ffffff',
  inner: '#f2a7b5',
  iris: '#a6d94a',
  pupil: '#14160f',
  nose: '#f08aa0',
  whisker: '#8d96a1',
  brow: '#d9dee4',
  accent: '#e5a100',
  mark: '#24170f',
  outline: '#ffffff',
  bellyEdge: '#3a3f47',
};

const rect = (x: number, y: number, w: number, h: number, part: CatPart = 'body', r = 0): CatShape => ({ kind: 'rect', x, y, w, h, r, part });

/** Formes du chat pour une humeur donnée (de l'arrière vers l'avant). */
export function catShapes(mood: CatMood, options: { headOnly?: boolean } = {}): CatShape[] {
  const shapes: CatShape[] = [];
  // Queue noire en équerre (relevée quand le chat est content).
  if (!options.headOnly) {
    const tailTop = mood === 'happy' ? 10 : 18;
    shapes.push(rect(37, 30, 7, 4), rect(40, tailTop, 4, 34 - tailTop, 'body', 1));
  }
  // Oreilles noires.
  shapes.push({ kind: 'poly', points: [[7, 16], [7, 5], [16, 14]], part: 'body' }, { kind: 'poly', points: [[37, 16], [37, 5], [28, 14]], part: 'body' });
  // Tête et dos noirs, ventre blanc.
  shapes.push(rect(6, 13, 32, options.headOnly ? 24 : 22, 'body', 2.5));
  if (!options.headOnly) shapes.push(rect(8, 28, 28, 7, 'belly', 2));
  // Museau blanc.
  shapes.push(rect(17, 24, 10, options.headOnly ? 9 : 8, 'belly', 3));
  // Intérieur des oreilles.
  shapes.push({ kind: 'poly', points: [[9, 13], [9, 9], [12.5, 12.5]], part: 'inner' }, { kind: 'poly', points: [[35, 13], [35, 9], [31.5, 12.5]], part: 'inner' });
  // Pattes blanches.
  if (!options.headOnly) shapes.push(rect(9, 34, 4, 7, 'belly'), rect(15.5, 34, 4, 7, 'belly'), rect(24.5, 34, 4, 7, 'belly'), rect(31, 34, 4, 7, 'belly'));
  // Yeux verts selon l'humeur.
  if (mood === 'happy') {
    shapes.push(
      { kind: 'line', points: [[12, 23.5], [14.75, 19.5], [17.5, 23.5]], part: 'iris', width: 2.2 },
      { kind: 'line', points: [[26.5, 23.5], [29.25, 19.5], [32, 23.5]], part: 'iris', width: 2.2 },
    );
  } else if (mood === 'warning') {
    // Yeux ronds et sourcils inquiets, petit « ! » ambre.
    shapes.push(rect(12.5, 18.5, 5, 5, 'iris', 2.5), rect(26.5, 18.5, 5, 5, 'iris', 2.5));
    shapes.push(rect(14.25, 19.5, 1.5, 3, 'pupil', 0.75), rect(28.25, 19.5, 1.5, 3, 'pupil', 0.75));
    shapes.push({ kind: 'line', points: [[12, 17.2], [16.8, 15.6]], part: 'brow', width: 1.3 }, { kind: 'line', points: [[32, 17.2], [27.2, 15.6]], part: 'brow', width: 1.3 });
    shapes.push(rect(39.5, -1, 8, 11, 'accent', 4), rect(42.7, 0.8, 1.6, 4.8, 'mark', 0.8), rect(42.7, 6.6, 1.6, 1.6, 'mark', 0.8));
  } else {
    shapes.push(rect(12.8, 18.5, 4, 5.5, 'iris', 1.2), rect(27.2, 18.5, 4, 5.5, 'iris', 1.2));
    shapes.push(rect(14.3, 19.2, 1, 4.1, 'pupil', 0.5), rect(28.7, 19.2, 1, 4.1, 'pupil', 0.5));
  }
  // Nez rose sur le museau, moustaches grises.
  shapes.push({ kind: 'poly', points: [[20.6, 25.4], [23.4, 25.4], [22, 27]], part: 'nose' });
  shapes.push(
    { kind: 'line', points: [[1.5, 25.5], [8.5, 26.5]], part: 'whisker', width: 1 },
    { kind: 'line', points: [[1.5, 29.5], [8.5, 28.5]], part: 'whisker', width: 1 },
    { kind: 'line', points: [[42.5, 25.5], [35.5, 26.5]], part: 'whisker', width: 1 },
    { kind: 'line', points: [[42.5, 29.5], [35.5, 28.5]], part: 'whisker', width: 1 },
  );
  return shapes;
}
