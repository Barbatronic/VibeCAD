/**
 * Propriétés de la pièce active (outil « Propriétés » du secteur Contrôler, ou rappel de la barre
 * d'état) : matière, volume, masse, encombrement, centre de gravité.
 */
import { allows } from '../app/levels';
import { PROCESS_LABELS, sheetOf } from '../domain/material-sheets';
import { massOf, partMaterial, partMaterialId } from '../domain/part-material';
import { formatLength, formatNumber, formatVolume } from '../domain/units';
import { useAppState, useController } from './context';
import { Button } from './components/controls';
import { Icon } from './icons';

export function PropertiesPanel() {
  const c = useController();
  const part = useAppState((s) => s.doc.parts.find((p) => p.id === s.activePartId) ?? s.doc.parts[0]);
  const analysis = useAppState((s) => (part ? s.display[part.id]?.result.analysis : null));
  const sheet = useAppState((s) => (part ? sheetOf(s.doc, part) : undefined));
  const showCentroid = useAppState((s) => s.showCentroid);
  const canCentroid = useAppState((s) => allows(s.level, 'view-centroid'));
  if (!part) return null;
  const material = partMaterial(partMaterialId(part));
  const solid = analysis && analysis.solidCount > 0 ? analysis : null;
  const size = solid?.bbox ? { x: solid.bbox.max.x - solid.bbox.min.x, y: solid.bbox.max.y - solid.bbox.min.y, z: solid.bbox.max.z - solid.bbox.min.z } : null;
  return (
    <aside class="panel right-panel" aria-label={`Propriétés de « ${part.name} »`}>
      <div class="panel-title">
        <Icon name="info" />
        <span>Propriétés de « {part.name} »</span>
      </div>
      <div class="panel-content">
        <div class="field">
          <span class="field-label">Matière</span>
          <div class="part-sheet">
            {sheet ? <span class="color-swatch" style={{ background: sheet.color, width: '16px', height: '16px' }} /> : null}
            <strong id="part-sheet-name">{sheet ? sheet.name : `Non choisie (comptée en ${material.name})`}</strong>
            {sheet ? <span class="field-help">{PROCESS_LABELS[sheet.process]}</span> : null}
          </div>
          <Button small icon="material" onClick={() => c.showMaterials()}>
            Changer…
          </Button>
        </div>
        {solid ? (
          <dl class="props-list" aria-live="polite">
            <dt>Volume</dt>
            <dd>{formatVolume(solid.volume)}</dd>
            <dt>Masse (pièce pleine)</dt>
            <dd>≈ {formatNumber(massOf(solid.volume, material), 1)} g</dd>
            {size ? (
              <>
                <dt>Encombrement (X × Y × Z)</dt>
                <dd>
                  {formatLength(size.x, undefined, false)} × {formatLength(size.y, undefined, false)} × {formatLength(size.z)}
                </dd>
              </>
            ) : null}
            {solid.solidCount > 1 ? (
              <>
                <dt>Morceaux</dt>
                <dd>{solid.solidCount} morceaux séparés</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p class="field-help">Pas encore de volume.</p>
        )}
        {solid && canCentroid && solid.centroid ? (
          <label class="checkbox-row" title="Point d’équilibre de la pièce">
            <input type="checkbox" checked={showCentroid} onChange={() => c.toggleCentroid()} />
            <span>
              Montrer le centre de gravité ({formatNumber(solid.centroid.x, 1)} ; {formatNumber(solid.centroid.y, 1)} ; {formatNumber(solid.centroid.z, 1)} mm)
            </span>
          </label>
        ) : null}
      </div>
      <div class="panel-actions">
        <Button variant="primary" icon="check" onClick={() => c.toggleProperties(false)}>
          Fermer
        </Button>
      </div>
    </aside>
  );
}
