/**
 * Onglet Fabrication : préparer ce qui a été conçu pour l'impression 3D (plateau, orientation,
 * exemplaires, échelle, export 3MF), la découpe laser (SVG, DXF) et les documents (mise en plan,
 * gabarit 1:1, nomenclature). Voir docs/fabrication.md.
 */
import { formatNumber } from '../domain/units';
import { bomSizeText, scaleLabel } from '../app/drawings';
import { PLA_DENSITY } from '../app/fabrication';
import type { DrawingPage } from '../io/drawing';
import { useAppState, useController } from './context';
import { useEffect, useState } from 'preact/hooks';
import type { LaserItem } from '../domain/model';
import { Button, Callout, IconButton, ToolButton } from './components/controls';
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
        <ToolButton id="fab-laser" icon="laser" label="Découpe laser" pressed={tab === 'laser'} onClick={() => c.setFabricationTab('laser')} />
        <ToolButton id="fab-docs" icon="drawing" label="Documents" hint="Mise en plan cotée, gabarit 1:1, nomenclature" pressed={tab === 'docs'} onClick={() => c.setFabricationTab('docs')} />
      </div>
      <div class="toolbar-group" role="group" aria-label="Exporter">
        {tab === 'print' ? <ToolButton id="fab-export-3mf" icon="export" label="Exporter 3MF" hint="Exporter le plateau préparé en 3MF" onClick={() => c.showExportDialog('3mf')} /> : null}
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
      </div>
    </>
  );
}

/** Panneau de gauche : selon le sous-onglet, impression 3D ou découpe laser. */
export function FabricationSection() {
  const tab = useAppState((s) => s.fabricationTab);
  return tab === 'laser' ? <LaserSection /> : tab === 'docs' ? <DocsSection /> : <PrintSection />;
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
          return { ...i, name: part.name, color: part.color, thickness: layout.thickness[i.partId] ?? null, resolved: layout.materialOf[i.partId] ?? null };
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
        <p class="field-help">
          Pour chaque pièce plate (une extrusion de l’épaisseur du matériau), indiquez le nombre d’exemplaires à découper et le matériau. Par défaut, le
          matériau est celui qui a la même épaisseur que la pièce.
        </p>
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

/** Aperçu des plaques d'un matériau (dessins réduits). */
function SheetPreview({ materialId }: { materialId: string }) {
  const c = useController();
  const svg = useAppState(() => {
    const doc = c.laserDocument(materialId);
    if (!doc || doc.sheets.length === 0) return null;
    const { w, h } = doc.sheet;
    const sheets = doc.sheets.map((sheet) =>
      sheet.items.flatMap((it) => it.loops.map((l) => l.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(2)},${(h - p.y).toFixed(2)}`).join('') + 'Z')),
    );
    return { w, h, sheets };
  }, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  if (!svg) return <p class="empty-hint">Aucune pièce dans ce matériau.</p>;
  return (
    <>
      {svg.sheets.map((paths, n) => (
        <figure class="sheet-preview" key={n}>
          <svg viewBox={`0 0 ${svg.w} ${svg.h}`} role="img" aria-label={`Aperçu de la plaque ${n + 1}`}>
            <rect x="0" y="0" width={svg.w} height={svg.h} fill="var(--surface)" stroke="var(--border-strong)" stroke-width={Math.max(svg.w, svg.h) / 300} />
            {paths.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="#e03131" stroke-width={Math.max(svg.w, svg.h) / 400} />
            ))}
          </svg>
          <figcaption class="field-help">
            Plaque {n + 1}
            {svg.sheets.length > 1 ? ` sur ${svg.sheets.length}` : ''}
          </figcaption>
        </figure>
      ))}
    </>
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

/** Panneau de droite du laser : une page par matériau (épaisseur, plaques, aperçu, export). */
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
  const [selected, setSelected] = useState<string | null>(null);
  const page = info.pages.find((p) => p.id === selected) ?? info.pages.find((p) => p.count > 0) ?? info.pages[0];
  const set = (patch: Record<string, unknown>, label: string) => c.updateFabrication((f) => ({ ...f, laser: { ...f.laser, ...patch } }), label);
  return (
    <aside class="panel right-panel" aria-label="Plaques de découpe">
      <div class="panel-title">
        <Icon name="laser" />
        <span>Plaques de découpe</span>
      </div>
      <div class="panel-content">
        <p class="vocab">
          <strong>Découpe laser</strong> : une page par matériau. Le contour de chaque pièce plate est tracé à l’échelle 1:1, en rouge (découpe), décalé
          de la moitié du trait de coupe, puis rangé sur les plaques de son matériau.
        </p>
        <div class="mat-tabs" role="tablist" aria-label="Matériaux">
          {info.pages.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === page?.id} onClick={() => setSelected(p.id)}>
              {p.name}
              <span class="mat-count">{p.count}</span>
            </button>
          ))}
          <IconButton icon="plus" label="Ajouter un matériau" small onClick={() => setSelected(c.addLaserMaterial())} />
        </div>
        {page ? (
          <div class="mat-page" role="tabpanel" aria-label={page.name}>
            <NameField value={page.name} label="Nom du matériau" onDone={(name) => c.updateLaserMaterial(page.id, { name }, 'Nom du matériau')} />
            <div class="limits-row">
              {numberField('Épaisseur du matériau', page.thickness, 'mm', (thickness) => c.updateLaserMaterial(page.id, { thickness }, 'Épaisseur du matériau'), { step: 0.5 })}
              {numberField('Trait de coupe (kerf)', page.kerf, 'mm', (kerf) => c.updateLaserMaterial(page.id, { kerf }, 'Trait de coupe'), { step: 0.05, max: 2 })}
            </div>
            <div class="limits-row">
              {numberField('Plaque : largeur', page.sheet.w, 'mm', (w) => c.updateLaserMaterial(page.id, { sheet: { ...page.sheet, w } }, 'Taille de la plaque'), { step: 10, min: 20 })}
              {numberField('hauteur', page.sheet.h, 'mm', (h) => c.updateLaserMaterial(page.id, { sheet: { ...page.sheet, h } }, 'Taille de la plaque'), { step: 10, min: 20, aria: 'Plaque : hauteur' })}
            </div>
            <p>
              <strong>{page.count}</strong> pièce{page.count > 1 ? 's' : ''} sur <strong>{page.sheets}</strong> plaque{page.sheets > 1 ? 's' : ''}
            </p>
            <SheetPreview materialId={page.id} />
            <div class="mat-actions">
              <Button small icon="export" disabledReason={page.count === 0 ? 'Aucune pièce dans ce matériau.' : null} onClick={() => void c.exportLaser('svg', page.id)}>
                SVG
              </Button>
              <Button small icon="export" disabledReason={page.count === 0 ? 'Aucune pièce dans ce matériau.' : null} onClick={() => void c.exportLaser('dxf', page.id)}>
                DXF
              </Button>
              <Button small icon="trash" disabledReason={info.pages.length <= 1 ? 'Il faut garder au moins un matériau.' : null} onClick={() => c.removeLaserMaterial(page.id)}>
                Supprimer
              </Button>
            </div>
          </div>
        ) : null}
        {numberField('Espace entre les pièces', info.spacing, 'mm', (spacing) => set({ spacing }, 'Espace entre les pièces'), { step: 1, max: 50 })}
        <label class="checkbox-row">
          <input type="checkbox" checked={info.engrave} onChange={() => set({ engraveNames: !info.engrave }, 'Gravure des noms')} />
          <span>Graver le nom des pièces (en bleu)</span>
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

/** Impression 3D : réglages de chaque pièce. */
function PrintSection() {
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

/** Panneau de droite : selon le sous-onglet. */
export function FabricationRightPanel() {
  const tab = useAppState((s) => s.fabricationTab);
  return tab === 'laser' ? <LaserRightPanel /> : tab === 'docs' ? <DocsRightPanel /> : <PrintRightPanel />;
}

function PrintRightPanel() {
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
        {info.plates > 1 ? (
          <div class="plate-nav" role="group" aria-label="Plateaux">
            <IconButton icon="chevron-left" label="Plateau précédent" small disabled={info.plate === 0} onClick={() => c.setPrintPlate(info.plate - 1)} />
            <strong aria-live="polite">
              Plateau {info.plate + 1} sur {info.plates}
            </strong>
            <IconButton icon="chevron-right" label="Plateau suivant" small disabled={info.plate >= info.plates - 1} onClick={() => c.setPrintPlate(info.plate + 1)} />
          </div>
        ) : null}
        <p>
          {info.plates > 1 ? (
            <>
              <strong>{info.plateCount}</strong> pièce{info.plateCount > 1 ? 's' : ''} sur ce plateau (≈ {formatNumber(info.plateGrams, 1)} g) ·{' '}
              <strong>{info.count}</strong> en tout sur {info.plates} plateaux · matière ≈ <strong>{formatNumber(info.grams, 1)} g</strong>
            </>
          ) : (
            <>
              <strong>{info.count}</strong> pièce{info.count > 1 ? 's' : ''} sur le plateau · matière ≈ <strong>{formatNumber(info.grams, 1)} g</strong>
            </>
          )}
          <span class="field-help"> (pièces pleines en PLA, {formatNumber(PLA_DENSITY, 2)} g/cm³ ; le remplissage du logiciel d’impression en utilise moins)</span>
        </p>
        {info.plates > 1 ? (
          <p class="field-help">Tout ne tient pas sur un seul plateau : les pièces suivantes passent sur un nouveau plateau, à imprimer l’un après l’autre.</p>
        ) : null}
        {info.warnings.map((w) => (
          <Callout key={w} kind="warning">
            {w}
          </Callout>
        ))}
      </div>
      <div class="panel-actions">
        <Button variant="primary" icon="export" disabledReason={info.count === 0 ? 'Le plateau est vide.' : null} onClick={() => c.showExportDialog('3mf')}>
          {info.plates > 1 ? 'Exporter les plateaux (3MF)' : 'Exporter le plateau (3MF)'}
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
        bom: { source: bom.source, rows: bom.rows.map((r) => ({ mark: r.mark, name: r.name, quantity: r.quantity, size: bomSizeText(r.size) })) },
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
        <p class="field-help">Choisissez une pièce (ici ou en cliquant dans la vue 3D) pour voir sa mise en plan.</p>
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
        <p class="field-help">
          {data.bom.source === 'assembly' ? 'Pièces de l’assemblage et nombre d’exemplaires.' : 'Pas encore d’assemblage : une ligne par pièce.'}
        </p>
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
                  <td>{r.name}</td>
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

/** Aperçu d'une page de mise en plan (fond blanc, comme le papier). */
function DrawingPreview({ page, label }: { page: DrawingPage; label: string }) {
  const y = (v: number) => page.height - v;
  return (
    <svg class="drawing-preview" viewBox={`0 0 ${page.width} ${page.height}`} role="img" aria-label={label}>
      <rect width={page.width} height={page.height} fill="#ffffff" />
      {page.lines.map((l, i) => (
        <line
          key={i}
          x1={l.a.x}
          y1={y(l.a.y)}
          x2={l.b.x}
          y2={y(l.b.y)}
          stroke={l.style === 'hidden' ? '#555555' : '#000000'}
          stroke-width={l.style === 'thick' ? 0.5 : 0.25}
          stroke-dasharray={l.style === 'hidden' ? '2 1.2' : undefined}
          stroke-linecap="round"
        />
      ))}
      {page.texts.map((t, i) => (
        <text
          key={i}
          x={t.at.x}
          y={y(t.at.y)}
          font-size={t.size}
          font-family="Helvetica, Arial, sans-serif"
          fill="#000000"
          text-anchor={t.anchor ?? 'start'}
          transform={t.angle ? `rotate(${-t.angle} ${t.at.x} ${y(t.at.y)})` : undefined}
        >
          {t.text}
        </text>
      ))}
    </svg>
  );
}

function DocsRightPanel() {
  const c = useController();
  const info = useAppState((s) => {
    const id = c.docsPart();
    const part = id ? s.doc.parts.find((p) => p.id === id) : null;
    return { id, name: part?.name ?? '', drawing: id ? c.drawingOf(id) : null };
  }, (a, b) => a.id === b.id && a.name === b.name && a.drawing === b.drawing);
  return (
    <aside class="panel right-panel" aria-label="Mise en plan">
      <div class="panel-title">
        <Icon name="drawing" />
        <span>Mise en plan</span>
      </div>
      <div class="panel-content">
        <p class="vocab">
          <strong>Mise en plan</strong> : la pièce vue de face, de dessus et de gauche, avec ses dimensions. Les traits interrompus montrent ce qui
          est caché.
        </p>
        {info.drawing ? (
          <figure class="sheet-preview">
            <DrawingPreview page={info.drawing.page} label={`Mise en plan de « ${info.name} »`} />
            <figcaption class="field-help">
              « {info.name} » · A4 paysage · échelle {scaleLabel(info.drawing.scale)}
            </figcaption>
          </figure>
        ) : (
          <Callout kind="info">Aucune pièce avec un volume : extrudez une esquisse pour obtenir une mise en plan.</Callout>
        )}
        <p class="vocab">
          <strong>Gabarit 1:1</strong> : le contour d’une face plate de chaque pièce, à taille réelle, pour tracer ou découper à la main (carton,
          bois). Imprimez-le en « taille réelle ».
        </p>
      </div>
      <div class="panel-actions stack">
        <Button variant="primary" icon="export" disabledReason={info.drawing ? null : 'Aucune pièce avec un volume.'} onClick={() => void c.exportDrawing('pdf')}>
          Mise en plan (PDF)
        </Button>
        <Button icon="export" disabledReason={info.drawing ? null : 'Aucune pièce avec un volume.'} onClick={() => void c.exportDrawing('svg')}>
          Mise en plan de cette pièce (SVG)
        </Button>
        <Button icon="export" disabledReason={info.drawing ? null : 'Aucune pièce avec un volume.'} onClick={() => void c.exportTemplate()}>
          Gabarit 1:1 (PDF)
        </Button>
      </div>
    </aside>
  );
}
