/** Panneau du profilé aluminium : système, section, longueur, axe et position. */
import type { BeamFeature, BeamSize, BeamSystem } from '../../domain/model';
import { readNumber } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { OperationField, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { beamIssues } from './definition';
import { BEAM_SYSTEMS, beamLabel, beamRange } from './profiles';

const SYSTEM_TITLES: Record<BeamSystem, string> = {
  vslot: 'Série 20, entrée de rainure en V (roues à gorge)',
  tslot: 'Série 20, entrée de rainure droite',
  makerbeam: 'MakerBeam 10 × 10, rainure de 3 mm',
};

export function BeamPanel(props: FeaturePanelProps<BeamFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const coordinate = (axis: 'x' | 'y' | 'z') => (
    <LengthField
      key={axis}
      id={`draft-pos-${axis}`}
      label={axis.toUpperCase()}
      value={draft.fields[axis] ?? ''}
      error={draft.errors[axis] ?? null}
      onInput={(text) => {
        const v = readNumber(text);
        if (v === null) return setField(axis, text, { error: 'La position doit être un nombre de millimètres.' });
        setField(axis, text, { feature: withParams(f, { position: { ...p.position, [axis]: v } }) });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
  return (
    <>
      <Segmented<BeamSystem>
        label="Système"
        value={p.system}
        options={(Object.keys(BEAM_SYSTEMS) as BeamSystem[]).map((s) => ({ value: s, label: BEAM_SYSTEMS[s], title: SYSTEM_TITLES[s] }))}
        // Section gardée si le nouveau système la propose, sinon la première de sa gamme.
        onChange={(system) => update((x) => withParams(x, { system, size: beamRange(system).sizes.includes(x.params.size) ? x.params.size : beamRange(system).sizes[0]! }))}
      />
      <label class="field">
        <span class="field-label">Section (mm)</span>
        <select id="draft-beam-size" class="select" value={p.size} onChange={(e) => update((x) => withParams(x, { size: (e.target as HTMLSelectElement).value as BeamSize }))}>
          {beamRange(p.system).sizes.map((s) => (
            <option key={s} value={s}>
              {beamLabel(s)}
            </option>
          ))}
        </select>
        <span class="field-help">{beamRange(p.system).help}</span>
      </label>
      <LengthField
        id="draft-length"
        label="Longueur"
        value={draft.fields.length ?? ''}
        error={draft.errors.length ?? null}
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const v = readNumber(text);
          if (v === null) return setField('length', text, { error: 'La longueur doit être un nombre de millimètres.' });
          const next = withParams(f, { length: v });
          const issue = beamIssues(next.params).find((i) => i.field === 'length');
          setField('length', text, issue ? { error: issue.message } : { feature: next });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <Segmented<'X' | 'Y' | 'Z'> label="Axe" value={p.axis} options={(['X', 'Y', 'Z'] as const).map((a) => ({ value: a, label: a }))} onChange={(axis) => update((x) => withParams(x, { axis }))} />
      <div class="field">
        <span class="field-label">Centre de la section de départ (mm)</span>
        <div class="limits-row three">{(['x', 'y', 'z'] as const).map(coordinate)}</div>
      </div>
      <OperationField what="Le profilé" value={p.operation} onChange={(operation) => update((x) => withParams(x, { operation }))} />
      <PreviewStatus status={props.status} kind={p.operation === 'cut' ? 'cut' : p.operation === 'common' ? 'modify' : 'add'} />
    </>
  );
}
