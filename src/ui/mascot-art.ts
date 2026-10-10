/**
 * Dessin du chat de VibeCAD (logo et mascotte), décrit par des formes simples (grille 48 × 48) :
 * corps en bloc, oreilles triangulaires, courtes pattes, queue en équerre, petits yeux anguleux.
 * Les mêmes données servent au composant d'interface et à la génération des icônes (SVG, PNG).
 */

export type CatMood = 'tip' | 'happy' | 'warning';

export type CatShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number; part: CatPart }
  | { kind: 'poly'; points: [number, number][]; part: CatPart }
  | { kind: 'line'; points: [number, number][]; part: CatPart; width: number };

/** Rôle d'une forme : silhouette (couleur du chat, entourée de blanc) ou détail du visage. */
export type CatPart = 'body' | 'inner' | 'eye' | 'accent';

export const CAT_COLORS = {
  body: '#d9774f',
  inner: '#f3b49a',
  eye: '#24170f',
  outline: '#ffffff',
  accent: '#e5a100',
} as const;

const rect = (x: number, y: number, w: number, h: number, part: CatPart = 'body', r = 0): CatShape => ({ kind: 'rect', x, y, w, h, r, part });

/** Formes du chat pour une humeur donnée (de l'arrière vers l'avant). */
export function catShapes(mood: CatMood, options: { headOnly?: boolean } = {}): CatShape[] {
  const shapes: CatShape[] = [];
  const earsDown = false;
  // Queue en équerre (relevée quand le chat est content).
  if (!options.headOnly) {
    const tailTop = mood === 'happy' ? 10 : 18;
    shapes.push(rect(37, 30, 7, 4), rect(40, tailTop, 4, 34 - tailTop, 'body', 1));
  }
  // Oreilles.
  shapes.push(
    { kind: 'poly', points: earsDown ? [[7, 17], [3, 9], [15, 14]] : [[7, 16], [7, 5], [16, 14]], part: 'body' },
    { kind: 'poly', points: earsDown ? [[37, 17], [41, 9], [29, 14]] : [[37, 16], [37, 5], [28, 14]], part: 'body' },
  );
  // Corps (et tête) en un seul bloc.
  shapes.push(rect(6, 13, 32, options.headOnly ? 24 : 22, 'body', 2.5));
  // Intérieur des oreilles.
  if (!earsDown) {
    shapes.push({ kind: 'poly', points: [[9, 13], [9, 9], [12.5, 12.5]], part: 'inner' }, { kind: 'poly', points: [[35, 13], [35, 9], [31.5, 12.5]], part: 'inner' });
  }
  // Pattes.
  if (!options.headOnly) shapes.push(rect(9, 34, 4, 7), rect(15.5, 34, 4, 7), rect(24.5, 34, 4, 7), rect(31, 34, 4, 7));
  // Yeux selon l'humeur.
  if (mood === 'happy') {
    shapes.push(
      { kind: 'line', points: [[12.5, 24], [15, 20.5], [17.5, 24]], part: 'eye', width: 2.2 },
      { kind: 'line', points: [[26.5, 24], [29, 20.5], [31.5, 24]], part: 'eye', width: 2.2 },
    );
  } else if (mood === 'warning') {
    // Yeux ronds et sourcils inquiets, petit « ! » ambre.
    shapes.push(rect(13, 20, 4.5, 4.5, 'eye', 2.25), rect(26.5, 20, 4.5, 4.5, 'eye', 2.25));
    shapes.push({ kind: 'line', points: [[12.5, 18.6], [17, 16.8]], part: 'eye', width: 1.4 }, { kind: 'line', points: [[31.5, 18.6], [27, 16.8]], part: 'eye', width: 1.4 });
    shapes.push(rect(39.5, -1, 8, 11, 'accent', 4), rect(42.7, 0.8, 1.6, 4.8, 'eye', 0.8), rect(42.7, 6.6, 1.6, 1.6, 'eye', 0.8));
  } else {
    shapes.push(rect(13.5, 19.5, 3.2, 5.5, 'eye', 0.6), rect(27.3, 19.5, 3.2, 5.5, 'eye', 0.6));
  }
  // Nez et moustaches.
  shapes.push({ kind: 'poly', points: [[20.6, 26.6], [23.4, 26.6], [22, 28.2]], part: 'eye' });
  shapes.push(
    { kind: 'line', points: [[1.5, 25.5], [8.5, 26.5]], part: 'eye', width: 1 },
    { kind: 'line', points: [[1.5, 29.5], [8.5, 28.5]], part: 'eye', width: 1 },
    { kind: 'line', points: [[42.5, 25.5], [35.5, 26.5]], part: 'eye', width: 1 },
    { kind: 'line', points: [[42.5, 29.5], [35.5, 28.5]], part: 'eye', width: 1 },
  );
  return shapes;
}

const pts = (p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(' ');

function shapeToSvg(s: CatShape, fill: string, stroke?: { color: string; width: number }): string {
  const st = stroke ? ` stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linejoin="round" stroke-linecap="round"` : '';
  if (s.kind === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r ?? 0}" fill="${fill}"${st}/>`;
  if (s.kind === 'poly') return `<polygon points="${pts(s.points)}" fill="${fill}"${st}/>`;
  const w = stroke ? s.width + stroke.width : s.width;
  return `<polyline points="${pts(s.points)}" fill="none" stroke="${stroke ? stroke.color : fill}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** SVG autonome du chat (icônes de l'application). */
export function catSvg(mood: CatMood, options: { background?: string; padding?: number; headOnly?: boolean } = {}): string {
  const shapes = catShapes(mood, options);
  const pad = options.padding ?? 2;
  const size = 48 + pad * 2;
  const silhouette = shapes.filter((s) => s.part === 'body');
  const outline = silhouette.map((s) => shapeToSvg(s, CAT_COLORS.outline, { color: CAT_COLORS.outline, width: 3 })).join('');
  const body = shapes.map((s) => shapeToSvg(s, CAT_COLORS[s.part === 'body' ? 'body' : s.part])).join('');
  const bg = options.background ? `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${options.background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${size} ${size}">${bg}${outline}${body}</svg>`;
}
