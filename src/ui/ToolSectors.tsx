import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Availability } from '../app/availability';
import { ToolButton } from './components/controls';
import { Icon } from './icons';

/** Un outil d'un secteur : bouton dans la barre, ligne dans le menu quand le secteur se regroupe. */
export type SectorTool = {
  key: string;
  id: string;
  menuId: string;
  icon: string;
  label: string;
  hint?: string;
  /** Texte de la ligne du menu (à défaut : l'aide). */
  desc?: string;
  shortcut?: string;
  availability?: Availability;
  pressed?: boolean;
  suggested?: boolean;
  /** Reste sorti quand le secteur se regroupe. */
  main?: boolean;
  onClick: () => void;
};

/** Groupe d'outils encadré et titré (sans regroupement). */
export function ToolGroup({ name, children }: { name: string; children: ComponentChildren }) {
  return (
    <div class="toolbar-group sector" role="group" aria-label={name}>
      <div class="sector-tools">{children}</div>
      <div class="sector-name" aria-hidden="true">
        {name}
      </div>
    </div>
  );
}

/**
 * Secteur de la barre d'outils : un cadre titré qui rassemble des outils voisins, tous sortis.
 * Quand la place manque, `useToolbarFit` (TopBar) pose `is-grouped` : les outils secondaires
 * passent dans le menu ▾ ; puis `is-folded` : le secteur tient en un bouton (le dernier outil
 * utilisé) et son menu. `fold` : ordre de regroupement, le plus petit se regroupe en premier.
 */
export function Sector({ name, title, fold, tools }: { name: string; title: string; fold: number; tools: SectorTool[] }) {
  const [open, setOpen] = useState<'extra' | 'all' | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(null);
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
  if (!tools.length) return null;
  const extras = tools.filter((t) => !t.main);
  const use = (t: SectorTool) => {
    setLast(t.key);
    t.onClick();
  };
  // Bouton du secteur regroupé : l'outil actif, sinon le dernier utilisé, sinon le premier.
  const pick = (list: SectorTool[]) => list.find((t) => t.pressed) ?? list.find((t) => t.key === last) ?? list[0]!;
  const pickButton = (t: SectorTool, cls: string) => (
    <span class={cls}>
      <ToolButton icon={t.icon} label={t.label} hint={t.hint} shortcut={t.shortcut} availability={t.availability} pressed={t.pressed} onClick={() => use(t)} />
    </span>
  );
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div class="toolbar-group sector" role="group" aria-label={name} data-fold={fold} ref={root}>
      <div class="sector-tools">
        {tools.map((t) => (
          <span key={t.key} class={t.main ? 'sector-main' : 'sector-extra'}>
            <ToolButton
              id={t.id}
              icon={t.icon}
              label={t.label}
              hint={t.hint}
              shortcut={t.shortcut}
              availability={t.availability}
              pressed={t.pressed}
              suggested={t.suggested}
              onClick={() => use(t)}
            />
          </span>
        ))}
        {tools.length > 1 ? (
          <div class="anchor tool-split sector-split">
            {extras.length ? pickButton(pick(extras), 'sector-pick-extra') : null}
            {pickButton(pick(tools), 'sector-pick-all')}
            <button
              type="button"
              class="split-toggle"
              aria-haspopup="menu"
              aria-expanded={!!open}
              aria-label={`Autres outils : ${title}`}
              title={`Autres outils : ${title}`}
              onClick={() => setOpen(open ? null : root.current?.classList.contains('is-folded') ? 'all' : 'extra')}
            >
              <Icon name="chevron-down" />
            </button>
            {open ? (
              <div class="menu menu-wide" role="menu" aria-label={title} onKeyDown={onMenuKey}>
                {(open === 'all' ? tools : extras).map((t) => {
                  const ok = !t.availability || t.availability.ok;
                  const desc = t.availability && !t.availability.ok ? t.availability.reason : (t.desc ?? t.hint);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="menuitem"
                      id={t.menuId}
                      class="menu-item"
                      aria-disabled={ok ? undefined : 'true'}
                      aria-current={t.pressed ? 'true' : undefined}
                      title={desc}
                      onClick={() => {
                        setOpen(null);
                        use(t);
                      }}
                    >
                      <Icon name={t.icon} />
                      <span class="menu-text">
                        <strong>{t.label}</strong>
                        {desc ? <span class="desc">{desc}</span> : null}
                      </span>
                      {t.shortcut ? <span class="shortcut">{t.shortcut}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div class="sector-name" aria-hidden="true">
        {name}
      </div>
    </div>
  );
}
