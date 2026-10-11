/**
 * Onglet Simulation : voir comment une pièce se déforme sous une charge. On choisit la pièce, son
 * matériau, les faces où elle est tenue et celles où elle est chargée, puis on lance le calcul :
 * la pièce apparaît déformée (exagérée) et colorée selon l'effort. Voir docs/simulation.md.
 */
import { DIRECTION_LABELS, QUALITY_LABELS, studyInput, studyKey, studyOf, verdict } from '../app/simulation';
import type { LoadDirection, SimulationStudy } from '../domain/model';
import { formatNumber } from '../domain/units';
import { SIM_MATERIALS } from '../sim/materials';
import { exaggerationFor } from '../sim/study';
import { useAppState, useController } from './context';
import { Button, Callout, ToolButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';

const num = (t: string) => {
  const v = Number(t.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

export function SimulationTools() {
  const c = useController();
  const picking = useAppState((s) => (s.mode.kind === 'pick-sim-face' ? s.mode.role : null));
  const running = useAppState((s) => s.simulationRun?.status === 'running');
  return (
    <div class="toolbar-group" role="group" aria-label="Simulation">
      <ToolButton id="sim-pick-fixed" icon="anchor" label="Faces fixées" hint="Cliquer les faces où la pièce est tenue" pressed={picking === 'fixed'} onClick={() => c.pickSimulationFaces('fixed')} />
      <ToolButton id="sim-pick-load" icon="load" label="Charge" hint="Cliquer les faces où appuie la charge" pressed={picking === 'load'} onClick={() => c.pickSimulationFaces('load')} />
      <ToolButton id="sim-run" icon="simulate" label="Calculer" hint="Calculer la déformation de la pièce" pressed={running} onClick={() => void c.runSimulation()} />
    </div>
  );
}

/** Panneau de gauche : la pièce étudiée. */
export function SimulationSection() {
  const c = useController();
  const data = useAppState(
    (s) => ({
      current: c.simulationPartId(),
      parts: s.doc.parts.filter((p) => s.display[p.id]?.mesh).map((p) => ({ id: p.id, name: p.name, color: p.color })),
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  return (
    <section class="panel-section grow" aria-labelledby="sim-title">
      <div class="panel-header">
        <span id="sim-title">Pièce étudiée</span>
      </div>
      <div class="panel-body">
        {data.parts.length === 0 ? <p class="empty-hint">Aucune pièce n’a encore de volume : construisez-en une dans l’onglet Pièces.</p> : null}
        <ul class="feature-list sim-parts" role="radiogroup" aria-label="Pièce étudiée">
          {data.parts.map((p) => (
            <li key={p.id}>
              <button type="button" role="radio" aria-checked={p.id === data.current} class={`sim-part${p.id === data.current ? ' is-current' : ''}`} onClick={() => c.setSimulationPart(p.id)}>
                <span class="color-swatch" style={{ background: p.color, width: '16px', height: '16px' }} />
                <span>{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <ol class="sim-steps field-help">
          <li>Choisissez le matériau.</li>
          <li>
            <strong>Faces fixées</strong> : cliquez où la pièce est tenue (vissée, collée, posée).
          </li>
          <li>
            <strong>Charge</strong> : cliquez où l’on appuie, puis indiquez combien.
          </li>
          <li>
            <strong>Calculer</strong> : la pièce se déforme (en exagéré) et se colore, du bleu (tranquille) au rouge (très sollicité).
          </li>
        </ol>
      </div>
    </section>
  );
}

/** Panneau de droite : réglages de l'étude, puis résultat. */
export function SimulationRightPanel() {
  const c = useController();
  const info = useAppState(
    (s) => {
      const partId = c.simulationPartId();
      const d = partId ? s.display[partId] : undefined;
      if (!partId || !d?.mesh || !d.meshKey) return null;
      const study = studyOf(s.doc, partId);
      const problem = studyInput(study, d.mesh);
      const run = s.simulationRun?.partId === partId ? s.simulationRun : null;
      const current = !!run && run.key === studyKey(study, d.meshKey);
      return {
        partId,
        name: s.doc.parts.find((p) => p.id === partId)?.name ?? '',
        study,
        missing: problem.ok ? null : problem.message,
        picking: s.mode.kind === 'pick-sim-face' ? s.mode.role : null,
        run: run ? { status: run.status, progress: run.progress, error: run.error ?? null, current, result: run.result ? { maxStress: run.result.maxStress, maxDisplacement: run.result.maxDisplacement, cells: run.result.cells, cellSize: run.result.cellSize, converged: run.result.converged, durationMs: run.result.durationMs } : null } : null,
        exaggeration: run?.result ? exaggerationFor(run.result.maxDisplacement, run.size) : 1,
        display: s.simulationDisplay,
        deformed: s.simulationDeformed,
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  if (!info) {
    return (
      <aside class="panel right-panel" aria-label="Simulation">
        <div class="panel-title">
          <Icon name="simulate" />
          <span>Simulation</span>
        </div>
        <div class="panel-content">
          <p class="empty-hint">Choisissez une pièce qui a un volume.</p>
        </div>
      </aside>
    );
  }
  const { study, partId } = info;
  const update = (change: (s: SimulationStudy) => SimulationStudy, label: string) => c.updateStudy(partId, change, label);
  const unit = study.load.kind === 'mass' ? 'kg' : 'N';
  const running = info.run?.status === 'running';
  const result = info.run?.status === 'done' ? info.run.result : null;
  const v = result ? verdict(study, result.maxStress) : null;
  const top = result ? (info.display === 'stress' ? result.maxStress : result.maxDisplacement) : 0;
  return (
    <aside class="panel right-panel" aria-label="Simulation">
      <div class="panel-title">
        <Icon name="simulate" />
        <span>Simulation de « {info.name} »</span>
      </div>
      <div class="panel-content">
        <label class="field">
          <span class="field-label">Matériau</span>
          <select id="sim-material" class="select" value={study.materialId} onChange={(e) => update((s) => ({ ...s, materialId: (e.target as HTMLSelectElement).value }), 'Matériau de la simulation')}>
            {SIM_MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <div class="field sim-faces">
          <span class="field-label">
            <span class="sim-dot fixed" aria-hidden="true" /> Faces fixées : {study.fixed.length}
          </span>
          <div class="sim-face-buttons">
            <Button small icon="anchor" onClick={() => c.pickSimulationFaces('fixed')}>
              {info.picking === 'fixed' ? 'Terminé' : 'Choisir'}
            </Button>
            {study.fixed.length ? (
              <button type="button" class="tl-link" onClick={() => c.clearSimulationFaces('fixed')}>
                tout retirer
              </button>
            ) : null}
          </div>
        </div>

        <div class="field sim-faces">
          <span class="field-label">
            <span class="sim-dot load" aria-hidden="true" /> Faces chargées : {study.load.faces.length}
          </span>
          <div class="sim-face-buttons">
            <Button small icon="load" onClick={() => c.pickSimulationFaces('load')}>
              {info.picking === 'load' ? 'Terminé' : 'Choisir'}
            </Button>
            {study.load.faces.length ? (
              <button type="button" class="tl-link" onClick={() => c.clearSimulationFaces('load')}>
                tout retirer
              </button>
            ) : null}
          </div>
        </div>

        <div class="field">
          <span class="field-label">Charge</span>
          <div class="limits-row">
            <label class="mini-field">
              <span>Type</span>
              <select
                id="sim-load-kind"
                class="select"
                value={study.load.kind}
                onChange={(e) => {
                  const kind = (e.target as HTMLSelectElement).value as 'mass' | 'force';
                  update((s) => ({ ...s, load: { ...s.load, kind, direction: kind === 'mass' ? '-z' : s.load.direction } }), 'Type de charge');
                }}
              >
                <option value="mass">Masse posée</option>
                <option value="force">Force</option>
              </select>
            </label>
            <label class="mini-field">
              <span>{study.load.kind === 'mass' ? 'Masse' : 'Force'}</span>
              <NumberInput
                value={formatNumber(study.load.value, 3)}
                unit={unit}
                min={0}
                max={100000}
                ariaLabel={study.load.kind === 'mass' ? 'Masse posée (kg)' : 'Force (N)'}
                onInput={(t) => {
                  const x = num(t);
                  if (x !== null && x >= 0 && x <= 100000) update((s) => ({ ...s, load: { ...s.load, value: x } }), 'Valeur de la charge');
                }}
              />
            </label>
          </div>
          {study.load.kind === 'mass' ? (
            <p class="field-help">
              Une masse de {formatNumber(study.load.value, 3)} kg pèse {formatNumber(study.load.value * 9.81, 1)} N, vers le bas (−Z).
            </p>
          ) : (
            <label class="mini-field">
              <span>Sens</span>
              <select id="sim-load-direction" class="select" value={study.load.direction} onChange={(e) => update((s) => ({ ...s, load: { ...s.load, direction: (e.target as HTMLSelectElement).value as LoadDirection } }), 'Sens de la charge')}>
                {(Object.keys(DIRECTION_LABELS) as LoadDirection[]).map((d) => (
                  <option key={d} value={d}>
                    {DIRECTION_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <label class="field">
          <span class="field-label">Précision</span>
          <select id="sim-quality" class="select" value={study.quality} onChange={(e) => update((s) => ({ ...s, quality: (e.target as HTMLSelectElement).value as SimulationStudy['quality'] }), 'Précision de la simulation')}>
            {(Object.keys(QUALITY_LABELS) as SimulationStudy['quality'][]).map((q) => (
              <option key={q} value={q}>
                {QUALITY_LABELS[q]}
              </option>
            ))}
          </select>
        </label>

        {info.missing ? <p class="field-help">{info.missing}</p> : null}
        {running ? (
          <div class="sim-progress" role="status">
            <progress max={1} value={info.run!.progress} aria-label="Avancement du calcul" />
            <Button small onClick={() => c.cancelSimulation()}>
              Annuler
            </Button>
          </div>
        ) : (
          <Button variant="primary" icon="simulate" disabled={!!info.missing} disabledReason={info.missing} onClick={() => void c.runSimulation()}>
            Calculer
          </Button>
        )}
        {info.run?.status === 'error' ? <Callout kind="error">{info.run.error}</Callout> : null}

        {result && v ? (
          <div class={`sim-result${info.run!.current ? '' : ' is-stale'}`} aria-label="Résultat de la simulation">
            {!info.run!.current ? <Callout kind="warning">Les réglages ou la pièce ont changé : relancez le calcul.</Callout> : null}
            <div class={`sim-verdict ${v.level}`} role="status">
              <strong>{v.label}</strong>
              <span>{Number.isFinite(v.margin) ? `marge × ${formatNumber(v.margin, 1)}` : 'aucun effort'}</span>
            </div>
            <dl class="sim-figures">
              <dt>Déplacement maximal</dt>
              <dd id="sim-max-displacement">{formatNumber(result.maxDisplacement, 3)} mm</dd>
              <dt>Contrainte maximale</dt>
              <dd id="sim-max-stress">{formatNumber(result.maxStress, 2)} MPa</dd>
            </dl>
            <div class="segmented" role="group" aria-label="Couleurs">
              <button type="button" aria-pressed={info.display === 'stress'} onClick={() => c.setSimulationDisplay('stress')}>
                Contrainte
              </button>
              <button type="button" aria-pressed={info.display === 'displacement'} onClick={() => c.setSimulationDisplay('displacement')}>
                Déplacement
              </button>
            </div>
            <div class="sim-legend" aria-hidden="true">
              <span class="sim-ramp" />
              <span class="sim-legend-labels">
                <span>0</span>
                <span>
                  {formatNumber(top, info.display === 'stress' ? 2 : 3)} {info.display === 'stress' ? 'MPa' : 'mm'}
                </span>
              </span>
            </div>
            <label class="checkbox-row">
              <input type="checkbox" checked={info.deformed} onChange={(e) => c.setSimulationDeformed((e.target as HTMLInputElement).checked)} />
              <span>Montrer la déformation{info.exaggeration > 1.01 ? ` (exagérée × ${formatNumber(info.exaggeration, 0)})` : ''}</span>
            </label>
            <p class="field-help">
              Résultat indicatif : la pièce est découpée en {formatNumber(result.cells, 0)} cubes de {formatNumber(result.cellSize, 2)} mm. Une pièce imprimée dépend aussi
              du remplissage et du sens des couches.
            </p>
            {!result.converged ? <Callout kind="warning">Le calcul n’a pas tout à fait abouti : le résultat est approximatif.</Callout> : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
