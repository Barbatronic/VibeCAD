/** Panneau du déplacement : décalage, rotation autour d'un axe, copie. */
import type { MoveFeature } from '../../domain/model';
import { readNumber } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { moveIssues } from './definition';

type Vec = 'translation' | 'center';

export function MovePanel(props: FeaturePanelProps<MoveFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const vecField = (which: Vec, axis: 'x' | 'y' | 'z', autoFocus = false) => {
    const name = `${which === 'translation' ? 't' : 'c'}${axis}`;
    return (
      <LengthField
        key={name}
        id={`draft-${name}`}
        label={axis.toUpperCase()}
        value={draft.fields[name] ?? ''}
        error={draft.errors[name] ?? null}
        {...(autoFocus ? { autoFocus: true, selectOnFocus: true } : {})}
        onInput={(text) => {
          const v = readNumber(text);
          if (v === null) return setField(name, text, { error: 'Saisissez un nombre de millimètres.' });
          const next = withParams(f, { [which]: { ...p[which], [axis]: v } } as Partial<MoveFeature['params']>);
          const issue = moveIssues(next.params).find((i) => i.field === name);
          setField(name, text, issue ? { error: issue.message } : { feature: next });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
    );
  };
  return (
    <>
      <div class="field">
        <span class="field-label">Décalage (mm)</span>
        <div class="limits-row three">{(['x', 'y', 'z'] as const).map((a, i) => vecField('translation', a, i === 0))}</div>
      </div>
      <div class="field">
        <span class="field-label">Rotation</span>
        <Segmented<'X' | 'Y' | 'Z'>
          label="Axe de rotation"
          value={p.axis}
          options={[
            { value: 'X', label: 'Axe X' },
            { value: 'Y', label: 'Axe Y' },
            { value: 'Z', label: 'Axe Z' },
          ]}
          onChange={(axis) => update((x) => withParams(x, { axis }))}
        />
        <LengthField
          id="draft-angle"
          label="Angle"
          unit="°"
          step={15}
          value={draft.fields.angle ?? ''}
          error={draft.errors.angle ?? null}
          help="Sens trigonométrique en regardant depuis le bout de l’axe (0 : pas de rotation)."
          onInput={(text) => {
            const v = readNumber(text);
            if (v === null) return setField('angle', text, { error: 'Saisissez un angle en degrés.' });
            const next = withParams(f, { angle: v });
            const issue = moveIssues(next.params).find((i) => i.field === 'angle');
            setField('angle', text, issue ? { error: issue.message } : { feature: next });
          }}
          onEnter={props.confirm}
          onEscape={props.cancel}
        />
      </div>
      {p.angle % 360 !== 0 ? (
        <div class="field">
          <span class="field-label">Centre de rotation (mm)</span>
          <div class="limits-row three">{(['x', 'y', 'z'] as const).map((a) => vecField('center', a))}</div>
          <p class="field-help">L’axe de rotation passe par ce point. La pièce tourne d’abord, puis se décale.</p>
        </div>
      ) : null}
      <label class="checkbox-row">
        <input id="draft-copy" type="checkbox" checked={p.copy} onChange={() => update((x) => withParams(x, { copy: !p.copy }))} />
        <span>Garder l’original et ajouter une copie déplacée</span>
      </label>
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
