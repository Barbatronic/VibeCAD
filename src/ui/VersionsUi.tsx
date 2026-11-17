import { useMemo, useState } from 'preact/hooks';
import { historyBytes } from '../io/version-store';
import { commitOf, diffIsEmpty, headOf, layoutGraph, mergeState, partHistory, sameTree, treeOf, type ChangeStatus, type MergeConflict, type MergeSide, type VersionDiff, type VersionGraph } from '../io/versions';
import { useAppState, useController } from './context';
import { Button, IconButton, ToolButton } from './components/controls';
import { ToolGroup } from './ToolSectors';
import { Icon } from './icons';

const ROW = 30;
const LANE = 14;
const PAD = 11;
const LANE_COLORS = ['var(--accent)', '#e0823d', '#3aa675', '#b05cc8', '#d1495b', '#2a9db5'];
const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]!;
const laneX = (lane: number) => PAD + lane * LANE;
/** Les versions commencent à la deuxième ligne : la première est l'état actuel du projet. */
const rowY = (row: number) => (row + 1) * ROW + ROW / 2;

const MARKS: Record<ChangeStatus, { mark: string; cls: string; text: string }> = {
  added: { mark: '+', cls: 'is-added', text: 'ajout' },
  modified: { mark: '~', cls: 'is-modified', text: 'modification' },
  removed: { mark: '−', cls: 'is-removed', text: 'suppression' },
};

function when(iso: string, long = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return long ? d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function bytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',')} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

function Mark({ status }: { status: ChangeStatus }) {
  const m = MARKS[status];
  return (
    <span class={`versions-mark ${m.cls}`}>
      <span aria-hidden="true">{m.mark}</span>
      <span class="visually-hidden">{m.text} : </span>
    </span>
  );
}

/** Résumé sur une ligne : « 2 modifiées · 1 ajoutée · Assemblage ». */
function diffSummary(d: VersionDiff): string {
  const count = (status: ChangeStatus, one: string, many: string) => {
    const n = d.parts.filter((p) => p.status === status).length;
    return n > 0 ? [`${n} ${n > 1 ? many : one}`] : [];
  };
  return [...count('modified', 'pièce modifiée', 'pièces modifiées'), ...count('added', 'ajoutée', 'ajoutées'), ...count('removed', 'supprimée', 'supprimées'), ...d.sections].join(' · ');
}

/** Traits et points du graphe, derrière la liste ; en haut, l'état actuel, relié à sa version. */
function GraphLines({ graph, head, modified }: { graph: VersionGraph; head: string | undefined; modified: boolean }) {
  const headRow = graph.rows.findIndex((r) => r.commit.id === head);
  const headLane = graph.rows[headRow]?.lane ?? 0;
  return (
    <svg class="versions-graph" width={laneX(graph.lanes - 1) + PAD} height={(graph.rows.length + 1) * ROW} aria-hidden="true">
      {headRow >= 0 ? <path d={`M${laneX(headLane)} ${ROW / 2} L${laneX(headLane)} ${rowY(headRow)}`} fill="none" stroke={laneColor(headLane)} stroke-width="2" stroke-dasharray="3 3" /> : null}
      {graph.edges.map((e, i) => {
        const x0 = laneX(e.fromLane);
        const y0 = rowY(e.from);
        const xl = laneX(e.lane);
        const x1 = laneX(e.toLane);
        const y1 = rowY(e.to);
        let d = `M${x0} ${y0}`;
        if (e.lane !== e.fromLane) d += ` C${x0} ${y0 + ROW / 2} ${xl} ${y0 + ROW / 2} ${xl} ${y0 + ROW}`;
        if (e.lane !== e.toLane) d += ` L${xl} ${y1 - ROW} C${xl} ${y1 - ROW / 2} ${x1} ${y1 - ROW / 2} ${x1} ${y1}`;
        else d += ` L${x1} ${y1}`;
        return <path key={i} d={d} fill="none" stroke={laneColor(e.lane)} stroke-width="2" />;
      })}
      <circle cx={laneX(headLane)} cy={ROW / 2} r="4.5" fill={modified ? 'var(--warning, #c98a1b)' : 'var(--surface)'} stroke={modified ? 'var(--warning, #c98a1b)' : laneColor(headLane)} stroke-width="2" />
      {graph.rows.map((r, i) => (
        <circle key={r.commit.id} cx={laneX(r.lane)} cy={rowY(i)} r="4.5" fill={laneColor(r.lane)} />
      ))}
    </svg>
  );
}

/** Outils de l'atelier Versions. */
export function VersionsTools() {
  const c = useController();
  const s = useAppState(
    (st) => {
      const commit = st.versions && st.versionView.commitId ? commitOf(st.versions, st.versionView.commitId) : undefined;
      const head = st.versions ? headOf(st.versions) : undefined;
      const mergeable = !!st.versions && !!commit && !!head && mergeState(st.versions, head.id, commit.id) !== 'merged';
      return { has: !!st.versions, selected: commit?.id ?? null, mergeable, branch: st.versions?.current ?? '', busy: st.mode.kind !== 'model' };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  return (
    <>
      <ToolGroup name="Version">
        <ToolButton
          id="ver-restore"
          icon="undo"
          label="Restaurer"
          hint="Remettre le projet dans l’état de la version choisie, sans changer de branche (annulable)"
          availability={s.selected ? { ok: true } : { ok: false, reason: 'Choisissez une version dans la liste.' }}
          onClick={() => s.selected && void c.restoreVersion(s.selected)}
        />
        <ToolButton
          id="ver-merge"
          icon="merge"
          label="Fusionner"
          hint={`Reprendre dans « ${s.branch} » ce que la version choisie a changé de son côté`}
          availability={s.mergeable ? { ok: true } : { ok: false, reason: s.selected ? `Cette version est déjà dans « ${s.branch} ».` : 'Choisissez une version d’une autre branche.' }}
          onClick={() => s.selected && void c.mergeVersion(s.selected)}
        />
      </ToolGroup>
      <ToolGroup name="Fichier">
        <ToolButton
          id="ver-export"
          icon="export"
          label="Sans historique"
          hint="Télécharger une copie du projet sans ses versions"
          availability={s.has ? { ok: true } : { ok: false, reason: 'Le projet n’a pas encore de version.' }}
          onClick={() => void c.exportWithoutVersions()}
        />
      </ToolGroup>
    </>
  );
}

/** Panneau de gauche : branche de travail, création d'une version, graphe. */
export function VersionsSection() {
  const c = useController();
  const h = useAppState((s) => s.versions);
  const doc = useAppState((s) => s.doc);
  const view = useAppState((s) => s.versionView);
  const [message, setMessage] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const tree = useMemo(() => treeOf(doc), [doc]);
  const graph = useMemo(() => (h ? layoutGraph(h) : null), [h?.commits, h?.branches]);
  const head = h ? headOf(h) : undefined;
  const modified = !head || !sameTree(head, tree);
  // Pièce suivie : les versions qui ne l'ont pas touchée s'estompent.
  const touched = useMemo(() => (h?.objects && view.partId ? new Set(partHistory(h, view.partId).map((x) => x.commit.id)) : null), [h?.objects, h?.commits, view.partId]);
  const pending = view.commitId === null ? view.diff : null;
  const create = () => {
    void c.createVersion(message).then(() => setMessage(''));
  };
  const indent = `${laneX((graph?.lanes ?? 1) - 1) + PAD}px`;
  return (
    <section class="panel-section grow versions-section" aria-labelledby="versions-title">
      <div class="panel-header">
        <span id="versions-title">Versions</span>
        {h ? <span class="count">{h.commits.length}</span> : null}
        <span class="spacer" />
        {h ? <span class="versions-weight" title="Poids de l’historique dans le fichier du projet">{bytes(historyBytes(h, doc.resources))}</span> : null}
        {h ? <IconButton icon="trash" small label="Supprimer l’historique (le projet en cours ne change pas)" onClick={() => setConfirmClear(!confirmClear)} /> : null}
      </div>
      <div class="panel-body">
        {confirmClear ? (
          <div class="versions-confirm" role="alert">
            <span>Supprimer toutes les versions ?</span>
            <Button
              small
              variant="danger"
              onClick={() => {
                setConfirmClear(false);
                c.clearVersions();
              }}
            >
              Supprimer
            </Button>
            <Button small onClick={() => setConfirmClear(false)}>
              Annuler
            </Button>
          </div>
        ) : null}
        <div class="versions-work">
          <div class="versions-work-head">
            <Icon name="branch" />
            {h && h.branches.length > 1 ? (
              <select class="versions-branch" aria-label="Branche de travail" value={h.current} onChange={(e) => void c.switchVersionBranch((e.target as HTMLSelectElement).value)}>
                {h.branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong class="versions-branch-name">{h?.current ?? 'principal'}</strong>
            )}
          </div>
          <div class="versions-create">
            <input
              class="versions-input"
              type="text"
              placeholder="Message"
              aria-label="Message de la version"
              value={message}
              maxLength={120}
              onInput={(e) => setMessage((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && modified) create();
              }}
            />
            <Button small variant="primary" icon="check" onClick={create} disabledReason={modified ? null : 'Aucune modification depuis la dernière version.'}>
              Créer
            </Button>
          </div>
        </div>
        <div class="versions-list" role="listbox" aria-label="Versions du projet">
          {graph ? <GraphLines graph={graph} head={head?.id} modified={modified} /> : null}
          <button type="button" role="option" aria-selected={view.commitId === null} class={`versions-row is-work${view.commitId === null ? ' is-selected' : ''}`} style={{ paddingLeft: graph ? indent : '10px' }} onClick={() => void c.selectVersion(null)}>
            <span class="message">État actuel</span>
            <span class={`versions-state${modified ? ' is-modified' : ''}`} title={pending && !diffIsEmpty(pending) ? diffSummary(pending) : undefined}>
              {!head ? 'aucune version' : modified ? 'modifié' : 'à jour'}
            </span>
          </button>
          {h && graph
            ? graph.rows.map((r) => (
                <button
                  key={r.commit.id}
                  type="button"
                  role="option"
                  aria-selected={view.commitId === r.commit.id}
                  class={`versions-row${view.commitId === r.commit.id ? ' is-selected' : ''}${touched && !touched.has(r.commit.id) ? ' is-dim' : ''}`}
                  style={{ paddingLeft: indent }}
                  title={`${r.commit.message} — ${when(r.commit.date, true)}`}
                  onClick={() => void c.selectVersion(r.commit.id)}
                >
                  {r.branches.map((b) => (
                    <span key={b} class={`versions-chip${b === h.current ? ' is-current' : ''}`} style={{ borderColor: laneColor(r.lane) }}>
                      {b}
                    </span>
                  ))}
                  <span class="message">{r.commit.message}</span>
                  <span class="date">{when(r.commit.date)}</span>
                </button>
              ))
            : null}
        </div>
      </div>
    </section>
  );
}

const SIDE_TEXT: Record<ChangeStatus, string> = { added: 'ajoutée', modified: 'modifiée', removed: 'supprimée' };

/** Fusion en attente : chaque pièce (ou partie du projet) changée des deux côtés, et le côté à garder. */
function MergeConflicts({ ours, theirs, conflicts, commitId }: { ours: string; theirs: string; conflicts: MergeConflict[]; commitId: string }) {
  const c = useController();
  const [choices, setChoices] = useState<Record<string, MergeSide>>({});
  const left = conflicts.filter((k) => !choices[k.key]).length;
  const side = (k: MergeConflict, which: MergeSide, name: string) => (
    <button type="button" class={`versions-side${choices[k.key] === which ? ' is-selected' : ''}`} aria-pressed={choices[k.key] === which} title={`Garder « ${k.name} » de « ${name} » (${SIDE_TEXT[k[which]]})`} onClick={() => setChoices({ ...choices, [k.key]: which })}>
      <Mark status={k[which]} />
      <span class="name">{name}</span>
    </button>
  );
  return (
    <div class="versions-merge" role="group" aria-label="Conflits de la fusion">
      <h3 class="list-title">Conflits</h3>
      <p class="versions-none">Changé des deux côtés : côté à garder.</p>
      <ul class="versions-conflicts">
        {conflicts.map((k) => (
          <li key={k.key}>
            {k.key.startsWith('part:') ? (
              <button type="button" class="versions-conflict-name" title={k.name} onClick={() => c.selectVersionPart(k.key.slice(5))}>
                {k.name}
              </button>
            ) : (
              <span class="versions-conflict-name" title={k.name}>
                {k.name}
              </span>
            )}
            <div class="versions-sides">
              {side(k, 'ours', ours)}
              {side(k, 'theirs', theirs)}
            </div>
          </li>
        ))}
      </ul>
      <div class="versions-actions">
        <Button small variant="primary" icon="merge" onClick={() => void c.mergeVersion(commitId, choices)} disabledReason={left > 0 ? (left > 1 ? `${left} conflits à trancher.` : 'Un conflit à trancher.') : null}>
          Fusionner
        </Button>
        <Button small onClick={() => c.cancelVersionMerge()}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

/** Panneau de droite : ce que la version regardée a changé, pièce par pièce, et ses actions. */
export function VersionsRightPanel() {
  const c = useController();
  const h = useAppState((s) => s.versions);
  const view = useAppState((s) => s.versionView);
  const doc = useAppState((s) => s.doc);
  const [branchName, setBranchName] = useState('');
  const commit = h && view.commitId ? commitOf(h, view.commitId) : undefined;
  const head = h ? headOf(h) : undefined;
  const diff = view.diff;
  const branches = h && commit ? h.branches.filter((b) => b.head === commit.id) : [];
  const history = useMemo(() => (h?.objects && view.partId ? partHistory(h, view.partId) : []), [h?.objects, h?.commits, view.partId]);
  const partName = view.partId
    ? ((view.scene?.doc ?? doc).parts.find((p) => p.id === view.partId)?.name ?? doc.parts.find((p) => p.id === view.partId)?.name ?? history[0]?.change.name ?? diff?.parts.find((p) => p.id === view.partId)?.name ?? null)
    : null;
  const inDiff = !!view.partId && !!diff?.parts.some((p) => p.id === view.partId);
  return (
    <aside class="panel right-panel versions-panel" aria-label="Version regardée">
      <div class="panel-title">
        <Icon name="branch" />
        <span class="versions-title">{commit ? commit.message : 'État actuel'}</span>
      </div>
      <div class="panel-content">
        <p class="versions-meta">
          {commit ? when(commit.date, true) : head ? `Comparé à « ${head.message} »` : 'Aucune version enregistrée'}
          {view.loading ? ' · calcul de la vue…' : ''}
        </p>
        <div class="versions-legend" aria-hidden="true">
          <span class="is-added">ajoutée</span>
          <span class="is-modified">modifiée</span>
          <span class="is-removed">supprimée</span>
          <span class="is-same">inchangée</span>
        </div>
        {commit && h ? (
          <>
            <div class="versions-actions">
              <Button small icon="undo" onClick={() => void c.restoreVersion(commit.id)} hint="Remettre le projet dans l’état de cette version, sans changer de branche (annulable)">
                Restaurer
              </Button>
              {head && mergeState(h, head.id, commit.id) !== 'merged' ? (
                <Button small icon="merge" onClick={() => void c.mergeVersion(commit.id)} hint="Reprendre ce que cette version a changé de son côté ; une pièce changée des deux côtés demande un choix">
                  Fusionner dans « {h.current} »
                </Button>
              ) : null}
              {branches
                .filter((b) => b.name !== h.current)
                .flatMap((b) => [
                  <Button small key={`go:${b.name}`} icon="branch" onClick={() => void c.switchVersionBranch(b.name)}>
                    Passer sur « {b.name} »
                  </Button>,
                  <Button small key={`del:${b.name}`} icon="trash" onClick={() => void c.deleteVersionBranch(b.name)} hint="Supprimer la branche et les versions qu’elle est seule à porter">
                    Supprimer « {b.name} »
                  </Button>,
                ])}
            </div>
            <div class="versions-create">
              <input
                class="versions-input"
                type="text"
                placeholder="Nouvelle branche"
                aria-label="Nom de la nouvelle branche"
                value={branchName}
                maxLength={40}
                onInput={(e) => setBranchName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <Button
                small
                icon="plus"
                onClick={() =>
                  void c.createVersionBranch(branchName, commit.id).then((ok) => {
                    if (ok) setBranchName('');
                  })
                }
                disabledReason={branchName.trim() ? null : 'Donnez un nom à la branche.'}
                hint="Créer une branche à partir de cette version et travailler dessus"
              >
                Créer
              </Button>
            </div>
          </>
        ) : null}
        {view.merge && h && view.merge.theirs === commit?.id ? <MergeConflicts key={view.merge.theirs} ours={h.current} theirs={view.merge.label} conflicts={view.merge.conflicts} commitId={view.merge.theirs} /> : null}
        <h3 class="list-title">Modifications</h3>
        {!diff ? (
          <p class="versions-none">Chargement…</p>
        ) : diffIsEmpty(diff) ? (
          <p class="versions-none">Aucune.</p>
        ) : (
          <ul class="versions-changes">
            {diff.parts.map((p) => (
              <li key={p.id}>
                <button type="button" class={`versions-part${view.partId === p.id ? ' is-selected' : ''}`} aria-pressed={view.partId === p.id} onClick={() => c.selectVersionPart(p.id)}>
                  <Mark status={p.status} />
                  <span class="name" title={p.name}>
                    {p.name}
                  </span>
                </button>
                {p.steps.length > 0 ? (
                  <ul class="versions-steps">
                    {p.steps.map((st) => (
                      <li key={`${st.status}:${st.name}`}>
                        <Mark status={st.status} />
                        <span class="name" title={st.name}>
                          {st.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {diff.sections.map((name) => (
              <li key={`section:${name}`} class="versions-section-change">
                <Mark status="modified" />
                <span class="name">{name}</span>
              </li>
            ))}
          </ul>
        )}
        {view.partId && partName ? (
          <>
            <h3 class="list-title versions-part-title">
              <span class="name" title={partName}>
                {partName}
              </span>
              <IconButton icon="close" small label="Ne plus suivre cette pièce" onClick={() => c.selectVersionPart(null)} />
            </h3>
            {!inDiff ? <p class="versions-none">{commit ? 'Inchangée dans cette version.' : 'Inchangée depuis la dernière version.'}</p> : null}
            {history.length > 0 ? (
              <ul class="versions-changes">
                {history.map(({ commit: k, change }) => (
                  <li key={k.id}>
                    <button type="button" class={`versions-part${view.commitId === k.id ? ' is-selected' : ''}`} onClick={() => void c.selectVersion(k.id)} title={when(k.date, true)}>
                      <Mark status={change.status} />
                      <span class="name">{k.message}</span>
                      <span class="date">{when(k.date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="versions-none">Dans aucune version.</p>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
}
