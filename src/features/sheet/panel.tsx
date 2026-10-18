/** Panneau « Tôle » : contour, matériau, épaisseur, rayon des plis. */
import type { SheetFeature } from '../../domain/model';
import { defaultBendRadius, minBendRadius, SHEET_MATERIALS, sheetMaterial } from '../../domain/sheet-metal';
import { formatLength, parseLength } from '../../domain/units';
import { Callout, LengthField, Segmented } from '../../ui/components/controls';
import { PreviewStatus, SketchSelect, withParams } from '../../ui/components/feature-fields';
import type { FeaturePanelProps } from '../panel-types';
import { validateSheetThickness } from './definition';

export function SheetPanel(props: FeaturePanelProps<SheetFeature>) {
  const { draft, update, setField } = props;
  const f = draft.feature;
  const p = f.params;
  const material = sheetMaterial(p.materialId);
  return (
    <>
      <SketchSelect value={p.sketchId} options={props.sketches} onChange={(sketchId) => update((x) => withParams(x, { sketchId }))} />
      <div class="field">
        <label class="field-label" for="draft-sheet-material">
          Matériau
        </label>
        <select
          id="draft-sheet-material"
          class="select"
          value={p.materialId}
          onChange={(e) => {
            const m = sheetMaterial((e.target as HTMLSelectElement).value);
            const thickness = m.thicknesses.includes(p.thickness) ? p.thickness : (m.thicknesses.find((t) => t >= p.thickness) ?? m.thicknesses[m.thicknesses.length - 1]!);
            const radius = Math.max(p.radius, defaultBendRadius(m, thickness));
            const next = withParams(f, { materialId: m.id, thickness, radius });
            setField('thickness', formatLength(thickness, 3, false), { feature: next });
            setField('radius', formatLength(radius, 3, false), { feature: next });
          }}
        >
          {SHEET_MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.method === 'hot' ? 'à chaud' : 'à froid'})
            </option>
          ))}
        </select>
      </div>
      <LengthField
        id="draft-thickness"
        label="Épaisseur"
        value={draft.fields.thickness ?? ''}
        error={draft.errors.thickness ?? null}
        help={`Épaisseurs courantes : ${material.thicknesses.map((t) => formatLength(t, 3, false)).join(' ; ')} mm.`}
        autoFocus
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'L’épaisseur' });
          const err = parsed.ok ? validateSheetThickness(parsed.value) : parsed.error;
          setField('thickness', text, err ? { error: err } : { feature: withParams(f, { thickness: (parsed as { value: number }).value }) });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <LengthField
        id="draft-radius"
        label="Rayon des plis"
        value={draft.fields.radius ?? ''}
        error={draft.errors.radius ?? null}
        help={`Rayon intérieur des plis (modifiable pli par pli). Au moins ${formatLength(minBendRadius(material, p.thickness))} pour cette épaisseur.`}
        selectOnFocus
        onInput={(text) => {
          const parsed = parseLength(text, { label: 'Le rayon' });
          setField('radius', text, parsed.ok ? { feature: withParams(f, { radius: parsed.value }) } : { error: parsed.error });
        }}
        onEnter={props.confirm}
        onEscape={props.cancel}
      />
      <Segmented<'up' | 'down'>
        label="Épaisseur"
        value={p.reversed ? 'down' : 'up'}
        options={[
          { value: 'up', label: 'Au-dessus du dessin', title: 'La tôle part du plan de l’esquisse, côté normale' },
          { value: 'down', label: 'En dessous', title: 'La tôle est de l’autre côté du plan de l’esquisse' },
        ]}
        onChange={(v) => update((x) => withParams(x, { reversed: v === 'down' }))}
      />
      <Callout kind="info">
        <p>
          {material.name} : {material.method === 'hot' ? 'pliage à chaud' : 'pliage à froid'}. {material.note} Ensuite : « Bord plié » sur un bord, ou « Pli » sur un trait dessiné sur la tôle. Faites les trous avant les plis.
        </p>
      </Callout>
      <PreviewStatus status={props.status} kind="add" />
    </>
  );
}
