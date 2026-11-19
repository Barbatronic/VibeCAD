/**
 * Onglet Fabrication : préparer ce qui a été conçu pour l'impression 3D (plateau, orientation,
 * exemplaires, échelle, export 3MF), la découpe laser (SVG, DXF) et les documents (mise en plan,
 * gabarit 1:1, nomenclature). Voir docs/fabrication.md.
 */
import { formatNumber, readNumber } from '../domain/units';
import { bomSizeText, scaleLabel } from '../app/drawings';
import { allows } from '../app/levels';
import { AMS_SLOTS, PLA_DENSITY, formatSeriesValue, seriesValues } from '../app/fabrication';
import { useAppState, useController } from './context';
import { ToolGroup } from './ToolSectors';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DrawingTitle, LaserItem, PrintSeries } from '../domain/model';
import { variantDocument } from '../features/parameters';
import { MARK_MIN_HEIGHT } from '../features/series-mark';
import { sheetOf } from '../domain/material-sheets';
import { Button, Callout, IconButton, ToolButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';
import { MaterialsRightPanel, MaterialsSection } from './MaterialsUi';

/** Valeur saisie : nombre ou équation (paramètres du projet compris). */
const num = (t: string) => readNumber(t);

export function FabricationTools() {
  const c = useController();
  const tab = useAppState((s) => s.fabricationTab);
  const laser = useAppState((s) => allows(s.level, 'fabrication:laser'));
  const docs = useAppState((s) => allows(s.level, 'fabrication:docs'));
  return (
    <>
      <ToolGroup name="Fabriquer">
        <ToolButton id="fab-materials" icon="material" label="Matières" hint="Comment chaque pièce est fabriquée : matière, procédé, couleur" pressed={tab === 'materials'} onClick={() => c.setFabricationTab('materials')} />
        <ToolButton id="fab-print" icon="print3d" label="Impression 3D" pressed={tab === 'print'} onClick={() => c.setFabricationTab('print')} />
        {laser ? <ToolButton id="fab-laser" icon="laser" label="Découpe laser" pressed={tab === 'laser'} onClick={() => c.setFabricationTab('laser')} /> : null}
        {docs ? (
          <ToolButton id="fab-docs" icon="drawing" label="Documents" hint="Mise en plan cotée, gabarit 1:1, nomenclature" pressed={tab === 'docs'} onClick={() => c.setFabricationTab('docs')} />
        ) : null}
      </ToolGroup>
      {tab === 'materials' ? null : (
      <ToolGroup name="Exporter">
        {tab === 'print' ? (
          <>
            <ToolButton id="fab-send-slicer" icon="print3d" label="Envoyer au slicer" hint="Envoyer le plateau affiché à votre logiciel d’impression (OrcaSlicer, PrusaSlicer, Bambu Studio, Cura…)" onClick={() => void c.sendToSlicer()} />
            <ToolButton id="fab-export-3mf" icon="export" label="Exporter 3MF" hint="Exporter le plateau préparé en 3MF" onClick={() => c.showExportDialog('3mf')} />
          </>
        ) : null}
        {tab === 'laser' ? (
          <>
            <ToolButton id="fab-export-svg" icon="export" label="SVG" hint="Exporter les plaques en SVG (1:1, mm), un fichier par matériau" onClick={() => void c.exportLaser('svg')} />
            <ToolButton id="fab-export-dxf" icon="export" label="DXF" hint="Exporter les plaques en DXF (mm), un fichier par matériau" onClick={() => void c.exportLaser('dxf')} />
          </>
        ) : null}
        {tab === 'docs' ? (
          <>
            <ToolButton id="fab-export-drawing" icon="export" label="Mise en plan" hint="Exporter la mise en plan de toutes les pièces (PDF)" onClick={() => void c.exportDrawing('pdf')} />
            <ToolButton id="fab-export-template" icon="export" label="Gabarit" hint="Exporter les gabarits papier 1:1 (PDF)" onClick={() => void c.exportTemplate()} />
            <ToolButton id="fab-export-bom" icon="export" label="Nomenclature" hint="Exporter la nomenclature (CSV, pour un tableur)" onClick={() => void c.exportBom()} />
          </>
        ) : null}
      </ToolGroup>
      )}
    </>
  );
}

/** Panneau de gauche : selon le sous-onglet, impression 3D ou découpe laser. */
export function FabricationSection() {
  const tab = useAppState((s) => s.fabricationTab);
  return tab === 'materials' ? <MaterialsSection /> : tab === 'laser' ? <LaserSection /> : tab === 'docs' ? <DocsSection /> : <PrintSection />;
}

function LaserSection() {
  const c = useController();
  const data = useAppState(
    (s) => {
      const f = c.fabrication();
      const layout = c.laserLayout();
      return {
        mode: s.mode.kind === 'pick-fab-face' ? s.mode.partId : null,
        materials: f.laser.materials.map((m) => ({ id: m.id, name: m.name })),
        items: f.laser.items.map((i) => {
          const part = s.doc.parts.find((p) => p.id === i.partId)!;
          return { ...i, name: part.name, color: part.color, thickness: layout.thickness[i.partId] ?? null, resolved: layout.materialOf[i.partId] ?? null, bySheet: !!part.make };
        }),
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const setItem = (partId: string, change: (i: LaserItem) => LaserItem, label: string) =>
    c.updateFabrication((f) => ({ ...f, laser: { ...f.laser, items: f.laser.items.map((i) => (i.partId === partId ? change(i) : i)) } }), label);
  const autoName = (resolved: string | null) => data.materials.find((m) => m.id === resolved)?.name ?? '—';
  return (
    <section class="panel-section grow" aria-labelledby="laser-title">
      <div class="panel-header">
        <span id="laser-title">Découpe laser</span>
      </div>
      <div class="panel-body">
        <ul class="feature-list fab-list" aria-label="Pièces à découper">
          {data.items.map((i) => (
            <li key={i.partId} class="fab-item">
              <div class="fab-item-title">
                <span class="color-swatch" style={{ background: i.color, width: '16px', height: '16px' }} />
                <strong>{i.name}</strong>
                {i.thickness !== null ? <span class="field-help">épaisseur {formatNumber(i.thickness, 2)} mm</span> : null}
              </div>
              <label class="mini-field">
                <span>Exemplaires</span>
                <NumberInput
                  value={String(i.copies)}
                  unit="×"
                  min={0}
                  max={200}
                  ariaLabel={`Exemplaires à découper de « ${i.name} »`}
                  onInput={(t) => {
                    const v = num(t);
                    if (v !== null && v >= 0 && v <= 200) setItem(i.partId, (x) => ({ ...x, copies: Math.round(v) }), `Exemplaires à découper de « ${i.name} »`);
                  }}
                />
              </label>
              <label class="mini-field fab-material">
                <span>Matériau</span>
                <select
                  class="select"
                  aria-label={`Matériau de « ${i.name} »`}
                  disabled={i.bySheet}
                  title={i.bySheet ? 'La plaque vient de la matière de la pièce (Fabrication › Matières).' : undefined}
                  value={i.materialId ?? ''}
                  onChange={(e) => {
                    const id = (e.target as HTMLSelectElement).value;
                    setItem(i.partId, ({ materialId: _old, ...rest }) => (id ? { ...rest, materialId: id } : rest), `Matériau de « ${i.name} »`);
                  }}
                >
                  <option value="">Auto ({autoName(i.resolved)})</option>
                  {data.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <div class="fab-face">
                <Button small icon="target" onClick={() => (data.mode === i.partId ? c.cancelFabricationPick() : c.pickFabricationFace('laser', i.partId))}>
                  {data.mode === i.partId ? 'Cliquez une face…' : 'Face du contour'}
                </Button>
                {i.face ? (
                  <button type="button" class="tl-link" onClick={() => setItem(i.partId, ({ face: _f, ...rest }) => rest, `Contour par défaut de « ${i.name} »`)}>
                    plus grande face
                  </button>
                ) : (
                  <span class="field-help">par défaut : la plus grande face plate</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Nom modifiable (validé à la sortie du champ ou avec Entrée). */
function NameField(props: { value: string; label: string; onDone: (value: string) => void }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const done = () => {
    const v = text.trim();
    if (v && v !== props.value) props.onDone(v);
    else setText(props.value);
  };
  return (
    <label class="mini-field">
      <span>{props.label}</span>
      <input
        class="rename-input"
        aria-label={props.label}
        value={text}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') done();
          if (e.key === 'Escape') setText(props.value);
        }}
        onBlur={done}
      />
    </label>
  );
}

const numberField = (label: string, value: number, unit: string, apply: (v: number) => void, opts: { step?: number; min?: number; max?: number; aria?: string } = {}) => (
  <label class="mini-field">
    <span>{label}</span>
    <NumberInput
      value={formatNumber(value, 2)}
      unit={unit}
      step={opts.step ?? 1}
      min={opts.min ?? 0}
      max={opts.max ?? 5000}
      ariaLabel={opts.aria ?? label}
      onInput={(t) => {
        const v = num(t);
        if (v !== null && v >= (opts.min ?? 0) && v <= (opts.max ?? 5000)) apply(v);
      }}
    />
  </label>
);

/** Panneau de droite du laser : réglages et export du matériau dont les plaques sont affichées. */
function LaserRightPanel() {
  const c = useController();
  const info = useAppState(
    () => {
      const f = c.fabrication().laser;
      const layout = c.laserLayout();
      return {
        spacing: f.spacing,
        engrave: !!f.engraveNames,
        warnings: layout.warnings,
        pages: layout.materials.map((g) => ({ ...g.material, count: g.placed.length, sheets: g.sheets })),
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const chosen = useAppState((s) => s.laserPage);
  // Même matériau que les plaques affichées au centre.
  const page = info.pages.find((p) => p.id === chosen) ?? info.pages.find((p) => p.count > 0) ?? info.pages[0];
  const set = (patch: Record<string, unknown>, label: string) => c.updateFabrication((f) => ({ ...f, laser: { ...f.laser, ...patch } }), label);
  return (
    <aside class="panel right-panel" aria-label="Plaques de découpe">
      <div class="panel-title">
        <Icon name="laser" />
        <span>{page?.name ?? 'Découpe laser'}</span>
      </div>
      <div class="panel-content">
        {page ? (
          <div class="mat-page" role="tabpanel" aria-label={page.name}>
            {page.fromSheet ? (
              <p class="field-help">
                {page.name} · {formatNumber(page.thickness, 1)} mm
              </p>
            ) : (
              <NameField key={page.id} value={page.name} label="Nom du matériau" onDone={(name) => c.updateLaserMaterial(page.id, { name }, 'Nom du matériau')} />
            )}
            <div class="limits-row">
              {page.fromSheet ? null : numberField('Épaisseur du matériau', page.thickness, 'mm', (thickness) => c.updateLaserMaterial(page.id, { thickness }, 'Épaisseur du matériau'), { step: 0.5 })}
              {numberField('Trait de coupe (kerf)', page.kerf, 'mm', (kerf) => c.updateLaserMaterial(page.id, { kerf }, 'Trait de coupe'), { step: 0.05, max: 2 })}
            </div>
            <div class="limits-row">
              {numberField('Plaque : largeur', page.sheet.w, 'mm', (w) => c.updateLaserMaterial(page.id, { sheet: { ...page.sheet, w } }, 'Taille de la plaque'), { step: 10, min: 20 })}
              {numberField('hauteur', page.sheet.h, 'mm', (h) => c.updateLaserMaterial(page.id, { sheet: { ...page.sheet, h } }, 'Taille de la plaque'), { step: 10, min: 20, aria: 'Plaque : hauteur' })}
            </div>
            <p>
              <strong>{page.count}</strong> pièce{page.count > 1 ? 's' : ''} sur <strong>{page.sheets}</strong> plaque{page.sheets > 1 ? 's' : ''}
            </p>
            <div class="mat-actions">
              <Button small icon="export" disabledReason={page.count === 0 ? 'Aucune pièce dans ce matériau.' : null} onClick={() => void c.exportLaser('svg', page.id)}>
                SVG
              </Button>
              <Button small icon="export" disabledReason={page.count === 0 ? 'Aucune pièce dans ce matériau.' : null} onClick={() => void c.exportLaser('dxf', page.id)}>
                DXF
              </Button>
              <Button
                small
                icon="trash"
                disabledReason={page.fromSheet ? 'Plaque d’une matière du projet : changez la matière des pièces dans Fabrication › Matières.' : info.pages.length <= 1 ? 'Il faut garder au moins un matériau.' : null}
                onClick={() => c.removeLaserMaterial(page.id)}
              >
                Supprimer
              </Button>
            </div>
          </div>
        ) : null}
        {numberField('Espace entre les pièces', info.spacing, 'mm', (spacing) => set({ spacing }, 'Espace entre les pièces'), { step: 1, max: 50 })}
        <label class="checkbox-row">
          <input type="checkbox" checked={info.engrave} onChange={() => set({ engraveNames: !info.engrave }, 'Gravure des noms')} />
          <span>Graver le nom des pièces</span>
        </label>
        {info.warnings.map((w) => (
          <Callout key={w} kind="warning">
            {w}
          </Callout>
        ))}
      </div>
      <div class="panel-actions stack">
        <Button variant="primary" icon="export" disabledReason={info.pages.every((p) => p.count === 0) ? 'Aucune pièce à découper.' : null} onClick={() => void c.exportLaser('svg')}>
          Exporter tout en SVG
        </Button>
        <Button icon="export" disabledReason={info.pages.every((p) => p.count === 0) ? 'Aucune pièce à découper.' : null} onClick={() => void c.exportLaser('dxf')}>
          Exporter tout en DXF
        </Button>
      </div>
    </aside>
  );
}

/** Impression 3D, à gauche : les plateaux, puis les pièces du plateau choisi. */
function PrintSection() {
  const c = useController();
  const data = useAppState(
    (s) => {
      const f = c.fabrication();
      const current = c.currentPlate();
      const nameOf = (id: string) => s.doc.parts.find((p) => p.id === id);
      return {
        plates: (f.print.plates ?? []).map((p) => ({ id: p.id, name: p.name, count: p.items.reduce((n, i) => n + i.copies * (i.series ? Math.max(1, seriesValues(i.series).values.length) : 1), 0) })),
        current: current.id,
        selected: s.printItem,
        items: current.items.map((i) => {
          const part = nameOf(i.partId);
          const values = i.series ? seriesValues(i.series).values.length : 0;
          return { partId: i.partId, name: part?.name ?? '?', color: part?.color ?? '#888', copies: i.copies, scale: i.scale, series: i.series ? { parameter: i.series.parameter, values } : null };
        }),
        addable: c.partsToAddToPlate().map((p) => ({ id: p.id, name: p.name })),
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  return (
    <>
      <section class="panel-section" aria-labelledby="plates-title">
        <div class="panel-header">
          <span id="plates-title">Plateaux</span>
          <IconButton icon="plus" label="Nouveau plateau" small onClick={() => c.addPrintPlate()} />
        </div>
        <div class="panel-body">
          <ul class="feature-list fab-list" aria-label="Plateaux d’impression">
            {data.plates.map((p) => (
              <li key={p.id} class="plate-row">
                <button type="button" class={`doc-part${p.id === data.current ? ' selected' : ''}`} aria-pressed={p.id === data.current} onClick={() => c.selectPrintPlate(p.id)}>
                  <Icon name="print3d" />
                  <span class="plate-row-name">{p.name}</span>
                  <span class="field-help">{p.count ? `${p.count} pièce${p.count > 1 ? 's' : ''}` : 'vide'}</span>
                </button>
                {data.plates.length > 1 ? <IconButton icon="trash" label={`Supprimer « ${p.name} »`} small onClick={() => c.removePrintPlate(p.id)} /> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section class="panel-section grow" aria-labelledby="plate-parts-title">
        <div class="panel-header">
          <span id="plate-parts-title">Pièces du plateau</span>
        </div>
        <div class="panel-body">
          {data.items.length === 0 ? <p class="empty-hint">Aucune pièce sur ce plateau.</p> : null}
          <ul class="feature-list fab-list" aria-label="Pièces du plateau">
            {data.items.map((i) => (
              <li key={i.partId} class="plate-row">
                <button type="button" class={`doc-part${i.partId === data.selected ? ' selected' : ''}`} aria-pressed={i.partId === data.selected} onClick={() => c.selectPrintItem(i.partId === data.selected ? null : i.partId)}>
                  <span class="color-swatch" style={{ background: i.color, width: '14px', height: '14px' }} />
                  <span class="plate-row-name">{i.name}</span>
                  <span class="field-help">
                    {i.series ? `${i.series.parameter} × ${i.series.values}` : `× ${i.copies}`}
                    {i.scale !== 100 ? ` · ${formatNumber(i.scale, 1)} %` : ''}
                  </span>
                </button>
                <IconButton icon="close" label={`Retirer « ${i.name} » du plateau`} small onClick={() => c.removeFromPlate(i.partId)} />
              </li>
            ))}
          </ul>
          {data.addable.length ? (
            <select
              class="select plate-add"
              aria-label="Ajouter une pièce au plateau"
              value=""
              onChange={(e) => {
                const id = (e.target as HTMLSelectElement).value;
                if (id) c.addToPlate(id);
              }}
            >
              <option value="">+ Ajouter une pièce…</option>
              {data.addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : data.items.length === 0 ? (
            <p class="field-help">Aucune pièce imprimée avec un volume dans le projet.</p>
          ) : null}
        </div>
      </section>
    </>
  );
}

/** Impression 3D, à droite : réglages de la pièce choisie sur le plateau. */
function PrintItemPanel() {
  const c = useController();
  const data = useAppState(
    (s) => {
      // La pièce peut quitter le plateau (autre plateau, annulation) juste avant que le panneau se ferme.
      const item = c.printItem();
      if (!item) return null;
      const part = s.doc.parts.find((p) => p.id === item.partId);
      return {
        item,
        name: part?.name ?? '?',
        color: part?.color ?? '#888',
        picking: s.mode.kind === 'pick-fab-face' && s.mode.partId === item.partId,
        progress: item.series ? c.printVariantProgress(item.partId) : null,
        hasParameters: (s.doc.parameters ?? []).length > 0,
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  if (!data) return null;
  const i = data.item;
  const set = (patch: Partial<typeof i>, label: string) => c.updatePrintItem(i.partId, patch, label);
  return (
    <aside class="panel right-panel" aria-label={`Impression de « ${data.name} »`}>
      <div class="panel-title">
        <IconButton icon="chevron-left" label="Retour au plateau" small onClick={() => c.selectPrintItem(null)} />
        <span class="color-swatch" style={{ background: data.color, width: '16px', height: '16px' }} />
        <span>{data.name}</span>
      </div>
      <div class="panel-content">
        <div class="limits-row">
          <label class="mini-field">
            <span>{i.series ? 'Exemplaires par valeur' : 'Exemplaires'}</span>
            <NumberInput
              value={String(i.copies)}
              unit="×"
              min={1}
              max={50}
              ariaLabel={`Exemplaires de « ${data.name} »`}
              onInput={(t) => {
                const v = num(t);
                if (v !== null && v >= 1 && v <= 50) set({ copies: Math.round(v) }, `Exemplaires de « ${data.name} »`);
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
              ariaLabel={`Échelle de « ${data.name} »`}
              onInput={(t) => {
                const v = num(t);
                if (v !== null && v > 0 && v <= 1000) set({ scale: v }, `Échelle de « ${data.name} »`);
              }}
            />
          </label>
        </div>
        <div class="fab-face">
          <Button small icon="target" onClick={() => (data.picking ? c.cancelFabricationPick() : c.pickFabricationFace('print', i.partId))}>
            {data.picking ? 'Cliquez une face…' : 'Face du dessous'}
          </Button>
          {i.downFace ? (
            <button type="button" class="tl-link" onClick={() => set({ downFace: undefined }, `Orientation d’origine de « ${data.name} »`)}>
              orientation d’origine
            </button>
          ) : null}
        </div>
        {i.series && i.scale !== 100 ? (
          <Callout kind="warning">
            Échelle {formatNumber(i.scale, 1)} % : les valeurs essayées sont agrandies d’autant. Pour un essai de tolérance, laissez 100 %.
          </Callout>
        ) : null}
        {i.series ? (
          <SeriesEditor partId={i.partId} name={data.name} series={i.series} progress={data.progress} />
        ) : (
          <div class="fab-face">
            <Button
              small
              icon="pattern"
              hint="Une version de la pièce par valeur d’un paramètre, pour trouver le bon jeu"
              disabledReason={data.hasParameters ? null : 'Aucun paramètre dans le projet : créez-en un dans Paramètres.'}
              onClick={() => {
                const series = c.defaultPrintSeries();
                if (series) c.setPrintSeries(i.partId, series);
              }}
            >
              Série d’essais
            </Button>
          </div>
        )}
      </div>
      <div class="panel-actions">
        <Button icon="close" onClick={() => c.removeFromPlate(i.partId)}>
          Retirer du plateau
        </Button>
      </div>
    </aside>
  );
}

const SERIES_MODES: { value: PrintSeries['mode']; label: string; title: string }[] = [
  { value: 'around', label: 'Autour', title: 'Valeur ± écart, par pas' },
  { value: 'range', label: 'Entre', title: 'De … à …, en n essais' },
  { value: 'list', label: 'Liste', title: 'Valeurs données une à une' },
];

/** Série d'essais d'une pièce : paramètre, valeurs, avancement du calcul, valeur retenue. */
function SeriesEditor(props: { partId: string; name: string; series: PrintSeries; progress: { done: number; total: number } | null }) {
  const c = useController();
  const { partId, name, series } = props;
  const doc = useAppState((s) => s.doc);
  const picking = useAppState((s) => s.mode.kind === 'pick-fab-face' && s.mode.purpose === 'mark' && s.mode.partId === partId);
  const params = doc.parameters ?? [];
  const known = params.find((p) => p.name.toLowerCase() === series.parameter.toLowerCase());
  const r = seriesValues(series);
  const set = (patch: Partial<PrintSeries>) => c.setPrintSeries(partId, { ...series, ...patch });
  // Paramètre sans effet sur la pièce : toutes les versions seraient identiques.
  const unused = useMemo(() => {
    const part = doc.parts.find((p) => p.id === partId);
    if (!known || !part || r.values.length < 2) return false;
    return [r.values[0]!, r.values[r.values.length - 1]!].every((v) => variantDocument(doc, known.name, v).parts.find((p) => p.id === partId) === part);
  }, [doc.parts, doc.parameters, partId, known?.name, r.values.join(';')]);
  const [kept, setKept] = useState<number | null>(null);
  const keep = kept !== null && r.values.includes(kept) ? kept : (r.values[Math.floor(r.values.length / 2)] ?? null);
  const changeMode = (mode: PrintSeries['mode']) => {
    if (mode === series.mode) return;
    const v = r.values;
    const min = v[0] ?? 0;
    const max = v[v.length - 1] ?? 0;
    if (mode === 'range') set({ mode, from: min, to: max, count: Math.max(2, v.length) });
    else if (mode === 'around') set({ mode, center: (min + max) / 2, delta: (max - min) / 2, step: v.length > 1 ? v[1]! - v[0]! : 0.1 });
    else set({ mode, values: v });
  };
  const field = (label: string, value: number | undefined, key: keyof PrintSeries, opts: { unit?: string; step?: number; min?: number; integer?: boolean } = {}) => (
    <label class="mini-field">
      <span>{label}</span>
      <NumberInput
        value={value === undefined ? '' : formatNumber(value, 4)}
        unit={opts.unit ?? ''}
        step={opts.step ?? 0.05}
        {...(opts.min !== undefined ? { min: opts.min } : {})}
        ariaLabel={`Série d’essais de « ${name} » : ${label.toLowerCase()}`}
        onInput={(t) => {
          const n = num(t);
          if (n !== null && (opts.min === undefined || n >= opts.min)) set({ [key]: opts.integer ? Math.round(n) : n });
        }}
      />
    </label>
  );
  return (
    <div class="fab-series" role="group" aria-label={`Série d’essais de « ${name} »`}>
      <div class="fab-series-head">
        <strong>Série d’essais</strong>
        <button type="button" class="tl-link" onClick={() => c.setPrintSeries(partId, null)}>
          arrêter
        </button>
      </div>
      <label class="mini-field">
        <span>Paramètre</span>
        <select
          class="select"
          aria-label={`Paramètre essayé sur « ${name} »`}
          value={known?.name ?? ''}
          onChange={(e) => {
            const parameter = (e.target as HTMLSelectElement).value;
            // Autour : on repart de la valeur actuelle du nouveau paramètre.
            const center = resolveValue(params, parameter);
            set(series.mode === 'around' && center !== null ? { parameter, center } : { parameter });
          }}
        >
          {known ? null : <option value="">{series.parameter} (supprimé)</option>}
          {params.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div class="segmented small" role="group" aria-label="Valeurs essayées">
        {SERIES_MODES.map((m) => (
          <button type="button" key={m.value} aria-pressed={m.value === series.mode} title={m.title} onClick={() => changeMode(m.value)}>
            {m.label}
          </button>
        ))}
      </div>
      {series.mode === 'around' ? (
        <div class="limits-row three">
          {field('Valeur', series.center, 'center', { unit: 'mm' })}
          {field('± écart', series.delta, 'delta', { unit: 'mm', min: 0 })}
          {field('Pas', series.step, 'step', { unit: 'mm', min: 0 })}
        </div>
      ) : series.mode === 'range' ? (
        <div class="limits-row three">
          {field('De', series.from, 'from', { unit: 'mm' })}
          {field('À', series.to, 'to', { unit: 'mm' })}
          {field('Essais', series.count, 'count', { unit: '×', step: 1, min: 1, integer: true })}
        </div>
      ) : (
        <SeriesList name={name} values={series.values ?? []} onChange={(values) => set({ values })} />
      )}
      {r.error ? (
        <span class="field-error" role="alert">
          {r.error}
        </span>
      ) : (
        <p class="field-help">
          {r.values.length} essai{r.values.length > 1 ? 's' : ''} : {r.values.map(formatSeriesValue).join(' · ')}
        </p>
      )}
      {props.progress && props.progress.done < props.progress.total ? (
        <p class="field-help" aria-live="polite">
          Calcul des versions : {props.progress.done} / {props.progress.total}
        </p>
      ) : null}
      {unused ? <Callout kind="warning">« {known!.name} » ne modifie pas « {name} » : toutes les versions sont identiques.</Callout> : null}
      <div class="fab-series-mark" role="group" aria-label="Marquage de la valeur">
        <div class="fab-face">
          <Button small icon="text" hint="Grave la valeur essayée sur une face plane de chaque version" onClick={() => (picking ? c.cancelFabricationPick() : c.pickFabricationFace('mark', partId))}>
            {picking ? 'Cliquez une face…' : series.mark ? 'Face du marquage' : 'Marquer la valeur'}
          </Button>
          {series.mark ? (
            <button type="button" class="tl-link" onClick={() => c.setPrintSeries(partId, (({ mark: _m, ...rest }) => rest)(series))}>
              sans marquage
            </button>
          ) : null}
        </div>
        {series.mark ? (
          <div class="limits-row">
            <label class="mini-field">
              <span>Hauteur du texte</span>
              <NumberInput
                value={formatNumber(series.mark.height, 2)}
                unit="mm"
                step={0.5}
                min={MARK_MIN_HEIGHT}
                ariaLabel={`Marquage de « ${name} » : hauteur du texte`}
                onInput={(t) => {
                  const n = num(t);
                  if (n !== null && n >= MARK_MIN_HEIGHT && n <= 100) set({ mark: { ...series.mark!, height: n } });
                }}
              />
            </label>
            <label class="mini-field">
              <span>Profondeur</span>
              <NumberInput
                value={formatNumber(series.mark.depth, 2)}
                unit="mm"
                step={0.1}
                min={0}
                ariaLabel={`Marquage de « ${name} » : profondeur`}
                onInput={(t) => {
                  const n = num(t);
                  if (n !== null && n >= 0 && n <= 10) set({ mark: { ...series.mark!, depth: n } });
                }}
              />
            </label>
          </div>
        ) : null}
      </div>
      {known && keep !== null ? (
        <div class="fab-face">
          <select class="select" aria-label={`Valeur retenue pour « ${known.name} »`} value={String(keep)} onChange={(e) => setKept(Number((e.target as HTMLSelectElement).value))}>
            {r.values.map((v) => (
              <option key={v} value={String(v)}>
                {known.name} = {formatSeriesValue(v)}
              </option>
            ))}
          </select>
          <Button small hint={`Donne cette valeur au paramètre « ${known.name} » et termine la série`} onClick={() => c.keepSeriesValue(partId, keep)}>
            Retenir
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Valeur actuelle d'un paramètre du projet (null s'il est en erreur). */
function resolveValue(params: readonly { name: string; expression: string }[], name: string): number | null {
  const own = params.find((p) => p.name === name);
  if (!own) return null;
  return num(own.expression) ?? null;
}

/** Liste de valeurs saisie librement (« 0,1 ; 0,15 ; 0,2 »), prise en compte à la validation. */
function SeriesList(props: { name: string; values: number[]; onChange: (values: number[]) => void }) {
  const shown = props.values.map(formatSeriesValue).join(' ; ');
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const apply = () => {
    const values = text
      .split(/[;\s]+/)
      .filter(Boolean)
      .map((t) => num(t));
    if (values.every((v): v is number => v !== null)) props.onChange(values);
    else setText(shown);
  };
  return (
    <label class="mini-field">
      <span>Valeurs (séparées par ;)</span>
      <input
        class="text-input"
        type="text"
        aria-label={`Série d’essais de « ${props.name} » : valeurs`}
        value={text}
        placeholder="0,1 ; 0,15 ; 0,2"
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={apply}
      />
    </label>
  );
}

/** Panneau de droite : selon le sous-onglet. */
export function FabricationRightPanel() {
  const tab = useAppState((s) => s.fabricationTab);
  return tab === 'materials' ? <MaterialsRightPanel /> : tab === 'laser' ? <LaserRightPanel /> : tab === 'docs' ? <DocsRightPanel /> : <PrintRightPanel />;
}

function PrintRightPanel() {
  const c = useController();
  const hasItem = useAppState(() => c.printItem() !== null);
  return hasItem ? <PrintItemPanel /> : <PlatePanel />;
}

function PlatePanel() {
  const c = useController();
  const info = useAppState(
    () => {
      const f = c.fabrication();
      const layout = c.printLayout();
      const plate = c.printPlate();
      const on = layout.placements.filter((p) => p.plate === plate);
      return {
        bed: f.print.bed,
        spacing: f.print.spacing,
        count: layout.placements.length,
        grams: layout.grams,
        warnings: layout.warnings,
        plates: layout.plates,
        plate,
        plateCount: on.length,
        plateGrams: on.reduce((g, p) => g + p.grams, 0),
        ams: c.amsSlots().map((m) => ({ id: m.id, name: m.name, color: m.color })),
        name: c.currentPlate().name,
      };
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
        <NameField value={info.name} label="Nom du plateau" onDone={(v) => c.renamePrintPlate(v)} />
        {info.ams.length ? (
          <div class="field" role="group" aria-labelledby="ams-title">
            <span class="field-label" id="ams-title">
              AMS : matière de chaque emplacement
            </span>
            <ul class="sheet-list" aria-label="Emplacements de l’AMS">
              {info.ams.map((m, k) => (
                <li key={m.id} class="sheet-item static">
                  <span class="color-swatch" style={{ background: m.color, width: '18px', height: '18px' }} />
                  <span class="sheet-item-text">
                    <strong>{m.name}</strong>
                  </span>
                  <select class="select" aria-label={`Emplacement de « ${m.name} »`} value={String(k)} onChange={(e) => c.setAmsSlot(m.id, Number((e.target as HTMLSelectElement).value))}>
                    {info.ams.map((_x, j) => (
                      <option key={j} value={String(j)}>
                        {j + 1}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            {info.ams.length > AMS_SLOTS ? (
              <Callout kind="warning">
                {info.ams.length} matières à imprimer : un AMS n’en charge que {AMS_SLOTS}. Imprimez en plusieurs fois, ou regroupez des pièces dans la même matière.
              </Callout>
            ) : null}
          </div>
        ) : null}
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
        {info.plates > 1 ? (
          <div class="plate-nav" role="group" aria-label="Impressions">
            <IconButton icon="chevron-left" label="Impression précédente" small disabled={info.plate === 0} onClick={() => c.setPrintPlate(info.plate - 1)} />
            <strong aria-live="polite">
              Impression {info.plate + 1} sur {info.plates}
            </strong>
            <IconButton icon="chevron-right" label="Impression suivante" small disabled={info.plate >= info.plates - 1} onClick={() => c.setPrintPlate(info.plate + 1)} />
          </div>
        ) : null}
        <p>
          {info.plates > 1 ? (
            <>
              Ne tient pas en une fois : <strong>{info.plateCount}</strong> pièce{info.plateCount > 1 ? 's' : ''} sur cette impression (≈ {formatNumber(info.plateGrams, 1)} g) ·{' '}
              <strong>{info.count}</strong> en tout sur {info.plates} impressions · matière ≈ <strong>{formatNumber(info.grams, 1)} g</strong>
            </>
          ) : (
            <>
              <strong>{info.count}</strong> pièce{info.count > 1 ? 's' : ''} sur le plateau · matière ≈ <strong>{formatNumber(info.grams, 1)} g</strong>
            </>
          )}
          <span class="field-help" title={`Pièces pleines en PLA (${formatNumber(PLA_DENSITY, 2)} g/cm³) : le remplissage du slicer en utilise moins.`}> (plein)</span>
        </p>
        {info.warnings.map((w) => (
          <Callout key={w} kind="warning">
            {w}
          </Callout>
        ))}
      </div>
      <div class="panel-actions">
        <Button variant="primary" icon="print3d" disabledReason={info.count === 0 ? 'Le plateau est vide.' : null} onClick={() => void c.sendToSlicer()}>
          {info.plates > 1 ? `Envoyer l’impression ${info.plate + 1} au slicer` : 'Envoyer au slicer'}
        </Button>
        <Button icon="export" disabledReason={info.count === 0 ? 'Le plateau est vide.' : null} onClick={() => c.showExportDialog('3mf')}>
          {info.plates > 1 ? 'Exporter les impressions (3MF)' : 'Exporter le plateau (3MF)'}
        </Button>
      </div>
    </aside>
  );
}

// ----- Documents

function DocsSection() {
  const c = useController();
  const data = useAppState(
    (s) => {
      const current = c.docsPart();
      const bom = c.billOfMaterials();
      return {
        current,
        parts: s.doc.parts.filter((p) => (s.display[p.id]?.result.analysis?.solidCount ?? 0) > 0).map((p) => ({ id: p.id, name: p.name, color: p.color })),
        bom: { source: bom.source, rows: bom.rows.map((r) => ({ mark: r.mark, name: r.name, quantity: r.quantity, size: bomSizeText(r.size), bought: r.bought })) },
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  return (
    <section class="panel-section grow" aria-labelledby="docs-title">
      <div class="panel-header">
        <span id="docs-title">Documents</span>
      </div>
      <div class="panel-body">
        <ul class="feature-list fab-list" aria-label="Pièces à mettre en plan">
          {data.parts.map((p) => (
            <li key={p.id}>
              <button type="button" class={`doc-part${p.id === data.current ? ' selected' : ''}`} aria-pressed={p.id === data.current} onClick={() => c.setFabricationPart(p.id)}>
                <span class="color-swatch" style={{ background: p.color, width: '14px', height: '14px' }} />
                <span>{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <h3 class="sub-title">Nomenclature</h3>
        {data.bom.rows.length ? (
          <table class="bom-table" aria-label="Nomenclature">
            <thead>
              <tr>
                <th scope="col">Rep.</th>
                <th scope="col">Désignation</th>
                <th scope="col">Qté</th>
                <th scope="col">L × l × h (mm)</th>
              </tr>
            </thead>
            <tbody>
              {data.bom.rows.map((r) => (
                <tr key={r.mark}>
                  <td>{r.mark}</td>
                  <td>
                    {r.name}
                    {r.bought ? <span class="bom-bought"> achat</span> : null}
                  </td>
                  <td>{r.quantity}</td>
                  <td>{r.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <div class="docs-actions">
          <Button small icon="export" disabledReason={data.bom.rows.length ? null : 'Aucune pièce avec un volume.'} onClick={() => void c.exportBom()}>
            Nomenclature (CSV)
          </Button>
        </div>
      </div>
    </section>
  );
}

const TITLE_FIELDS: { key: keyof DrawingTitle; label: string; placeholder?: (info: { name: string; material: string }) => string }[] = [
  { key: 'title', label: 'Titre', placeholder: (i) => i.name },
  { key: 'number', label: 'Plan n°' },
  { key: 'material', label: 'Matière', placeholder: (i) => i.material },
  { key: 'author', label: 'Dessiné par' },
  { key: 'date', label: 'Date' },
  { key: 'note', label: 'Remarque' },
];

function DocsRightPanel() {
  const c = useController();
  const info = useAppState(
    (s) => {
      const id = c.docsPart();
      const part = id ? s.doc.parts.find((p) => p.id === id) : null;
      const drawing = id ? c.drawingOf(id) : null;
      return { id, name: part?.name ?? '', material: (part && sheetOf(s.doc, part)?.name) || '', title: (id && c.drawingSettings(id)?.title) || null, format: drawing?.layout.format ?? null, scale: drawing?.scale ?? null };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const none = info.format ? null : 'Aucune pièce avec un volume.';
  return (
    <aside class="panel right-panel" aria-label="Mise en plan">
      <div class="panel-title">
        <Icon name="drawing" />
        <span>Mise en plan</span>
      </div>
      <div class="panel-content">
        {info.id && info.format && info.scale ? (
          <>
            <p class="field-help">
              « {info.name} » · {info.format} paysage · échelle {scaleLabel(info.scale)}
            </p>
            <h3 class="list-title">Cartouche</h3>
            <div class="drawing-title-fields">
              {TITLE_FIELDS.map((f) => (
                <label key={f.key} class="mini-field">
                  <span>{f.label}</span>
                  <input
                    class="text-input"
                    type="text"
                    aria-label={`Cartouche : ${f.label}`}
                    maxLength={60}
                    value={info.title?.[f.key] ?? ''}
                    placeholder={f.placeholder?.(info) ?? ''}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    onChange={(e) => c.setDrawingTitle(info.id!, f.key, (e.target as HTMLInputElement).value)}
                  />
                </label>
              ))}
            </div>
          </>
        ) : (
          <p class="empty-hint">Aucune pièce avec un volume.</p>
        )}
      </div>
      <div class="panel-actions stack">
        <Button variant="primary" icon="export" disabledReason={none} hint="Une page par pièce" onClick={() => void c.exportDrawing('pdf')}>
          Mise en plan (PDF)
        </Button>
        <Button icon="export" disabledReason={none} onClick={() => void c.exportDrawing('svg')}>
          Cette pièce (SVG)
        </Button>
        <Button icon="export" disabledReason={none} hint="Traits par calque (contours, traits cachés, cotes), en mm" onClick={() => void c.exportDrawing('dxf')}>
          Cette pièce (DXF)
        </Button>
        <Button icon="export" hint="Contour d’une face plate de chaque pièce, à imprimer en taille réelle" disabledReason={none} onClick={() => void c.exportTemplate()}>
          Gabarit 1:1 (PDF)
        </Button>
      </div>
    </aside>
  );
}
