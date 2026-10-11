import { useEffect, useRef, useState } from 'preact/hooks';
import { exportAvailability, measureAvailability, sketchAvailability, toolAvailability, toolFeatureTypes, type Availability } from '../app/availability';
import { FEATURE_DEFINITIONS } from '../features/registry';
import { allows } from '../app/levels';
import type { FeatureType } from '../domain/model';
import { shallowEqual } from '../app/store';
import { nextRedoLabel, nextUndoLabel } from '../commands/history';
import { APP_NAME } from '../meta';
import {
  redo as sketchRedo,
  setTool,
  toggleConstruction,
  undo as sketchUndo,
  deleteSelection,
  TOOL_HELP,
  TOOL_LABELS,
  type SketchTool,
} from '../sketch/session';
import { useAppState, useController } from './context';
import { IconButton, ToolButton } from './components/controls';
import { Icon } from './icons';
import { CatFigure } from './Mascot';
import { AssemblyTools, WorkspaceTabs } from './AssemblyUi';
import { FabricationTools } from './FabricationUi';

function FileMenu() {
  const c = useController();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const exportOk = useAppState((s) => exportAvailability(s).ok);
  const canImport = useAppState((s) => allows(s.level, 'import-step'));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    root.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const item = (icon: string, label: string, action: () => void, shortcut?: string, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      class="menu-item"
      aria-disabled={disabled ? 'true' : undefined}
      onClick={() => {
        setOpen(false);
        action();
      }}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {shortcut ? <span class="shortcut">{shortcut}</span> : null}
    </button>
  );
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div class="anchor" ref={root}>
      <button type="button" class="tool-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Fichier : nouveau, ouvrir, enregistrer, importer, exporter">
        <Icon name="menu" />
        <span>Fichier</span>
      </button>
      {open ? (
        <div class="menu" role="menu" aria-label="Fichier" onKeyDown={onMenuKey}>
          {item('new', 'Nouveau projet', () => c.newProject())}
          {item('open', 'Ouvrir…', () => void c.showOpenDialog(), 'Ctrl+O')}
          {item('save', 'Enregistrer', () => void c.save(), 'Ctrl+S')}
          {item('export', 'Enregistrer sous… (fichier)', () => void c.saveAs(), 'Ctrl+Maj+S')}
          <div class="menu-sep" role="separator" />
          {canImport ? item('import', 'Importer un fichier STEP…', () => void c.importStep()) : null}
          {item('export', 'Exporter en STEP (FreeCAD)…', () => c.showExportDialog('step'), undefined, !exportOk)}
          {item('print3d', 'Exporter en 3MF (impression 3D)…', () => c.showExportDialog('3mf'), undefined, !exportOk)}
          {item('stl', 'Exporter en STL (impression 3D)…', () => c.showExportDialog('stl'), undefined, !exportOk)}
          <div class="menu-sep" role="separator" />
          {item('info', 'À propos et licences', () => c.setDialog({ kind: 'about' }))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectName() {
  const c = useController();
  const name = useAppState((s) => s.doc.name);
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  return (
    <input
      class="project-name"
      aria-label="Nom du projet"
      title="Nom du projet (cliquez pour le modifier)"
      value={text}
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onBlur={() => (text.trim() ? c.renameProject(text) : setText(name))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(name);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function UndoRedo() {
  const c = useController();
  const s = useAppState(
    (st) => ({
      mode: st.mode.kind,
      undo: st.mode.kind === 'sketch' ? (st.mode.session.undo.length ? 'dernière action de l’esquisse' : null) : nextUndoLabel(st.history),
      redo: st.mode.kind === 'sketch' ? (st.mode.session.redo.length ? 'action de l’esquisse' : null) : nextRedoLabel(st.history),
    }),
    shallowEqual,
  );
  const blocked = s.mode !== 'model' && s.mode !== 'sketch';
  return (
    <div class="toolbar-group">
      <ToolButton
        icon="undo"
        label="Annuler"
        shortcut="Ctrl+Z"
        hint={s.undo ? `Annuler : ${s.undo}` : 'Rien à annuler'}
        availability={blocked ? { ok: false, reason: 'Terminez d’abord l’opération en cours.' } : s.undo ? { ok: true } : { ok: false, reason: 'Rien à annuler pour le moment.' }}
        onClick={() => (s.mode === 'sketch' ? c.updateSession(sketchUndo) : c.undo())}
      />
      <ToolButton
        icon="redo"
        label="Rétablir"
        shortcut="Ctrl+Y"
        hint={s.redo ? `Rétablir : ${s.redo}` : 'Rien à rétablir'}
        availability={blocked ? { ok: false, reason: 'Terminez d’abord l’opération en cours.' } : s.redo ? { ok: true } : { ok: false, reason: 'Rien à rétablir.' }}
        onClick={() => (s.mode === 'sketch' ? c.updateSession(sketchRedo) : c.redo())}
      />
    </div>
  );
}

function ModelTools() {
  const c = useController();
  const level = useAppState((s) => s.level);
  const types = toolFeatureTypes().filter((t) => allows(level, `feature:${t}`));
  const a = useAppState(
    (s) => ({
      sketch: sketchAvailability(s),
      tools: types.map((t) => toolAvailability(s, t)),
      measure: measureAvailability(s),
      importOk: s.mode.kind === 'model' ? ({ ok: true } as Availability) : ({ ok: false, reason: 'Terminez d’abord l’opération en cours.' } as Availability),
      selectedSketch: s.selection?.kind === 'feature' && s.doc.parts.some((p) => p.features.some((f) => f.id === (s.selection as { featureId: string }).featureId && f.type === 'sketch')),
      planarFace: s.selection?.kind === 'face',
    }),
    (x, y) => JSON.stringify(x) === JSON.stringify(y),
  );
  return (
    <>
      <div class="toolbar-group" role="group" aria-label="Créer">
        <ToolButton
          id="tool-sketch"
          icon="sketch"
          label="Esquisse"
          hint={a.planarFace ? 'Nouvelle esquisse sur la face sélectionnée' : 'Nouvelle esquisse : choisir un plan puis dessiner'}
          availability={a.sketch}
          onClick={() => c.startSketch()}
        />
        {types.map((t, i) => {
          const def = FEATURE_DEFINITIONS[t];
          const group = FEATURE_GROUPS.find((g) => g.types.includes(t));
          if (group) {
            // Un seul bouton par groupe, à la place du premier de ses membres.
            if (types.find((x) => group.types.includes(x)) !== t) return null;
            // Dans l'ordre du groupe : le premier outil est celui montré par défaut.
            const members = group.types.flatMap((x) => {
              const k = types.indexOf(x);
              return k >= 0 ? [{ type: x, availability: a.tools[k]! }] : [];
            });
            return <FeatureSplit key={group.name} name={group.name} members={members} />;
          }
          return (
            <ToolButton
              key={t}
              id={`tool-${t}`}
              icon={def.icon}
              label={def.label}
              hint={def.explanation}
              availability={a.tools[i]}
              suggested={i === 0 && a.selectedSketch && a.tools[i]!.ok}
              onClick={() => c.startFeature(t)}
            />
          );
        })}
      </div>
      <div class="toolbar-group" role="group" aria-label="Pièces">
        <ToolButton id="tool-new-part" icon="part" label="Pièce" hint="Ajouter une nouvelle pièce indépendante" availability={a.importOk} onClick={() => c.addPart()} />
        <ToolButton id="tool-export" icon="export" label="STEP" hint="Exporter en STEP pour FreeCAD" availability={a.importOk} onClick={() => c.showExportDialog('step')} />
      </div>
      <div class="toolbar-group" role="group" aria-label="Outils">
        <ToolButton id="tool-measure" icon="measure" label="Mesurer" hint="Mesurer une arête, une face ou une distance" availability={a.measure} onClick={() => c.startMeasure()} />
      </div>
    </>
  );
}

const SKETCH_TOOLS: { tool: SketchTool; icon: string; key?: string }[] = [
  { tool: 'select', icon: 'select', key: 'Échap' },
  { tool: 'line', icon: 'line', key: 'L' },
];

type ToolVariant = { tool: SketchTool; icon: string; key: string; label: string };

/** Variantes regroupées sous un même bouton (le bouton garde la dernière variante choisie). */
const RECTANGLE_VARIANTS: ToolVariant[] = [
  { tool: 'rectangle', icon: 'rectangle', key: 'R', label: 'Rectangle par deux coins' },
  { tool: 'centerRectangle', icon: 'center-rectangle', key: 'Maj+R', label: 'Rectangle par le centre' },
  { tool: 'polygon', icon: 'polygon', key: '', label: 'Polygone régulier (centre et sommet)' },
];
const CIRCLE_VARIANTS: ToolVariant[] = [
  { tool: 'circle', icon: 'circle', key: 'C', label: 'Cercle (centre et bord)' },
  { tool: 'arc', icon: 'arc', key: 'A', label: 'Arc de cercle (centre, départ, arrivée)' },
  { tool: 'slot', icon: 'slot', key: '', label: 'Oblong (rainure arrondie aux deux bouts)' },
];

/** Fonctions voisines regroupées sous un bouton à menu (la barre reste sur une ligne). */
const FEATURE_GROUPS: { name: string; types: FeatureType[] }[] = [
  { name: 'révolutions, lissages et balayages', types: ['revolve', 'loft', 'sweep'] },
  { name: 'arrondis, chanfreins, coques et dépouilles', types: ['fillet', 'chamfer', 'shell', 'draft'] },
  { name: 'répétitions, symétries et découpes', types: ['pattern', 'mirror', 'split'] },
];

/** Bouton d'une fonction du groupe (la dernière utilisée) et menu des autres. */
function FeatureSplit({ name, members }: { name: string; members: { type: FeatureType; availability: Availability }[] }) {
  const c = useController();
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(members[0]!.type);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    root.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const shown = members.find((m) => m.type === last) ?? members[0]!;
  const def = FEATURE_DEFINITIONS[shown.type];
  if (members.length === 1) {
    return <ToolButton id={`tool-${shown.type}`} icon={def.icon} label={def.label} hint={def.explanation} availability={shown.availability} onClick={() => c.startFeature(shown.type)} />;
  }
  return (
    <div class="anchor tool-split" ref={root}>
      <ToolButton id={`tool-${shown.type}`} icon={def.icon} label={def.label} hint={def.explanation} availability={shown.availability} onClick={() => c.startFeature(shown.type)} />
      <button type="button" class="split-toggle" aria-haspopup="menu" aria-expanded={open} aria-label={`Autres outils : ${name}`} title={`Autres outils : ${name}`} onClick={() => setOpen(!open)}>
        <Icon name="chevron-down" />
      </button>
      {open ? (
        <div class="menu menu-wide" role="menu" aria-label={name}>
          {members.map((m) => {
            const d = FEATURE_DEFINITIONS[m.type];
            return (
              <button
                key={m.type}
                type="button"
                role="menuitem"
                id={`tool-menu-${m.type}`}
                class="menu-item"
                aria-disabled={m.availability.ok ? undefined : 'true'}
                title={m.availability.ok ? d.explanation : m.availability.reason}
                onClick={() => {
                  setOpen(false);
                  setLast(m.type);
                  c.startFeature(m.type);
                }}
              >
                <Icon name={d.icon} />
                <span class="menu-text">
                  <strong>{d.label}</strong>
                  <span class="desc">{m.availability.ok ? d.explanation : m.availability.reason}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ToolVariants({ variants: all, tool, name }: { variants: ToolVariant[]; tool: SketchTool; name: string }) {
  const c = useController();
  const level = useAppState((s) => s.level);
  const variants = all.filter((v) => allows(level, `sketch:${v.tool}`));
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(variants[0]!.tool);
  const root = useRef<HTMLDivElement>(null);
  const activeVariant = variants.find((v) => v.tool === tool);
  useEffect(() => {
    if (activeVariant) setLast(activeVariant.tool);
  }, [activeVariant?.tool]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    root.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  if (variants.length === 1) {
    const v = variants[0]!;
    return (
      <ToolButton id={`sk-${v.tool}`} icon={v.icon} label={TOOL_LABELS[v.tool]} shortcut={v.key} pressed={tool === v.tool} onClick={() => c.updateSession((x) => setTool(x, v.tool))} />
    );
  }
  const shown = activeVariant ?? variants.find((v) => v.tool === last) ?? variants[0]!;
  return (
    <div class="anchor tool-split" ref={root}>
      <ToolButton
        id={`sk-${shown.tool}`}
        icon={shown.icon}
        label={TOOL_LABELS[shown.tool]}
        shortcut={shown.key}
        pressed={!!activeVariant}
        onClick={() => c.updateSession((x) => setTool(x, shown.tool))}
      />
      <button
        type="button"
        class="split-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Autres façons de tracer : ${name}`}
        title={`Autres façons de tracer : ${name}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevron-down" />
      </button>
      {open ? (
        <div class="menu menu-wide" role="menu" aria-label={name}>
          {variants.map((v) => (
            <button
              key={v.tool}
              type="button"
              role="menuitem"
              id={`sk-menu-${v.tool}`}
              class="menu-item"
              aria-current={v.tool === tool ? 'true' : undefined}
              onClick={() => {
                setOpen(false);
                setLast(v.tool);
                c.updateSession((x) => setTool(x, v.tool));
              }}
            >
              <Icon name={v.icon} />
              <span class="menu-text">
                <strong>{v.label}</strong>
                <span class="desc">{shortHelp(v.tool)}</span>
              </span>
              <span class="shortcut">{v.key}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const MAIN_CONSTRAINT_TOOLS: { tool: SketchTool; icon: string; key?: string }[] = [
  { tool: 'dimension', icon: 'dimension', key: 'D' },
  { tool: 'coincident', icon: 'coincident', key: 'O' },
  { tool: 'horizontal', icon: 'horizontal', key: 'H' },
  { tool: 'vertical', icon: 'vertical', key: 'V' },
];

/** Contraintes moins fréquentes, regroupées dans le menu « Contraintes ». */
const MORE_CONSTRAINTS: { tool: SketchTool; icon: string }[] = [
  { tool: 'parallel', icon: 'parallel' },
  { tool: 'perpendicular', icon: 'perpendicular' },
  { tool: 'equal', icon: 'equal' },
  { tool: 'collinear', icon: 'collinear' },
  { tool: 'tangent', icon: 'tangent' },
  { tool: 'pointOn', icon: 'point-on' },
  { tool: 'midpoint', icon: 'midpoint' },
  { tool: 'concentric', icon: 'concentric' },
];

/** Aide courte d'un outil (la partie après « Nom : »). */
const shortHelp = (tool: SketchTool) => {
  const text = TOOL_HELP[tool].split(' : ').slice(1).join(' : ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function ConstraintMenu({ tool }: { tool: SketchTool }) {
  const c = useController();
  const level = useAppState((s) => s.level);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    root.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const active = MORE_CONSTRAINTS.find((t) => t.tool === tool);
  const item = (t: { tool: SketchTool; icon: string; key?: string }, id: string) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      id={id}
      class="menu-item"
      aria-current={t.tool === tool ? 'true' : undefined}
      onClick={() => {
        setOpen(false);
        c.updateSession((x) => setTool(x, t.tool));
      }}
    >
      <Icon name={t.icon} />
      <span class="menu-text">
        <strong>{TOOL_LABELS[t.tool]}</strong>
        <span class="desc">{shortHelp(t.tool)}</span>
      </span>
      {t.key ? <span class="shortcut">{t.key}</span> : null}
    </button>
  );
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div class="anchor" ref={root}>
      <button
        type="button"
        id="sk-more-constraints"
        class="tool-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={!!active}
        title="Toutes les contraintes : celles de la barre (cote, coïncidence, horizontal, vertical) et les autres (parallèle, perpendiculaire, égalité, colinéaire, tangence, point sur, milieu, concentrique)"
        onClick={() => setOpen(!open)}
      >
        <Icon name={active?.icon ?? 'constraints'} />
        <span>
          {active ? TOOL_LABELS[active.tool] : 'Autres'} <span aria-hidden="true">▾</span>
        </span>
      </button>
      {open ? (
        <div class="menu menu-wide menu-end" role="menu" aria-label="Toutes les contraintes" onKeyDown={onMenuKey}>
          {/* Les contraintes de la barre sont reprises ici : on les trouve aussi en cherchant dans le menu. */}
          <div class="menu-section" role="presentation">
            Aussi dans la barre
          </div>
          {MAIN_CONSTRAINT_TOOLS.map((t) => item(t, `sk-menu-${t.tool}`))}
          <div class="menu-section" role="presentation">
            Autres contraintes
          </div>
          {MORE_CONSTRAINTS.filter((t) => allows(level, `sketch:${t.tool}`)).map((t) => item(t, `sk-${t.tool}`))}
        </div>
      ) : null}
    </div>
  );
}

function SketchTools() {
  const c = useController();
  const level = useAppState((st) => st.level);
  const s = useAppState(
    (st) =>
      st.mode.kind === 'sketch'
        ? {
            tool: st.mode.session.tool,
            selection: st.mode.session.selection.length,
            construction: st.mode.session.construction,
            canProject: st.mode.session.projectable.length > 0,
          }
        : null,
    (x, y) => JSON.stringify(x) === JSON.stringify(y),
  );
  if (!s) return null;
  const btn = (t: { tool: SketchTool; icon: string; key?: string }) => (
    <ToolButton
      key={t.tool}
      id={`sk-${t.tool}`}
      icon={t.icon}
      label={TOOL_LABELS[t.tool]}
      {...(t.key ? { shortcut: t.key } : {})}
      pressed={s.tool === t.tool}
      onClick={() => c.updateSession((x) => setTool(x, t.tool))}
    />
  );
  return (
    <>
      <div class="toolbar-group" role="group" aria-label="Dessiner">
        {SKETCH_TOOLS.map(btn)}
        <ToolVariants variants={RECTANGLE_VARIANTS} tool={s.tool} name="rectangles" />
        <ToolVariants variants={CIRCLE_VARIANTS} tool={s.tool} name="cercles et arcs" />
        {allows(level, 'sketch:trim') ? (
          <ToolButton
            id="sk-trim"
            icon="trim"
            label="Couper"
            shortcut="T"
            hint="Couper : retirer le morceau d’un trait jusqu’aux croisements les plus proches"
            pressed={s.tool === 'trim'}
            onClick={() => c.updateSession((x) => setTool(x, 'trim'))}
          />
        ) : null}
        {allows(level, 'sketch-construction') ? (
          <ToolButton
            id="sk-construction"
            icon="construction"
            label="Construction"
            shortcut="G"
            hint="Traits de construction (pointillés) : des repères pour coter, ignorés pour le volume. Avec des éléments sélectionnés : les convertit."
            pressed={s.construction}
            onClick={() => c.updateSession(toggleConstruction)}
          />
        ) : null}
        {allows(level, 'sketch:project') ? (
          <ToolButton
            id="sk-project"
            icon="project"
            label="Projeter"
            shortcut="P"
            hint="Reprendre une arête de la pièce (bord, trou…) dans l’esquisse comme repère"
            pressed={s.tool === 'project'}
            availability={s.canProject ? { ok: true } : { ok: false, reason: 'Aucune arête de la pièce à reprendre : il faut un volume construit avant cette esquisse.' }}
            onClick={() => c.updateSession((x) => setTool(x, 'project'))}
          />
        ) : null}
      </div>
      <div class="toolbar-group" role="group" aria-label="Coter et contraindre">
        {MAIN_CONSTRAINT_TOOLS.map(btn)}
        {MORE_CONSTRAINTS.some((t) => allows(level, `sketch:${t.tool}`)) ? <ConstraintMenu tool={s.tool} /> : null}
      </div>
      <div class="toolbar-group" role="group" aria-label="Édition">
        <ToolButton
          icon="trash"
          label="Supprimer"
          shortcut="Suppr"
          availability={s.selection ? { ok: true } : { ok: false, reason: 'Sélectionnez d’abord un élément ou une cote (outil Sélection).' }}
          onClick={() => c.updateSession(deleteSelection)}
        />
      </div>
    </>
  );
}

export function TopBar() {
  const c = useController();
  const mode = useAppState((s) => s.mode.kind);
  const workspace = useAppState((s) => s.workspace);
  const tutorialOn = useAppState((s) => s.tutorial !== null);
  const leftShown = useAppState((s) => (window.matchMedia('(max-width: 980px)').matches ? s.leftPanelOpen : !s.leftPanelHidden));
  return (
    <header class="topbar">
      <IconButton
        icon="panel"
        label="Afficher ou masquer le panneau des pièces"
        pressed={leftShown}
        onClick={() => c.toggleLeftPanel(undefined, window.matchMedia('(max-width: 980px)').matches)}
      />
      <div class="brand">
        <CatFigure decorative class="brand-mark" size={34} />
        <span>{APP_NAME}</span>
      </div>
      <FileMenu />
      <ProjectName />
      {mode === 'model' || mode === 'joint' || mode === 'pick-fab-face' ? <WorkspaceTabs /> : null}
      <nav class="toolbar" aria-label="Outils">
        <UndoRedo />
        {mode === 'sketch' ? <SketchTools /> : workspace === 'assembly' ? <AssemblyTools /> : workspace === 'fabrication' ? <FabricationTools /> : <ModelTools />}
      </nav>
      <div class="spacer" />
      <ToolButton icon="graduation" label="Parcours" hint="Parcours guidés : la plaque percée, l’assemblage, la fabrication" pressed={tutorialOn} onClick={() => (tutorialOn ? c.closeTutorial() : c.startTutorial())} />
      <ToolButton icon="help" label="Aide" shortcut="F1" hint="Aide : commandes de navigation et vocabulaire" onClick={() => c.toggleHelp()} />
    </header>
  );
}
