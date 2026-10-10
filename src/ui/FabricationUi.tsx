/**
 * Onglet Fabrication : préparer ce qui a été conçu pour l'impression 3D (plateau, orientation,
 * exemplaires, échelle, export 3MF). Voir docs/fabrication.md.
 */
import { formatNumber } from '../domain/units';
import { PLA_DENSITY } from '../app/fabrication';
import { useAppState, useController } from './context';
import { Button, Callout, ToolButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';

const num = (t: string) => {
  const v = Number(t.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

export function FabricationTools() {
  const c = useController();
  const tab = useAppState((s) => s.fabricationTab);
  return (
    <>
      <div class="toolbar-group" role="group" aria-label="Type de fabrication">
        <ToolButton id="fab-print" icon="print3d" label="Impression 3D" pressed={tab === 'print'} onClick={() => c.setFabricationTab('print')} />
      </div>
      <div class="toolbar-group" role="group" aria-label="Exporter">
        {tab === 'print' ? <ToolButton id="fab-export-3mf" icon="export" label="Exporter 3MF" hint="Exporter le plateau préparé en 3MF" onClick={() => c.showExportDialog('3mf')} /> : null}
      </div>
    </>
  );
}

/** Panneau de gauche : réglages de chaque pièce à imprimer. */
export function FabricationSection() {
  const c = useController();
  const data = useAppState(
    (s) => {
      const f = c.fabrication();
      return {
        mode: s.mode.kind === 'pick-fab-face' ? s.mode.partId : null,
        items: f.print.items.map((i) => {
          const part = s.doc.parts.find((p) => p.id === i.partId)!;
          return { ...i, name: part.name, color: part.color };
        }),
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const setItem = (partId: string, patch: Record<string, unknown>, label: string) =>
    c.updateFabrication((f) => ({ ...f, print: { ...f.print, items: f.print.items.map((i) => (i.partId === partId ? { ...i, ...patch } : i)) } }), label);
  return (
    <section class="panel-section grow" aria-labelledby="fab-title">
      <div class="panel-header">
        <span id="fab-title">Impression 3D</span>
      </div>
      <div class="panel-body">
        {data.items.length === 0 ? <p class="empty-hint">Aucune pièce n’a encore de volume : construisez-en une dans l’onglet Pièces.</p> : null}
        <ul class="feature-list fab-list" aria-label="Pièces à imprimer">
          {data.items.map((i) => (
            <li key={i.partId} class="fab-item">
              <div class="fab-item-title">
                <span class="color-swatch" style={{ background: i.color, width: '16px', height: '16px' }} />
                <strong>{i.name}</strong>
              </div>
              <div class="limits-row">
                <label class="mini-field">
                  <span>Exemplaires</span>
                  <NumberInput
                    value={String(i.copies)}
                    unit="×"
                    min={0}
                    max={50}
                    ariaLabel={`Exemplaires de « ${i.name} »`}
                    onInput={(t) => {
                      const v = num(t);
                      if (v !== null && v >= 0 && v <= 50) setItem(i.partId, { copies: Math.round(v) }, `Exemplaires de « ${i.name} »`);
                    }}
                  />
                </label>
                <label class="mini-field">
                  <span>Échelle</span>
                  <NumberInput
                    value={formatNumber(i.scale, 1)}
                    unit="%"
                    step={10}
                    min={1}
                    max={1000}
                    ariaLabel={`Échelle de « ${i.name} »`}
                    onInput={(t) => {
                      const v = num(t);
                      if (v !== null && v > 0 && v <= 1000) setItem(i.partId, { scale: v }, `Échelle de « ${i.name} »`);
                    }}
                  />
                </label>
              </div>
              <div class="fab-face">
                <Button small icon="target" onClick={() => (data.mode === i.partId ? c.cancelFabricationPick() : c.pickFabricationFace('print', i.partId))}>
                  {data.mode === i.partId ? 'Cliquez une face…' : 'Face du dessous'}
                </Button>
                {i.downFace ? (
                  <button type="button" class="tl-link" onClick={() => setItem(i.partId, { downFace: undefined }, `Orientation d’origine de « ${i.name} »`)}>
                    orientation d’origine
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Panneau de droite : plateau, résumé, export. */
export function FabricationRightPanel() {
  const c = useController();
  const info = useAppState(
    () => {
      const f = c.fabrication();
      const layout = c.printLayout();
      return { bed: f.print.bed, spacing: f.print.spacing, count: layout.placements.length, grams: layout.grams, warnings: layout.warnings };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const setBed = (patch: Partial<typeof info.bed>) => c.updateFabrication((f) => ({ ...f, print: { ...f.print, bed: { ...f.print.bed, ...patch } } }), 'Taille du plateau');
  return (
    <aside class="panel right-panel" aria-label="Plateau d’impression">
      <div class="panel-title">
        <Icon name="print3d" />
        <span>Plateau d’impression</span>
      </div>
      <div class="panel-content">
        <p class="vocab">
          <strong>Impression 3D</strong> : choisissez pour chaque pièce la face posée sur le plateau et le nombre d’exemplaires, puis exportez le
          plateau en 3MF pour votre logiciel d’impression (PrusaSlicer, Bambu Studio, Cura…).
        </p>
        <div class="field">
          <span class="field-label">Taille du plateau (X × Y × hauteur)</span>
          <div class="limits-row three">
            {(['x', 'y', 'z'] as const).map((k) => (
              <label class="mini-field" key={k}>
              <span>{k === 'z' ? 'Hauteur' : k.toUpperCase()}</span>
              <NumberInput
                value={formatNumber(info.bed[k], 0)}
                unit="mm"
                step={10}
                min={20}
                max={2000}
                ariaLabel={`Plateau ${k.toUpperCase()}`}
                onInput={(t) => {
                  const v = num(t);
                  if (v !== null && v >= 20 && v <= 2000) setBed({ [k]: v });
                }}
              />
              </label>
            ))}
          </div>
        </div>
        <p>
          <strong>{info.count}</strong> pièce{info.count > 1 ? 's' : ''} sur le plateau · matière ≈ <strong>{formatNumber(info.grams, 1)} g</strong>
          <span class="field-help"> (pièces pleines en PLA, {formatNumber(PLA_DENSITY, 2)} g/cm³ ; le remplissage du logiciel d’impression en utilise moins)</span>
        </p>
        {info.warnings.map((w) => (
          <Callout key={w} kind="warning">
            {w}
          </Callout>
        ))}
      </div>
      <div class="panel-actions">
        <Button variant="primary" icon="export" disabledReason={info.count === 0 ? 'Le plateau est vide.' : null} onClick={() => c.showExportDialog('3mf')}>
          Exporter le plateau (3MF)
        </Button>
      </div>
    </aside>
  );
}
