/** Champs communs aux panneaux des fonctions volumiques (esquisse utilisée, sens, aperçu). */
import type { AxisFeature, ExtentDirection, Feature, Id, Part, PatternAxis, PlaneFeature, SketchFeature, VolumeOperation } from '../../domain/model';
import { ORIGIN_POINT_ID } from '../../domain/model';
import { formatLength } from '../../domain/units';
import { pointPosition } from '../../sketch/model';
import type { FeatureStatus } from '../../domain/status';
import type { SketchOption } from '../../features/panel-types';
import { useAppState } from '../context';
import { Callout, Segmented } from './controls';

export function SketchSelect(props: { value: string; options: SketchOption[]; onChange: (sketchId: string) => void }) {
  return (
    <div class="field">
      <label class="field-label" for="draft-sketch">
        Esquisse utilisée
      </label>
      <select id="draft-sketch" class="select" value={props.value} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}>
        {props.options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.closed === false ? ' (contour ouvert)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DirectionField(props: { value: ExtentDirection; labels: Record<ExtentDirection, string>; onChange: (d: ExtentDirection) => void }) {
  return (
    <Segmented
      label="Sens"
      value={props.value}
      options={(['default', 'reversed', 'symmetric', 'twoSides'] as const).map((d) => ({ value: d, label: props.labels[d] }))}
      onChange={props.onChange}
    />
  );
}

/** État de l'aperçu : en calcul, à jour (avec ce qui sera ajouté ou retiré), ou problème. */
export function PreviewStatus(props: { status: FeatureStatus | null; kind: 'add' | 'cut' | 'modify' }) {
  const { status } = props;
  if (status === null) {
    return (
      <Callout kind="info">
        <p>Calcul de l’aperçu…</p>
      </Callout>
    );
  }
  if (status.state === 'ok') {
    return (
      <Callout kind="success">
        <p>
          Aperçu à jour
        </p>
      </Callout>
    );
  }
  return (
    <Callout kind={status.state === 'warning' ? 'warning' : 'error'}>
      <p>{status.message}</p>
    </Callout>
  );
}

export function withParams<F extends Feature>(feature: F, params: Partial<F['params']>): F {
  return { ...feature, params: { ...feature.params, ...params } } as F;
}

/** Ce que fait le volume avec la pièce : Ajouter, Creuser, ou (niveau Expert) Garder la partie commune. */
export function OperationField(props: { value: VolumeOperation; onChange: (op: VolumeOperation) => void; what: string }) {
  const expert = useAppState((s) => s.level === 'expert');
  const options: { value: VolumeOperation; label: string; title: string }[] = [
    { value: 'add', label: 'Ajouter', title: `${props.what} ajoute de la matière à la pièce` },
    { value: 'cut', label: 'Creuser', title: `${props.what} retire de la matière, comme un trou` },
  ];
  if (expert || props.value === 'common') {
    options.push({ value: 'common', label: 'Garder', title: `Garder seulement la matière commune à la pièce et à ${props.what.toLowerCase()} (intersection)` });
  }
  return <Segmented<VolumeOperation> label="Matière" value={props.value} options={options} onChange={props.onChange} />;
}

/** Plans de construction de la pièce placés avant l'étape (tous, pour une nouvelle étape). */
export function datumPlanesBefore(part: Part, featureId: Id): PlaneFeature[] {
  const own = part.features.findIndex((x) => x.id === featureId);
  return part.features.filter((x, i): x is PlaneFeature => x.type === 'plane' && (own < 0 || i < own));
}

/** Choix du plan de construction utilisé (affiché quand le plan choisi en est un). */
export function DatumPlaneSelect(props: { planes: PlaneFeature[]; value: Id; onChange: (featureId: Id) => void }) {
  return (
    <label class="field">
      <span class="field-label">Plan de construction</span>
      <select id="draft-datum" class="select" value={props.value} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}>
        {props.planes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Axes de construction de la pièce placés avant l'étape (tous, pour une nouvelle étape). */
export function datumAxesBefore(part: Part, featureId: Id): AxisFeature[] {
  const own = part.features.findIndex((x) => x.id === featureId);
  return part.features.filter((x, i): x is AxisFeature => x.type === 'axis' && (own < 0 || i < own));
}

type AxisChoice = 'X' | 'Y' | 'Z' | 'edge' | 'datum';

/**
 * Choix d'un axe : X, Y, Z (par l'origine), une arête cliquée dans la vue 3D (`picking` : en
 * attente du clic) ou un axe de construction de la pièce.
 */
export function AxisField(props: { label: string; axis: PatternAxis; picking: boolean; datums: AxisFeature[]; onAxis: (axis: PatternAxis) => void; onPick: () => void }) {
  const value: AxisChoice = props.picking || props.axis.kind === 'edge' ? 'edge' : props.axis.kind === 'datum' ? 'datum' : props.axis.axis;
  return (
    <>
      <Segmented<AxisChoice>
        label={props.label}
        value={value}
        options={[
          { value: 'X', label: 'X', title: 'Axe X (rouge)' },
          { value: 'Y', label: 'Y', title: 'Axe Y (vert)' },
          { value: 'Z', label: 'Z', title: 'Axe Z (bleu)' },
          { value: 'edge', label: 'Arête…', title: 'Une arête droite ou le bord d’un trou, cliqué dans la vue 3D' },
          ...(props.datums.length ? [{ value: 'datum' as const, label: 'Axe…', title: 'Un axe de construction (outil « Axe »)' }] : []),
        ]}
        onChange={(v) =>
          v === 'edge' ? props.onPick() : props.onAxis(v === 'datum' ? { kind: 'datum', featureId: props.datums[props.datums.length - 1]!.id } : { kind: 'axis', axis: v })
        }
      />
      {props.picking ? (
        <Callout kind="info">
          <p>Sélectionnez une arête droite ou le bord d’un trou</p>
        </Callout>
      ) : props.axis.kind === 'edge' ? (
        <span class="field-help">Arête choisie</span>
      ) : props.axis.kind === 'datum' ? (
        <label class="field">
          <span class="field-label">Axe de construction</span>
          <select id="draft-datum-axis" class="select" value={props.axis.featureId} onChange={(e) => props.onAxis({ kind: 'datum', featureId: (e.target as HTMLSelectElement).value })}>
            {props.datums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}

/** Élément d'esquisse utilisable par un plan ou un axe de construction. */
export type SketchElementKind = 'point' | 'line' | 'circle';
export interface SketchElementOption {
  sketchId: Id;
  entityId: string;
  label: string;
}

/**
 * Éléments des esquisses placées avant l'étape `featureId`, des sortes demandées (`circle` : cercles
 * et arcs), nommés comme dans l'esquisse : « Esquisse 2 › Segment 3, 40 mm ».
 */
export function sketchElementsBefore(part: Part, featureId: Id, kinds: readonly SketchElementKind[]): SketchElementOption[] {
  const own = part.features.findIndex((x) => x.id === featureId);
  const sketches = part.features.filter((x, i): x is SketchFeature => x.type === 'sketch' && (own < 0 || i < own));
  const out: SketchElementOption[] = [];
  for (const sk of sketches) {
    const at = (id: string) => pointPosition(sk.params, id);
    const count = { point: 0, line: 0, construction: 0, circle: 0, arc: 0 };
    // Points confondus (bouts de segments qui se touchent) : un seul dans la liste.
    const seen: { x: number; y: number }[] = [];
    for (const e of sk.params.entities) {
      let label: string | null = null;
      if (e.type === 'point' && kinds.includes('point')) {
        if (seen.some((q) => Math.hypot(q.x - e.x, q.y - e.y) < 1e-6)) continue;
        seen.push(e);
        label = e.id === ORIGIN_POINT_ID ? 'Origine de l’esquisse' : `Point ${++count.point} (${formatLength(e.x)} ; ${formatLength(e.y)})`;
      } else if (e.type === 'line' && kinds.includes('line')) {
        const n = e.construction ? ++count.construction : ++count.line;
        const [a, b] = [at(e.a), at(e.b)];
        label = `${e.construction ? 'Trait de construction' : 'Segment'} ${n}${a && b ? `, ${formatLength(Math.hypot(b.x - a.x, b.y - a.y))}` : ''}`;
      } else if (e.type === 'circle' && (kinds.includes('circle') || kinds.includes('point'))) {
        label = `${kinds.includes('circle') ? 'Cercle' : 'Centre du cercle'} ${++count.circle}, Ø ${formatLength(2 * e.radius)}`;
      } else if (e.type === 'arc' && (kinds.includes('circle') || kinds.includes('point'))) {
        const [c, s0] = [at(e.center), at(e.start)];
        label = `${kinds.includes('circle') ? 'Arc' : 'Centre de l’arc'} ${++count.arc}${c && s0 ? `, R ${formatLength(Math.hypot(s0.x - c.x, s0.y - c.y))}` : ''}`;
      }
      if (label) out.push({ sketchId: sk.id, entityId: e.id, label: `${sk.name} › ${label}` });
    }
  }
  return out;
}

/** Choix d'un élément d'esquisse (liste de `sketchElementsBefore`). */
export function SketchElementSelect(props: { id: string; label: string; options: SketchElementOption[]; value: { sketchId: Id; entityId: string } | undefined; onChange: (ref: { sketchId: Id; entityId: string }) => void }) {
  const key = (o: { sketchId: Id; entityId: string }) => `${o.sketchId}|${o.entityId}`;
  const value = props.value ? key(props.value) : '';
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      <select
        id={props.id}
        class="select"
        value={value}
        onChange={(e) => {
          const o = props.options.find((x) => key(x) === (e.target as HTMLSelectElement).value);
          if (o) props.onChange({ sketchId: o.sketchId, entityId: o.entityId });
        }}
      >
        {!value ? <option value="">À choisir</option> : null}
        {props.value && !props.options.some((o) => key(o) === value) ? <option value={value}>Élément introuvable</option> : null}
        {props.options.map((o) => (
          <option key={key(o)} value={key(o)}>
            {o.label}
          </option>
        ))}
      </select>
      {!props.options.length ? <span class="field-help">Aucune esquisse avant cette étape n’a d’élément utilisable</span> : null}
    </label>
  );
}
