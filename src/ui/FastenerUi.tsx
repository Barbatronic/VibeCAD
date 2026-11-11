/**
 * Visserie de l'assemblage : menu « Visserie » (choix du type d'élément), groupe replié
 * « Visserie » de la liste de gauche (éléments identiques regroupés), réglages de l'élément choisi
 * (taille et longueur limitées à la norme et au trou). Voir docs/assemblage.md.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FASTENER_ISSUE_MESSAGES, fastenerGroups, holeOf, sizesForHole } from '../app/fasteners';
import { designation, FASTENER_TYPES, fastenerType, HOLES, INSERTS, lengthsOf, sizesOf, type FastenerKind, type MetricSize } from '../domain/fasteners';
import { formatNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { Button, Callout, IconButton } from './components/controls';
import { Icon } from './icons';

const mm = (v: number) => `${formatNumber(v, 2)} mm`;

/** Bouton « Visserie » de la barre d'outils : choisir le type d'élément à poser. */
export function FastenerMenu() {
  const c = useController();
  const active = useAppState((s) => (s.mode.kind === 'fastener' ? s.mode.fastenerKind : null));
  const count = useAppState((s) => s.doc.assembly?.instances.length ?? 0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    root.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  return (
    <div class="anchor" ref={root}>
      <button
        type="button"
        id="as-fastener"
        class="tool-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={!!active}
        aria-disabled={count ? undefined : 'true'}
        title={count ? 'Poser des vis, écrous, rondelles et inserts dans les trous des pièces' : 'Insérez d’abord une pièce percée.'}
        onClick={() => {
          if (!count) return c.explain('Insérez d’abord une pièce percée dans l’assemblage.');
          if (active) return c.cancelFastener();
          setOpen(!open);
        }}
      >
        <Icon name="screw" />
        <span>
          Visserie <span aria-hidden="true">▾</span>
        </span>
      </button>
      {open ? (
        <div class="menu" role="menu" aria-label="Élément de visserie à poser" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {FASTENER_TYPES.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="menuitem"
              class="menu-item"
              title={t.help}
              onClick={() => {
                setOpen(false);
                c.startFastener(t.kind);
              }}
            >
              <Icon name={`fastener-${t.kind}`} class="fastener-icon" />
              <span>{t.label}</span>
              <span class="shortcut">{t.standard}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Groupe replié « Visserie » de la liste de gauche (absent tant qu'il n'y a pas de visserie). */
export function FastenerList() {
  const c = useController();
  const data = useAppState(
    (s) => {
      const placement = c.fastenerPlacement();
      return {
        groups: fastenerGroups(s.doc.assembly).map((g) => ({ name: g.name, kind: g.kind, ids: g.ids, issue: g.ids.some((id) => placement?.issues.has(id)) })),
        sel: s.assemblySelection?.kind === 'fasteners' ? s.assemblySelection.ids : null,
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  if (data.groups.length === 0) return null;
  const total = data.groups.reduce((n, g) => n + g.ids.length, 0);
  const selected = (ids: string[]) => !!data.sel && data.sel.length === ids.length && ids.every((id) => data.sel!.includes(id));
  return (
    <details class="fastener-list" open={!!data.sel}>
      <summary>
        <Icon name="screw" />
        <span>Visserie</span>
        <span class="count">{total}</span>
        {data.groups.some((g) => g.issue) ? <span class="status-badge status-error">Souci</span> : null}
      </summary>
      <ul class="feature-list" aria-label="Visserie de l’assemblage">
        {data.groups.map((g) => (
          <li key={g.name}>
            <div class={`feature-row${selected(g.ids) ? ' is-selected' : ''}`}>
              <button type="button" class="feature-main" aria-pressed={selected(g.ids)} onClick={() => c.selectInAssembly({ kind: 'fasteners', ids: g.ids })}>
                <Icon name={`fastener-${g.kind}`} class="feature-icon" />
                <span class="feature-texts">
                  <span class="name">{g.name}</span>
                  <span class="status-line">
                    {g.issue ? <span class="status-badge status-error">Souci</span> : null}
                    <span class="summary">× {g.ids.length}</span>
                  </span>
                </span>
              </button>
              <span class="row-actions">
                <IconButton icon="trash" small label={`Supprimer ${g.ids.length > 1 ? `les ${g.ids.length} ` : ''}« ${g.name} »`} onClick={() => c.removeFasteners(g.ids)} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Panneau de droite pendant la pose. */
export function FastenerModePanel({ kind }: { kind: FastenerKind }) {
  const c = useController();
  const t = fastenerType(kind);
  return (
    <>
      <div class="panel-title">
        <Icon name={`fastener-${kind}`} />
        <span>Poser : {t.label}</span>
      </div>
      <div class="panel-content">
        <label class="field">
          <span class="field-label">Élément</span>
          <select id="fastener-kind" class="select" value={kind} onChange={(e) => c.startFastener((e.target as HTMLSelectElement).value as FastenerKind)}>
            {FASTENER_TYPES.map((x) => (
              <option key={x.kind} value={x.kind}>
                {x.label} ({x.standard})
              </option>
            ))}
          </select>
        </label>
        <ol class="steps">
          <li class="current">Bord d’un trou (la tête se pose de ce côté)</li>
          <li>Vis posée : rondelle sous la tête · bord de sortie : écrou</li>
        </ol>
        <p class="field-help">Taille déduite du diamètre du trou.</p>
      </div>
      <div class="panel-actions">
        <Button icon="check" variant="primary" onClick={() => c.cancelFastener()}>
          Terminé
        </Button>
      </div>
    </>
  );
}

/** Réglages d'un élément ou d'un groupe d'éléments identiques. */
export function FastenerPanel({ ids }: { ids: string[] }) {
  const c = useController();
  const data = useAppState(
    (s) => {
      const assembly = s.doc.assembly;
      const items = (assembly?.fasteners ?? []).filter((f) => ids.includes(f.id));
      const first = items[0];
      if (!assembly || !first) return null;
      const placement = c.fastenerPlacement();
      // Tailles possibles pour tous les trous du groupe.
      const holes = items.map((f) => {
        const inst = assembly.instances.find((i) => i.id === f.at.instanceId);
        const mesh = inst ? s.display[inst.partId]?.mesh : null;
        return { hole: mesh ? holeOf(mesh, f.at.edge) : null, part: inst?.name ?? '?' };
      });
      const sizesFor = (kind: FastenerKind) =>
        sizesOf(kind).filter((size) => holes.every((h) => h.hole && sizesForHole(kind, h.hole.diameter).some((m) => m.size === size)));
      const matches = holes[0]?.hole ? sizesForHole(first.kind, holes[0].hole.diameter) : [];
      return {
        kind: first.kind,
        size: first.size,
        length: first.length ?? null,
        flip: !!first.flip,
        count: items.length,
        name: designation(first.kind, first.size, first.length),
        hole: holes[0]?.hole ?? null,
        holeKind: matches.find((m) => m.size === first.size)?.hole ?? null,
        part: holes[0]?.part ?? '?',
        forced: items.some((f) => f.forced),
        // Tailles qui vont dans le trou d'abord ; les autres se choisissent en taille forcée.
        sizes: sizesFor(first.kind),
        otherSizes: sizesOf(first.kind).filter((size) => !sizesFor(first.kind).includes(size)),
        firstFit: Object.fromEntries(FASTENER_TYPES.map((t) => [t.kind, sizesFor(t.kind)[0] ?? null])),
        kinds: FASTENER_TYPES.map((t) => ({ kind: t.kind, label: `${t.label} (${t.standard})` })),
        issue: items.map((f) => placement?.issues.get(f.id)).find(Boolean) ?? null,
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  if (!data) return null;
  const t = fastenerType(data.kind);
  const lengths = lengthsOf(data.kind, data.size);
  const plural = data.count > 1;
  return (
    <>
      <div class="panel-title">
        <Icon name={`fastener-${data.kind}`} />
        <span>
          {data.name}
          {plural ? ` (× ${data.count})` : ''}
        </span>
      </div>
      <div class="panel-content">
        {data.issue ? <Callout kind="error">{FASTENER_ISSUE_MESSAGES[data.issue]}</Callout> : null}
        {data.issue === 'size' ? (
          <Button small icon="check" onClick={() => c.updateFasteners(ids, { size: data.size }, `Forcer la taille ${data.size}`)}>
            Garder {data.size} (taille forcée)
          </Button>
        ) : null}
        <label class="field">
          <span class="field-label">Élément</span>
          <select
            id="fastener-edit-kind"
            class="select"
            value={data.kind}
            onChange={(e) => {
              const kind = (e.target as HTMLSelectElement).value as FastenerKind;
              const size: MetricSize = sizesOf(kind).includes(data.size) ? data.size : (data.firstFit[kind] ?? sizesOf(kind)[0]!);
              c.updateFasteners(ids, { kind, size }, 'Changer le type de visserie');
            }}
          >
            {data.kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <div class="limits-row">
          <label class="mini-field">
            <span>Taille</span>
            <select id="fastener-size" class="select" value={data.size} onChange={(e) => c.updateFasteners(ids, { size: (e.target as HTMLSelectElement).value as MetricSize }, 'Changer la taille de visserie')}>
              {data.sizes.length > 0 && data.otherSizes.length > 0 ? (
                <>
                  <optgroup label="Adaptées au trou">
                    {data.sizes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Autres (taille forcée)">
                    {data.otherSizes.map((s) => (
                      <option key={s} value={s}>
                        {s} (forcée)
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                [...data.sizes, ...data.otherSizes].map((s) => (
                  <option key={s} value={s}>
                    {data.sizes.includes(s) ? s : `${s} (forcée)`}
                  </option>
                ))
              )}
            </select>
          </label>
          {t.screw ? (
            <label class="mini-field">
              <span>Longueur</span>
              <select id="fastener-length" class="select" value={String(data.length ?? '')} onChange={(e) => c.updateFasteners(ids, { length: Number((e.target as HTMLSelectElement).value) }, 'Changer la longueur de vis')}>
                {lengths.map((l) => (
                  <option key={l} value={String(l)}>
                    {l} mm
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {data.forced ? (
          <p class="field-help" id="fastener-forced">
            Taille forcée : elle ne correspond pas au diamètre du trou, mais elle est gardée telle quelle.
          </p>
        ) : null}
        {data.hole ? (
          <p class="field-help" id="fastener-hole">
            Trou de « {data.part} » : Ø {mm(data.hole.diameter)}
            {data.holeKind === 'insert' ? ` (insert ${data.size} : perçage conseillé ${mm(INSERTS[data.size]?.hole ?? 0)})` : data.holeKind === 'tapped' ? ` (à tarauder ${data.size})` : data.holeKind === 'clearance' ? ` (passage ${data.size} : ${mm(HOLES[data.size].fine)} à ${mm(HOLES[data.size].coarse)})` : ''}
            {data.hole.depth > 0 ? `, profondeur ${mm(data.hole.depth)}` : ''}.
          </p>
        ) : null}
        <label class="checkbox-row">
          <input type="checkbox" checked={data.flip} onChange={() => c.updateFasteners(ids, { flip: !data.flip }, 'Retourner la visserie')} />
          <span>Retourner (de l’autre côté du bord du trou)</span>
        </label>
        <p class="field-help">Filetage non dessiné.</p>
      </div>
      <div class="panel-actions">
        <Button icon="trash" variant="danger" onClick={() => c.removeFasteners(ids)}>
          {plural ? `Supprimer les ${data.count}` : 'Supprimer'}
        </Button>
      </div>
    </>
  );
}
