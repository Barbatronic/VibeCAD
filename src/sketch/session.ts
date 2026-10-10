/**
 * Session d'édition d'une esquisse : machine à états pure (sans DOM ni Three.js).
 * La vue transmet des événements en coordonnées d'esquisse (mm) ; chaque fonction renvoie une
 * nouvelle session. Toute modification passe par le solveur : si les contraintes ne peuvent
 * pas être satisfaites, l'action est refusée avec un message et l'esquisse reste inchangée.
 */
import { sameEdgeRef } from '../domain/document';
import type { EdgeRef, Id, SketchConstraint, SketchEntity, SketchParams } from '../domain/model';
import { ORIGIN_POINT_ID } from '../domain/model';
import { formatAngle, formatLength, parseAngle, parseLength, readNumber, type ParseResult } from '../domain/units';
import type { Frame3D } from '../math/frame';
import { add2, cross2, distance2, distanceToSegment2, dot2, midpoint2, normalize2, scale2, sub2, type Vec2 } from '../math/vec';
import { trimAt, trimPiece } from './trim';
import { hitTest, type SketchTarget } from './hit-test';
import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  addRectangle,
  arePointsCoincident,
  findArc,
  findCircle,
  findRound,
  findLine,
  movePoints,
  ownerOfPoint,
  pointPosition,
  removeConstraints,
  removeEntities,
  setCircleRadius,
  updateConstraint,
  type NewConstraint,
} from './model';
import { gridStepFor, snapPoint, type SnapResult } from './snapping';
import { classifyNewConstraint, measureConstraint, solveSketch } from './solver';

/** Contraintes géométriques posées par clics successifs (ou sur la sélection). */
export type ConstraintTool =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'collinear'
  | 'tangent'
  | 'pointOn'
  | 'midpoint'
  | 'concentric';

export type SketchTool = 'select' | 'line' | 'rectangle' | 'centerRectangle' | 'polygon' | 'circle' | 'arc' | 'slot' | 'trim' | 'project' | 'dimension' | ConstraintTool;

export const CONSTRAINT_TOOLS: readonly ConstraintTool[] = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'collinear',
  'tangent',
  'pointOn',
  'midpoint',
  'concentric',
];

export const TOOL_LABELS: Record<SketchTool, string> = {
  select: 'Sélection',
  line: 'Segment',
  rectangle: 'Rectangle',
  centerRectangle: 'Rectangle centré',
  polygon: 'Polygone',
  circle: 'Cercle',
  arc: 'Arc',
  slot: 'Oblong',
  trim: 'Couper',
  project: 'Projeter',
  dimension: 'Cote',
  coincident: 'Coïncidence',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallèle',
  perpendicular: 'Perpendiculaire',
  equal: 'Égalité',
  collinear: 'Colinéaire',
  tangent: 'Tangence',
  pointOn: 'Point sur',
  midpoint: 'Milieu',
  concentric: 'Concentrique',
};

export const TOOL_HELP: Record<SketchTool, string> = {
  select: 'Sélection : cliquez un élément pour le choisir, faites-le glisser pour le déplacer. Double-cliquez une cote pour changer sa valeur.',
  line: 'Segment : cliquez le point de départ puis les points suivants. Cliquez le premier point pour fermer le contour. Vous pouvez taper la longueur.',
  rectangle: 'Rectangle : cliquez un premier coin puis le coin opposé. Vous pouvez aussi taper la largeur et la hauteur au clavier.',
  centerRectangle:
    'Rectangle centré : cliquez le centre puis un coin. Le centre reste au milieu quand les dimensions changent. Vous pouvez taper la largeur et la hauteur.',
  polygon:
    'Polygone régulier : cliquez le centre puis un sommet. Tapez le diamètre du cercle qui passe par les sommets et le nombre de côtés (Tab pour passer de l’un à l’autre).',
  slot: 'Oblong (rainure) : cliquez le centre du premier arrondi, puis celui du second, puis la largeur. Vous pouvez taper la longueur entre centres puis la largeur.',
  circle: 'Cercle : cliquez le centre puis un point du bord. Vous pouvez aussi taper le diamètre au clavier.',
  arc: 'Arc : cliquez le centre, puis le point de départ, puis tournez dans le sens voulu et cliquez l’arrivée. Vous pouvez taper le rayon puis l’angle.',
  trim: 'Couper : survolez un trait : la partie en rouge, jusqu’aux croisements les plus proches, sera retirée au clic. Pratique pour réunir deux formes en un seul contour.',
  project:
    'Projeter : cliquez une arête de la pièce (en violet) pour la reprendre dans l’esquisse. Elle suit la pièce et sert de repère pour coter (centre d’un trou, bord…).',
  dimension:
    'Cote : cliquez un segment (longueur) ou un cercle (diamètre), puis éventuellement un second élément : distance entre deux points, d’un point à un segment, entre deux segments parallèles, ou angle entre deux segments.',
  coincident: 'Coïncidence : cliquez deux points pour les réunir (ou un point puis une courbe pour l’y poser).',
  horizontal: 'Horizontal : cliquez un segment pour le rendre horizontal.',
  vertical: 'Vertical : cliquez un segment pour le rendre vertical.',
  parallel: 'Parallèle : cliquez deux segments pour qu’ils aient la même direction.',
  perpendicular: 'Perpendiculaire : cliquez deux segments pour qu’ils forment un angle droit.',
  equal: 'Égalité : cliquez deux segments (même longueur) ou deux cercles (même diamètre).',
  collinear: 'Colinéaire : cliquez deux segments pour les aligner sur une même droite.',
  tangent: 'Tangence : cliquez un segment et un cercle, ou deux cercles, pour qu’ils se touchent sans se couper.',
  pointOn: 'Point sur : cliquez un point puis un segment ou un cercle pour poser le point dessus.',
  midpoint: 'Milieu : cliquez un point puis un segment pour placer le point au milieu du segment.',
  concentric: 'Concentrique : cliquez deux cercles pour leur donner le même centre.',
};

/** Arête de la pièce projetée sur le plan de l'esquisse, proposée par l'outil Projeter. */
export type ProjectableCurve =
  | { kind: 'line'; a: Vec2; b: Vec2; ref: EdgeRef }
  | { kind: 'circle'; center: Vec2; radius: number; ref: EdgeRef };

export interface SessionMessage {
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface DimensionCandidate {
  constraint: NewConstraint;
  label: string;
}

/** Unité affichée et saisie pour une cote. */
export function dimensionUnit(type: SketchConstraint['type']): 'mm' | '°' {
  return type === 'angle' ? '°' : 'mm';
}

export interface DimensionEditor {
  mode: 'create' | 'edit';
  constraintId?: string;
  candidates: DimensionCandidate[];
  choice: number;
  text: string;
  /** Vrai tant que la valeur proposée n'a pas été modifiée (la première frappe la remplace). */
  fresh: boolean;
  error: string | null;
  anchor: Vec2;
}

export interface DrawInput {
  labels: string[];
  values: string[];
  /** Champ qui reçoit les chiffres tapés au clavier. */
  active: number;
  error: string | null;
}

interface DragState {
  target: SketchTarget;
  origin: Vec2;
  base: SketchParams;
  moved: boolean;
}

export interface SketchSession {
  featureId: Id;
  partId: Id;
  isNew: boolean;
  frame: Frame3D;
  /** Esquisse au début de la session (pour « Annuler »). */
  initial: SketchParams;
  sketch: SketchParams;
  dof: number;
  freeEntities: string[];
  converged: boolean;
  tool: SketchTool;
  /** Premier point du tracé en cours (segment, rectangle, cercle ; centre d'un arc). */
  start: SnapResult | null;
  /** Arc en cours : point de départ et rotation cumulée du curseur (signe : sens de l'arc). */
  arc: { start: SnapResult; sweep: number; lastAngle: number } | null;
  /** Oblong : second centre choisi (on règle ensuite la largeur). */
  slot: { end: SnapResult; length: number | null } | null;
  chainFirstPointId: string | null;
  chainLastPointId: string | null;
  /** Éléments choisis l'un après l'autre par l'outil Cote ou une contrainte. */
  picks: string[];
  /** Les nouveaux éléments dessinés sont de construction (pointillés, ignorés pour le volume). */
  construction: boolean;
  /** Arêtes de la pièce que l'outil Projeter peut reprendre, et celle survolée. */
  projectable: ProjectableCurve[];
  projectHover: number | null;
  input: DrawInput | null;
  cursor: Vec2 | null;
  snap: SnapResult | null;
  hover: SketchTarget | null;
  selection: string[];
  drag: DragState | null;
  /** Cote en cours de déplacement à la souris (esquisse avant le geste, pour Annuler). */
  labelDrag: { constraintId: string; base: SketchParams } | null;
  editor: DimensionEditor | null;
  message: SessionMessage | null;
  undo: SketchParams[];
  redo: SketchParams[];
  pixelSize: number;
  gridStep: number;
  snapToGrid: boolean;
  dirty: boolean;
}

const SNAP_PIXELS = 9;
const DRAG_PIXELS = 3;
const MAX_UNDO = 100;

export function createSession(args: {
  featureId: Id;
  partId: Id;
  isNew: boolean;
  frame: Frame3D;
  sketch: SketchParams;
  projectable?: ProjectableCurve[];
}): SketchSession {
  const res = solveSketch(args.sketch);
  return {
    featureId: args.featureId,
    partId: args.partId,
    isNew: args.isNew,
    frame: args.frame,
    initial: args.sketch,
    sketch: res.converged ? res.sketch : args.sketch,
    dof: res.dof,
    freeEntities: Array.from(res.freeEntities),
    converged: res.converged,
    tool: args.sketch.entities.length === 0 ? 'rectangle' : 'select',
    start: null,
    arc: null,
    slot: null,
    chainFirstPointId: null,
    chainLastPointId: null,
    picks: [],
    construction: false,
    projectable: args.projectable ?? [],
    projectHover: null,
    input: null,
    cursor: null,
    snap: null,
    hover: null,
    selection: [],
    drag: null,
    labelDrag: null,
    editor: null,
    message: res.converged ? null : { kind: 'error', text: 'Certaines contraintes de cette esquisse sont incompatibles : supprimez-en une.' },
    undo: [],
    redo: [],
    pixelSize: 0.1,
    gridStep: 1,
    snapToGrid: true,
    dirty: false,
  };
}

const tolerance = (s: SketchSession) => SNAP_PIXELS * s.pixelSize;
const info = (text: string): SessionMessage => ({ kind: 'info', text });
const success = (text: string): SessionMessage => ({ kind: 'success', text });
const failure = (text: string): SessionMessage => ({ kind: 'error', text });

function resetDraw(s: SketchSession): SketchSession {
  return { ...s, start: null, arc: null, slot: null, chainFirstPointId: null, chainLastPointId: null, picks: [], input: null };
}

/** Applique une nouvelle esquisse après résolution ; refuse si les contraintes sont incompatibles. */
function commit(
  s: SketchSession,
  next: SketchParams,
  opts: { weights?: Map<string, number>; message?: SessionMessage | null; pushUndo?: boolean } = {},
): { session: SketchSession; ok: boolean } {
  const res = solveSketch(next, opts.weights ? { weights: opts.weights } : {});
  if (!res.converged) {
    return { session: { ...s, message: failure('Ces contraintes ne peuvent pas être satisfaites ensemble : l’action a été annulée.') }, ok: false };
  }
  const pushUndo = opts.pushUndo ?? true;
  return {
    session: {
      ...s,
      sketch: res.sketch,
      dof: res.dof,
      freeEntities: Array.from(res.freeEntities),
      converged: true,
      undo: pushUndo ? [...s.undo, s.sketch].slice(-MAX_UNDO) : s.undo,
      redo: pushUndo ? [] : s.redo,
      dirty: true,
      message: opts.message === undefined ? s.message : opts.message,
    },
    ok: true,
  };
}

export function isConstraintTool(tool: SketchTool): tool is ConstraintTool {
  return (CONSTRAINT_TOOLS as readonly string[]).includes(tool);
}

export function setTool(s: SketchSession, tool: SketchTool): SketchSession {
  let next = resetDraw({ ...s, tool, editor: null, drag: null, projectHover: null, message: info(TOOL_HELP[tool]) });
  if (isConstraintTool(tool)) {
    const applied = applyConstraintToSelection(next, tool);
    if (applied) next = { ...applied, tool: 'select' };
  }
  if (tool === 'project' && s.projectable.length === 0) {
    next = { ...next, message: info('Aucune arête de la pièce ne peut être projetée sur ce plan pour l’instant (il faut un volume déjà construit).') };
  }
  return next;
}

/** Bascule le mode construction, ou passe les courbes sélectionnées en construction (et inversement). */
export function toggleConstruction(s: SketchSession): SketchSession {
  const curves = s.selection.filter((id) => {
    const e = s.sketch.entities.find((x) => x.id === id);
    return e && (e.type === 'line' || e.type === 'circle' || e.type === 'arc') && !e.reference;
  });
  if (curves.length > 0) {
    const allConstruction = curves.every((id) => {
      const e = s.sketch.entities.find((x) => x.id === id);
      return e && (e.type === 'line' || e.type === 'circle' || e.type === 'arc') && e.construction;
    });
    const next = setConstruction(s.sketch, curves, !allConstruction);
    const { session } = commit(s, next, {
      message: success(
        allConstruction
          ? 'Éléments remis en traits normaux : ils comptent à nouveau pour le volume.'
          : 'Éléments passés en construction (pointillés) : ils servent de repères et ne comptent pas pour le volume.',
      ),
    });
    return session;
  }
  const on = !s.construction;
  return {
    ...s,
    construction: on,
    message: info(
      on
        ? 'Mode construction : les prochains éléments seront des traits de construction (pointillés), utiles comme repères, ignorés pour le volume.'
        : 'Mode construction désactivé : les prochains éléments seront des traits normaux.',
    ),
  };
}

function setConstruction(sketch: SketchParams, ids: readonly string[], on: boolean): SketchParams {
  const set = new Set(ids);
  return {
    ...sketch,
    entities: sketch.entities.map((e): SketchEntity => {
      if (!set.has(e.id) || (e.type !== 'line' && e.type !== 'circle' && e.type !== 'arc') || e.reference) return e;
      const copy = { ...e };
      if (on) copy.construction = true;
      else delete copy.construction;
      return copy;
    }),
  };
}

export function setPixelSize(s: SketchSession, pixelSize: number): SketchSession {
  if (Math.abs(pixelSize - s.pixelSize) < 1e-12) return s;
  return { ...s, pixelSize, gridStep: gridStepFor(pixelSize) };
}

export function toggleSnapToGrid(s: SketchSession): SketchSession {
  return { ...s, snapToGrid: !s.snapToGrid, message: info(s.snapToGrid ? 'Aimantation à la grille désactivée.' : 'Aimantation à la grille activée.') };
}

function computeSnap(s: SketchSession, p: Vec2, alt: boolean): SnapResult {
  return snapPoint(s.sketch, p, {
    tolerance: tolerance(s),
    gridStep: s.gridStep,
    snapToGrid: s.snapToGrid,
    ...(s.start && s.tool === 'line' ? { reference: s.start.point } : {}),
    disabled: alt,
  });
}

export function pointerMove(s: SketchSession, p: Vec2, opts: { alt?: boolean } = {}): SketchSession {
  if (s.drag) return dragTo(s, p, !!opts.alt);
  if (s.tool === 'project') {
    const projectHover = nearestProjectable(s, p);
    return projectHover === s.projectHover && s.cursor === p ? s : { ...s, cursor: p, projectHover, hover: null, snap: null };
  }
  const drawing = s.tool === 'line' || s.tool === 'rectangle' || s.tool === 'centerRectangle' || s.tool === 'polygon' || s.tool === 'circle' || s.tool === 'arc' || s.tool === 'slot';
  const snap = drawing ? computeSnap(s, p, !!opts.alt) : null;
  if (s.tool === 'arc' && s.start && s.arc) {
    // Rotation cumulée : le sens de l'arc suit le mouvement de la souris.
    const c = s.start.point;
    const angle = Math.atan2(p.y - c.y, p.x - c.x);
    let delta = angle - s.arc.lastAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    const sweep = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, s.arc.sweep + delta));
    return { ...s, cursor: p, snap, hover: null, arc: { ...s.arc, sweep, lastAngle: angle } };
  }
  const hover = drawing ? null : hitTest(s.sketch, p, tolerance(s), true, s.tool === 'trim');
  return { ...s, cursor: p, snap, hover };
}

export function pointerLeave(s: SketchSession): SketchSession {
  // Tracé en cours : l'aperçu reste affiché (la souris va souvent vers la saisie au clavier).
  if (s.start) return { ...s, hover: null };
  return { ...s, cursor: null, snap: null, hover: null };
}

export function pointerDown(s: SketchSession, p: Vec2, opts: { shift?: boolean; alt?: boolean } = {}): SketchSession {
  if (s.editor) s = { ...s, editor: null };
  switch (s.tool) {
    case 'line':
      return lineClick(s, computeSnap(s, p, !!opts.alt));
    case 'rectangle':
      return rectangleClick(s, computeSnap(s, p, !!opts.alt));
    case 'circle':
      return circleClick(s, computeSnap(s, p, !!opts.alt));
    case 'centerRectangle':
      return centerRectangleClick(s, computeSnap(s, p, !!opts.alt));
    case 'arc':
      return arcClick(s, computeSnap(s, p, !!opts.alt));
    case 'polygon':
      return polygonClick(s, computeSnap(s, p, !!opts.alt));
    case 'slot':
      return slotClick(s, computeSnap(s, p, !!opts.alt));
    case 'project':
      return projectClick(s, p);
    case 'trim':
      return trimClick(s, p);
    case 'dimension':
      return dimensionClick(s, p);
    case 'select':
      return selectClick(s, p, !!opts.shift);
    default:
      return constraintToolClick(s, p, s.tool);
  }
}

export function pointerUp(s: SketchSession): SketchSession {
  if (!s.drag) return s;
  const { drag } = s;
  if (!drag.moved) return { ...s, drag: null };
  const changed = drag.base !== s.sketch;
  return {
    ...s,
    drag: null,
    undo: changed ? [...s.undo, drag.base].slice(-MAX_UNDO) : s.undo,
    redo: changed ? [] : s.redo,
    dirty: s.dirty || changed,
  };
}

// ---------------------------------------------------------------------------
// Outils de dessin

/** Outil Couper : retire le morceau de courbe sous le clic (voir `trim.ts`). */
function trimClick(s: SketchSession, p: Vec2): SketchSession {
  const target = hitTest(s.sketch, p, tolerance(s), true, true);
  if (!target || target.kind === 'point') return { ...s, message: info('Cliquez sur un trait (segment, cercle ou arc) pour en retirer un morceau.') };
  const entity = s.sketch.entities.find((e) => e.id === target.id);
  if (entity && entity.type !== 'point' && entity.reference) return { ...s, message: info('Une arête reprise de la pièce ne se coupe pas : elle suit la pièce.') };
  const out = trimAt(s.sketch, target.id, p);
  if (!out) return s;
  const dropped = out.droppedConstraints;
  const text = out.deleted
    ? 'Ce trait ne croisait rien : il a été supprimé en entier.'
    : `Morceau retiré.${dropped ? ` ${dropped} cote${dropped > 1 ? 's' : ''} ou contrainte${dropped > 1 ? 's' : ''} qui n’avai${dropped > 1 ? 'ent' : 't'} plus de sens ${dropped > 1 ? 'ont' : 'a'} été retirée${dropped > 1 ? 's' : ''}.` : ''}`;
  const { session } = commit(s, out.sketch, { message: success(text) });
  return { ...session, hover: null, selection: [] };
}

function lineClick(s: SketchSession, snap: SnapResult): SketchSession {
  if (!s.start) {
    return {
      ...s,
      start: snap,
      chainFirstPointId: null,
      chainLastPointId: null,
      input: { labels: ['Longueur'], values: [''], active: 0, error: null },
      message: info('Cliquez le point suivant, ou tapez une longueur puis Entrée.'),
    };
  }
  return createLine(s, s.start, snap, null);
}

function createLine(s: SketchSession, start: SnapResult, end: SnapResult, length: number | null): SketchSession {
  if (distance2(start.point, end.point) < tolerance(s) / 4 && length === null) return s;
  let sk = s.sketch;
  const r = addLine(sk, start.point, end.point);
  sk = s.construction ? setConstruction(r.sketch, [r.lineId], true) : r.sketch;
  const startRef = s.chainLastPointId ?? start.pointId;
  if (startRef) sk = addConstraint(sk, { type: 'coincident', a: startRef, b: r.a }).sketch;
  if (end.pointId) sk = addConstraint(sk, { type: 'coincident', a: end.pointId, b: r.b }).sketch;
  if (end.kind === 'horizontal') sk = addConstraint(sk, { type: 'horizontal', line: r.lineId }).sketch;
  if (end.kind === 'vertical') sk = addConstraint(sk, { type: 'vertical', line: r.lineId }).sketch;
  if (length !== null) sk = addConstraint(sk, { type: 'length', line: r.lineId, value: length }).sketch;
  const weights = new Map([
    [`${r.a}.x`, 1e3],
    [`${r.a}.y`, 1e3],
  ]);
  const { session, ok } = commit(s, sk, { weights });
  if (!ok) return session;
  const firstId = s.chainFirstPointId ?? r.a;
  const closes = end.pointId !== undefined && (end.pointId === firstId || arePointsCoincident(session.sketch, end.pointId, firstId));
  if (end.pointId) {
    return resetDraw({
      ...session,
      message: success(closes ? 'Contour fermé.' : 'Segment relié au point existant.'),
    });
  }
  const endPos = pointPosition(session.sketch, r.b) ?? end.point;
  return {
    ...session,
    start: { point: endPos, kind: 'point', pointId: r.b, label: 'Extrémité' },
    chainFirstPointId: firstId,
    chainLastPointId: r.b,
    input: { labels: ['Longueur'], values: [''], active: 0, error: null },
    message: info('Segment ajouté. Cliquez le point suivant, ou le premier point pour fermer. Échap pour arrêter.'),
  };
}

function rectangleClick(s: SketchSession, snap: SnapResult): SketchSession {
  if (!s.start) {
    return {
      ...s,
      start: snap,
      input: { labels: ['Largeur', 'Hauteur'], values: ['', ''], active: 0, error: null },
      message: info('Cliquez le coin opposé, ou tapez la largeur et la hauteur (Tab pour passer de l’une à l’autre) puis Entrée.'),
    };
  }
  const dx = snap.point.x - s.start.point.x;
  const dy = snap.point.y - s.start.point.y;
  if (Math.abs(dx) < tolerance(s) / 2 || Math.abs(dy) < tolerance(s) / 2) {
    return { ...s, message: failure('Le rectangle est trop étroit : éloignez davantage le second coin.') };
  }
  return createRectangle(s, s.start, snap, null);
}

function createRectangle(s: SketchSession, start: SnapResult, end: SnapResult, size: { w: number; h: number } | null): SketchSession {
  const r = addRectangle(s.sketch, start.point, end.point);
  let sk = s.construction ? setConstruction(r.sketch, r.lines, true) : r.sketch;
  if (start.pointId) sk = addConstraint(sk, { type: 'coincident', a: start.pointId, b: r.corners[0] }).sketch;
  if (end.pointId) sk = addConstraint(sk, { type: 'coincident', a: end.pointId, b: r.corners[2] }).sketch;
  if (size) {
    sk = addConstraint(sk, { type: 'length', line: r.lines[0], value: size.w }).sketch;
    sk = addConstraint(sk, { type: 'length', line: r.lines[3], value: size.h }).sketch;
  }
  const c0 = r.corners[0];
  const weights = new Map([
    [`${c0}.x`, 1e3],
    [`${c0}.y`, 1e3],
  ]);
  const message = size
    ? success(`Rectangle ${formatLength(size.w, 2, false)} × ${formatLength(size.h)} ajouté avec ses cotes.`)
    : success('Rectangle ajouté. Pour fixer ses dimensions, ajoutez des cotes avec l’outil Cote.');
  const { session } = commit(s, sk, { weights, message });
  return resetDraw(session);
}

function circleClick(s: SketchSession, snap: SnapResult): SketchSession {
  if (!s.start) {
    return {
      ...s,
      start: snap,
      input: { labels: ['Diamètre'], values: [''], active: 0, error: null },
      message: info('Cliquez un point du bord, ou tapez le diamètre puis Entrée.'),
    };
  }
  const r = distance2(s.start.point, snap.point);
  if (r < tolerance(s) / 2) return { ...s, message: failure('Le cercle est trop petit : éloignez davantage le point du bord.') };
  return createCircle(s, s.start, r, null);
}

function createCircle(s: SketchSession, center: SnapResult, radius: number, diameter: number | null): SketchSession {
  const c = addCircle(s.sketch, center.point, radius);
  let sk = s.construction ? setConstruction(c.sketch, [c.circleId], true) : c.sketch;
  if (center.pointId) sk = addConstraint(sk, { type: 'coincident', a: center.pointId, b: c.center }).sketch;
  if (diameter !== null) sk = addConstraint(sk, { type: 'diameter', circle: c.circleId, value: diameter }).sketch;
  const message =
    diameter !== null
      ? success(`Cercle de diamètre ${formatLength(diameter)} ajouté. Placez-le avec des cotes depuis l’origine.`)
      : success('Cercle ajouté. Ajoutez une cote de diamètre et des cotes de position avec l’outil Cote.');
  const { session } = commit(s, sk, { message });
  return resetDraw(session);
}

// ---------------------------------------------------------------------------
// Rectangle par le centre

function centerRectangleClick(s: SketchSession, snap: SnapResult): SketchSession {
  if (!s.start) {
    return {
      ...s,
      start: snap,
      input: { labels: ['Largeur', 'Hauteur'], values: ['', ''], active: 0, error: null },
      message: info('Cliquez un coin, ou tapez la largeur et la hauteur totales (Tab pour passer de l’une à l’autre) puis Entrée.'),
    };
  }
  const hw = Math.abs(snap.point.x - s.start.point.x);
  const hh = Math.abs(snap.point.y - s.start.point.y);
  if (hw < tolerance(s) / 2 || hh < tolerance(s) / 2) return { ...s, message: failure('Le rectangle est trop étroit : éloignez davantage le coin du centre.') };
  return createCenterRectangle(s, s.start, hw, hh, null);
}

/**
 * Rectangle autour d'un centre : quatre segments (horizontaux / verticaux) et deux diagonales de
 * construction dont le centre est le milieu. Le centre reste donc au milieu quand on cote.
 */
function createCenterRectangle(s: SketchSession, center: SnapResult, hw: number, hh: number, size: { w: number; h: number } | null): SketchSession {
  const c = center.point;
  const r = addRectangle(s.sketch, { x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y + hh });
  let sk = s.construction ? setConstruction(r.sketch, r.lines, true) : r.sketch;
  const [c0, c1, c2, c3] = r.corners;
  const pos = (id: string) => pointPosition(sk, id)!;
  const d1 = addLine(sk, pos(c0), pos(c2));
  const d2 = addLine(d1.sketch, pos(c1), pos(c3));
  sk = setConstruction(d2.sketch, [d1.lineId, d2.lineId], true);
  const mid = addPoint(sk, c);
  sk = mid.sketch;
  for (const [a, b] of [
    [c0, d1.a],
    [c2, d1.b],
    [c1, d2.a],
    [c3, d2.b],
  ] as const) {
    sk = addConstraint(sk, { type: 'coincident', a, b }).sketch;
  }
  sk = addConstraint(sk, { type: 'midpoint', point: mid.id, line: d1.lineId }).sketch;
  sk = addConstraint(sk, { type: 'midpoint', point: mid.id, line: d2.lineId }).sketch;
  if (center.pointId) sk = addConstraint(sk, { type: 'coincident', a: center.pointId, b: mid.id }).sketch;
  if (size) {
    sk = addConstraint(sk, { type: 'length', line: r.lines[0], value: size.w }).sketch;
    sk = addConstraint(sk, { type: 'length', line: r.lines[3], value: size.h }).sketch;
  }
  const weights = new Map([
    [`${mid.id}.x`, 1e3],
    [`${mid.id}.y`, 1e3],
  ]);
  const message = size
    ? success(`Rectangle centré ${formatLength(size.w, 2, false)} × ${formatLength(size.h)} ajouté avec ses cotes.`)
    : success('Rectangle centré ajouté : son centre reste au milieu. Ajoutez des cotes pour fixer ses dimensions.');
  const { session } = commit(s, sk, { weights, message });
  return resetDraw(session);
}

// ---------------------------------------------------------------------------
// Polygone régulier

const DEFAULT_SIDES = 6;

/** Nombre de côtés tapé (3 à 32). */
function parseSides(text: string): ParseResult {
  const v = readNumber(text);
  if (v === null || !Number.isInteger(v)) return { ok: false, error: 'Le nombre de côtés doit être un nombre entier (exemple : 6).' };
  if (v < 3 || v > 32) return { ok: false, error: 'Un polygone a entre 3 et 32 côtés.' };
  return { ok: true, value: v };
}

/** Nombre de côtés en cours (saisi s'il est valide, sinon 6). */
function currentSides(s: SketchSession): number {
  const r = s.input && s.tool === 'polygon' ? parseSides(s.input.values[1] ?? '') : null;
  return r?.ok ? r.value : DEFAULT_SIDES;
}

function polygonVertices(center: Vec2, vertex: Vec2, sides: number): Vec2[] {
  const r = distance2(center, vertex);
  const a0 = Math.atan2(vertex.y - center.y, vertex.x - center.x);
  return Array.from({ length: sides }, (_v, k) => {
    const a = a0 + (2 * Math.PI * k) / sides;
    return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
  });
}

function polygonClick(s: SketchSession, snap: SnapResult): SketchSession {
  if (!s.start) {
    return {
      ...s,
      start: snap,
      input: { labels: ['Diamètre', 'Côtés'], values: ['', String(DEFAULT_SIDES)], active: 0, error: null },
      message: info('Cliquez un sommet, ou tapez le diamètre (cercle passant par les sommets) et le nombre de côtés, puis Entrée.'),
    };
  }
  if (distance2(s.start.point, snap.point) < tolerance(s) / 2) return { ...s, message: failure('Le polygone est trop petit : éloignez davantage le sommet du centre.') };
  return createPolygon(s, s.start, snap.point, currentSides(s), null);
}

/**
 * Polygone régulier : ses sommets sont posés sur un cercle de construction et ses côtés sont
 * égaux. Coter le diamètre de ce cercle fixe la taille ; le polygone peut encore tourner.
 */
function createPolygon(s: SketchSession, center: SnapResult, vertex: Vec2, sides: number, diameter: number | null): SketchSession {
  const pts = polygonVertices(center.point, vertex, sides);
  const circle = addCircle(s.sketch, center.point, distance2(center.point, vertex));
  let sk = setConstruction(circle.sketch, [circle.circleId], true);
  const lines: { id: string; a: string; b: string }[] = [];
  for (let k = 0; k < sides; k++) {
    const r = addLine(sk, pts[k]!, pts[(k + 1) % sides]!);
    sk = r.sketch;
    lines.push({ id: r.lineId, a: r.a, b: r.b });
  }
  if (s.construction) sk = setConstruction(sk, lines.map((l) => l.id), true);
  for (let k = 0; k < sides; k++) {
    const l = lines[k]!;
    const next = lines[(k + 1) % sides]!;
    sk = addConstraint(sk, { type: 'coincident', a: l.b, b: next.a }).sketch;
    sk = addConstraint(sk, { type: 'pointOn', point: l.a, curve: circle.circleId }).sketch;
    // Égalités en chaîne (chaque côté égal au suivant) : une marque « = » par côté, pas une pile sur le premier.
    if (k > 0) sk = addConstraint(sk, { type: 'equal', a: lines[k - 1]!.id, b: l.id }).sketch;
  }
  if (center.pointId) sk = addConstraint(sk, { type: 'coincident', a: center.pointId, b: circle.center }).sketch;
  if (diameter !== null) sk = addConstraint(sk, { type: 'diameter', circle: circle.circleId, value: diameter }).sketch;
  const weights = new Map([
    [`${circle.center}.x`, 1e3],
    [`${circle.center}.y`, 1e3],
  ]);
  const message = diameter !== null
    ? success(`Polygone à ${sides} côtés ajouté, dans un cercle de ${formatLength(diameter)}.`)
    : success(`Polygone à ${sides} côtés ajouté. Cotez le diamètre du cercle en pointillés pour fixer sa taille.`);
  const { session } = commit(s, sk, { weights, message });
  return resetDraw(session);
}

// ---------------------------------------------------------------------------
// Oblong (rainure)

function slotClick(s: SketchSession, snap: SnapResult): SketchSession {
  if (!s.start) {
    return {
      ...s,
      start: snap,
      input: { labels: ['Longueur'], values: [''], active: 0, error: null },
      message: info('Cliquez le centre du second arrondi, ou tapez la longueur entre les deux centres puis Entrée.'),
    };
  }
  if (!s.slot) {
    if (distance2(s.start.point, snap.point) < tolerance(s) / 2) return { ...s, message: failure('Les deux centres sont confondus : éloignez davantage le second.') };
    return beginSlotWidth(s, snap);
  }
  const width = 2 * slotHalfWidth(s.start.point, s.slot.end.point, snap.point);
  if (width < tolerance(s) / 2) return { ...s, message: failure('L’oblong est trop étroit : éloignez davantage la souris de l’axe.') };
  return createSlot(s, s.start, s.slot.end, width, { length: s.slot.length, width: null });
}

function beginSlotWidth(s: SketchSession, end: SnapResult, length: number | null = null): SketchSession {
  return {
    ...s,
    slot: { end, length },
    input: { labels: ['Largeur'], values: [''], active: 0, error: null },
    message: info('Éloignez la souris de l’axe pour régler la largeur puis cliquez, ou tapez la largeur puis Entrée.'),
  };
}

/** Distance du point `p` à la droite qui passe par les deux centres. */
function slotHalfWidth(c1: Vec2, c2: Vec2, p: Vec2): number {
  const d = normalize2(sub2(c2, c1));
  return Math.abs((p.x - c1.x) * -d.y + (p.y - c1.y) * d.x);
}

/** Contour d'un oblong : deux demi-cercles et deux segments tangents. */
function slotOutline(c1: Vec2, c2: Vec2, r: number) {
  const d = normalize2(sub2(c2, c1));
  const n = { x: -d.y, y: d.x };
  const off = (c: Vec2, k: number) => ({ x: c.x + n.x * r * k, y: c.y + n.y * r * k });
  return { a1: off(c1, 1), b1: off(c2, 1), b2: off(c2, -1), a2: off(c1, -1), angle: Math.atan2(d.y, d.x) };
}

/**
 * Oblong : segments haut et bas tangents aux deux arcs, extrémités reliées, arcs de même rayon.
 * Il reste les deux centres et la largeur à coter.
 */
function createSlot(s: SketchSession, c1: SnapResult, c2: SnapResult, width: number, size: { length: number | null; width: number | null }): SketchSession {
  const r = width / 2;
  const o = slotOutline(c1.point, c2.point, r);
  const top = addLine(s.sketch, o.a1, o.b1);
  const bottom = addLine(top.sketch, o.b2, o.a2);
  const arcEnd = addArc(bottom.sketch, c2.point, o.b2, o.b1);
  const arcStart = addArc(arcEnd.sketch, c1.point, o.a1, o.a2);
  let sk = arcStart.sketch;
  if (s.construction) sk = setConstruction(sk, [top.lineId, bottom.lineId, arcEnd.arcId, arcStart.arcId], true);
  for (const [a, b] of [
    [top.b, arcEnd.end],
    [arcEnd.start, bottom.a],
    [bottom.b, arcStart.end],
    [arcStart.start, top.a],
  ] as const) {
    sk = addConstraint(sk, { type: 'coincident', a, b }).sketch;
  }
  for (const line of [top.lineId, bottom.lineId]) {
    for (const arc of [arcStart.arcId, arcEnd.arcId]) sk = addConstraint(sk, { type: 'tangent', a: line, b: arc }).sketch;
  }
  sk = addConstraint(sk, { type: 'equal', a: arcStart.arcId, b: arcEnd.arcId }).sketch;
  if (c1.pointId) sk = addConstraint(sk, { type: 'coincident', a: c1.pointId, b: arcStart.center }).sketch;
  if (c2.pointId) sk = addConstraint(sk, { type: 'coincident', a: c2.pointId, b: arcEnd.center }).sketch;
  if (size.length !== null) sk = addConstraint(sk, { type: 'distance', a: arcStart.center, b: arcEnd.center, value: size.length }).sketch;
  if (size.width !== null) sk = addConstraint(sk, { type: 'diameter', circle: arcStart.arcId, value: size.width }).sketch;
  const weights = new Map([
    [`${arcStart.center}.x`, 1e3],
    [`${arcStart.center}.y`, 1e3],
    [`${arcEnd.center}.x`, 1e3],
    [`${arcEnd.center}.y`, 1e3],
  ]);
  const message =
    size.length !== null && size.width !== null
      ? success(`Oblong ajouté : ${formatLength(size.length)} entre centres, largeur ${formatLength(size.width)}.`)
      : success('Oblong ajouté. Cotez la distance entre les centres et le diamètre d’un arrondi pour fixer sa taille.');
  const { session } = commit(s, sk, { weights, message });
  return resetDraw(session);
}

// ---------------------------------------------------------------------------
// Arc de cercle

function arcClick(s: SketchSession, snap: SnapResult): SketchSession {
  if (!s.start) {
    return {
      ...s,
      start: snap,
      input: { labels: ['Rayon'], values: [''], active: 0, error: null },
      message: info('Cliquez le point de départ de l’arc, ou tapez le rayon puis Entrée.'),
    };
  }
  if (!s.arc) {
    const r = distance2(s.start.point, snap.point);
    if (r < tolerance(s) / 2) return { ...s, message: failure('L’arc est trop petit : éloignez davantage le point de départ du centre.') };
    return beginArc(s, snap);
  }
  return finishArc(s, snap, null);
}

function beginArc(s: SketchSession, startSnap: SnapResult): SketchSession {
  const c = s.start!.point;
  const angle = Math.atan2(startSnap.point.y - c.y, startSnap.point.x - c.x);
  return {
    ...s,
    arc: { start: startSnap, sweep: 0, lastAngle: angle },
    input: { labels: ['Angle'], values: [''], active: 0, error: null },
    message: info('Tournez dans le sens voulu puis cliquez l’arrivée, ou tapez l’angle (en degrés) puis Entrée.'),
  };
}

/** Termine l'arc : arrivée cliquée (accrochée ou ramenée sur le cercle) ou angle tapé. */
function finishArc(s: SketchSession, endSnap: SnapResult | null, angleDeg: number | null): SketchSession {
  const center = s.start!;
  const arcState = s.arc!;
  const c = center.point;
  const startPt = arcState.start.point;
  const r = distance2(c, startPt);
  const a0 = Math.atan2(startPt.y - c.y, startPt.x - c.x);
  let ccw = arcState.sweep >= 0;
  let endPt: Vec2;
  let endId: string | undefined;
  if (angleDeg !== null) {
    const a = a0 + ((ccw ? 1 : -1) * angleDeg * Math.PI) / 180;
    endPt = { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  } else {
    const p = endSnap!.point;
    const d = Math.max(distance2(c, p), 1e-9);
    endPt = endSnap!.pointId ? p : { x: c.x + ((p.x - c.x) * r) / d, y: c.y + ((p.y - c.y) * r) / d };
    endId = endSnap!.pointId;
    if (Math.abs(arcState.sweep) < 1e-6) ccw = true;
  }
  if (distance2(endPt, startPt) < tolerance(s) / 4 && Math.abs(arcState.sweep) < Math.PI) {
    return { ...s, message: failure('L’arrivée est confondue avec le départ : tournez davantage avant de cliquer.') };
  }
  // Un arc est toujours enregistré dans le sens trigonométrique : on échange départ et arrivée si besoin.
  const [from, to, fromId, toId] = ccw ? [startPt, endPt, arcState.start.pointId, endId] : [endPt, startPt, endId, arcState.start.pointId];
  const a = addArc(s.sketch, c, from, to);
  let sk = s.construction ? setConstruction(a.sketch, [a.arcId], true) : a.sketch;
  if (center.pointId) sk = addConstraint(sk, { type: 'coincident', a: center.pointId, b: a.center }).sketch;
  if (fromId) sk = addConstraint(sk, { type: 'coincident', a: fromId, b: a.start }).sketch;
  if (toId) sk = addConstraint(sk, { type: 'coincident', a: toId, b: a.end }).sketch;
  const weights = new Map([
    [`${a.center}.x`, 1e3],
    [`${a.center}.y`, 1e3],
  ]);
  const { session } = commit(s, sk, {
    weights,
    message: success('Arc ajouté. Cotez son rayon, ou reliez-le aux segments voisins (coïncidence, tangence).'),
  });
  return resetDraw(session);
}

export function setInputValue(s: SketchSession, index: number, text: string): SketchSession {
  if (!s.input) return s;
  const values = s.input.values.map((v, i) => (i === index ? text : v));
  return { ...s, input: { ...s.input, values, active: index, error: null } };
}

export function setInputActive(s: SketchSession, index: number): SketchSession {
  if (!s.input || index < 0 || index >= s.input.values.length || index === s.input.active) return s;
  return { ...s, input: { ...s.input, active: index } };
}

/** Frappe au clavier hors d'un champ : le caractère s'ajoute au champ actif (aucune frappe perdue). */
export function typeIntoInput(s: SketchSession, key: string): SketchSession {
  if (!s.input) return s;
  const i = s.input.active;
  const current = s.input.values[i] ?? '';
  if (key === 'Backspace') return setInputValue(s, i, current.slice(0, -1));
  if (key === 'Tab') return setInputActive(s, (i + 1) % s.input.values.length);
  return setInputValue(s, i, current + key);
}

/** Frappe au clavier pendant la saisie d'une cote, avant que le champ ait le focus. */
export function typeIntoEditor(s: SketchSession, key: string): SketchSession {
  const ed = s.editor;
  if (!ed) return s;
  const base = ed.fresh ? '' : ed.text;
  const text = key === 'Backspace' ? base.slice(0, -1) : base + key;
  return { ...s, editor: { ...ed, text, fresh: false, error: null } };
}

/** Angle d'arc tapé (0 < angle < 360°). */
function parseAngleUpTo360(text: string): ParseResult {
  if (text.trim() === '') return { ok: false, error: 'L’angle est vide : tapez un nombre de degrés, par exemple 90.' };
  const v = readNumber(text);
  if (v === null) return { ok: false, error: 'L’angle doit être un nombre de degrés (exemple : 90).' };
  if (v <= 0 || v >= 360) return { ok: false, error: 'L’angle doit être compris entre 0° et 360° (exclus).' };
  return { ok: true, value: v };
}

/** Valide les valeurs tapées au clavier pendant un tracé (Entrée). */
export function confirmInput(s: SketchSession): SketchSession {
  if (!s.input || !s.start) return s;
  const parsed = s.input.values.map((v, i) => {
    const label = s.input!.labels[i]!;
    if (label === 'Angle') return parseAngleUpTo360(v);
    if (label === 'Côtés') return parseSides(v);
    return parseLength(v, { label: `${label === 'Rayon' || label === 'Diamètre' ? 'Le' : 'La'} ${label.toLowerCase()}` });
  });
  const firstError = parsed.find((r) => !r.ok);
  if (firstError && !firstError.ok) return { ...s, input: { ...s.input, error: firstError.error } };
  const values = parsed.map((r) => (r.ok ? r.value : 0));
  const cursor = s.snap?.point ?? s.cursor;
  if (s.tool === 'rectangle') {
    const sx = cursor && cursor.x < s.start.point.x ? -1 : 1;
    const sy = cursor && cursor.y < s.start.point.y ? -1 : 1;
    const end: SnapResult = { point: { x: s.start.point.x + sx * values[0]!, y: s.start.point.y + sy * values[1]! }, kind: 'free', label: '' };
    return createRectangle(s, s.start, end, { w: values[0]!, h: values[1]! });
  }
  if (s.tool === 'circle') return createCircle(s, s.start, values[0]! / 2, values[0]!);
  if (s.tool === 'centerRectangle') return createCenterRectangle(s, s.start, values[0]! / 2, values[1]! / 2, { w: values[0]!, h: values[1]! });
  if (s.tool === 'polygon') {
    const c = s.start.point;
    let dir = cursor ? normalize2(sub2(cursor, c)) : { x: 0, y: 1 };
    if (dir.x === 0 && dir.y === 0) dir = { x: 0, y: 1 };
    return createPolygon(s, s.start, add2(c, scale2(dir, values[0]! / 2)), values[1]!, values[0]!);
  }
  if (s.tool === 'slot') {
    const c1 = s.start.point;
    if (!s.slot) {
      let dir = cursor ? normalize2(sub2(cursor, c1)) : { x: 1, y: 0 };
      if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 };
      return beginSlotWidth(s, { point: add2(c1, scale2(dir, values[0]!)), kind: 'free', label: '' }, values[0]!);
    }
    return createSlot(s, s.start, s.slot.end, values[0]!, { length: s.slot.length, width: values[0]! });
  }
  if (s.tool === 'arc') {
    if (!s.arc) {
      const c = s.start.point;
      let dir = cursor ? normalize2(sub2(cursor, c)) : { x: 1, y: 0 };
      if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 };
      return beginArc(s, { point: add2(c, scale2(dir, values[0]!)), kind: 'free', label: '' });
    }
    return finishArc(s, null, values[0]!);
  }
  if (s.tool === 'line') {
    let dir = cursor ? normalize2(sub2(cursor, s.start.point)) : { x: 1, y: 0 };
    if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 };
    const kind = s.snap?.kind === 'horizontal' || s.snap?.kind === 'vertical' ? s.snap.kind : 'free';
    if (kind === 'horizontal') dir = { x: Math.sign(dir.x) || 1, y: 0 };
    if (kind === 'vertical') dir = { x: 0, y: Math.sign(dir.y) || 1 };
    const end: SnapResult = { point: add2(s.start.point, scale2(dir, values[0]!)), kind, label: '' };
    return createLine(s, s.start, end, values[0]!);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Cotes

function anchorWeights(c: NewConstraint | SketchConstraint, sketch: SketchParams): Map<string, number> {
  const w = new Map<string, number>();
  const hold = (pointId: string | undefined) => {
    if (!pointId || pointId === ORIGIN_POINT_ID) return;
    w.set(`${pointId}.x`, 1e3);
    w.set(`${pointId}.y`, 1e3);
  };
  const holdLine = (lineId: string, both: boolean) => {
    const l = findLine(sketch, lineId);
    hold(l?.a);
    if (both) hold(l?.b);
  };
  switch (c.type) {
    case 'distance':
    case 'distanceX':
    case 'distanceY':
      hold(c.a);
      break;
    case 'length':
      holdLine(c.line, false);
      break;
    case 'diameter':
    case 'radius':
      hold(findRound(sketch, c.circle)?.center);
      break;
    case 'angle':
      // Le premier segment reste en place, le second tourne.
      holdLine(c.a, true);
      break;
    case 'pointLineDistance':
      holdLine(c.line, true);
      break;
    default:
      break;
  }
  return w;
}

type PickKind = 'point' | 'line' | 'circle' | 'arc';

/** Cercle ou arc : élément « rond » (centre et rayon). */
const isRound = (k: PickKind) => k === 'circle' || k === 'arc';

/** Centre et rayon d'un cercle ou d'un arc. */
function roundInfo(sketch: SketchParams, id: string): { id: string; centerId: string; center: Vec2; radius: number } | null {
  const e = findRound(sketch, id);
  const center = e && pointPosition(sketch, e.center);
  if (!e || !center) return null;
  if (e.type === 'circle') return { id, centerId: e.center, center, radius: e.radius };
  const start = pointPosition(sketch, e.start);
  return start ? { id, centerId: e.center, center, radius: distance2(center, start) } : null;
}
interface PickTarget {
  kind: PickKind;
  id: string;
}

function targetOf(sketch: SketchParams, id: string): PickTarget | null {
  if (id === ORIGIN_POINT_ID) return { kind: 'point', id };
  const e = sketch.entities.find((x) => x.id === id);
  return e ? { kind: e.type, id } : null;
}

function dimensionCandidatesForPoints(s: SketchSession, a: string, b: string): DimensionCandidate[] | null {
  const pa = pointPosition(s.sketch, a);
  const pb = pointPosition(s.sketch, b);
  if (!pa || !pb) return null;
  const [lx, rx] = pb.x >= pa.x ? [a, b] : [b, a];
  const [ly, ry] = pb.y >= pa.y ? [a, b] : [b, a];
  const dx = Math.abs(pb.x - pa.x);
  const dy = Math.abs(pb.y - pa.y);
  const horizontal: DimensionCandidate = { label: 'Horizontale', constraint: { type: 'distanceX', a: lx, b: rx, value: dx } };
  const vertical: DimensionCandidate = { label: 'Verticale', constraint: { type: 'distanceY', a: ly, b: ry, value: dy } };
  const aligned: DimensionCandidate = { label: 'Alignée', constraint: { type: 'distance', a, b, value: Math.hypot(dx, dy) } };
  return dx >= dy ? [horizontal, vertical, aligned] : [vertical, horizontal, aligned];
}

function lineGeometry(sketch: SketchParams, lineId: string): { a: Vec2; b: Vec2; d: Vec2; len: number } | null {
  const line = findLine(sketch, lineId);
  const a = line && pointPosition(sketch, line.a);
  const b = line && pointPosition(sketch, line.b);
  if (!a || !b) return null;
  const d = sub2(b, a);
  return { a, b, d, len: Math.hypot(d.x, d.y) };
}

/** Distance d'un point à la droite qui porte un segment. */
function distanceToLine(p: Vec2, l: { a: Vec2; d: Vec2; len: number }): number {
  return Math.abs(cross2(l.d, sub2(p, l.a))) / Math.max(l.len, 1e-12);
}

/** Point d'un élément utilisé pour une distance (le centre pour un cercle). */
function measurePointOf(sketch: SketchParams, t: PickTarget): string | null {
  if (t.kind === 'point') return t.id;
  if (isRound(t.kind)) return findRound(sketch, t.id)?.center ?? null;
  return null;
}

/** Cotes possibles entre deux éléments cliqués l'un après l'autre. */
function pairDimensionCandidates(s: SketchSession, first: PickTarget, second: PickTarget): { candidates: DimensionCandidate[]; anchor: Vec2 } | null {
  const sk = s.sketch;
  // Deux segments : angle, ou distance s'ils sont parallèles.
  if (first.kind === 'line' && second.kind === 'line') {
    const la = lineGeometry(sk, first.id);
    const lb = lineGeometry(sk, second.id);
    if (!la || !lb || la.len < 1e-9 || lb.len < 1e-9) return null;
    const anchor = midpoint2(midpoint2(la.a, la.b), midpoint2(lb.a, lb.b));
    const sin = cross2(la.d, lb.d) / (la.len * lb.len);
    if (Math.abs(sin) < 1e-6) {
      const lineB = findLine(sk, second.id)!;
      const value = distanceToLine(lb.a, la);
      if (value < 1e-6) return null;
      return { candidates: [{ label: 'Distance', constraint: { type: 'pointLineDistance', point: lineB.a, line: first.id, value } }], anchor };
    }
    const theta = (Math.abs(Math.atan2(cross2(la.d, lb.d), dot2(la.d, lb.d))) * 180) / Math.PI;
    const direct: DimensionCandidate = { label: formatAngle(theta), constraint: { type: 'angle', a: first.id, b: second.id, value: theta } };
    const other: DimensionCandidate = {
      label: formatAngle(180 - theta),
      constraint: { type: 'angle', a: first.id, b: second.id, value: 180 - theta, supplementary: true },
    };
    if (Math.abs(theta - 90) < 1e-6) return { candidates: [direct], anchor };
    return { candidates: theta <= 90 ? [direct, other] : [other, direct], anchor };
  }
  // Un segment et un point (ou le centre d'un cercle) : distance à la droite.
  if (first.kind === 'line' || second.kind === 'line') {
    const lineT = first.kind === 'line' ? first : second;
    const other = first.kind === 'line' ? second : first;
    const pointId = measurePointOf(sk, other);
    const l = lineGeometry(sk, lineT.id);
    const p = pointId && pointPosition(sk, pointId);
    if (!pointId || !p || !l || l.len < 1e-9) return null;
    const value = distanceToLine(p, l);
    if (value < 1e-6) return null;
    const t = scale2(l.d, 1 / l.len);
    const foot = add2(l.a, scale2(t, dot2(sub2(p, l.a), t)));
    const label = isRound(other.kind) ? 'Distance du centre au segment' : 'Distance au segment';
    return { candidates: [{ label, constraint: { type: 'pointLineDistance', point: pointId, line: lineT.id, value } }], anchor: midpoint2(p, foot) };
  }
  // Points et centres de cercles : distances horizontale, verticale, alignée.
  const a = measurePointOf(sk, first);
  const b = measurePointOf(sk, second);
  if (!a || !b || a === b || arePointsCoincident(sk, a, b)) return null;
  const candidates = dimensionCandidatesForPoints(s, a, b);
  const pa = pointPosition(sk, a);
  const pb = pointPosition(sk, b);
  if (!candidates || !pa || !pb) return null;
  return { candidates, anchor: midpoint2(pa, pb) };
}

/** Cotes d'un seul élément : longueur d'un segment, diamètre ou rayon d'un cercle. */
function singleDimensionCandidates(s: SketchSession, t: PickTarget): { candidates: DimensionCandidate[]; anchor: Vec2 } | null {
  if (t.kind === 'line') {
    const l = lineGeometry(s.sketch, t.id);
    if (!l) return null;
    return { candidates: [{ label: 'Longueur', constraint: { type: 'length', line: t.id, value: l.len } }], anchor: midpoint2(l.a, l.b) };
  }
  if (isRound(t.kind)) {
    const r = roundInfo(s.sketch, t.id);
    if (!r) return null;
    const diameter: DimensionCandidate = { label: 'Diamètre', constraint: { type: 'diameter', circle: t.id, value: r.radius * 2 } };
    const radius: DimensionCandidate = { label: 'Rayon', constraint: { type: 'radius', circle: t.id, value: r.radius } };
    // Un arc se cote d'habitude par son rayon, un cercle par son diamètre.
    return {
      candidates: t.kind === 'arc' ? [radius, diameter] : [diameter, radius],
      anchor: { x: r.center.x + r.radius * 0.7, y: r.center.y + r.radius * 0.7 },
    };
  }
  return null;
}

function openCreateEditor(s: SketchSession, candidates: DimensionCandidate[], anchor: Vec2, message?: string): SketchSession {
  const first = candidates[0]!;
  const value = 'value' in first.constraint ? first.constraint.value : 0;
  return {
    ...s,
    editor: { mode: 'create', candidates, choice: 0, text: formatLength(value, 3, false), fresh: true, error: null, anchor },
    message: info(message ?? 'Tapez la valeur de la cote puis Entrée.'),
  };
}

function dimensionClick(s: SketchSession, p: Vec2): SketchSession {
  const hit = hitTest(s.sketch, p, tolerance(s));
  if (!hit) {
    return { ...s, picks: [], message: info('Cliquez sur un segment, un cercle ou un point (l’origine compte comme un point).') };
  }
  const target: PickTarget = { kind: hit.kind, id: hit.id };
  const first = s.picks.length === 1 ? targetOf(s.sketch, s.picks[0]!) : null;
  if (!first || first.id === target.id) {
    if (target.kind === 'point') {
      return { ...s, picks: [target.id], message: info('Cliquez maintenant le second élément : un point (par exemple l’origine), un segment ou un cercle.') };
    }
    const single = singleDimensionCandidates(s, target);
    if (!single) return { ...s, picks: [] };
    return {
      ...openCreateEditor(
        s,
        single.candidates,
        single.anchor,
        'Tapez la valeur puis Entrée — ou cliquez un second élément pour une distance ou un angle.',
      ),
      picks: [target.id],
    };
  }
  const pair = pairDimensionCandidates(s, first, target);
  if (!pair) {
    return {
      ...s,
      picks: [],
      message: info('Ces deux éléments ne peuvent pas être cotés ensemble (points confondus ou segments alignés). Recommencez par le premier élément.'),
    };
  }
  return { ...openCreateEditor(s, pair.candidates, pair.anchor), picks: [first.id, target.id] };
}

/** Ouvre la saisie de la valeur d'une cote existante (double-clic sur la cote). */
export function editDimension(s: SketchSession, constraintId: string): SketchSession {
  const c = s.sketch.constraints.find((k) => k.id === constraintId);
  if (!c || !('value' in c)) return s;
  const anchor = dimensionAnchor(s.sketch, c) ?? { x: 0, y: 0 };
  return {
    ...resetDraw(s),
    selection: [constraintId],
    editor: {
      mode: 'edit',
      constraintId,
      candidates: [],
      choice: 0,
      text: formatLength(c.value, 3, false),
      fresh: true,
      error: null,
      anchor,
    },
    message: info('Tapez la nouvelle valeur puis Entrée. Échap pour annuler.'),
  };
}

export function setEditorText(s: SketchSession, text: string): SketchSession {
  return s.editor ? { ...s, editor: { ...s.editor, text, fresh: false, error: null } } : s;
}

export function setEditorChoice(s: SketchSession, choice: number): SketchSession {
  if (!s.editor || s.editor.mode !== 'create') return s;
  const cand = s.editor.candidates[choice];
  if (!cand) return s;
  const value = 'value' in cand.constraint ? cand.constraint.value : 0;
  return { ...s, editor: { ...s.editor, choice, text: s.editor.fresh ? formatLength(value, 3, false) : s.editor.text, error: null } };
}

export function cancelEditor(s: SketchSession): SketchSession {
  return { ...s, editor: null, picks: [], message: null };
}

function allowsZero(type: SketchConstraint['type'] | NewConstraint['type']) {
  return type === 'distanceX' || type === 'distanceY';
}

function parseDimension(type: SketchConstraint['type'], text: string) {
  return type === 'angle' ? parseAngle(text, 'L’angle') : parseLength(text, { label: 'La cote', allowZero: allowsZero(type) });
}

export function formatDimension(type: SketchConstraint['type'], value: number): string {
  return type === 'angle' ? formatAngle(value) : formatLength(value);
}

/** Unité de la cote en cours de saisie (pour l'affichage du champ). */
export function editorUnit(s: SketchSession): 'mm' | '°' {
  const ed = s.editor;
  if (!ed) return 'mm';
  if (ed.mode === 'edit') {
    const c = s.sketch.constraints.find((k) => k.id === ed.constraintId);
    return c ? dimensionUnit(c.type) : 'mm';
  }
  const cand = ed.candidates[ed.choice];
  return cand ? dimensionUnit(cand.constraint.type) : 'mm';
}

export function confirmEditor(s: SketchSession): SketchSession {
  const ed = s.editor;
  if (!ed) return s;
  if (ed.mode === 'edit') {
    const c = s.sketch.constraints.find((k) => k.id === ed.constraintId);
    if (!c || !('value' in c)) return { ...s, editor: null };
    const parsed = parseDimension(c.type, ed.text);
    if (!parsed.ok) return { ...s, editor: { ...ed, error: parsed.error } };
    const next = { ...s.sketch, constraints: s.sketch.constraints.map((k) => (k.id === c.id ? ({ ...k, value: parsed.value } as SketchConstraint) : k)) };
    const { session, ok } = commit(s, next, {
      weights: anchorWeights(c, s.sketch),
      message: success(`Cote modifiée : ${formatDimension(c.type, parsed.value)}.`),
    });
    if (!ok) return { ...s, editor: { ...ed, error: 'Cette valeur est impossible avec les autres contraintes. Essayez une autre valeur.' } };
    return { ...session, editor: null };
  }
  const cand = ed.candidates[ed.choice];
  if (!cand) return { ...s, editor: null };
  const parsed = parseDimension(cand.constraint.type, ed.text);
  if (!parsed.ok) return { ...s, editor: { ...ed, error: parsed.error } };
  const constraint = { ...cand.constraint, value: parsed.value } as NewConstraint;
  const kind = classifyNewConstraint(s.sketch, { ...constraint, id: '__candidate__' } as SketchConstraint);
  if (kind === 'redundant') {
    return { ...s, editor: { ...ed, error: 'Cette cote est déjà déterminée par les autres contraintes : inutile de l’ajouter.' } };
  }
  if (kind === 'conflicting') {
    return { ...s, editor: { ...ed, error: 'Cette valeur contredit d’autres cotes ou contraintes de l’esquisse.' } };
  }
  const added = addConstraint(s.sketch, constraint);
  const { session, ok } = commit(s, added.sketch, {
    weights: anchorWeights(constraint, s.sketch),
    message: success(`Cote ajoutée : ${formatDimension(constraint.type, parsed.value)}.`),
  });
  if (!ok) return { ...s, editor: { ...ed, error: 'Cette valeur est impossible avec les autres contraintes. Essayez une autre valeur.' } };
  return { ...session, editor: null, picks: [], selection: [added.id] };
}

/**
 * Placement d'affichage d'une cote quand on fait glisser son libellé jusqu'au point `p` (voir
 * `DimensionPlacement`). Ne change ni la valeur ni la géométrie.
 */
export function placementFor(sketch: SketchParams, c: SketchConstraint, p: Vec2): { offset?: number; labelAngle?: number } | null {
  const round = (v: number) => Math.round(v * 100) / 100;
  switch (c.type) {
    case 'length':
    case 'distance': {
      const l = c.type === 'length' ? lineGeometry(sketch, c.line) : null;
      const a = l ? l.a : c.type === 'distance' ? pointPosition(sketch, c.a) : undefined;
      const b = l ? l.b : c.type === 'distance' ? pointPosition(sketch, c.b) : undefined;
      if (!a || !b || distance2(a, b) < 1e-9) return null;
      const d = sub2(b, a);
      const n = normalize2({ x: -d.y, y: d.x });
      return { offset: round(dot2(sub2(p, a), n)) };
    }
    case 'distanceX':
    case 'distanceY': {
      const a = pointPosition(sketch, c.a);
      const b = pointPosition(sketch, c.b);
      if (!a || !b) return null;
      return { offset: round(c.type === 'distanceX' ? p.y - (a.y + b.y) / 2 : p.x - (a.x + b.x) / 2) };
    }
    case 'diameter':
    case 'radius': {
      const r = roundInfo(sketch, c.circle);
      if (!r) return null;
      const angle = (Math.atan2(p.y - r.center.y, p.x - r.center.x) * 180) / Math.PI;
      return { labelAngle: Math.round(angle), offset: round(Math.max(0, distance2(p, r.center) - r.radius)) };
    }
    case 'angle': {
      const la = lineGeometry(sketch, c.a);
      const lb = lineGeometry(sketch, c.b);
      if (!la || !lb) return null;
      const denom = cross2(la.d, lb.d);
      const o =
        Math.abs(denom) < 1e-9
          ? midpoint2(midpoint2(la.a, la.b), midpoint2(lb.a, lb.b))
          : add2(la.a, scale2(la.d, cross2(sub2(lb.a, la.a), lb.d) / denom));
      return { offset: round(Math.max(1, distance2(p, o))) };
    }
    case 'pointLineDistance': {
      const pt = pointPosition(sketch, c.point);
      const l = lineGeometry(sketch, c.line);
      if (!pt || !l || l.len < 1e-9) return null;
      return { offset: round(dot2(sub2(p, pt), scale2(l.d, 1 / l.len))) };
    }
    default:
      return null;
  }
}

/** Déplace le libellé d'une cote ; `end` termine le geste (une seule action à annuler). */
export function moveDimensionLabel(s: SketchSession, constraintId: string, p: Vec2 | null, phase: 'move' | 'end'): SketchSession {
  if (phase === 'end') {
    const drag = s.labelDrag;
    if (!drag) return s;
    const changed = drag.base !== s.sketch;
    return {
      ...s,
      labelDrag: null,
      undo: changed ? [...s.undo, drag.base].slice(-MAX_UNDO) : s.undo,
      redo: changed ? [] : s.redo,
      dirty: s.dirty || changed,
      message: changed ? success('Cote déplacée (sa valeur ne change pas).') : s.message,
    };
  }
  const c = s.sketch.constraints.find((k) => k.id === constraintId);
  if (!c || !p) return s;
  const placement = placementFor(s.sketch, c, p);
  if (!placement) return s;
  const base = s.labelDrag?.base ?? s.sketch;
  const sketch = updateConstraint(s.sketch, constraintId, placement as Partial<SketchConstraint>);
  return { ...s, sketch, labelDrag: { constraintId, base }, editor: null };
}

/** Point d'ancrage d'une cote (milieu de l'élément coté), pour placer libellé et saisie. */
export function dimensionAnchor(sketch: SketchParams, c: SketchConstraint): Vec2 | null {
  switch (c.type) {
    case 'distance':
    case 'distanceX':
    case 'distanceY':
    case 'coincident': {
      const a = pointPosition(sketch, c.a);
      const b = pointPosition(sketch, c.b);
      return a && b ? midpoint2(a, b) : null;
    }
    case 'length': {
      const l = lineGeometry(sketch, c.line);
      return l ? midpoint2(l.a, l.b) : null;
    }
    case 'diameter':
    case 'radius': {
      const r = roundInfo(sketch, c.circle);
      return r ? { x: r.center.x + r.radius * 0.7, y: r.center.y + r.radius * 0.7 } : null;
    }
    case 'pointLineDistance': {
      const p = pointPosition(sketch, c.point);
      const l = lineGeometry(sketch, c.line);
      if (!p || !l || l.len < 1e-12) return null;
      const t = scale2(l.d, 1 / l.len);
      return midpoint2(p, add2(l.a, scale2(t, dot2(sub2(p, l.a), t))));
    }
    case 'angle': {
      const la = lineGeometry(sketch, c.a);
      const lb = lineGeometry(sketch, c.b);
      return la && lb ? midpoint2(midpoint2(la.a, la.b), midpoint2(lb.a, lb.b)) : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Contraintes géométriques

interface ConstraintLabels {
  redundant: string;
  conflicting: string;
  done: string;
}

function tryAddConstraint(s: SketchSession, constraint: NewConstraint, labels: ConstraintLabels) {
  const kind = classifyNewConstraint(s.sketch, { ...constraint, id: '__candidate__' } as SketchConstraint);
  if (kind === 'redundant') return { session: { ...s, message: info(labels.redundant) }, added: false };
  if (kind === 'conflicting') return { session: { ...s, message: failure(labels.conflicting) }, added: false };
  const { session, ok } = commit(s, addConstraint(s.sketch, constraint).sketch, { message: success(labels.done) });
  return { session, added: ok };
}

function labelsFor(tool: ConstraintTool, constraint: NewConstraint): ConstraintLabels {
  if (tool === 'horizontal' || tool === 'vertical') {
    const word = tool === 'horizontal' ? 'horizontal' : 'vertical';
    return {
      redundant: `Ce segment est déjà ${word}.`,
      conflicting: `Ce segment ne peut pas être ${word} avec les autres contraintes.`,
      done: `Segment rendu ${word}.`,
    };
  }
  if (constraint.type === 'coincident' && tool === 'coincident') {
    return {
      redundant: 'Ces points sont déjà réunis.',
      conflicting: 'Ces deux points ne peuvent pas être réunis avec les autres contraintes.',
      done: 'Points réunis (coïncidence).',
    };
  }
  const name = constraint.type === 'pointOn' ? 'point sur la courbe' : TOOL_LABELS[tool].toLowerCase();
  return {
    redundant: `Cette contrainte (${name}) est déjà respectée par le dessin et ses autres contraintes.`,
    conflicting: `Contrainte « ${name} » impossible : elle contredit d’autres cotes ou contraintes de l’esquisse.`,
    done: `Contrainte ajoutée : ${name}.`,
  };
}

type ConstraintBuild = { kind: 'done'; constraint: NewConstraint } | { kind: 'next'; hint: string } | { kind: 'invalid'; hint: string };

const done = (constraint: NewConstraint): ConstraintBuild => ({ kind: 'done', constraint });
const nextPick = (hint: string): ConstraintBuild => ({ kind: 'next', hint });
const invalid = (hint: string): ConstraintBuild => ({ kind: 'invalid', hint });

/** Contrainte formée par les éléments choisis, ou indication de l'élément suivant à cliquer. */
function buildConstraint(s: SketchSession, tool: ConstraintTool, picks: readonly PickTarget[]): ConstraintBuild {
  const [a, b] = picks;
  if (!a) return nextPick(TOOL_HELP[tool]);
  const sk = s.sketch;
  switch (tool) {
    case 'horizontal':
    case 'vertical':
      return a.kind === 'line' ? done({ type: tool, line: a.id }) : invalid('Cliquez sur un segment.');
    case 'coincident': {
      if (!b) {
        if (a.kind === 'point') return nextPick('Cliquez le second point (ou un segment, un cercle pour y poser le point).');
        if (a.kind === 'line') return nextPick('Cliquez le point à poser sur ce segment.');
        return nextPick('Cliquez un point à poser sur ce cercle, ou un autre cercle pour leur donner le même centre.');
      }
      if (a.kind === 'point' && b.kind === 'point') return done({ type: 'coincident', a: a.id, b: b.id });
      if (a.kind === 'point') return done({ type: 'pointOn', point: a.id, curve: b.id });
      if (b.kind === 'point') return done({ type: 'pointOn', point: b.id, curve: a.id });
      if (isRound(a.kind) && isRound(b.kind)) return buildConstraint(s, 'concentric', picks);
      return invalid('Pour aligner deux segments, utilisez plutôt « Colinéaire ».');
    }
    case 'parallel':
    case 'perpendicular':
    case 'collinear':
      if (a.kind !== 'line') return invalid('Cliquez sur un segment.');
      if (!b) return nextPick('Cliquez le second segment.');
      if (b.kind !== 'line') return invalid('Cliquez sur un second segment.');
      return done({ type: tool, a: a.id, b: b.id });
    case 'equal':
      if (a.kind === 'point') return invalid('Cliquez sur un segment ou un cercle.');
      if (!b) return nextPick(a.kind === 'line' ? 'Cliquez le second segment (même longueur).' : 'Cliquez le second cercle (même diamètre).');
      if (isRound(b.kind) !== isRound(a.kind) || b.kind === 'point') return invalid('Choisissez deux éléments du même type : deux segments, ou deux cercles / arcs.');
      return done({ type: 'equal', a: a.id, b: b.id });
    case 'tangent': {
      if (a.kind === 'point') return invalid('Cliquez sur un segment ou un cercle.');
      if (!b) return nextPick(a.kind === 'line' ? 'Cliquez le cercle qui doit toucher ce segment.' : 'Cliquez un segment ou un second cercle.');
      if (b.kind === 'point') return invalid('Cliquez sur un segment ou un cercle.');
      if (a.kind === 'line' && b.kind === 'line') return invalid('Deux segments ne peuvent pas être tangents : choisissez un cercle.');
      if (a.kind === 'line') return done({ type: 'tangent', a: a.id, b: b.id });
      if (b.kind === 'line') return done({ type: 'tangent', a: b.id, b: a.id });
      const ca = roundInfo(sk, a.id);
      const cb = roundInfo(sk, b.id);
      if (!ca || !cb) return invalid('Cliquez sur un cercle ou un arc.');
      // L'un dans l'autre si le centre de l'un est à l'intérieur de l'autre.
      const internal = distance2(ca.center, cb.center) < Math.max(ca.radius, cb.radius);
      return done(internal ? { type: 'tangent', a: a.id, b: b.id, internal: true } : { type: 'tangent', a: a.id, b: b.id });
    }
    case 'pointOn':
      if (!b) return nextPick(a.kind === 'point' ? 'Cliquez le segment ou le cercle sur lequel poser ce point.' : 'Cliquez le point à poser sur cette courbe.');
      if (a.kind === 'point' && b.kind !== 'point') return done({ type: 'pointOn', point: a.id, curve: b.id });
      if (b.kind === 'point' && a.kind !== 'point') return done({ type: 'pointOn', point: b.id, curve: a.id });
      return invalid('Choisissez un point et une courbe (segment ou cercle).');
    case 'midpoint':
      if (isRound(a.kind)) return invalid('Cliquez sur un point ou un segment.');
      if (!b) return nextPick(a.kind === 'point' ? 'Cliquez le segment dont ce point sera le milieu.' : 'Cliquez le point à placer au milieu du segment.');
      if (a.kind === 'point' && b.kind === 'line') return done({ type: 'midpoint', point: a.id, line: b.id });
      if (a.kind === 'line' && b.kind === 'point') return done({ type: 'midpoint', point: b.id, line: a.id });
      return invalid('Choisissez un point et un segment.');
    case 'concentric': {
      if (!isRound(a.kind)) return invalid('Cliquez sur un cercle ou un arc.');
      if (!b) return nextPick('Cliquez le second cercle ou arc.');
      if (!isRound(b.kind)) return invalid('Cliquez sur un second cercle ou arc.');
      const ca = findRound(sk, a.id);
      const cb = findRound(sk, b.id);
      if (!ca || !cb) return invalid('Cliquez sur un cercle ou un arc.');
      return done({ type: 'coincident', a: ca.center, b: cb.center });
    }
  }
}

/** Applique une contrainte à la sélection courante ; renvoie null si la sélection ne convient pas. */
function applyConstraintToSelection(s: SketchSession, tool: ConstraintTool): SketchSession | null {
  const targets = s.selection.map((id) => targetOf(s.sketch, id)).filter((t): t is PickTarget => t !== null);
  if (tool === 'horizontal' || tool === 'vertical') {
    const lines = targets.filter((t) => t.kind === 'line');
    if (lines.length === 0) return null;
    let cur = s;
    for (const line of lines) cur = tryAddConstraint(cur, { type: tool, line: line.id }, labelsFor(tool, { type: tool, line: line.id })).session;
    return cur;
  }
  if (targets.length !== 2) return null;
  const built = buildConstraint(s, tool, targets);
  if (built.kind !== 'done') return null;
  return tryAddConstraint(s, built.constraint, labelsFor(tool, built.constraint)).session;
}

function constraintToolClick(s: SketchSession, p: Vec2, tool: ConstraintTool): SketchSession {
  const hit = hitTest(s.sketch, p, tolerance(s));
  if (!hit) return { ...s, picks: [], message: info(TOOL_HELP[tool]) };
  const previous = s.picks.map((id) => targetOf(s.sketch, id)).filter((t): t is PickTarget => t !== null);
  if (previous.some((t) => t.id === hit.id)) return s;
  const picks = [...previous, { kind: hit.kind, id: hit.id }];
  const built = buildConstraint(s, tool, picks);
  if (built.kind === 'invalid') return { ...s, message: info(built.hint) };
  if (built.kind === 'next') return { ...s, picks: picks.map((t) => t.id), message: info(built.hint) };
  return { ...tryAddConstraint(s, built.constraint, labelsFor(tool, built.constraint)).session, picks: [] };
}

// ---------------------------------------------------------------------------
// Projection d'arêtes de la pièce

function nearestProjectable(s: SketchSession, p: Vec2): number | null {
  let best: number | null = null;
  let bestD = tolerance(s);
  s.projectable.forEach((c, i) => {
    const d = c.kind === 'line' ? distanceToSegment2(p, c.a, c.b) : Math.abs(distance2(p, c.center) - c.radius);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Remplace les arêtes projetables (la pièce a été recalculée). */
export function setProjectable(s: SketchSession, projectable: ProjectableCurve[]): SketchSession {
  if (JSON.stringify(projectable) === JSON.stringify(s.projectable)) return s;
  const next = { ...s, projectable };
  // L'arête survolée est recalculée à la position du curseur (pas d'effacement intempestif).
  return { ...next, projectHover: s.tool === 'project' && s.cursor ? nearestProjectable(next, s.cursor) : null };
}

function projectClick(s: SketchSession, p: Vec2): SketchSession {
  const index = nearestProjectable(s, p);
  if (index === null) return { ...s, message: info('Cliquez sur une arête violette de la pièce pour la reprendre dans l’esquisse.') };
  const curve = s.projectable[index]!;
  const existing = s.sketch.entities.find((e) => (e.type === 'line' || e.type === 'circle') && e.reference && sameEdgeRef(e.reference.edge, curve.ref));
  if (existing) return { ...s, selection: [existing.id], message: info('Cette arête est déjà reprise dans l’esquisse.') };
  let sketch: SketchParams;
  let id: string;
  if (curve.kind === 'line') {
    const r = addLine(s.sketch, curve.a, curve.b);
    sketch = r.sketch;
    id = r.lineId;
  } else {
    const r = addCircle(s.sketch, curve.center, curve.radius);
    sketch = r.sketch;
    id = r.circleId;
  }
  sketch = {
    ...sketch,
    entities: sketch.entities.map((e): SketchEntity => (e.id === id && (e.type === 'line' || e.type === 'circle') ? { ...e, reference: { edge: curve.ref } } : e)),
  };
  const what = curve.kind === 'line' ? 'ses extrémités' : 'son centre';
  const { session } = commit(s, sketch, {
    message: success(`Arête reprise (en violet) : elle suit la pièce. Utilisez ${what} pour coter ou contraindre votre dessin.`),
  });
  return { ...session, projectHover: null };
}

// ---------------------------------------------------------------------------
// Sélection et déplacement

/** L'origine et la géométrie reprise de la pièce ne se déplacent pas à la souris. */
function isFixedTarget(sketch: SketchParams, target: SketchTarget): boolean {
  if (target.kind === 'point') {
    if (target.id === ORIGIN_POINT_ID) return true;
    return !!ownerOfPoint(sketch, target.id)?.reference;
  }
  const e = sketch.entities.find((x) => x.id === target.id);
  return !!e && (e.type === 'line' || e.type === 'circle' || e.type === 'arc') && !!e.reference;
}

function selectClick(s: SketchSession, p: Vec2, additive: boolean): SketchSession {
  const target = hitTest(s.sketch, p, tolerance(s));
  if (!target) return { ...s, selection: additive ? s.selection : [], drag: null };
  const id = target.id;
  const selection = additive ? (s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]) : [id];
  const fixed = isFixedTarget(s.sketch, target);
  const message = fixed && target.id !== ORIGIN_POINT_ID ? info('Élément repris de la pièce : il est fixe et suit la pièce. Cotez ou contraignez votre dessin par rapport à lui.') : s.message;
  return { ...s, selection, message, drag: fixed ? null : { target, origin: p, base: s.sketch, moved: false } };
}

export function selectConstraint(s: SketchSession, id: string, additive = false): SketchSession {
  const selection = additive ? (s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]) : [id];
  return { ...s, selection };
}

function dragTo(s: SketchSession, p: Vec2, alt: boolean): SketchSession {
  const drag = s.drag!;
  if (!drag.moved && distance2(p, drag.origin) < DRAG_PIXELS * s.pixelSize) return { ...s, cursor: p };
  const base = drag.base;
  const weights = new Map<string, number>();
  let moved: SketchParams = base;
  const t = drag.target;
  if (t.kind === 'point') {
    const exclude = new Set([t.id]);
    const snap = snapPoint(base, p, { tolerance: tolerance(s), gridStep: s.gridStep, snapToGrid: s.snapToGrid, exclude, disabled: alt });
    moved = movePoints(base, new Map([[t.id, snap.point]]));
    weights.set(`${t.id}.x`, 1e4);
    weights.set(`${t.id}.y`, 1e4);
  } else if (t.kind === 'line') {
    const line = findLine(base, t.id);
    if (!line) return s;
    const delta = sub2(p, drag.origin);
    const a = pointPosition(base, line.a)!;
    const b = pointPosition(base, line.b)!;
    moved = movePoints(base, new Map([
      [line.a, add2(a, delta)],
      [line.b, add2(b, delta)],
    ]));
    for (const id of [line.a, line.b]) {
      weights.set(`${id}.x`, 1e4);
      weights.set(`${id}.y`, 1e4);
    }
  } else if (t.kind === 'arc') {
    const arc = findArc(base, t.id);
    if (!arc) return s;
    const delta = sub2(p, drag.origin);
    const moves = new Map<string, Vec2>();
    for (const id of [arc.center, arc.start, arc.end]) {
      moves.set(id, add2(pointPosition(base, id)!, delta));
      weights.set(`${id}.x`, 1e4);
      weights.set(`${id}.y`, 1e4);
    }
    moved = movePoints(base, moves);
  } else {
    const circle = findCircle(base, t.id);
    const c = circle ? pointPosition(base, circle.center) : undefined;
    if (!circle || !c) return s;
    moved = setCircleRadius(base, circle.id, Math.max(distance2(c, p), s.pixelSize));
    weights.set(`${circle.id}.r`, 1e4);
  }
  const res = solveSketch(moved, { weights });
  if (!res.converged) return { ...s, cursor: p, drag: { ...drag, moved: true } };
  const unchanged = sameGeometry(res.sketch, s.sketch);
  return {
    ...s,
    cursor: p,
    sketch: unchanged ? s.sketch : res.sketch,
    dof: res.dof,
    freeEntities: Array.from(res.freeEntities),
    drag: { ...drag, moved: true },
    message: sameGeometry(res.sketch, base)
      ? info('Cet élément est entièrement contraint : modifiez ses cotes pour le changer.')
      : s.message?.kind === 'info' && s.message.text.startsWith('Cet élément')
        ? null
        : s.message,
  };
}

function sameGeometry(a: SketchParams, b: SketchParams): boolean {
  if (a.entities.length !== b.entities.length) return false;
  return a.entities.every((e, i) => {
    const f = b.entities[i]!;
    if (e.type === 'point' && f.type === 'point') return Math.abs(e.x - f.x) < 1e-9 && Math.abs(e.y - f.y) < 1e-9;
    if (e.type === 'circle' && f.type === 'circle') return Math.abs(e.radius - f.radius) < 1e-9;
    return true;
  });
}

export function deleteSelection(s: SketchSession): SketchSession {
  if (s.selection.length === 0) return { ...s, message: info('Sélectionnez d’abord un élément ou une cote à supprimer.') };
  const constraintIds = s.selection.filter((id) => s.sketch.constraints.some((c) => c.id === id));
  const entityIds = s.selection.filter((id) => s.sketch.entities.some((e) => e.id === id));
  let next = removeConstraints(s.sketch, constraintIds);
  next = removeEntities(next, entityIds);
  const { session } = commit(s, next, { message: success('Suppression effectuée.') });
  return { ...session, selection: [], hover: null };
}

export function escape(s: SketchSession): SketchSession {
  if (s.editor) return cancelEditor(s);
  if (s.start || s.picks.length > 0 || s.input) return { ...resetDraw(s), message: info(TOOL_HELP[s.tool]) };
  if (s.tool !== 'select') return { ...s, tool: 'select', message: info(TOOL_HELP.select) };
  if (s.selection.length > 0) return { ...s, selection: [] };
  return s;
}

export function undo(s: SketchSession): SketchSession {
  const prev = s.undo[s.undo.length - 1];
  if (!prev) return { ...s, message: info('Rien à annuler dans cette esquisse.') };
  const res = solveSketch(prev);
  return {
    ...resetDraw(s),
    sketch: prev,
    dof: res.dof,
    freeEntities: Array.from(res.freeEntities),
    converged: res.converged,
    undo: s.undo.slice(0, -1),
    redo: [...s.redo, s.sketch],
    selection: [],
    editor: null,
    message: info('Action annulée.'),
  };
}

export function redo(s: SketchSession): SketchSession {
  const next = s.redo[s.redo.length - 1];
  if (!next) return { ...s, message: info('Rien à rétablir.') };
  const res = solveSketch(next);
  return {
    ...resetDraw(s),
    sketch: next,
    dof: res.dof,
    freeEntities: Array.from(res.freeEntities),
    converged: res.converged,
    undo: [...s.undo, s.sketch],
    redo: s.redo.slice(0, -1),
    selection: [],
    editor: null,
    message: info('Action rétablie.'),
  };
}

// ---------------------------------------------------------------------------
// Aperçu du tracé en cours (dessiné en pointillés par la vue)

export interface SessionPreview {
  lines: [Vec2, Vec2][];
  circles: { center: Vec2; radius: number }[];
  /** Arcs en cours (ouverture signée : négative dans le sens horaire), avec flèche de sens. */
  arcs: { center: Vec2; radius: number; startAngle: number; sweep: number; arrow?: false }[];
  labels: { at: Vec2; text: string }[];
  guides: [Vec2, Vec2][];
  /** Outil Couper : morceau qui sera retiré au clic (en rouge). */
  removed: Vec2[][];
}

export function sessionPreview(s: SketchSession): SessionPreview {
  const out: SessionPreview = { lines: [], circles: [], arcs: [], labels: [], guides: [], removed: [] };
  if (s.tool === 'trim' && s.cursor && s.hover && s.hover.kind !== 'point') {
    const piece = trimPiece(s.sketch, s.hover.id, s.cursor);
    if (piece) out.removed.push(piece.path);
    return out;
  }
  const end = s.snap?.point ?? s.cursor;
  if (!s.start || !end) return out;
  const a = s.start.point;
  if (s.tool === 'line') {
    out.lines.push([a, end]);
    out.labels.push({ at: midpoint2(a, end), text: formatLength(distance2(a, end)) });
    if (s.snap?.kind === 'horizontal' || s.snap?.kind === 'vertical') out.guides.push([a, end]);
  } else if (s.tool === 'rectangle') {
    const b = { x: end.x, y: a.y };
    const d = { x: a.x, y: end.y };
    out.lines.push([a, b], [b, end], [end, d], [d, a]);
    out.labels.push({
      at: { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2 },
      text: `${formatLength(Math.abs(end.x - a.x), 2, false)} × ${formatLength(Math.abs(end.y - a.y))}`,
    });
  } else if (s.tool === 'circle') {
    const r = distance2(a, end);
    out.circles.push({ center: a, radius: r });
    out.lines.push([a, end]);
    out.labels.push({ at: midpoint2(a, end), text: `Ø ${formatLength(2 * r)}` });
  } else if (s.tool === 'centerRectangle') {
    const hw = Math.abs(end.x - a.x);
    const hh = Math.abs(end.y - a.y);
    const p0 = { x: a.x - hw, y: a.y - hh };
    const p1 = { x: a.x + hw, y: a.y - hh };
    const p2 = { x: a.x + hw, y: a.y + hh };
    const p3 = { x: a.x - hw, y: a.y + hh };
    out.lines.push([p0, p1], [p1, p2], [p2, p3], [p3, p0]);
    out.guides.push([p0, p2], [p1, p3]);
    out.labels.push({ at: { x: a.x, y: a.y + hh }, text: `${formatLength(2 * hw, 2, false)} × ${formatLength(2 * hh)}` });
  } else if (s.tool === 'polygon') {
    const pts = polygonVertices(a, end, currentSides(s));
    pts.forEach((q, k) => out.lines.push([q, pts[(k + 1) % pts.length]!]));
    out.circles.push({ center: a, radius: distance2(a, end) });
    out.labels.push({ at: midpoint2(a, end), text: `${pts.length} côtés · Ø ${formatLength(2 * distance2(a, end))}` });
  } else if (s.tool === 'slot') {
    if (!s.slot) {
      out.lines.push([a, end]);
      out.labels.push({ at: midpoint2(a, end), text: formatLength(distance2(a, end)) });
    } else {
      const c2 = s.slot.end.point;
      const r = slotHalfWidth(a, c2, end);
      const o = slotOutline(a, c2, r);
      out.guides.push([a, c2]);
      out.lines.push([o.a1, o.b1], [o.b2, o.a2]);
      out.arcs.push({ center: c2, radius: r, startAngle: o.angle - Math.PI / 2, sweep: Math.PI, arrow: false }, { center: a, radius: r, startAngle: o.angle + Math.PI / 2, sweep: Math.PI, arrow: false });
      out.labels.push({ at: o.b1, text: `largeur ${formatLength(2 * r)}` });
    }
  } else if (s.tool === 'arc') {
    if (!s.arc) {
      const r = distance2(a, end);
      out.lines.push([a, end]);
      out.guides.push(...[]);
      out.labels.push({ at: midpoint2(a, end), text: `R ${formatLength(r)}` });
    } else {
      const st = s.arc.start.point;
      const r = distance2(a, st);
      const a0 = Math.atan2(st.y - a.y, st.x - a.x);
      const sweep = s.arc.sweep;
      out.lines.push([a, st]);
      out.arcs.push({ center: a, radius: r, startAngle: a0, sweep });
      const mid = a0 + sweep / 2;
      out.labels.push({
        at: { x: a.x + (r + 0) * Math.cos(mid), y: a.y + r * Math.sin(mid) },
        text: `${formatAngle(Math.abs((sweep * 180) / Math.PI))} · R ${formatLength(r)}`,
      });
    }
  }
  return out;
}

/** Dimensions actuelles du tracé sous le curseur, dans l'ordre des champs de saisie. */
export function drawInputCurrentValues(s: SketchSession): number[] {
  const end = s.snap?.point ?? s.cursor;
  if (!s.start || !end) return [];
  const a = s.start.point;
  const round = (v: number) => Math.round(v * 100) / 100;
  if (s.tool === 'line') return [round(distance2(a, end))];
  if (s.tool === 'rectangle') return [round(Math.abs(end.x - a.x)), round(Math.abs(end.y - a.y))];
  if (s.tool === 'circle') return [round(2 * distance2(a, end))];
  if (s.tool === 'centerRectangle') return [round(2 * Math.abs(end.x - a.x)), round(2 * Math.abs(end.y - a.y))];
  if (s.tool === 'polygon') return [round(2 * distance2(a, end)), currentSides(s)];
  if (s.tool === 'slot') return s.slot ? [round(2 * slotHalfWidth(a, s.slot.end.point, end))] : [round(distance2(a, end))];
  if (s.tool === 'arc') return s.arc ? [round(Math.abs((s.arc.sweep * 180) / Math.PI))] : [round(distance2(a, end))];
  return [];
}

/** Valeur mesurée actuelle d'une cote (utile à l'affichage des cotes non à jour). */
export function currentDimensionValue(sketch: SketchParams, c: SketchConstraint): number | undefined {
  return measureConstraint(sketch, c);
}
