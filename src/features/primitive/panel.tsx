/** Panneau d'une forme toute faite (boîte, cylindre, boule, anneau). */
import type { PrimitiveFeature, PrimitiveShape } from '../../domain/model';
import { formatLength, parseLength, readNumber } from '../../domain/units';
import { LengthField } from '../../ui/components/controls';
import { OperationField, PreviewStatus, withParams } from '../../ui/components/feature-fields';
import { useAppState } from '../../ui/context';
import { Icon } from '../../ui/icons';
import type { FeaturePanelProps } from '../panel-types';
import { effectivePrimitive, POLYGON_SHAPES, regularPyramidHeight, PRIMITIVE_EXPLANATIONS, PRIMITIVE_FIELDS, PRIMITIVE_LABELS, primitiveFieldLabel, primitiveIssues, primitiveSides, type PrimitiveField } from './definition';

export function PrimitivePanel(props: FeaturePanelProps<PrimitiveFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  // Boîte, cylindre, boule et cône pour tous ; les autres formes à partir du niveau Intermédiaire.
  const beginner = useAppState((s) => s.level === 'debutant');
  const basic: PrimitiveShape[] = ['box', 'cylinder', 'sphere', 'cone'];
  const shapes: PrimitiveShape[] = beginner && basic.includes(p.shape) ? basic : [...basic, 'pyramid', 'prism', 'wedge', 'torus'];
  const hasSolid = props.part.features.some((x) => x.type !== 'sketch');
  const dimension = (field: PrimitiveField, autoFocus: boolean) => (
    <LengthField
      key={field}
      id={`draft-${field}`}
      label={primitiveFieldLabel(p.shape, field)}
      value={draft.fields[field] ?? ''}
      error={draft.errors[field] ?? null}
      autoFocus={autoFocus}
      selectOnFocus
      onInput={(text) => {
        const parsed = parseLength(text, { label: primitiveFieldLabel(p.shape, field), ...(field === 'topDiameter' ? { allowZero: true } : {}) });
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
      </div>
      <OperationField what="La forme" value={p.operation} onChange={(operation) => update((x) => withParams(x, { operation }))} />
      {p.operation === 'cut' && !hasSolid ? <p class="field-help">Rien à creuser : la pièce n’a pas de volume.</p> : null}
      {POLYGON_SHAPES.includes(p.shape) ? (
        <LengthField
          id="draft-sides"
          label="Nombre de côtés"
          value={draft.fields.sides ?? String(primitiveSides(p))}
          error={draft.errors.sides ?? null}
          unit=""
          selectOnFocus
          onInput={(text) => {
            const n = readNumber(text);
            if (n === null || !Number.isInteger(n) || n < 3 || n > 24) return setField('sides', text, { error: 'Le nombre de côtés doit être un entier de 3 à 24.' });
            setField('sides', text, { feature: withParams(f, { sides: n }) });
          }}
          onEnter={props.confirm}
          onEscape={props.cancel}
        />
      ) : null}
      {p.shape === 'pyramid' ? (
        <label class="checkbox-row">
          <input type="checkbox" checked={!!p.regular} onChange={() => update((x) => withParams(x, { regular: !p.regular }))} />
          <span>Régulière : toutes les arêtes égales</span>
        </label>
      ) : null}
      {PRIMITIVE_FIELDS[p.shape]
        // Pyramide régulière : hauteur calculée, pointe en haut.
        .filter((field) => !(p.shape === 'pyramid' && p.regular && (field === 'height' || field === 'topDiameter')))
        .map((field, i) => dimension(field, i === 0))}
      {p.shape === 'pyramid' && p.regular ? (
        <p class="field-help">
          {regularPyramidHeight(primitiveSides(p), p.diameter) !== null
            ? `Hauteur ${formatLength(effectivePrimitive(p).height)}${primitiveSides(p) === 3 ? ' : tétraèdre, 4 faces identiques' : ', faces latérales en triangles équilatéraux'}.`
            : 'Au plus 5 côtés pour une pyramide régulière.'}
        </p>
      ) : null}
      <div class="field">
        <span class="field-label">{p.shape === 'box' || p.shape === 'wedge' ? 'Position du coin (mm)' : p.shape === 'sphere' || p.shape === 'torus' ? 'Position du centre (mm)' : 'Position du centre de la base (mm)'}</span>
        <div class="limits-row three position-row">{(['x', 'y', 'z'] as const).map(coordinate)}</div>
      </div>
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
