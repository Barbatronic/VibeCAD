/**
 * Frise de l'historique (barre de retour en arrière) : une icône par étape de la pièce active et
 * un repère à faire glisser. Les étapes à droite du repère ne sont pas calculées ; une nouvelle
 * étape s'insère à la position du repère. Les boutons ◀ ▶ rejouent la construction pas à pas.
 */
import { useRef } from 'preact/hooks';
import { activeCount } from '../app/rollback';
import { definitionOf } from '../features/registry';
import { useAppState, useController } from './context';
import { Icon } from './icons';

export function Timeline() {
  const c = useController();
  const part = useAppState((s) => s.doc.parts.find((p) => p.id === s.activePartId) ?? s.doc.parts[0]);
  const rollback = useAppState((s) => s.rollback);
  const modelMode = useAppState((s) => s.mode.kind === 'model' && s.workspace === 'parts');
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  if (!part || part.features.length === 0 || !modelMode) return null;
  const n = part.features.length;
  const k = activeCount(part, rollback);
  const current = k > 0 ? part.features[k - 1]! : null;

  /** Nombre d'étapes actives correspondant à une position horizontale du pointeur. */
  const countAt = (clientX: number): number => {
    const steps = Array.from(track.current?.querySelectorAll<HTMLElement>('.tl-step') ?? []);
    return steps.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < clientX;
    }).length;
  };

  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: k - 1, ArrowDown: k - 1, ArrowRight: k + 1, ArrowUp: k + 1, Home: 0, End: n };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    c.setRollback(part.id, to);
  };

  const label = k === n ? `Toutes les étapes (${n})` : k === 0 ? `Avant la première étape (0 sur ${n})` : `Après « ${current!.name} » (${k} sur ${n})`;
  const marker = (
    <div
      key="marker"
      class="tl-marker"
      role="slider"
      tabIndex={0}
      aria-label="Barre de retour dans l’historique"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={k}
      aria-valuetext={label}
      title="Faites glisser pour revenir en arrière dans l’historique (flèches ← → au clavier)"
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (dragging.current) c.setRollback(part.id, countAt(e.clientX));
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    />
  );

  const items = part.features.flatMap((f, i) => {
    const def = definitionOf(f);
    const step = (
      <button
        key={f.id}
        type="button"
        class={`tl-step${i >= k ? ' is-after' : ''}`}
        title={`${f.name} — cliquez pour voir la pièce à cette étape`}
        aria-label={`${f.name}${i >= k ? ' (après la barre, non calculée)' : ''}`}
        onClick={() => c.setRollback(part.id, i + 1)}
      >
        <Icon name={def.icon} />
      </button>
    );
    return i === k - 1 ? [step, marker] : [step];
  });
  if (k === 0) items.unshift(marker);

  return (
    <div class={`timeline${k < n ? ' is-rolled-back' : ''}`} role="group" aria-label={`Frise de l’historique de ${part.name}`}>
      <div class="tl-controls">
        <button type="button" class="tl-btn" title="Début : avant la première étape" aria-label="Revenir au début" disabled={k === 0} onClick={() => c.setRollback(part.id, 0)}>
          <Icon name="tl-first" />
        </button>
        <button type="button" class="tl-btn" title="Étape précédente" aria-label="Étape précédente" disabled={k === 0} onClick={() => c.stepRollback(part.id, -1)}>
          <Icon name="tl-prev" />
        </button>
        <div class="tl-track" ref={track}>
          {items}
        </div>
        <button type="button" class="tl-btn" title="Étape suivante" aria-label="Étape suivante" disabled={k === n} onClick={() => c.stepRollback(part.id, 1)}>
          <Icon name="tl-next" />
        </button>
        <button type="button" class="tl-btn" title="Fin : toutes les étapes" aria-label="Aller à la fin" disabled={k === n} onClick={() => c.rollbackToEnd(part.id)}>
          <Icon name="tl-last" />
        </button>
      </div>
      {k < n ? (
        <div class="tl-caption" role="status">
          <span>
            {k === 0 ? 'Avant la première étape' : <>Pièce après « {current!.name} » ({k} étapes sur {n})</>} : une nouvelle étape s’ajoutera ici.
          </span>
          <button type="button" class="tl-link" onClick={() => c.rollbackToEnd(part.id)}>
            Revenir à la fin
          </button>
        </div>
      ) : null}
    </div>
  );
}
