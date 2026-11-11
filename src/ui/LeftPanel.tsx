import { allows } from '../app/levels';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AssemblyInstance, Feature, Id, Part, PartFolder, SubAssembly } from '../domain/model';
import type { FeatureStatus } from '../domain/status';
import { definitionOf, featureSummary } from '../features/registry';
import { activeCount } from '../app/rollback';
import { useAppState, useController } from './context';
import { AssemblySection } from './AssemblyUi';
import { FabricationSection } from './FabricationUi';
import { SimulationSection } from './SimulationUi';
import { ParametersSection } from './ParametersUi';
import { Button, IconButton } from './components/controls';
import { Icon } from './icons';

function InlineRename(props: { value: string; label: string; onDone: (value: string | null) => void }) {
  const [text, setText] = useState(props.value);
  const ref = useRef<HTMLInputElement>(null);
  // Avant l'affichage : une frappe juste après l'ouverture va bien dans le champ.
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      class="rename-input"
      aria-label={props.label}
      value={text}
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') props.onDone(text);
        if (e.key === 'Escape') props.onDone(null);
      }}
      onBlur={() => props.onDone(text)}
    />
  );
}

/**
 * Sections repliables du panneau (Pièces, Historique) : repliées, elles ne montrent que l'élément
 * choisi. L'état est gardé d'un atelier à l'autre (le panneau est recréé en changeant d'atelier).
 */
const folded = { parts: false, history: false };
function useFolded(key: keyof typeof folded): [boolean, () => void] {
  const [value, setValue] = useState(folded[key]);
  return [
    value,
    () => {
      folded[key] = !value;
      setValue(!value);
    },
  ];
}

/** Dossiers repliés (gardé d'un atelier à l'autre, pas enregistré dans le projet). */
const closedFolders = new Set<Id>();
const NO_FOLDERS: PartFolder[] = [];
const NO_ENSEMBLES: SubAssembly[] = [];

/** Hauteur choisie pour la liste des pièces (poignée) ; null : plafond par défaut de la feuille de style. */
let partsHeight: number | null = null;

/** Menu d'une pièce (bouton « ⋯ » ou clic droit) : affiché hors du panneau, qui rogne ce qui dépasse. */
function PartMenu(props: { x: number; y: number; label: string; items: { icon: string; label: string; shortcut?: string; sep?: boolean; action: () => void }[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    // Garde le menu dans la fenêtre (au-dessus du point d'appel s'il n'y a pas la place dessous).
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(props.x, window.innerWidth - r.width - 4)),
      top: props.y + r.height > window.innerHeight - 4 ? Math.max(4, props.y - r.height) : props.y,
    });
    const onDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    el.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return createPortal(
    <div class="menu part-menu" role="menu" aria-label={props.label} ref={root} style={{ left: `${pos.left}px`, top: `${pos.top}px` }} onKeyDown={onMenuKey}>
      {props.items.flatMap((it, i) => [
        it.sep && i > 0 ? <div key={`sep-${it.label}`} class="menu-sep" role="separator" /> : null,
        <button
          key={it.label}
          type="button"
          role="menuitem"
          class="menu-item"
          onClick={() => {
            props.onClose();
            it.action();
          }}
        >
          <Icon name={it.icon} />
          <span>{it.label}</span>
          {it.shortcut ? <span class="shortcut">{it.shortcut}</span> : null}
        </button>,
      ])}
    </div>,
    document.body,
  );
}

function PartsSection() {
  const c = useController();
  // Liste retirée (changement d'atelier) pendant un survol : la vue ne reste pas estompée.
  useEffect(() => () => c.setHoverPart(null), []);
  const parts = useAppState((s) => s.doc.parts);
  const activePartId = useAppState((s) => s.activePartId);
  const busy = useAppState((s) => s.mode.kind !== 'model');
  const isolatedId = useAppState((s) => (s.isolatedPartId && s.doc.parts.some((p) => p.id === s.isolatedPartId) ? s.isolatedPartId : null));
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [menu, setMenu] = useState<{ id: Id; x: number; y: number } | null>(null);
  const isolated = parts.find((p) => p.id === isolatedId);
  const [fold, toggleFold] = useFolded('parts');
  const shown = fold ? parts.filter((p) => p.id === activePartId) : parts;
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [height, setHeight] = useState(partsHeight);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setOverflow(el.scrollHeight > el.clientHeight + 1);
  });
  // La pièce active reste en vue (choisie dans la vue 3D, liste longue).
  useEffect(() => {
    listRef.current?.querySelector('.part-row.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [activePartId]);
  const resize = (e: PointerEvent) => {
    const section = sectionRef.current;
    const panel = section?.parentElement;
    if (!section || !panel) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const top = section.getBoundingClientRect().top;
    const max = panel.getBoundingClientRect().bottom - 160 - top;
    const onMove = (ev: PointerEvent) => {
      partsHeight = Math.round(Math.max(96, Math.min(ev.clientY - top, max)));
      setHeight(partsHeight);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };
  const folders = useAppState((s) => s.doc.folders ?? NO_FOLDERS);
  // Ensembles : les sous-assemblages (hors de l'onglet Assemblage, aucun n'est ouvert).
  const ensembles = useAppState((s) => (s.doc.editingSubassembly ? NO_ENSEMBLES : (s.doc.subassemblies ?? NO_ENSEMBLES)));
  const mainAssembly = useAppState((s) => (s.doc.editingSubassembly ? undefined : s.doc.assembly));
  const canEnsemble = useAppState((s) => allows(s.level, 'workspace:assembly'));
  /** Nombre d'exemplaires de chaque pièce dans l'assemblage (copies liées, blocs comptés). */
  const copies = new Map<Id, number>();
  const countIn = (instances: readonly AssemblyInstance[], times: number, depth = 0) => {
    if (depth > 8) return;
    for (const i of instances) {
      if (!i.subassemblyId) copies.set(i.partId, (copies.get(i.partId) ?? 0) + times);
      else countIn(ensembles.find((e) => e.id === i.subassemblyId)?.instances ?? [], times, depth + 1);
    }
  };
  countIn(mainAssembly?.instances ?? [], 1);
  const ensembleOfPart = (p: Part): Id | null => ensembles.find((e) => e.instances.some((i) => i.partId === p.id && !i.subassemblyId))?.id ?? null;
  /** Ligne sous laquelle la pièce est rangée : son ensemble, sinon son dossier, sinon aucune (''). */
  const groupOf = (p: Part): Id | '' => ensembleOfPart(p) ?? (p.folder && folders.some((f) => f.id === p.folder) ? p.folder : '');
  /** Dépose d'une pièce sur une ligne (ensemble, dossier) ou hors de tout groupe (''). */
  const dropPart = (partId: Id, target: Id | '') => {
    const part = parts.find((p) => p.id === partId);
    if (!part) return;
    const from = ensembleOfPart(part);
    if (ensembles.some((e) => e.id === target)) return c.movePartToEnsemble(partId, target);
    if (from) c.movePartToEnsemble(partId, null);
    if (target || !from) c.movePartToFolder(partId, target || null);
  };
  const [closedCount, setClosedCount] = useState(0);
  void closedCount;
  const toggleFolder = (id: Id, open?: boolean) => {
    const isClosed = closedFolders.has(id);
    if (open === undefined ? isClosed : open) closedFolders.delete(id);
    else closedFolders.add(id);
    setClosedCount((n) => n + 1);
  };
  // Pièce choisie (dans la vue 3D) alors que son dossier est replié : on l'ouvre.
  useEffect(() => {
    const folder = parts.find((p) => p.id === activePartId)?.folder;
    if (folder && closedFolders.has(folder)) toggleFolder(folder, true);
  }, [activePartId]);
  // Glisser une pièce sur un dossier (souris) ; au doigt : « Ranger dans… » du menu.
  const dragId = useRef<Id | null>(null);
  const [dropOn, setDropOn] = useState<Id | '' | null>(null);
  const dropTarget = (e: DragEvent): Id | '' => ((e.target as Element).closest?.('li[data-folder]') as HTMLElement | null)?.dataset.folder ?? '';
  const partRow = (p: Part) => {
            const hidden = isolatedId ? p.id !== isolatedId : !p.visible;
            return (
              <li
                key={p.id}
                data-folder={groupOf(p)}
                draggable={renaming !== p.id && folders.length + ensembles.length > 0}
                onDragStart={(e) => {
                  dragId.current = p.id;
                  e.dataTransfer?.setData('text/plain', p.name);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  setDropOn(null);
                }}
                class={`part-row${p.id === activePartId ? ' is-active' : ''}${hidden ? ' is-hidden' : ''}${menu?.id === p.id ? ' has-menu' : ''}${groupOf(p) && !fold ? ' in-folder' : ''}`}
                onPointerEnter={() => c.setHoverPart(p.id)}
                onPointerLeave={() => c.setHoverPart(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: p.id, x: e.clientX, y: e.clientY });
                }}
              >
                <label class="color-swatch" style={{ background: p.color }} title={`Couleur de « ${p.name} »`}>
                  <input
                    type="color"
                    value={p.color}
                    aria-label={`Couleur de la pièce « ${p.name} »`}
                    onChange={(e) => c.setPartColor(p.id, (e.target as HTMLInputElement).value)}
                  />
                </label>
                {renaming === p.id ? (
                  <InlineRename
                    value={p.name}
                    label="Nouveau nom de la pièce"
                    onDone={(v) => {
                      setRenaming(null);
                      if (v !== null) c.renamePart(p.id, v);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    class={`part-select${hidden ? ' is-hidden' : ''}`}
                    aria-pressed={p.id === activePartId}
                    title={p.id === activePartId ? 'Pièce active : les nouvelles étapes lui sont ajoutées' : 'Rendre cette pièce active'}
                    onClick={() => c.setActivePart(p.id)}
                    onDblClick={() => setRenaming(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'F2') {
                        e.preventDefault();
                        setRenaming(p.id);
                      } else if (e.key === 'Delete') {
                        e.preventDefault();
                        c.deletePart(p.id);
                      }
                    }}
                  >
                    <span class="name">{p.name}</span>
                    {(copies.get(p.id) ?? 0) > 1 ? (
                      <span class="copies" title={`${copies.get(p.id)} exemplaires dans l’assemblage`}>
                        ×{copies.get(p.id)}
                      </span>
                    ) : null}
                    {p.visible ? null : <span class="visually-hidden"> (masquée)</span>}
                    {p.id === activePartId ? <span class="visually-hidden"> (pièce active)</span> : null}
                  </button>
                )}
                <span class="row-actions">
                  {parts.length > 1 ? (
                    <span class={`on-demand${p.id === isolatedId ? ' is-on' : ''}`}>
                      <IconButton
                        icon="isolate"
                        label={p.id === isolatedId ? 'Réafficher toutes les pièces' : `Isoler « ${p.name} » (masquer les autres pièces)`}
                        small
                        pressed={p.id === isolatedId}
                        onClick={() => c.toggleIsolate(p.id)}
                      />
                    </span>
                  ) : null}
                  <span class="on-demand">
                    <IconButton
                      icon="more"
                      label={`Autres actions sur « ${p.name} »`}
                      small
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenu(menu?.id === p.id ? null : { id: p.id, x: r.left, y: r.bottom + 4 });
                      }}
                    />
                  </span>
                  <span class={`eye${p.visible ? '' : ' is-on'}`}>
                    <IconButton icon={p.visible ? 'eye' : 'eye-off'} label={p.visible ? `Masquer « ${p.name} »` : `Afficher « ${p.name} »`} small onClick={() => c.togglePartVisible(p.id)} />
                  </span>
                </span>
              </li>
            );
  };
  const groupRow = (g: { kind: 'ensemble' | 'folder'; id: Id; name: string }, inside: Part[]) => {
    const closed = closedFolders.has(g.id);
    const allHidden = inside.length > 0 && inside.every((p) => !p.visible);
    return [
      <li
        key={g.id}
        data-folder={g.id}
        class={`folder-row${g.kind === 'ensemble' ? ' is-ensemble' : ''}${dropOn === g.id ? ' is-drop' : ''}${menu?.id === g.id ? ' has-menu' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ id: g.id, x: e.clientX, y: e.clientY });
        }}
      >
        {renaming === g.id ? (
          <>
            <Icon name={g.kind === 'ensemble' ? 'group' : 'folder'} class="folder-icon" />
            <InlineRename
              value={g.name}
              label={g.kind === 'ensemble' ? 'Nouveau nom de l’ensemble' : 'Nouveau nom du dossier'}
              onDone={(v) => {
                setRenaming(null);
                if (v !== null) (g.kind === 'ensemble' ? c.renameEnsemble(g.id, v) : c.renameFolder(g.id, v));
              }}
            />
          </>
        ) : (
          <button
            type="button"
            class="folder-toggle"
            aria-expanded={!closed}
            onClick={() => toggleFolder(g.id)}
            onDblClick={() => setRenaming(g.id)}
            onKeyDown={(e) => {
              if (e.key === 'F2') {
                e.preventDefault();
                setRenaming(g.id);
              }
            }}
          >
            <Icon name={closed ? 'chevron-right' : 'chevron-down'} class="folder-chevron" />
            <Icon name={g.kind === 'ensemble' ? 'group' : 'folder'} class="folder-icon" />
            <span class="name">{g.name}</span>
            <span class="folder-count">{inside.length}</span>
          </button>
        )}
        <span class="row-actions">
          <span class="on-demand">
            <IconButton
              icon="more"
              label={`Autres actions sur « ${g.name} »`}
              small
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenu(menu?.id === g.id ? null : { id: g.id, x: r.left, y: r.bottom + 4 });
              }}
            />
          </span>
          {inside.length > 0 ? (
            <span class={`eye${allHidden ? ' is-on' : ''}`}>
              <IconButton
                icon={allHidden ? 'eye-off' : 'eye'}
                label={inside.some((p) => !p.visible) ? `Afficher les pièces de « ${g.name} »` : `Masquer les pièces de « ${g.name} »`}
                small
                onClick={() => (g.kind === 'ensemble' ? c.toggleEnsembleVisible(g.id) : c.toggleFolderVisible(g.id))}
              />
            </span>
          ) : null}
        </span>
      </li>,
      ...(closed ? [] : inside.map(partRow)),
    ];
  };
  const menuPart = menu ? parts.find((p) => p.id === menu.id) : undefined;
  const menuEnsemble = menu ? ensembles.find((e) => e.id === menu.id) : undefined;
  const menuFolder = menu ? folders.find((f) => f.id === menu.id) : undefined;
  return (
    <section class={`panel-section parts-section${height !== null && !fold ? ' has-height' : ''}`} aria-labelledby="parts-title" ref={sectionRef} style={height !== null && !fold ? { maxHeight: `${height}px` } : undefined}>
      <div class="panel-header">
        <button
          type="button"
          class="section-toggle"
          aria-expanded={!fold}
          title={fold ? 'Montrer toutes les pièces' : 'Replier : ne montrer que la pièce choisie'}
          onClick={toggleFold}
        >
          <Icon name={fold ? 'chevron-right' : 'chevron-down'} />
          <span id="parts-title">Pièces</span>
          {parts.length > 1 ? <span class="count">{parts.length}</span> : null}
        </button>
        <span class="spacer" />
        <IconButton
          id="part-folder"
          icon="folder-plus"
          label="Nouveau dossier"
          small
          onClick={() => {
            if (fold) toggleFold();
            setRenaming(c.addFolder());
          }}
        />
        <IconButton
          id="part-component"
          icon="import"
          label={busy ? 'Insérer un composant (terminez d’abord l’opération en cours)' : 'Insérer un composant d’une bibliothèque (roulement, moteur, poulie…)'}
          small
          disabled={busy}
          onClick={() => c.openComponents()}
        />
        <IconButton
          id="part-add"
          icon="plus"
          label={busy ? 'Ajouter une pièce (terminez d’abord l’opération en cours)' : 'Ajouter une nouvelle pièce indépendante'}
          small
          disabled={busy}
          onClick={() => c.addPart()}
        />
      </div>
      <div class="panel-body">
        <ul
          class={`part-list${dropOn === '' ? ' is-drop' : ''}`}
          ref={listRef}
          onDragOver={(e) => {
            if (!dragId.current) return;
            e.preventDefault();
            const target = dropTarget(e);
            if (target !== dropOn) setDropOn(target);
          }}
          onDrop={(e) => {
            if (!dragId.current) return;
            e.preventDefault();
            const target = dropTarget(e);
            dropPart(dragId.current, target);
            if (target) toggleFolder(target, true);
            dragId.current = null;
            setDropOn(null);
          }}
        >
          {fold
            ? shown.map(partRow)
            : [
                ...ensembles.flatMap((e) => groupRow({ kind: 'ensemble', id: e.id, name: e.name }, parts.filter((p) => groupOf(p) === e.id))),
                ...folders.flatMap((f) => groupRow({ kind: 'folder', id: f.id, name: f.name }, parts.filter((p) => groupOf(p) === f.id))),
                ...parts.filter((p) => groupOf(p) === '').map(partRow),
              ]}
        </ul>
        {isolated ? (
          <div class="isolate-banner" role="status">
            <span>
              « {isolated.name} » est isolée : les autres pièces sont cachées.
            </span>
            <Button small icon="eye" onClick={() => c.toggleIsolate(isolated.id)}>
              Tout réafficher
            </Button>
          </div>
        ) : null}
      </div>
      {!fold && (overflow || height !== null) ? (
        <div
          class="parts-resize"
          role="separator"
          aria-orientation="horizontal"
          title="Glisser pour ajuster la hauteur de la liste (double-clic : hauteur par défaut)"
          onPointerDown={resize}
          onDblClick={() => {
            partsHeight = null;
            setHeight(null);
          }}
        />
      ) : null}
      {menu && menuPart ? (
        <PartMenu
          key={menu.id}
          x={menu.x}
          y={menu.y}
          label={`Actions sur « ${menuPart.name} »`}
          onClose={() => setMenu(null)}
          items={[
            { icon: 'rename', label: 'Renommer', shortcut: 'F2', action: () => setRenaming(menuPart.id) },
            ...(parts.length > 1
              ? [{ icon: 'isolate', label: menuPart.id === isolatedId ? 'Tout réafficher' : 'Isoler', action: () => c.toggleIsolate(menuPart.id) }]
              : []),
            ...(canEnsemble ? [{ icon: 'copy', label: 'Dupliquer (copie liée)', action: () => c.duplicatePart(menuPart.id) }] : []),
            ...folders
              .filter((f) => f.id !== groupOf(menuPart))
              .map((f, i) => ({ sep: i === 0, icon: 'folder', label: `Ranger dans « ${f.name} »`, action: () => dropPart(menuPart.id, f.id) })),
            { sep: folders.every((f) => f.id === groupOf(menuPart)), icon: 'folder-plus', label: 'Nouveau dossier', action: () => setRenaming(c.addFolder(menuPart.id)) },
            ...(canEnsemble
              ? [
                  ...ensembles
                    .filter((e) => e.id !== groupOf(menuPart))
                    .map((e, i) => ({ sep: i === 0, icon: 'group', label: `Mettre dans « ${e.name} »`, action: () => c.movePartToEnsemble(menuPart.id, e.id) })),
                  {
                    sep: ensembles.every((e) => e.id === groupOf(menuPart)),
                    icon: 'group',
                    label: 'Nouvel ensemble',
                    action: () => {
                      const id = c.createEnsemble(menuPart.id);
                      if (id) setRenaming(id);
                    },
                  },
                ]
              : []),
            ...(groupOf(menuPart) ? [{ sep: true, icon: 'chevron-right', label: ensembleOfPart(menuPart) ? 'Sortir de l’ensemble' : 'Sortir du dossier', action: () => dropPart(menuPart.id, '') }] : []),
            { sep: true, icon: 'trash', label: 'Supprimer', shortcut: 'Suppr', action: () => c.deletePart(menuPart.id) },
          ]}
        />
      ) : null}
      {menu && menuEnsemble ? (
        <PartMenu
          key={menu.id}
          x={menu.x}
          y={menu.y}
          label={`Actions sur l’ensemble « ${menuEnsemble.name} »`}
          onClose={() => setMenu(null)}
          items={[
            { icon: 'rename', label: 'Renommer', shortcut: 'F2', action: () => setRenaming(menuEnsemble.id) },
            { icon: 'copy', label: 'Dupliquer (copie liée)', action: () => c.duplicateEnsemble(menuEnsemble.id) },
            { icon: 'pivot', label: 'Ouvrir dans l’assemblage', action: () => c.openEnsemble(menuEnsemble.id) },
            { sep: true, icon: 'trash', label: 'Défaire l’ensemble', action: () => c.dissolveEnsemble(menuEnsemble.id) },
          ]}
        />
      ) : null}
      {menu && menuFolder ? (
        <PartMenu
          key={menu.id}
          x={menu.x}
          y={menu.y}
          label={`Actions sur le dossier « ${menuFolder.name} »`}
          onClose={() => setMenu(null)}
          items={[
            { icon: 'rename', label: 'Renommer', shortcut: 'F2', action: () => setRenaming(menuFolder.id) },
            { icon: 'trash', label: 'Supprimer le dossier', action: () => c.deleteFolder(menuFolder.id) },
          ]}
        />
      ) : null}
    </section>
  );
}

function StatusBadge({ status }: { status: FeatureStatus | undefined }) {
  if (!status || status.state === 'ok') return null;
  const map = {
    warning: { cls: 'status-warning', icon: 'warning', text: 'Attention' },
    error: { cls: 'status-error', icon: 'error', text: 'Erreur' },
    blocked: { cls: 'status-blocked', icon: 'blocked', text: 'En attente' },
  } as const;
  const m = map[status.state];
  return (
    <span class={`status-badge ${m.cls}`}>
      <Icon name={m.icon} />
      {m.text}
    </span>
  );
}

/**
 * Pastille à côté de l'icône d'une étape : orange pour une esquisse qui n'est pas entièrement
 * contrainte (degrés de liberté restants), rouge pour une erreur ou un défaut.
 */
function StatusDot({ status, dof }: { status: FeatureStatus | undefined; dof: number | null }) {
  let tone: 'error' | 'free' | null = null;
  let text = '';
  if (status?.state === 'error' || status?.state === 'warning') {
    tone = 'error';
    text = status.state === 'error' ? 'Erreur dans cette étape' : 'Défaut dans cette étape';
  } else if (dof !== null && dof > 0) {
    tone = 'free';
    text = `Esquisse pas entièrement contrainte : encore ${dof} degré${dof > 1 ? 's' : ''} de liberté`;
  }
  if (!tone) return null;
  return (
    <span class={`status-dot dot-${tone}`} title={text}>
      <span class="visually-hidden">{text}</span>
    </span>
  );
}

function IssueBox(props: { part: Part; feature: Feature; status: FeatureStatus }) {
  const c = useController();
  const { status, part } = props;
  const blocker = status.blockedBy ? part.features.find((f) => f.id === status.blockedBy) : undefined;
  const related = status.relatedFeatureId ? part.features.find((f) => f.id === status.relatedFeatureId) : undefined;
  const supportIssue = status.code === 'SUPPORT_LOST' || status.code === 'SUPPORT_AMBIGUOUS' || status.code === 'SUPPORT_NOT_PLANAR';
  return (
    <div class={`feature-issue ${status.state}`} role={status.state === 'error' ? 'alert' : undefined}>
      <div>
        {status.state === 'blocked' && blocker ? (
          <>
            Cette étape attend la correction de « <strong>{blocker.name}</strong> ».
          </>
        ) : (
          status.message
        )}
      </div>
      {status.detail ? (
        <details>
          <summary>Détail technique</summary>
          <code>{status.detail}</code>
        </details>
      ) : null}
      <div class="issue-actions">
        {supportIssue ? (
          <button type="button" class="btn btn-small btn-primary" onClick={() => c.repairSketch(props.feature.id)}>
            Choisir un nouveau support
          </button>
        ) : null}
        {related ? (
          <button type="button" class="btn btn-small btn-primary" onClick={() => c.editFeature(related.id)}>
            Modifier « {related.name} »
          </button>
        ) : null}
        {status.state === 'error' && !supportIssue && (props.feature.type === 'extrude' || props.feature.type === 'pocket' || props.feature.type === 'hole') ? (
          <button type="button" class="btn btn-small" onClick={() => c.editFeature(props.feature.id)}>
            Modifier les paramètres
          </button>
        ) : null}
        {status.state === 'error' ? (
          <button type="button" class="btn btn-small btn-ghost" onClick={() => c.undo()}>
            Annuler la dernière action
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HistorySection() {
  const c = useController();
  const part = useAppState((s) => s.doc.parts.find((p) => p.id === s.activePartId) ?? s.doc.parts[0]);
  const statuses = useAppState((s) => (part ? s.display[part.id]?.result.statuses : undefined));
  const sketchDof = useAppState(
    (s) => Object.fromEntries((part ? (s.display[part.id]?.result.sketches ?? []) : []).map((k) => [k.featureId, k.dof])) as Record<Id, number>,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const selection = useAppState((s) => s.selection);
  const draft = useAppState((s) => (s.mode.kind === 'feature' && s.mode.draft.isNew ? s.mode.draft.feature : null));
  const editingSketch = useAppState((s) => (s.mode.kind === 'sketch' ? s.mode.session.featureId : null));
  const rollback = useAppState((s) => s.rollback);
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [foldHistory, toggleFoldHistory] = useFolded('history');
  const list = useRef<HTMLOListElement>(null);
  if (!part) return null;
  const statusOf = (id: Id) => statuses?.find((st) => st.featureId === id);
  const active = activeCount(part, rollback);
  // Repliée : seule l'étape choisie (sinon l'esquisse en cours, sinon la dernière étape calculée).
  const selectedId = selection?.kind === 'feature' && part.features.some((f) => f.id === selection.featureId) ? selection.featureId : null;
  const shownId = foldHistory ? (selectedId ?? editingSketch ?? part.features[active - 1]?.id ?? null) : null;
  const draftRow = draft ? (
    <li key="draft-row">
      <div class="feature-row is-selected">
        <span class="feature-main">
          <Icon name={definitionOf(draft).icon} class="feature-icon" />
          <span class="feature-texts">
            <span class="name">{draft.name}</span>
            <span class="summary">aperçu</span>
          </span>
        </span>
      </div>
    </li>
  ) : null;
  const n = part.features.length;
  /** Nombre d'étapes actives pour une position verticale du pointeur (milieu des lignes d'étape). */
  const countAt = (clientY: number): number =>
    Array.from(list.current?.querySelectorAll<HTMLElement>(':scope > li[data-step]') ?? []).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 < clientY;
    }).length;
  const onMarkerKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowUp: active - 1, ArrowDown: active + 1, Home: 0, End: n };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    c.setRollback(part.id, to);
  };
  const rollbackMarker = (
    <li
      class={`rollback-marker${active < n ? ' is-rolled-back' : ''}`}
      key="rollback-marker"
      role="slider"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Barre de retour"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={active}
      aria-valuetext={active === n ? `Toutes les étapes (${n})` : `${active} étapes sur ${n}`}
      title="Glisser pour revenir dans l’historique (↑ ↓)"
      onKeyDown={onMarkerKey}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).focus();
        // La barre change de place dans la liste pendant le glissement (capture du pointeur perdue) :
        // le suivi se fait sur la fenêtre.
        const move = (ev: PointerEvent) => c.setRollback(part.id, countAt(ev.clientY));
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
          window.removeEventListener('pointercancel', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
      }}
    >
      <span class="rollback-line" aria-hidden="true" />
      {active < n ? (
        <span class="rollback-info">
          <span class="rollback-text">{n - active} non calculée{n - active > 1 ? 's' : ''}</span>
          <button type="button" class="tl-link" onClick={() => c.rollbackToEnd(part.id)}>
            Revenir à la fin
          </button>
        </span>
      ) : null}
    </li>
  );
  return (
    <section class="panel-section grow" aria-labelledby="history-title">
      <div class="panel-header">
        <button
          type="button"
          class="section-toggle"
          aria-expanded={!foldHistory}
          title={foldHistory ? 'Montrer toutes les étapes' : 'Replier : ne montrer que l’étape choisie'}
          onClick={toggleFoldHistory}
        >
          <Icon name={foldHistory ? 'chevron-right' : 'chevron-down'} />
          <span id="history-title" title={`Historique — ${part.name}`}>Historique — {part.name}</span>
          {part.features.length > 1 ? <span class="count">{part.features.length}</span> : null}
        </button>
      </div>
      <div class="panel-body">
        {part.features.length === 0 && !draft ? (
          <p class="empty-hint">
            Pièce vide.
          </p>
        ) : null}
        <ol class="feature-list" ref={list} aria-label={`Étapes de construction de ${part.name}`}>
          {active === 0 && part.features.length > 0 && !foldHistory ? [draftRow, rollbackMarker] : null}
          {part.features.flatMap((f, index) => {
            if (foldHistory && f.id !== shownId) return [];
            const after = index >= active;
            const status = after ? undefined : statusOf(f.id);
            const def = definitionOf(f);
            const selected = selection?.kind === 'feature' && selection.featureId === f.id;
            const row = (
              <li key={f.id} data-step>
                <div
                  class={`feature-row${selected || editingSketch === f.id ? ' is-selected' : ''}${status?.state === 'blocked' ? ' is-blocked' : ''}${after ? ' is-rolled-back' : ''}`}
                >
                  {renaming === f.id ? (
                    <InlineRename
                      value={f.name}
                      label="Nouveau nom de l’étape"
                      onDone={(v) => {
                        setRenaming(null);
                        if (v !== null) c.renameFeature(f.id, v);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      class="feature-main"
                      aria-pressed={selected}
                      title={`${def.explanation}\nDouble-cliquez pour modifier.`}
                      onClick={() => c.select({ kind: 'feature', partId: part.id, featureId: f.id })}
                      onDblClick={() => c.editFeature(f.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'F2') {
                          e.preventDefault();
                          setRenaming(f.id);
                        }
                      }}
                    >
                      <span class="feature-icon-wrap">
                        <Icon name={def.icon} class="feature-icon" />
                        {after ? null : <StatusDot status={status} dof={f.type === 'sketch' ? (sketchDof[f.id] ?? null) : null} />}
                      </span>
                      <span class="feature-texts">
                        <span class="name">{f.name}</span>
                        <span class="status-line">
                          {after ? <span class="status-badge status-rolled-back">Non calculée</span> : <StatusBadge status={status} />}
                          <span class="summary">{featureSummary(f)}</span>
                        </span>
                      </span>
                    </button>
                  )}
                  <span class="row-actions">
                    {f.type !== 'imported-solid' ? <IconButton icon="edit" label={`Modifier « ${f.name} »`} small onClick={() => c.editFeature(f.id)} /> : null}
                    {f.type === 'sketch' && f.params.support.kind === 'face' && f.params.support.context ? (
                      <IconButton
                        icon="pivot"
                        small
                        pressed={!!f.params.support.context.frozen}
                        label={f.params.support.context.frozen ? `Suivre de nouveau l’assemblage pour « ${f.name} »` : `Figer la place de la voisine pour « ${f.name} » (ne plus suivre l’assemblage)`}
                        onClick={() => c.toggleContextFrozen(f.id)}
                      />
                    ) : null}
                    {f.type === 'sketch' || f.type === 'image' ? (
                      <IconButton icon={f.visible ? 'eye' : 'eye-off'} label={f.visible ? `Masquer « ${f.name} »` : `Afficher « ${f.name} »`} small onClick={() => c.toggleSketchVisible(f.id)} />
                    ) : null}
                    <IconButton icon="trash" label={`Supprimer « ${f.name} »`} small onClick={() => c.deleteFeature(f.id)} />
                  </span>
                </div>
                {status && status.state !== 'ok' ? <IssueBox part={part} feature={f} status={status} /> : null}
              </li>
            );
            if (foldHistory) return [row];
            return index === active - 1 && active < part.features.length ? [row, draftRow, rollbackMarker] : [row];
          })}
          {active === part.features.length || foldHistory ? draftRow : null}
          {active === part.features.length && part.features.length > 0 && !foldHistory ? rollbackMarker : null}
        </ol>
      </div>
    </section>
  );
}

export function LeftPanel() {
  const workspace = useAppState((s) => s.workspace);
  const canParameters = useAppState((s) => allows(s.level, 'parameters'));
  return (
    <aside class="panel left-panel" aria-label={workspace === 'assembly' ? 'Assemblage' : workspace === 'simulation' ? 'Simulation' : 'Pièces et historique'}>
      {workspace === 'assembly' ? (
        <AssemblySection />
      ) : workspace === 'fabrication' ? (
        <FabricationSection />
      ) : workspace === 'simulation' ? (
        <SimulationSection />
      ) : (
        <>
          <PartsSection />
          {canParameters ? <ParametersSection /> : null}
          <HistorySection />
        </>
      )}
    </aside>
  );
}
