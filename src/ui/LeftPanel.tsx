import { useEffect, useRef, useState } from 'preact/hooks';
import type { Feature, Id, Part } from '../domain/model';
import type { FeatureStatus } from '../domain/status';
import { formatVolume } from '../domain/units';
import { definitionOf, featureSummary } from '../features/registry';
import { activeCount } from '../app/rollback';
import { useAppState, useController } from './context';
import { AssemblySection } from './AssemblyUi';
import { FabricationSection } from './FabricationUi';
import { IconButton } from './components/controls';
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
  const [renaming, setRenaming] = useState<Id | null>(null);
  return (
    <section class="panel-section" aria-labelledby="parts-title">
      <div class="panel-header">
        <span id="parts-title">Pièces</span>
        <span class="spacer" />
        <IconButton icon="plus" label="Ajouter une pièce" small onClick={() => c.addPart()} />
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
                  class={`part-select${p.visible ? '' : ' is-hidden'}`}
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
              <IconButton icon={p.visible ? 'eye' : 'eye-off'} label={p.visible ? `Masquer « ${p.name} »` : `Afficher « ${p.name} »`} small onClick={() => c.togglePartVisible(p.id)} />
              <IconButton icon="trash" label={`Supprimer la pièce « ${p.name} »`} small onClick={() => c.deletePart(p.id)} />
            </li>
          ))}
        </ul>
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
        {status.state === 'error' && !supportIssue && (props.feature.type === 'extrude' || props.feature.type === 'pocket') ? (
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
  const analysis = useAppState((s) => (part ? s.display[part.id]?.result.analysis : null));
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
                      <Icon name={def.icon} class="feature-icon" />
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
          <p class="field-help" style={{ margin: '12px 4px 0' }}>
            Volume de la pièce : <strong>{formatVolume(analysis.volume)}</strong>
            {analysis.solidCount > 1 ? ` (${analysis.solidCount} morceaux séparés)` : ''}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function LeftPanel() {
  const workspace = useAppState((s) => s.workspace);
  return (
    <aside class="panel left-panel" aria-label={workspace === 'assembly' ? 'Assemblage' : 'Pièces et historique'}>
      {workspace === 'assembly' ? (
        <AssemblySection />
      ) : workspace === 'fabrication' ? (
        <FabricationSection />
      ) : (
        <>
          <PartsSection />
          <HistorySection />
        </>
      )}
    </aside>
  );
}
