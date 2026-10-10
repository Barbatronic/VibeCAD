/** Champs communs aux panneaux des fonctions volumiques (esquisse utilisée, sens, aperçu). */
import type { ExtentDirection, Feature } from '../../domain/model';
import type { FeatureStatus } from '../../domain/status';
import type { SketchOption } from '../../features/panel-types';
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
      options={(['default', 'reversed', 'symmetric'] as const).map((d) => ({ value: d, label: props.labels[d] }))}
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
