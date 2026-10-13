/** Champs communs aux panneaux des fonctions volumiques (esquisse utilisée, sens, aperçu). */
import type { AxisFeature, ExtentDirection, Feature, Id, Part, PatternAxis, PlaneFeature, VolumeOperation } from '../../domain/model';
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
          Aperçu à jour : {props.kind === 'cut' ? 'le volume rouge sera retiré' : props.kind === 'add' ? 'le volume vert sera ajouté' : 'la pièce sera modifiée comme affiché'}.
          Cliquez sur « Valider » pour l’enregistrer dans l’historique.
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
          <p>Cliquez dans la vue 3D une arête droite (direction) ou le bord d’un trou (son axe).</p>
        </Callout>
      ) : props.axis.kind === 'edge' ? (
        <span class="field-help">Arête choisie dans la vue 3D. Cliquez « Arête… » pour en prendre une autre.</span>
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
