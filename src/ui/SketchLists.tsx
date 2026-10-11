/**
 * Listes de l'esquisse en cours (niveau Expert) : ses éléments géométriques et ses contraintes,
 * repliables. Un clic sur une ligne l'ajoute à la sélection (ou l'en retire), comme dans la vue ;
 * double-clic sur une cote : changer sa valeur.
 */
import { constraintReferences, ORIGIN_POINT_ID, type SketchConstraint, type SketchEntity } from '../domain/model';
import { formatAngle, formatLength } from '../domain/units';
import { arcGeometry, linePoints, pointPosition } from '../sketch/model';
import { editDimension, selectConstraint, type SketchSession } from '../sketch/session';
import { useController } from './context';

const ENTITY_NAMES: Record<SketchEntity['type'], string> = { point: 'Point', line: 'Segment', circle: 'Cercle', arc: 'Arc' };

const CONSTRAINT_NAMES: Record<SketchConstraint['type'], string> = {
  coincident: 'Coïncidence',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  length: 'Longueur',
  distance: 'Distance',
  distanceX: 'Distance horizontale',
  distanceY: 'Distance verticale',
  diameter: 'Diamètre',
  radius: 'Rayon',
  parallel: 'Parallèle',
  perpendicular: 'Perpendiculaire',
  collinear: 'Colinéaire',
  equal: 'Égalité',
  tangent: 'Tangence',
  pointOn: 'Point sur',
  midpoint: 'Milieu',
  angle: 'Angle',
  pointLineDistance: 'Distance point-segment',
};

/** Noms lisibles et numérotés par type (« Segment 2 »), dans l'ordre de l'esquisse. */
function entityNames(entities: SketchEntity[]): Map<string, string> {
  const count: Record<string, number> = {};
  const names = new Map<string, string>([[ORIGIN_POINT_ID, 'Origine']]);
  for (const e of entities) {
    count[e.type] = (count[e.type] ?? 0) + 1;
    names.set(e.id, `${ENTITY_NAMES[e.type]} ${count[e.type]}`);
  }
  return names;
}

function entityDetail(session: SketchSession, e: SketchEntity): string {
  const sk = session.sketch;
  const n = (v: number) => formatLength(v, 2, false);
  let text = '';
  if (e.type === 'point') text = `(${n(e.x)} ; ${n(e.y)})`;
  else if (e.type === 'line') {
    const pts = linePoints(sk, e);
    text = pts ? formatLength(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)) : '';
  } else if (e.type === 'circle') text = `Ø ${formatLength(2 * e.radius)}`;
  else {
    const g = arcGeometry(sk, e);
    text = g ? `R ${formatLength(g.radius)}, ${formatAngle((g.sweep * 180) / Math.PI)}` : '';
  }
  if (e.type !== 'point' && e.reference) text += ' — repris de la pièce';
  else if (e.type !== 'point' && e.construction) text += ' — construction';
  return text;
}

function constraintValue(c: SketchConstraint): string {
  if (!('value' in c)) return '';
  if (c.type === 'angle') return formatAngle(c.value);
  if (c.type === 'diameter') return `Ø ${formatLength(c.value)}`;
  if (c.type === 'radius') return `R ${formatLength(c.value)}`;
  return formatLength(c.value);
}

export function SketchLists({ session }: { session: SketchSession }) {
  const c = useController();
  const sk = session.sketch;
  const names = entityNames(sk.entities);
  // Les courbes d'abord, puis les points (plus nombreux).
  const entities = [...sk.entities.filter((e) => e.type !== 'point'), ...sk.entities.filter((e) => e.type === 'point')];
  const selected = new Set(session.selection);
  const free = new Set(session.freeEntities);
  const toggle = (id: string) => c.updateSession((s) => selectConstraint(s, id, true));
  return (
    <>
      <details class="advanced sketch-list" open>
        <summary>Éléments ({entities.length})</summary>
        {entities.length === 0 ? (
          <p class="field-help">Aucun élément pour l’instant.</p>
        ) : (
          <ul aria-label="Éléments de l’esquisse">
            {entities.map((e) => (
              <li key={e.id}>
                <button type="button" class={`sketch-row${free.has(e.id) ? ' is-free' : ''}`} aria-pressed={selected.has(e.id)} onClick={() => toggle(e.id)}>
                  <strong>{names.get(e.id)}</strong>
                  <span>{entityDetail(session, e)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
      <details class="advanced sketch-list" open>
        <summary>Contraintes ({sk.constraints.length})</summary>
        {sk.constraints.length === 0 ? (
          <p class="field-help">Aucune cote ni contrainte pour l’instant.</p>
        ) : (
          <ul aria-label="Contraintes de l’esquisse">
            {sk.constraints.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  class="sketch-row"
                  aria-pressed={selected.has(k.id)}
                  title={'value' in k ? 'Double-clic : changer la valeur' : undefined}
                  onClick={() => toggle(k.id)}
                  onDblClick={() => ('value' in k ? c.updateSession((s) => editDimension(s, k.id)) : undefined)}
                >
                  <strong>
                    {CONSTRAINT_NAMES[k.type]}
                    {'value' in k ? ` ${constraintValue(k)}` : ''}
                  </strong>
                  <span>{constraintReferences(k).map((id) => names.get(id) ?? (pointPosition(sk, id) ? 'Point' : '?')).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}
