/** Panneau d'un plan de construction : plan de départ, décalage, inclinaison autour d'une charnière. */
import type { PlaneFeature, PlaneName } from '../../domain/model';
import { readNumber } from '../../domain/units';
import { Callout, LengthField, Segmented } from '../../ui/components/controls';
import { AxisField, datumAxesBefore, DatumPlaneSelect, datumPlanesBefore, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { planeIssues } from './definition';

type BaseChoice = PlaneName | 'face' | 'datum';

export function PlanePanel(props: FeaturePanelProps<PlaneFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const datums = datumPlanesBefore(props.part, f.id);
  const picking = draft.fields.pick === 'face';
  const base: BaseChoice = p.base.kind === 'face' ? 'face' : p.base.kind === 'datum' ? 'datum' : p.base.plane;
  const numberField = (field: 'offset' | 'angle', label: string, unit: string, help: string) => (
    <LengthField
      id={`draft-${field}`}
      label={label}
      unit={unit}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      help={help}
      selectOnFocus
      onInput={(text) => {
        const v = readNumber(text);
        if (v === null) return setField(field, text, { error: `${label} : saisissez un nombre.` });
        const next = withParams(f, { [field]: v } as Partial<PlaneFeature['params']>);
        const issue = planeIssues(next.params).find((i) => i.field === field);
        setField(field, text, issue ? { error: issue.message } : { feature: next });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  return (
    <>
      <Segmented<BaseChoice>
        label="Plan de départ"
        value={picking ? 'face' : base}
        options={[
          { value: 'XY', label: 'XY', title: 'Plan XY (le sol)' },
          { value: 'XZ', label: 'XZ', title: 'Plan XZ (de face)' },
          { value: 'YZ', label: 'YZ', title: 'Plan YZ (de côté)' },
          { value: 'face', label: 'Face…', title: 'Une face plane de la pièce, cliquée dans la vue 3D' },
          ...(datums.length ? [{ value: 'datum' as const, label: 'Plan…', title: 'Un autre plan de construction' }] : []),
        ]}
        onChange={(v) =>
          v === 'face'
            ? setField('pick', 'face', { feature: f })
            : setField('pick', '', { feature: withParams(f, { base: v === 'datum' ? { kind: 'datum', featureId: datums[datums.length - 1]!.id } : { kind: 'plane', plane: v } }) })
        }
      />
      {picking ? (
        <Callout kind="info">
          <p>Cliquez dans la vue 3D une face plane de la pièce : le nouveau plan part de cette face.</p>
        </Callout>
      ) : p.base.kind === 'face' ? (
        <span class="field-help">Face choisie dans la vue 3D. Cliquez « Face… » pour en prendre une autre.</span>
      ) : null}
      {p.base.kind === 'datum' ? (
        <DatumPlaneSelect planes={datums} value={p.base.featureId} onChange={(featureId) => update((x) => withParams(x, { base: { kind: 'datum', featureId } }))} />
      ) : null}
      {numberField('offset', 'Décalage', 'mm', 'Distance entre le plan de départ et le nouveau plan (négatif : de l’autre côté).')}
      {numberField('angle', 'Inclinaison', '°', '0 : parallèle au plan de départ. Le plan tourne autour de la charnière choisie ci-dessous.')}
      {p.angle !== 0 ? (
        <>
          <AxisField
            label="Charnière (axe de rotation)"
            axis={p.hinge}
            picking={draft.fields.pick === 'edge'}
            datums={datumAxesBefore(props.part, f.id)}
            onAxis={(hinge) => setField('pick', '', { feature: withParams(f, { hinge }) })}
            onPick={() => setField('pick', 'edge', { feature: f })}
          />
        </>
      ) : null}
      <p class="field-help">Le plan ne change pas la pièce : il sert ensuite de support à une esquisse (« Esquisse »), de miroir (« Symétrie ») ou de plan de « Découpe ».</p>
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
