import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { exportAvailability, measureAvailability, sketchAvailability, toolAvailability, toolFeatureTypes } from '../app/availability';
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
import { AssemblyTools, WorkspaceTabs } from './AssemblyUi';
import { FabricationTools } from './FabricationUi';
import { SimulationTools } from './SimulationUi';
import { Sector, type SectorTool } from './ToolSectors';

function FileMenu() {
  const c = useController();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const exportOk = useAppState((s) => exportAvailability(s).ok);
  const canImport = useAppState((s) => allows(s.level, 'import-step'));
  const tutorialOn = useAppState((s) => s.tutorial !== null);
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
      <button type="button" class="tool-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Fichier : nouveau, ouvrir, enregistrer, importer, exporter ; parcours guidés, aide, préférences">
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
          {canImport ? item('import', 'Importer un fichier (STEP, STL)…', () => void c.importStep()) : null}
          {item('export', 'Exporter… (STEP, 3MF, STL, GLB)', () => c.showExportDialog(), undefined, !exportOk)}
          <div class="menu-sep" role="separator" />
          {item('graduation', tutorialOn ? 'Fermer le parcours guidé' : 'Parcours guidés…', () => (tutorialOn ? c.closeTutorial() : c.startTutorial()))}
          {item('help', 'Aide', () => c.toggleHelp(), 'F1')}
          {item('settings', 'Préférences…', () => c.setDialog({ kind: 'preferences' }))}
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
    <div class="toolbar-group history-group">
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

/**
 * Secteurs de l'onglet Pièces. `main` : outils qui restent sortis quand le secteur se regroupe ;
 * `fold` : ordre de regroupement quand la place manque (le plus petit d'abord).
 */
const PART_SECTORS: { name: string; title: string; fold: number; types: FeatureType[]; main: FeatureType[] }[] = [
  { name: 'Esquisse', title: 'esquisse, plans et axes de construction', fold: 3, types: ['plane', 'axis'], main: [] },
  { name: 'Ajouter', title: 'ajouter de la matière', fold: 5, types: ['extrude', 'revolve', 'loft', 'sweep', 'thicken', 'primitive', 'gear'], main: ['extrude', 'primitive'] },
  { name: 'Enlever', title: 'enlever de la matière', fold: 4, types: ['pocket', 'hole', 'split'], main: ['pocket', 'hole'] },
  { name: 'Modifier', title: 'arrondis, chanfreins, coques et dépouilles', fold: 2, types: ['fillet', 'chamfer', 'shell', 'draft'], main: ['fillet', 'chamfer'] },
  { name: 'Répéter', title: 'répétitions, symétries et déplacements', fold: 1, types: ['pattern', 'mirror', 'move'], main: ['pattern', 'mirror'] },
  { name: 'Tôle', title: 'tôlerie et pliage : tôle, bords pliés, plis', fold: 0, types: ['sheet', 'flange', 'fold'], main: ['sheet'] },
];

function ModelTools() {
  const c = useController();
  const level = useAppState((s) => s.level);
  const types = toolFeatureTypes().filter((t) => allows(level, `feature:${t}`));
  const a = useAppState(
    (s) => ({
      sketch: sketchAvailability(s),
      tools: types.map((t) => toolAvailability(s, t)),
      measure: measureAvailability(s),
      flat: !!s.display[s.activePartId]?.result.flat,
      unfolded: s.unfolded,
      selectedSketch: s.selection?.kind === 'feature' && s.doc.parts.some((p) => p.features.some((f) => f.id === (s.selection as { featureId: string }).featureId && f.type === 'sketch')),
      planarFace: s.selection?.kind === 'face',
    }),
    (x, y) => JSON.stringify(x) === JSON.stringify(y),
  );
  const tool = (t: FeatureType, main: boolean): SectorTool => {
    const def = FEATURE_DEFINITIONS[t];
    const availability = a.tools[types.indexOf(t)]!;
    return {
      key: t,
      id: `tool-${t}`,
      menuId: `tool-menu-${t}`,
      icon: def.icon,
      label: def.label,
      hint: def.explanation,
      availability,
      suggested: t === types[0] && a.selectedSketch && availability.ok,
      main,
      onClick: () => c.startFeature(t),
    };
  };
  // Un outil absent des secteurs (fonction ajoutée depuis) va dans « Modifier ».
  const placed = new Set(PART_SECTORS.flatMap((s) => s.types));
  const sectors = PART_SECTORS.map((s) => ({
    ...s,
    types: [...s.types, ...(s.name === 'Modifier' ? types.filter((t) => t !== 'sketch' && !placed.has(t)) : [])].filter((t) => types.includes(t)),
  }));
  const sketch: SectorTool = {
    key: 'sketch',
    id: 'tool-sketch',
    menuId: 'tool-menu-sketch',
    icon: 'sketch',
    label: 'Esquisse',
    hint: a.planarFace ? 'Nouvelle esquisse sur la face sélectionnée' : 'Nouvelle esquisse : choisir un plan puis dessiner',
    availability: a.sketch,
    main: true,
    onClick: () => c.startSketch(),
  };
  // Tôlerie : montrer la pièce pliée à plat (développé), avec ses lignes de pli.
  const unfold: SectorTool = {
    key: 'unfold',
    id: 'tool-unfold',
    menuId: 'tool-menu-unfold',
    icon: 'unfold',
    label: 'Déplier',
    hint: 'Déplier : voir la tôle à plat (son développé), avec les lignes de pli, telle qu’elle sera découpée',
    pressed: a.unfolded,
    availability: a.flat || a.unfolded ? { ok: true } : { ok: false, reason: 'La pièce active n’a pas encore de pli : ajoutez un bord plié ou un pli à une tôle.' },
    main: false,
    onClick: () => c.toggleUnfolded(),
  };
  return (
    <>
      {sectors.map((s) => (
        <Sector
          key={s.name}
          name={s.name}
          title={s.title}
          fold={s.fold}
          tools={[...(s.name === 'Esquisse' ? [sketch] : []), ...s.types.map((t) => tool(t, s.main.includes(t))), ...(s.name === 'Tôle' && s.types.length ? [unfold] : [])]}
        />
      ))}
      <div class="toolbar-group secondary" role="group" aria-label="Mesurer">
        <div class="sector-tools">
          <ToolButton id="tool-measure" icon="measure" label="Mesurer" hint="Mesurer une arête, une face ou une distance" availability={a.measure} onClick={() => c.startMeasure()} />
        </div>
        <div class="sector-name" aria-hidden="true">
          Contrôler
        </div>
      </div>
    </>
  );
}

/** Outils de l'esquisse, par secteur (`main` : restent sortis quand le secteur se regroupe). */
const SKETCH_SECTORS: { name: string; title: string; fold: number; tools: { tool: SketchTool; icon: string; key?: string; main?: boolean }[] }[] = [
  {
    name: 'Dessiner',
    title: 'tracer des points, traits, rectangles, cercles et courbes',
    fold: 3,
    tools: [
      { tool: 'select', icon: 'select', key: 'Échap', main: true },
      { tool: 'point', icon: 'point' },
      { tool: 'line', icon: 'line', key: 'L', main: true },
      { tool: 'rectangle', icon: 'rectangle', key: 'R', main: true },
      { tool: 'centerRectangle', icon: 'center-rectangle', key: 'Maj+R' },
      { tool: 'polygon', icon: 'polygon' },
      { tool: 'circle', icon: 'circle', key: 'C', main: true },
      { tool: 'arc', icon: 'arc', key: 'A' },
      { tool: 'slot', icon: 'slot' },
      { tool: 'ellipse', icon: 'ellipse' },
      { tool: 'spline', icon: 'spline' },
    ],
  },
  {
    name: 'Contraindre',
    title: 'cotes et contraintes',
    fold: 1,
    tools: [
      { tool: 'dimension', icon: 'dimension', key: 'D', main: true },
      { tool: 'coincident', icon: 'coincident', key: 'O', main: true },
      { tool: 'horizontal', icon: 'horizontal', key: 'H', main: true },
      { tool: 'vertical', icon: 'vertical', key: 'V', main: true },
      { tool: 'parallel', icon: 'parallel' },
      { tool: 'perpendicular', icon: 'perpendicular' },
      { tool: 'equal', icon: 'equal' },
      { tool: 'collinear', icon: 'collinear' },
      { tool: 'tangent', icon: 'tangent' },
      { tool: 'pointOn', icon: 'point-on' },
      { tool: 'midpoint', icon: 'midpoint' },
      { tool: 'concentric', icon: 'concentric' },
    ],
  },
];

/** Aide courte d'un outil (la partie après « Nom : »). */
const shortHelp = (tool: SketchTool) => {
  const text = TOOL_HELP[tool].split(' : ').slice(1).join(' : ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

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
  const sketchTool = (t: { tool: SketchTool; icon: string; key?: string; main?: boolean }): SectorTool => ({
    key: t.tool,
    id: `sk-${t.tool}`,
    menuId: `sk-menu-${t.tool}`,
    icon: t.icon,
    label: TOOL_LABELS[t.tool],
    hint: TOOL_HELP[t.tool],
    desc: shortHelp(t.tool),
    ...(t.key ? { shortcut: t.key } : {}),
    pressed: s.tool === t.tool,
    main: !!t.main,
    onClick: () => c.updateSession((x) => setTool(x, t.tool)),
  });
  const edit = ([
    { ...sketchTool({ tool: 'trim', icon: 'trim', key: 'T', main: true }) },
    { ...sketchTool({ tool: 'offset', icon: 'offset' }) },
    ...(allows(level, 'sketch-construction')
      ? [
          {
            key: 'construction',
            id: 'sk-construction',
            menuId: 'sk-menu-construction',
            icon: 'construction',
            label: 'Construction',
            shortcut: 'G',
            hint: 'Traits de construction (pointillés) : des repères pour coter, ignorés pour le volume. Avec des éléments sélectionnés : les convertit.',
            pressed: s.construction,
            main: true,
            onClick: () => c.updateSession(toggleConstruction),
          },
        ]
      : []),
    {
      ...sketchTool({ tool: 'project', icon: 'project', key: 'P' }),
      hint: 'Reprendre une arête de la pièce (bord, trou…) dans l’esquisse comme repère',
      desc: 'Reprendre une arête de la pièce dans l’esquisse comme repère',
      availability: s.canProject ? { ok: true } : { ok: false, reason: 'Aucune arête de la pièce à reprendre : il faut un volume construit avant cette esquisse.' },
    },
    {
      key: 'delete',
      id: 'sk-delete',
      menuId: 'sk-menu-delete',
      icon: 'trash',
      label: 'Supprimer',
      shortcut: 'Suppr',
      hint: 'Supprimer les éléments sélectionnés',
      availability: s.selection ? { ok: true } : { ok: false, reason: 'Sélectionnez d’abord un élément ou une cote (outil Sélection).' },
      main: true,
      onClick: () => c.updateSession(deleteSelection),
    },
  ] as SectorTool[]).filter((t) => t.key === 'construction' || t.key === 'delete' || allows(level, `sketch:${t.key as SketchTool}`));
  return (
    <>
      {SKETCH_SECTORS.map((sec) => (
        <Sector key={sec.name} name={sec.name} title={sec.title} fold={sec.fold} tools={sec.tools.filter((t) => allows(level, `sketch:${t.tool}`)).map(sketchTool)} />
      ))}
      <Sector name="Modifier" title="couper, décaler, construction, projeter et supprimer" fold={2} tools={edit} />
    </>
  );
}

/**
 * Compactage automatique de la barre (voir app.css, « Barre d'outils : compactage automatique ») :
 * la barre est mesurée à chaque changement de taille ou de contenu ; tant qu'elle déborde, on
 * passe à l'étape suivante : Annuler et Rétablir en icônes, puis les secteurs se regroupent un à
 * un (outils secondaires dans leur menu), puis se replient un à un en un bouton, puis les outils
 * passent en icônes seules (les noms restent tant que possible) ; en dernier recours, les derniers groupes vont dans le tiroir « Plus ».
 * Les mesures modifient directement les attributs (pas d'état Preact : pas de boucle).
 */
function useToolbarFit(bar: { current: HTMLElement | null }, nav: { current: HTMLElement | null }, expanded: boolean) {
  useLayoutEffect(() => {
    const el = bar.current;
    const tools = nav.current;
    if (!el || !tools || expanded) return;
    let frame = 0;
    const overflowing = () => el.scrollWidth > el.clientWidth + 1;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      const groups = Array.from(tools.querySelectorAll<HTMLElement>(':scope > .toolbar-group'));
      groups.forEach((g) => g.classList.remove('is-overflow', 'is-grouped', 'is-folded'));
      delete el.dataset.overflow;
      delete el.dataset.compact;
      if (!overflowing()) return;
      const sectors = groups.filter((g) => g.dataset.fold).sort((x, y) => Number(x.dataset.fold) - Number(y.dataset.fold));
      const steps: (() => void)[] = [
        () => (el.dataset.compact = '1'),
        ...sectors.filter((g) => g.querySelector('.sector-extra')).map((g) => () => g.classList.add('is-grouped')),
        ...sectors.filter((g) => g.querySelector('.sector-split')).map((g) => () => g.classList.add('is-folded')),
        () => (el.dataset.compact = '2'),
        () => (el.dataset.compact = '3'),
        () => (el.dataset.compact = '4'),
      ];
      for (const step of steps) {
        step();
        if (!overflowing()) return;
      }
      // Toujours trop large : les derniers groupes passent dans le tiroir « Plus » (le premier reste).
      el.dataset.overflow = '1';
      for (let i = groups.length - 1; i >= 1 && overflowing(); i--) groups[i]!.classList.add('is-overflow');
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    fit();
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    // Le contenu change avec l'onglet, l'opération en cours, le niveau…
    const mutation = new MutationObserver(schedule);
    mutation.observe(tools, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [expanded]);
}

export function TopBar() {
  const c = useController();
  const barRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<{ width: number } | null>(null);
  useToolbarFit(barRef, navRef, !!expanded);
  const close = () => setExpanded(null);
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!navRef.current?.contains(t) && !(t as Element).closest?.('.toolbar-more, .menu')) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [!!expanded]);
  const mode = useAppState((s) => s.mode.kind);
  const workspace = useAppState((s) => s.workspace);
  const tutorialOn = useAppState((s) => s.tutorial !== null);
  const level = useAppState((s) => s.level);
  const leftShown = useAppState((s) => (window.matchMedia('(max-width: 980px)').matches ? s.leftPanelOpen : !s.leftPanelHidden));
  return (
    <header class="app-header">
      {/* Rang du haut : projet et onglets des ateliers ; rang du dessous : les outils de l'atelier. */}
      <div class="header-row">
        <IconButton
          icon="panel"
          label="Afficher ou masquer le panneau des pièces"
          pressed={leftShown}
          onClick={() => c.toggleLeftPanel(undefined, window.matchMedia('(max-width: 980px)').matches)}
        />
        <div class="brand">
          {/* Logo provisoire (cube) : le chat n'est plus le logo, seulement une mascotte facultative. */}
          <img class="brand-mark" src="icons/icon.svg" alt="" width={26} height={26} />
          <span>{APP_NAME}</span>
        </div>
        <FileMenu />
        <ProjectName />
        <WorkspaceTabs />
        <div class="spacer" />
        {/* Raccourcis pour débuter : Parcours (Débutant) et Aide (Débutant, Intermédiaire) ; tous deux restent dans le menu Fichier. */}
        {level === 'debutant' ? (
          <IconButton icon="graduation" label="Parcours guidés : la plaque percée, l’assemblage, la fabrication" pressed={tutorialOn} onClick={() => (tutorialOn ? c.closeTutorial() : c.startTutorial())} />
        ) : null}
        {level !== 'expert' ? <IconButton icon="help" label="Aide (F1) : commandes de navigation et vocabulaire" onClick={() => c.toggleHelp()} /> : null}
      </div>
      <div class="topbar" ref={barRef}>
      {expanded ? <div class="toolbar-placeholder" style={{ width: `${expanded.width}px` }} /> : null}
      <nav
        class={`toolbar${expanded ? ' is-expanded' : ''}`}
        aria-label="Outils"
        ref={navRef}
        onClick={(e) => {
          // Tiroir ouvert : il se referme après un outil (pas après l'ouverture d'un menu).
          const button = (e.target as Element).closest('button');
          if (expanded && button && !button.hasAttribute('aria-haspopup')) close();
        }}
      >
        <UndoRedo />
        {mode === 'sketch' ? <SketchTools /> : workspace === 'assembly' ? <AssemblyTools /> : workspace === 'fabrication' ? <FabricationTools /> : workspace === 'simulation' ? <SimulationTools /> : <ModelTools />}
      </nav>
      <button
        type="button"
        class="tool-btn toolbar-more"
        aria-expanded={!!expanded}
        aria-label="Plus d’outils"
        title="Plus d’outils : la barre est trop étroite pour tous les montrer"
        onClick={() => (expanded ? close() : setExpanded({ width: navRef.current?.offsetWidth ?? 0 }))}
      >
        <Icon name="more" />
        <span>Plus</span>
      </button>
      </div>
    </header>
  );
}
