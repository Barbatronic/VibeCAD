/** Panneau d'une coque : faces à ouvrir (cliquées dans la vue 3D) et épaisseur de la paroi. */
import type { ShellFeature } from '../../domain/model';
import { parseLength } from '../../domain/units';
import { Button, Callout, LengthField } from '../../ui/components/controls';
import { PreviewStatus, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { validateShellThickness } from './definition';

export function ShellPanel(props: FeaturePanelProps<ShellFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const n = f.params.open.length;
  return (
    <>
      <Callout kind="info">
        <p>Cliquez dans la vue 3D les faces à laisser ouvertes (le dessus d’un pot, l’entrée d’une boîte). Cliquez-les à nouveau pour les refermer.</p>
      </Callout>
      <div class="field">
        <span class="field-label">Faces ouvertes</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong aria-live="polite">{n === 0 ? 'aucune (pièce creuse et fermée)' : `${n} face${n > 1 ? 's' : ''}`}</strong>
          {n > 0 ? (
            <Button small icon="trash" onClick={() => update((x) => withParams(x, { open: [] }))}>
              Tout refermer
            </Button>
          ) : null}
        </div>
      </div>
      <LengthField
        id="draft-thickness"
        label="Épaisseur de la paroi"
        value={draft.fields.thickness ?? ''}
        error={draft.errors.thickness ?? null}
        help="Elle doit rester plus petite que les parties fines de la pièce."
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'L’épaisseur' });
          const err = parsed.ok ? validateShellThickness(parsed.value) : parsed.error;
          setField('thickness', text, err ? { error: err } : { feature: withParams(f, { thickness: (parsed as { value: number }).value }) });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <label class="checkbox-row">
        <input type="checkbox" checked={f.params.outward} onChange={() => update((x) => withParams(x, { outward: !x.params.outward }))} />
        <span>Paroi vers l’extérieur (la pièce grossit, son intérieur garde sa forme)</span>
      </label>
      <PreviewStatus status={props.status} kind="modify" />
    </>
  );
}
