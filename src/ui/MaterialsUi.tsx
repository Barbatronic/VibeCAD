/**
 * Atelier Fabrication › Matières : comment chaque pièce est fabriquée. À gauche, la fiche matière de
 * chaque pièce ; à droite, les fiches du projet (exactement celles des pièces, modifiables) et le
 * catalogue personnel de l'appareil. Voir docs/conception-matieres.md.
 */
import { useState } from 'preact/hooks';
import { engraveColors, FINISH_LABELS, FINISHES, MAKE_PROCESSES, PROCESS_LABELS, STARTER_MATERIALS, type MaterialFinish, type MaterialSheet } from '../domain/material-sheets';
import { massOf, PART_MATERIALS, partMaterial, partMaterialId } from '../domain/part-material';
import { formatNumber } from '../domain/units';
import { Button, ToolButton } from './components/controls';
import { libraryMaterials } from '../app/library';
import { useAppState, useController } from './context';
import { Icon } from './icons';

/** Valeur du choix « Nouvelle matière » dans la liste d'une pièce. */
const NEW_SHEET = '__new__';

const swatch = (color: string, opacity = 1) => ({ background: color, opacity: Math.max(0.35, opacity) });

/** Ligne de description d'une fiche : procédé, matière de base, épaisseur. */
function sheetSummary(s: MaterialSheet): string {
  const base = PART_MATERIALS.find((m) => m.id === s.base)?.name ?? s.base;
  return [PROCESS_LABELS[s.process], base, s.thickness ? `${formatNumber(s.thickness, 1)} mm` : null].filter(Boolean).join(' · ');
}

/** Panneau de gauche : la matière de chaque pièce. */
export function MaterialsSection() {
  const c = useController();
  const data = useAppState(
    (s) => ({
      parts: s.doc.parts.map((p) => {
        const volume = s.display[p.id]?.result.analysis?.volume ?? 0;
        return { id: p.id, name: p.name, color: p.color, make: p.make ?? '', grams: volume > 0 ? massOf(volume, partMaterial(partMaterialId(p))) : null };
      }),
      project: s.doc.materials ?? [],
      mine: s.materialCatalogue,
      libs: libraryMaterials(s.libraryCatalogs),
      current: c.docsPart(),
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const inProject = new Set(data.project.map((m) => m.id));
  const starters = STARTER_MATERIALS.filter((m) => !inProject.has(m.id));
  const mine = data.mine.filter((m) => !inProject.has(m.id));
  const libs = data.libs.map((l) => ({ ...l, sheets: l.sheets.filter((m) => !inProject.has(m.id)) })).filter((l) => l.sheets.length);
  const find = (id: string) => [...data.project, ...data.mine, ...data.libs.flatMap((l) => l.sheets), ...STARTER_MATERIALS].find((m) => m.id === id) ?? null;
  return (
    <section class="panel-section grow" aria-labelledby="mat-title">
      <div class="panel-header">
        <span id="mat-title">Matières des pièces</span>
      </div>
      <div class="panel-body">
        <p class="field-help">Pour chaque pièce, la matière et la façon de la fabriquer : elles donnent sa couleur réelle et sa masse. Cliquez une pièce pour la voir seule.</p>
        <ul class="feature-list fab-list" aria-label="Matière de chaque pièce">
          {data.parts.map((p) => {
            const sheet = data.project.find((m) => m.id === p.make);
            return (
              <li key={p.id} class={`fab-item mat-part${p.id === data.current ? ' selected' : ''}`} onFocusIn={() => c.setFabricationPart(p.id)}>
                {/* La pièce choisie est seule dans la vue : les autres ne la cachent pas. */}
                <button type="button" class="fab-item-title mat-part-show" aria-pressed={p.id === data.current} title="Voir cette pièce" onClick={() => c.setFabricationPart(p.id)}>
                  <span class={`color-swatch${sheet ? '' : ' swatch-unset'}`} style={{ ...swatch(sheet?.color ?? p.color, sheet?.opacity), width: '16px', height: '16px' }} />
                  <strong>{p.name}</strong>
                  {p.id === data.current ? <span class="mat-part-shown">affichée</span> : null}
                </button>
                <select
                  class="select"
                  aria-label={`Matière de « ${p.name} »`}
                  value={p.make}
                  onChange={(e) => {
                    const value = (e.target as HTMLSelectElement).value;
                    if (value === NEW_SHEET) c.createSheetFor(p.id);
                    else c.setPartSheet(p.id, find(value));
                  }}
                >
                  <option value="">— à choisir —</option>
                  <option value={NEW_SHEET}>+ Nouvelle matière…</option>
                  {data.project.length ? (
                    <optgroup label="Dans ce projet">
                      {data.project.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {mine.length ? (
                    <optgroup label="Mon catalogue">
                      {mine.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {libs.map((l) => (
                    <optgroup key={l.library} label={`Bibliothèque ${l.library}`}>
                      {l.sheets.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <optgroup label="Catalogue VibeCAD">
                    {starters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <span class="field-help">
                  {sheet ? sheetSummary(sheet) : 'Matière non choisie (comptée en PLA)'}
                  {p.grams !== null ? ` · ≈ ${formatNumber(p.grams, 1)} g` : ''}
                </span>
              </li>
            );
          })}
        </ul>
        <Brush />
      </div>
    </section>
  );
}

/**
 * Pinceau de l'impression multicouleur : une matière imprimée (du projet ou d'un catalogue) ou la
 * gomme ; chaque face touchée dans la vue prend la matière choisie.
 */
function Brush() {
  const c = useController();
  const data = useAppState(
    (s) => ({
      brush: s.brush === 'erase' ? 'erase' : (s.brush?.id ?? null),
      project: (s.doc.materials ?? []).filter((m) => m.process === 'print'),
      mine: [...s.materialCatalogue, ...libraryMaterials(s.libraryCatalogs).flatMap((l) => l.sheets)].filter((m) => m.process === 'print'),
      printed: s.doc.parts.some((p) => s.doc.materials?.find((m) => m.id === p.make)?.process === 'print'),
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  // Le pinceau ne sert qu'aux pièces imprimées.
  if (!data.printed) return null;
  const inProject = new Set(data.project.map((m) => m.id));
  const others = [...data.mine, ...STARTER_MATERIALS.filter((m) => m.process === 'print')].filter((m) => !inProject.has(m.id));
  const pick = (m: MaterialSheet) => c.setBrush(data.brush === m.id ? null : m);
  const chosen = data.project.find((m) => m.id === data.brush) ?? others.find((m) => m.id === data.brush);
  return (
    <div class="field brush" role="group" aria-labelledby="brush-title">
      <span class="field-label" id="brush-title">
        Peindre des faces (impression 3D)
      </span>
      <div class="brush-pots">
        {data.project.map((m) => (
          <button key={m.id} type="button" class="paint-swatch" aria-pressed={data.brush === m.id} aria-label={`Peindre en ${m.name}`} title={m.name} style={swatch(m.color, m.opacity)} onClick={() => pick(m)} />
        ))}
        <button type="button" class="paint-swatch paint-eraser" aria-pressed={data.brush === 'erase'} aria-label="Gomme : la face reprend la matière de sa pièce" title="Gomme" onClick={() => c.setBrush(data.brush === 'erase' ? null : 'erase')}>
          <Icon name="trash" />
        </button>
      </div>
      <select
        class="select"
        aria-label="Peindre avec une autre matière"
        value=""
        onChange={(e) => {
          const m = others.find((x) => x.id === (e.target as HTMLSelectElement).value);
          if (m) c.setBrush(m);
        }}
      >
        <option value="">Autre matière…</option>
        {others.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <span class="field-help">
        {data.brush === null
          ? 'Choisissez une matière, puis touchez les faces à peindre dans la vue.'
          : data.brush === 'erase'
            ? 'Touchez une face pour lui rendre la matière de sa pièce. Échap pour terminer.'
            : `Touchez les faces à peindre en ${chosen?.name ?? 'cette matière'}. Échap, ou la même couleur, pour terminer.`}
      </span>
    </div>
  );
}

/** Formulaire d'une fiche du projet : chaque changement est une étape annulable. */
function SheetEditor({ sheet, uses }: { sheet: MaterialSheet; uses: number }) {
  const c = useController();
  const [name, setName] = useState(sheet.name);
  const save = (patch: Partial<MaterialSheet>) => {
    const next: MaterialSheet = { ...sheet, ...patch };
    if (next.process !== 'laser') delete next.thickness;
    else next.thickness ??= 3;
    if (next.opacity === 1) delete next.opacity;
    if (next.finish === 'satin') delete next.finish;
    if (!next.edge || next.process !== 'laser') delete next.edge;
    c.updateProjectSheet(next);
  };
  return (
    <div class="sheet-editor" aria-label={`Fiche « ${sheet.name} »`} role="group">
      <label class="field">
        <span class="field-label">Nom</span>
        <div class="input-with-unit">
          <input
            type="text"
            aria-label="Nom de la matière"
            value={name}
            maxLength={60}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onBlur={() => name.trim() && save({ name: name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && save({ name: name.trim() })}
          />
        </div>
      </label>
      <div class="sheet-row">
        <label class="field">
          <span class="field-label">Couleur</span>
          <input type="color" aria-label="Couleur de la matière" value={sheet.color} onChange={(e) => save({ color: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field grow">
          <span class="field-label">Procédé</span>
          <select class="select" aria-label="Procédé" value={sheet.process} onChange={(e) => save({ process: (e.target as HTMLSelectElement).value as MaterialSheet['process'] })}>
            {MAKE_PROCESSES.map((p) => (
              <option key={p} value={p}>
                {PROCESS_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label class="field">
        <span class="field-label">Aspect</span>
        <select class="select" aria-label="Aspect de la matière" value={sheet.finish ?? 'satin'} onChange={(e) => save({ finish: (e.target as HTMLSelectElement).value as MaterialFinish })}>
          {FINISHES.map((f) => (
            <option key={f} value={f}>
              {FINISH_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        <span class="field-label">Matière de base (masse, simulation)</span>
        <select class="select" aria-label="Matière de base" value={sheet.base} onChange={(e) => save({ base: (e.target as HTMLSelectElement).value })}>
          {PART_MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        <span class="field-label">Transparence : {sheet.opacity && sheet.opacity < 1 ? `${Math.round((1 - sheet.opacity) * 100)} %` : 'opaque'}</span>
        <input type="range" aria-label="Opacité" min={0.2} max={1} step={0.05} value={sheet.opacity ?? 1} onChange={(e) => save({ opacity: Number((e.target as HTMLInputElement).value) })} />
      </label>
      {sheet.process === 'laser' ? (
        <div class="sheet-row">
          <label class="field">
            <span class="field-label">Chants</span>
            <input type="color" aria-label="Couleur des chants" value={sheet.edge ?? sheet.color} onChange={(e) => save({ edge: (e.target as HTMLInputElement).value })} />
          </label>
          <span class="field-help grow">
            Couleur des tranches après la découpe : brûlées pour le bois.{' '}
            {sheet.edge ? (
              <button type="button" class="tl-link" onClick={() => save({ edge: undefined })}>
                comme la plaque
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {sheet.process === 'laser' ? (
        <label class="field">
          <span class="field-label">Épaisseur de la plaque (mm)</span>
          <input
            class="select"
            type="number"
            aria-label="Épaisseur de la plaque"
            min={0.5}
            step={0.5}
            value={sheet.thickness ?? 3}
            onChange={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              if (v > 0) save({ thickness: v });
            }}
          />
        </label>
      ) : null}
      <div class="sheet-actions">
        <Button small icon="save" onClick={() => c.keepSheetInCatalogue(sheet)}>
          Garder dans mon catalogue
        </Button>
        <Button small icon="trash" variant="danger" onClick={() => c.removeProjectSheet(sheet.id)}>
          {`Retirer de ${uses > 1 ? `ses ${uses} pièces` : 'sa pièce'}`}
        </Button>
      </div>
    </div>
  );
}

/** Panneau de droite : fiches du projet et catalogue personnel. */
export function MaterialsRightPanel() {
  const c = useController();
  const data = useAppState(
    (s) => ({ project: s.doc.materials ?? [], mine: s.materialCatalogue, uses: Object.fromEntries((s.doc.materials ?? []).map((m) => [m.id, s.doc.parts.filter((p) => p.make === m.id || p.paint?.faces.some((f) => f.material === m.id) || engraveColors(p).some((e) => e.material === m.id)).length])), open: s.openSheet }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const open = data.open;
  const setOpen = (id: string | null) => c.setOpenSheet(id);
  const current = data.project.find((m) => m.id === open) ?? null;
  return (
    <aside class="panel right-panel" aria-label="Matières du projet">
      <div class="panel-title">
        <Icon name="material" />
        <span>Matières du projet</span>
      </div>
      <div class="panel-content">
        <p class="vocab">
          <strong>Matière</strong> : ce dans quoi la pièce est fabriquée, et comment (impression 3D, découpe laser…). Sa couleur se voit dans tous les ateliers avec Affichage › « Matières réelles ».
        </p>
        {data.project.length === 0 ? <p class="empty-hint">Aucune matière pour l’instant : choisissez-en une pour chaque pièce, à gauche. Ici apparaissent celles que le projet utilise.</p> : null}
        <ul class="sheet-list" aria-label="Fiches du projet">
          {data.project.map((m) => (
            <li key={m.id}>
              <button type="button" class="sheet-item" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                <span class="color-swatch" style={{ ...swatch(m.color, m.opacity), width: '20px', height: '20px' }} />
                <span class="sheet-item-text">
                  <strong>{m.name}</strong>
                  <span>
                    {sheetSummary(m)} · {data.uses[m.id] ?? 0} pièce{(data.uses[m.id] ?? 0) > 1 ? 's' : ''}
                  </span>
                </span>
              </button>
              {open === m.id && current ? <SheetEditor key={`${m.id}:${m.name}`} sheet={current} uses={data.uses[m.id] ?? 0} /> : null}
            </li>
          ))}
        </ul>
        <div class="field">
          <span class="field-label">Mon catalogue (sur cet appareil)</span>
          {data.mine.length === 0 ? <p class="field-help">Vide : « Garder dans mon catalogue » sur une fiche la rend disponible dans vos autres projets.</p> : null}
          <ul class="sheet-list" aria-label="Mon catalogue">
            {data.mine.map((m) => (
              <li key={m.id} class="sheet-item static">
                <span class="color-swatch" style={{ ...swatch(m.color, m.opacity), width: '20px', height: '20px' }} />
                <span class="sheet-item-text">
                  <strong>{m.name}</strong>
                  <span>{sheetSummary(m)}</span>
                </span>
                <button type="button" class="tl-link" aria-label={`Retirer « ${m.name} » de mon catalogue`} onClick={() => c.removeSheetFromCatalogue(m.id)}>
                  retirer
                </button>
              </li>
            ))}
          </ul>
          <div class="segmented">
            <Button small icon="import" onClick={() => void c.importCatalogue()}>
              Importer…
            </Button>
            <Button small icon="export" onClick={() => void c.exportCatalogue()}>
              Exporter…
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Bouton du ruban : jongler entre les matières réelles et les couleurs de conception (CAO). */
export function MaterialsToggle({ id }: { id: string }) {
  const c = useController();
  const on = useAppState((s) => s.colorMode === 'materials');
  return (
    <ToolButton
      id={id}
      icon="material"
      label="Matières"
      hint={on ? 'Matières réelles affichées : cliquer pour les couleurs de conception (CAO), qui distinguent mieux les pièces' : 'Couleurs de conception (CAO) : cliquer pour voir les pièces dans leurs matières réelles'}
      pressed={on}
      onClick={() => c.setColorMode(on ? 'design' : 'materials')}
    />
  );
}
