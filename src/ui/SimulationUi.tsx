/**
 * Onglet Simulation : voir comment une pièce se déforme sous une charge. On choisit la pièce, son
 * matériau, les faces où elle est tenue et celles où elle est chargée, puis on lance le calcul :
 * la pièce apparaît déformée (exagérée) et colorée selon l'effort. Voir docs/simulation.md.
 */
import { DIRECTION_LABELS, QUALITY_LABELS, studyInput, studyKey, studyOf, topologyKey, verdict } from '../app/simulation';
import { ASSEMBLY_STUDY, type LoadDirection, type SimulationStudy } from '../domain/model';
import { formatNumber, readNumber } from '../domain/units';
import { SIM_MATERIALS } from '../sim/materials';
import { exaggerationFor } from '../sim/study';
import { useAppState, useController } from './context';
import { ToolGroup } from './ToolSectors';
import { Button, Callout, ToolButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';

/** Valeur saisie : nombre ou équation (paramètres du projet compris). */
const num = (t: string) => readNumber(t);

export function SimulationTools() {
  const c = useController();
  const picking = useAppState((s) => (s.mode.kind === 'pick-sim-face' ? s.mode.role : null));
  const running = useAppState((s) => s.simulationRun?.status === 'running');
  return (
    <>
      <ToolGroup name="Préparer">
        <ToolButton id="sim-pick-fixed" icon="anchor" label="Faces fixées" hint="Cliquer les faces où la pièce est tenue" pressed={picking === 'fixed'} onClick={() => c.pickSimulationFaces('fixed')} />
        <ToolButton id="sim-pick-load" icon="load" label="Charge" hint="Cliquer les faces où appuie la charge" pressed={picking === 'load'} onClick={() => c.pickSimulationFaces('load')} />
      </ToolGroup>
      <ToolGroup name="Résultat">
        <ToolButton id="sim-run" icon="simulate" label="Calculer" hint="Calculer la déformation de la pièce" pressed={running} onClick={() => void c.runSimulation()} />
      </ToolGroup>
    </>
  );
}

/** Panneau de gauche : la pièce étudiée. */
export function SimulationSection() {
  const c = useController();
  const data = useAppState(
    (s) => ({
      current: c.simulationPartId(),
      parts: s.doc.parts.filter((p) => s.display[p.id]?.mesh).map((p) => ({ id: p.id, name: p.name, color: p.color })),
      // Assemblage collé (niveau Expert), dès qu'il a deux pièces.
      assembly: (s.doc.assembly?.instances.length ?? 0) >= 2 && !!c.simulationSource(ASSEMBLY_STUDY),
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
          {data.assembly ? (
            <li>
              <button
                type="button"
                role="radio"
                aria-checked={data.current === ASSEMBLY_STUDY}
                class={`sim-part${data.current === ASSEMBLY_STUDY ? ' is-current' : ''}`}
                title="Toutes les pièces de l’assemblage, à leur place : celles qui se touchent sont considérées comme collées."
                onClick={() => c.setSimulationPart(ASSEMBLY_STUDY)}
              >
                <Icon name="part" />
                <span>Assemblage (pièces collées)</span>
              </button>
            </li>
          ) : null}
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
      const source = partId ? c.simulationSource(partId) : null;
      if (!partId || !source) return null;
      const study = studyOf(s.doc, partId);
      const problem = studyInput(study, source);
      const run = s.simulationRun?.partId === partId ? s.simulationRun : null;
      const current = !!run && run.key === studyKey(study, source.key);
      return {
        partId,
        name: partId === ASSEMBLY_STUDY ? 'l’assemblage' : `« ${s.doc.parts.find((p) => p.id === partId)?.name ?? ''} »`,
        assembly: partId === ASSEMBLY_STUDY,
        study,
        missing: problem.ok ? null : problem.message,
        picking: s.mode.kind === 'pick-sim-face' ? s.mode.role : null,
        run: run ? { status: run.status, progress: run.progress, error: run.error ?? null, current, result: run.result ? { maxStress: run.result.maxStress, maxDisplacement: run.result.maxDisplacement, cells: run.result.cells, ignoredCells: run.result.ignoredCells, cellSize: run.result.cellSize, converged: run.result.converged, durationMs: run.result.durationMs } : null } : null,
        exaggeration: run?.result ? exaggerationFor(run.result.maxDisplacement, run.size) : 1,
        // Au-delà de 5 % de la taille de la pièce, l'hypothèse des petites déformations ne tient plus.
        large: !!run?.result && run.result.maxDisplacement > 0.05 * run.size,
        display: s.simulationDisplay,
        deformed: s.simulationDeformed,
        animate: s.simulationAnimate,
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
        <span>Simulation de {info.name}</span>
      </div>
      <div class="panel-content">
        {info.assembly ? (
          <p class="field-help">
            Les pièces de l’assemblage sont étudiées à leur place, toutes dans le même matériau. Celles qui se touchent sont considérées comme collées : ni
            jeu, ni glissement. Cliquez les faces sur n’importe quelle pièce.
          </p>
        ) : null}
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
          <label class="mini-field">
            <span>{study.load.kind === 'mass' ? 'Sens du poids' : 'Sens'}</span>
            <select
              id="sim-load-direction"
              class="select"
              value={study.load.direction}
              onChange={(e) => {
                const direction = (e.target as HTMLSelectElement).value as LoadDirection;
                update((s) => ({ ...s, load: { ...s.load, direction, ...(direction === 'custom' && !s.load.vector ? { vector: { x: 0, y: 0, z: -1 } } : {}) } }), 'Sens de la charge');
              }}
            >
              {(Object.keys(DIRECTION_LABELS) as LoadDirection[]).map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          {study.load.direction === 'custom' ? (
            <div class="limits-row three" role="group" aria-label="Direction de la charge">
              {(['x', 'y', 'z'] as const).map((k) => (
                <label key={k} class="mini-field">
                  <span>{k.toUpperCase()}</span>
                  <NumberInput
                    id={`sim-load-vector-${k}`}
                    value={formatNumber((study.load.vector ?? { x: 0, y: 0, z: -1 })[k], 3)}
                    min={-1000}
                    max={1000}
                    ariaLabel={`Direction de la charge : composante ${k.toUpperCase()}`}
                    onInput={(t) => {
                      const x = num(t);
                      if (x !== null) update((s) => ({ ...s, load: { ...s.load, vector: { ...(s.load.vector ?? { x: 0, y: 0, z: -1 }), [k]: x } } }), 'Direction de la charge');
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <p class="field-help">
            {study.load.kind === 'mass' ? `Une masse de ${formatNumber(study.load.value, 3)} kg pèse ${formatNumber(study.load.value * 9.81, 1)} N. ` : ''}
            {study.load.direction === 'custom'
              ? 'Seule la direction compte (par exemple 0 ; 1 ; −1 : à 45°, vers +Y et vers le bas). La flèche dans la vue montre le sens choisi.'
              : study.load.kind === 'mass'
                ? 'Le poids tire vers le bas (−Z) : changez le sens si la pièce n’est pas utilisée dans la position où elle est dessinée.'
                : 'La flèche dans la vue montre le sens choisi.'}
          </p>
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
            {info.deformed ? (
              <label class="checkbox-row">
                <input id="sim-animate" type="checkbox" checked={info.animate} onChange={(e) => c.setSimulationAnimate((e.target as HTMLInputElement).checked)} />
                <span>Animer : la pièce va et vient entre sa forme de départ et la déformée</span>
              </label>
            ) : null}
            <p class="field-help">
              Résultat indicatif : la pièce est découpée en {formatNumber(result.cells, 0)} cubes de {formatNumber(result.cellSize, 2)} mm. Une pièce imprimée dépend aussi
              du remplissage et du sens des couches.
            </p>
            {result.ignoredCells > 0 ? (
              <Callout kind="warning">
                Une partie de la matière ne touche aucune face fixée, même par une autre pièce : elle flotterait, elle a été laissée de côté (en bleu, sans
                déformation). Vérifiez que les pièces se touchent vraiment.
              </Callout>
            ) : null}
            {info.large ? (
              <Callout kind="warning">
                La pièce se déforme beaucoup : ce calcul suppose de petites déformations, la forme réelle sera différente. Une pièce souple (TPU) plie souvent
                ainsi sans casser.
              </Callout>
            ) : null}
            {!result.converged ? <Callout kind="warning">Le calcul n’a pas tout à fait abouti : le résultat est approximatif.</Callout> : null}
          </div>
        ) : null}
        {!info.assembly ? <TopologySection partId={partId} missing={info.missing} /> : null}
      </div>
    </aside>
  );
}

/**
 * « Alléger la pièce » (optimisation topologique) : avec les mêmes faces fixées et la même charge,
 * le calcul garde la matière qui travaille. La forme obtenue s'affiche à la place de la pièce ;
 * on peut l'exporter en STL ou la garder comme nouvelle pièce.
 */
function TopologySection({ partId, missing }: { partId: string; missing: string | null }) {
  const c = useController();
  const t = useAppState(
    (s) => {
      const run = s.topologyRun?.partId === partId ? s.topologyRun : null;
      const source = c.simulationSource(partId);
      const study = studyOf(s.doc, partId);
      const key = source ? topologyKey(study, source.key, s.topologyFraction) : '';
      return {
        fraction: s.topologyFraction,
        keep: study.keep?.length ?? 0,
        picking: s.mode.kind === 'pick-sim-face' && s.mode.role === 'keep',
        status: run?.status ?? null,
        progress: run?.progress ?? 0,
        error: run?.error ?? null,
        current: !!run && run.key === key,
        threshold: run?.threshold ?? 0.5,
        figures: run?.result
          ? {
              kept: run.surface ? run.surface.cells / run.result.cells : run.result.volumeFraction,
              stiffness: run.result.complianceFull / run.result.compliance,
              cells: run.result.cells,
              iterations: run.result.iterations,
              seconds: run.result.durationMs / 1000,
              flat: run.result.extrusion !== null,
              saturated: run.result.saturated,
              empty: !run.surface || run.surface.cells === 0,
            }
          : null,
      };
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const pct = (x: number) => `${formatNumber(100 * x, 0)} %`;
  return (
    <section class="topology" aria-labelledby="topo-title">
      <h3 id="topo-title" class="list-title">
        Alléger la pièce
      </h3>
      <p class="field-help">
        Avec les mêmes faces fixées et la même charge, le calcul cherche où la matière travaille vraiment, et garde seulement la part choisie : la pièce
        la plus raide possible avec moins de matière (optimisation topologique).
      </p>
      <div class="field sim-faces">
        <span class="field-label">
          <span class="sim-dot keep" aria-hidden="true" /> Faces à garder : {t.keep}
        </span>
        <div class="sim-face-buttons">
          <Button small icon="target" onClick={() => c.pickSimulationFaces('keep')}>
            {t.picking ? 'Terminé' : 'Choisir'}
          </Button>
          {t.keep ? (
            <button type="button" class="tl-link" onClick={() => c.clearSimulationFaces('keep')}>
              tout retirer
            </button>
          ) : null}
        </div>
        <span class="field-help">Facultatif : le bord d’un perçage, une face d’appui… restent pleins. Les faces fixées et chargées le sont déjà.</span>
      </div>
      <div class="field topology-field">
        <label class="field-label" for="topo-fraction">
          Matière gardée : {pct(t.fraction)}
        </label>
        <input id="topo-fraction" type="range" min={0.1} max={0.9} step={0.05} value={t.fraction} onInput={(e) => c.setTopologyFraction(Number((e.target as HTMLInputElement).value))} />
      </div>
      {t.status === 'running' ? (
        <div class="sim-progress" role="status">
          <progress max={1} value={t.progress} aria-label="Avancement de l’allègement" />
          <Button small onClick={() => c.closeTopology()}>
            Annuler
          </Button>
        </div>
      ) : (
        <Button icon="simulate" disabled={!!missing} disabledReason={missing} onClick={() => void c.runTopology()}>
          Alléger la pièce
        </Button>
      )}
      {t.status === 'error' ? <Callout kind="error">{t.error}</Callout> : null}
      {t.status === 'done' && t.figures ? (
        <div class="topology-result" aria-label="Pièce allégée">
          {!t.current ? <Callout kind="warning">Les réglages ou la pièce ont changé : relancez l’allègement.</Callout> : null}
          <dl class="sim-figures">
            <dt>Matière gardée</dt>
            <dd id="topo-kept">{pct(t.figures.kept)}</dd>
            <dt>Raideur gardée</dt>
            <dd id="topo-stiffness">{pct(t.figures.stiffness)}</dd>
          </dl>
          <div class="field topology-field">
            <label class="field-label" for="topo-threshold">
              Seuil : garder les cubes remplis à au moins {pct(t.threshold)}
            </label>
            <input id="topo-threshold" type="range" min={0.2} max={0.8} step={0.05} value={t.threshold} onInput={(e) => c.setTopologyThreshold(Number((e.target as HTMLInputElement).value))} />
          </div>
          {t.figures.saturated ? (
            <Callout kind="warning">
              Les faces fixées et chargées occupent déjà toute la matière à garder : il n’y a rien à alléger. Choisissez des faces plus petites, ou gardez plus
              de matière.
            </Callout>
          ) : null}
          {t.figures.empty ? <Callout kind="warning">À ce seuil, il ne reste rien : baissez le seuil ou gardez plus de matière.</Callout> : null}
          <div class="topology-actions">
            <Button small icon="export" disabled={t.figures.empty} onClick={() => void c.exportTopologyStl()}>
              Exporter en STL
            </Button>
            <Button small icon="plus" disabled={t.figures.empty} onClick={() => void c.keepTopologyAsPart()}>
              Nouvelle pièce
            </Button>
            <Button small icon="close" onClick={() => c.closeTopology()}>
              Revenir à la pièce
            </Button>
          </div>
          <p class="field-help">
            En orange, la matière utile ({formatNumber(t.figures.cells, 0)} cubes, {t.figures.iterations} étapes de calcul, {formatNumber(t.figures.seconds, 0)} s). C’est une
            forme indicative, en petits cubes lissés : inspirez-vous-en pour redessiner la pièce (trous, nervures), ou imprimez-la telle quelle.
            {t.figures.flat ? ' Pièce plate : la forme est la même dans toute l’épaisseur, les trous la traversent (comme à la découpe laser).' : ''}
          </p>
        </div>
      ) : null}
    </section>
  );
}
