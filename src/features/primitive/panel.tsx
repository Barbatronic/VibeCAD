/** Panneau d'une forme toute faite (boîte, cylindre, boule, anneau). */
import type { PrimitiveFeature, PrimitiveShape } from '../../domain/model';
import { parseLength, readNumber } from '../../domain/units';
import { LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import { useAppState } from '../../ui/context';
import { Icon } from '../../ui/icons';
import type { FeaturePanelProps } from '../panel-types';
import { PRIMITIVE_EXPLANATIONS, PRIMITIVE_FIELD_LABELS, PRIMITIVE_FIELDS, PRIMITIVE_LABELS, primitiveIssues } from './definition';

export function PrimitivePanel(props: FeaturePanelProps<PrimitiveFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  // L'anneau est un outil du niveau Intermédiaire (les trois autres formes sont pour tous).
  const beginner = useAppState((s) => s.level === 'debutant');
  const shapes: PrimitiveShape[] = beginner && p.shape !== 'torus' ? ['box', 'cylinder', 'sphere'] : ['box', 'cylinder', 'sphere', 'torus'];
  const hasSolid = props.part.features.some((x) => x.type !== 'sketch');
  const dimension = (field: (typeof PRIMITIVE_FIELDS)[PrimitiveShape][number], autoFocus: boolean) => (
    <LengthField
      key={field}
      id={`draft-${field}`}
      label={PRIMITIVE_FIELD_LABELS[field]}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      autoFocus={autoFocus}
      selectOnFocus
      onInput={(text) => {
        const parsed = parseLength(text, { label: PRIMITIVE_FIELD_LABELS[field] });
        if (!parsed.ok) return setField(field, text, { error: parsed.error });
        const next = withParams(f, { [field]: parsed.value } as Partial<PrimitiveFeature['params']>);
        const issue = primitiveIssues(next.params).find((i) => i.field === field);
        setField(field, text, issue ? { error: issue.message } : { feature: next });
      }}
      onEnter={props.confirm}
      onEscape={props.cancel}
    />
  );
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
      <div class="field" role="group" aria-label="Forme">
        <span class="field-label">Forme</span>
        <div class="choice-grid">
          {shapes.map((k) => (
            <button
              key={k}
              type="button"
              class="choice-card"
              aria-pressed={p.shape === k}
              title={`${PRIMITIVE_LABELS[k]} : ${PRIMITIVE_EXPLANATIONS[k]}`}
              onClick={() => update((x) => withParams(x, { shape: k }))}
            >
              <Icon name={`prim-${k}`} />
              <span>{PRIMITIVE_LABELS[k]}</span>
            </button>
          ))}
        </div>
        <p class="field-help">{PRIMITIVE_EXPLANATIONS[p.shape]}</p>
      </div>
      <Segmented<'add' | 'cut'>
        label="Matière"
        value={p.operation}
        options={[
          { value: 'add', label: 'Ajouter', title: 'La forme ajoute de la matière à la pièce' },
          { value: 'cut', label: 'Creuser', title: 'La forme retire de la matière, comme un trou' },
        ]}
        onChange={(operation) => update((x) => withParams(x, { operation }))}
      />
      {p.operation === 'cut' && !hasSolid ? <p class="field-help">Pour creuser, il faut d’abord un volume dans la pièce.</p> : null}
      {PRIMITIVE_FIELDS[p.shape].map((field, i) => dimension(field, i === 0))}
      <div class="field">
        <span class="field-label">{p.shape === 'box' ? 'Position du coin (mm)' : p.shape === 'cylinder' ? 'Position du centre de la base (mm)' : 'Position du centre (mm)'}</span>
        <div class="limits-row three position-row">{(['x', 'y', 'z'] as const).map(coordinate)}</div>
      </div>
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
