/** Champs communs aux panneaux des fonctions volumiques (esquisse utilisée, sens, aperçu). */
import type { ExtentDirection, Feature, Id, Part, PlaneFeature, VolumeOperation } from '../../domain/model';
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
