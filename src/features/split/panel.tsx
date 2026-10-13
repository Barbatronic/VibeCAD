/** Panneau des paramètres d'une découpe en deux. */
import type { PlaneName, SplitFeature, SplitKeep } from '../../domain/model';
import { readNumber } from '../../domain/units';
import { Callout, LengthField, Segmented } from '../../ui/components/controls';
import { DatumPlaneSelect, datumPlanesBefore, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import { useAppState } from '../../ui/context';
import type { FeaturePanelProps } from '../panel-types';
import { SPLIT_AXIS, splitIssues, splitSideLabels } from './definition';

type PlaneChoice = PlaneName | 'face' | 'datum';

const OFFSET_LABELS: Record<PlaneName, string> = { XY: 'Hauteur du plan (Z)', XZ: 'Position du plan (Y)', YZ: 'Position du plan (X)' };

export function SplitPanel(props: FeaturePanelProps<SplitFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const bbox = useAppState((s) => s.display[draft.partId]?.result.analysis?.bbox ?? null);
  const picking = draft.fields.pick === 'plane';
  const datums = datumPlanesBefore(props.part, f.id);
  const plane: PlaneChoice = picking || p.plane.kind === 'face' ? 'face' : p.plane.kind === 'datum' ? 'datum' : p.plane.plane;
  const sides = splitSideLabels(p.plane);
  const text = (v: number) => String(v).replace('.', ',');
  const choosePlane = (v: PlaneChoice) => {
    if (v === 'face') return setField('pick', 'plane', { feature: f });
    if (v === 'datum') {
      const datum = withParams(f, { plane: { kind: 'datum', featureId: datums[datums.length - 1]!.id }, offset: 0 });
      setField('offset', '0', { feature: datum });
      return setField('pick', '', { feature: datum });
    }
    // Nouveau plan d'origine : placé au milieu de la pièce le long de son axe.
    const axis = SPLIT_AXIS[v];
    const offset = bbox ? Math.round(((bbox.min[axis] + bbox.max[axis]) / 2) * 10) / 10 : p.offset;
    setField('offset', text(offset), { feature: withParams(f, { plane: { kind: 'plane', plane: v }, offset }) });
    setField('pick', '', { feature: withParams(f, { plane: { kind: 'plane', plane: v }, offset }) });
  };
  const numberField = (field: 'offset' | 'gap', label: string, help?: string) => (
    <LengthField
      id={`draft-${field}`}
      label={label}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      {...(help ? { help } : {})}
      selectOnFocus
      onInput={(t) => {
        const v = readNumber(t);
        if (v === null) return setField(field, t, { error: `${label} : nombre de millimètres attendu.` });
        const next = withParams(f, { [field]: v } as Partial<SplitFeature['params']>);
        const issue = splitIssues(next.params).find((i) => i.field === field);
        setField(field, t, issue ? { error: issue.message } : { feature: next });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  return (
    <>
      <Segmented<PlaneChoice>
        label="Plan de découpe"
        value={plane}
        options={[
          { value: 'XY', label: 'XY', title: 'Plan XY : coupe horizontale (haut / bas)' },
          { value: 'XZ', label: 'XZ', title: 'Plan XZ : coupe d’avant en arrière (selon Y)' },
          { value: 'YZ', label: 'YZ', title: 'Plan YZ : coupe de gauche à droite (selon X)' },
          { value: 'face', label: 'Face…', title: 'Une face plane de la pièce, cliquée dans la vue 3D, puis décalée' },
          ...(datums.length ? [{ value: 'datum', label: 'Plan…', title: 'Un plan de construction (outil « Plan »)' } as const] : []),
        ]}
        onChange={choosePlane}
      />
      {picking ? (
        <Callout kind="info">
          <p>Cliquez dans la vue 3D une face plane de la pièce : le plan de découpe lui est parallèle.</p>
        </Callout>
      ) : null}
      {p.plane.kind === 'datum' && !picking ? (
        <DatumPlaneSelect planes={datums} value={p.plane.featureId} onChange={(featureId) => update((x) => withParams(x, { plane: { kind: 'datum', featureId } }))} />
      ) : null}
      {p.plane.kind === 'plane'
        ? numberField('offset', OFFSET_LABELS[p.plane.plane])
        : p.plane.kind === 'datum'
          ? numberField('offset', 'Décalage depuis le plan de construction')
          : numberField('offset', 'Décalage depuis la face', 'Négatif : le plan entre dans la pièce.')}
      <Segmented<SplitKeep>
        label="Garder"
        value={p.keep}
        options={[
          { value: 'below', label: sides.below, title: `Garder ${sides.below.toLowerCase()} et retirer le reste` },
          { value: 'above', label: sides.above, title: `Garder ${sides.above.toLowerCase()} et retirer le reste` },
          { value: 'both', label: 'Les deux', title: 'Garder les deux morceaux, écartés l’un de l’autre (par exemple pour les imprimer séparément)' },
        ]}
        onChange={(keep) => update((x) => withParams(x, { keep }))}
      />
      {p.keep === 'both' ? numberField('gap', 'Écart entre les morceaux', 'Le morceau de l’autre côté du plan est éloigné de cette distance.') : null}
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
