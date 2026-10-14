import { allows } from '../app/levels';
import { PLA_DENSITY } from '../app/fabrication';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Feature, Id, Part } from '../domain/model';
import type { FeatureStatus } from '../domain/status';
import { formatNumber, formatVolume } from '../domain/units';
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
  useEffect(() => {
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

function PartsSection() {
  const c = useController();
  const parts = useAppState((s) => s.doc.parts);
  const activePartId = useAppState((s) => s.activePartId);
  const busy = useAppState((s) => s.mode.kind !== 'model');
  const isolatedId = useAppState((s) => (s.isolatedPartId && s.doc.parts.some((p) => p.id === s.isolatedPartId) ? s.isolatedPartId : null));
  const [renaming, setRenaming] = useState<Id | null>(null);
  const isolated = parts.find((p) => p.id === isolatedId);
  return (
    <section class="panel-section" aria-labelledby="parts-title">
      <div class="panel-header">
        <span id="parts-title">Pièces</span>
        <span class="spacer" />
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
        <ul class="part-list">
          {parts.map((p) => (
            <li key={p.id} class={`part-row${p.id === activePartId ? ' is-active' : ''}`}>
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
                  class={`part-select${(isolatedId ? p.id === isolatedId : p.visible) ? '' : ' is-hidden'}`}
                  aria-pressed={p.id === activePartId}
                  title={p.id === activePartId ? 'Pièce active : les nouvelles étapes lui sont ajoutées' : 'Rendre cette pièce active'}
                  onClick={() => c.setActivePart(p.id)}
                  onDblClick={() => setRenaming(p.id)}
                >
                  <span class="name">{p.name}</span>
                  {p.id === activePartId ? <span class="visually-hidden"> (pièce active)</span> : null}
                </button>
              )}
              <IconButton icon="rename" label={`Renommer « ${p.name} »`} small onClick={() => setRenaming(p.id)} />
              {parts.length > 1 ? (
                <IconButton
                  icon="isolate"
                  label={p.id === isolatedId ? 'Réafficher toutes les pièces' : `Isoler « ${p.name} » (masquer les autres pièces)`}
                  small
                  pressed={p.id === isolatedId}
                  onClick={() => c.toggleIsolate(p.id)}
                />
              ) : null}
              <IconButton icon={p.visible ? 'eye' : 'eye-off'} label={p.visible ? `Masquer « ${p.name} »` : `Afficher « ${p.name} »`} small onClick={() => c.togglePartVisible(p.id)} />
              <IconButton icon="trash" label={`Supprimer la pièce « ${p.name} »`} small onClick={() => c.deletePart(p.id)} />
            </li>
          ))}
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
  const analysis = useAppState((s) => (part ? s.display[part.id]?.result.analysis : null));
  const showCentroid = useAppState((s) => s.showCentroid);
  const canCentroid = useAppState((s) => allows(s.level, 'view-centroid'));
  const selection = useAppState((s) => s.selection);
  const draft = useAppState((s) => (s.mode.kind === 'feature' && s.mode.draft.isNew ? s.mode.draft.feature : null));
  const editingSketch = useAppState((s) => (s.mode.kind === 'sketch' ? s.mode.session.featureId : null));
  const rollback = useAppState((s) => s.rollback);
  const [renaming, setRenaming] = useState<Id | null>(null);
  if (!part) return null;
  const statusOf = (id: Id) => statuses?.find((st) => st.featureId === id);
  const active = activeCount(part, rollback);
  const draftRow = draft ? (
    <li key="draft-row">
      <div class="feature-row is-selected">
        <span class="feature-main">
          <Icon name={definitionOf(draft).icon} class="feature-icon" />
          <span class="feature-texts">
            <span class="name">{draft.name}</span>
            <span class="summary">aperçu — validez à droite</span>
          </span>
        </span>
      </div>
    </li>
  ) : null;
  const rollbackMarker = (
    <li class="rollback-marker" key="rollback-marker">
      <span class="rollback-line" aria-hidden="true" />
      <span class="rollback-text">
        Barre de retour : les étapes suivantes ne sont pas calculées. Une nouvelle étape s’ajoute ici.
      </span>
      <button type="button" class="tl-link" onClick={() => c.rollbackToEnd(part.id)}>
        Revenir à la fin
      </button>
    </li>
  );
  return (
    <section class="panel-section grow" aria-labelledby="history-title">
      <div class="panel-header">
        <span id="history-title">Historique — {part.name}</span>
      </div>
      <div class="panel-body">
        {part.features.length === 0 && !draft ? (
          <p class="empty-hint">
            Cette pièce est vide. Commencez par une <strong>esquisse</strong> : bouton « Esquisse » en haut, puis choisissez un plan.
          </p>
        ) : null}
        <ol class="feature-list" aria-label={`Étapes de construction de ${part.name}`}>
          {active === 0 && part.features.length > 0 ? [draftRow, rollbackMarker] : null}
          {part.features.flatMap((f, index) => {
            const after = index >= active;
            const status = after ? undefined : statusOf(f.id);
            const def = definitionOf(f);
            const selected = selection?.kind === 'feature' && selection.featureId === f.id;
            const row = (
              <li key={f.id}>
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
                    {f.type === 'sketch' ? (
                      <IconButton icon={f.visible ? 'eye' : 'eye-off'} label={f.visible ? `Masquer « ${f.name} »` : `Afficher « ${f.name} »`} small onClick={() => c.toggleSketchVisible(f.id)} />
                    ) : null}
                    <IconButton icon="trash" label={`Supprimer « ${f.name} »`} small onClick={() => c.deleteFeature(f.id)} />
                  </span>
                </div>
                {status && status.state !== 'ok' ? <IssueBox part={part} feature={f} status={status} /> : null}
              </li>
            );
            return index === active - 1 && active < part.features.length ? [row, draftRow, rollbackMarker] : [row];
          })}
          {active === part.features.length ? draftRow : null}
        </ol>
        {analysis && analysis.solidCount > 0 ? (
          <div class="part-figures">
            <p class="field-help">
              Volume de la pièce : <strong>{formatVolume(analysis.volume)}</strong>
              {analysis.solidCount > 1 ? ` (${analysis.solidCount} morceaux séparés)` : ''}
              <br />
              Masse en PLA (pleine) : <strong>≈ {formatNumber((analysis.volume * PLA_DENSITY) / 1000, 1)} g</strong>
            </p>
            {canCentroid && analysis.centroid ? (
              <label class="checkbox-row" title="Le centre de gravité est le point d’équilibre de la pièce : posée sur une pointe à cet endroit, elle tiendrait en équilibre.">
                <input type="checkbox" checked={showCentroid} onChange={() => c.toggleCentroid()} />
                <span>
                  Centre de gravité : {formatNumber(analysis.centroid.x, 1)} ; {formatNumber(analysis.centroid.y, 1)} ; {formatNumber(analysis.centroid.z, 1)} mm
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
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
