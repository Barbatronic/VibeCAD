/**
 * Scénarios de mouvement (atelier Simulation) : on choisit, liaison par liaison, celles qui
 * pilotent (un curseur règle leur position) et celles qui sont pilotées (leur position est
 * relevée, comme par un capteur). Les autres suivent. Plusieurs scénarios se gardent dans le
 * projet, pour comparer différents choix de pilotage.
 */
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { dofRange, jointDofs, type ScenarioReading } from '../app/mechanism';
import { LAW_STEPS_MAX, LAW_STEPS_MIN, type ControlLaw, type LawAxis } from '../app/control-law';
import type { MotionDof } from '../domain/model';
import { formatNumber, readNumber } from '../domain/units';
import { JOINT_LABELS } from '../domain/document';
import { useAppState, useController } from './context';
import { Button, Callout, IconButton } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';

const DOF_LABELS: Record<MotionDof, string> = { angle: 'rotation', offset: 'translation' };
const unitOf = (dof: MotionDof) => (dof === 'angle' ? '°' : 'mm');
const show = (v: number, dof: MotionDof) => `${formatNumber(v, dof === 'angle' ? 1 : 2)} ${unitOf(dof)}`;

/** Liste des scénarios (panneau de gauche, sous le choix de l'étude). */
export function ScenarioList() {
  const c = useController();
  const list = useAppState(() => c.scenarios());
  const current = useAppState(() => c.currentScenario()?.id ?? null);
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <section class="panel-section grow" aria-labelledby="scenario-title">
      <div class="panel-header">
        <span id="scenario-title">Scénarios</span>
        {list.length ? <span class="count">{list.length}</span> : null}
        <span class="spacer" />
        <IconButton id="scenario-add" icon="plus" small label="Nouveau scénario" onClick={() => c.addScenario()} />
      </div>
      <div class="panel-body">
        {list.length === 0 ? <p class="empty-hint">Aucun scénario.</p> : null}
        <ul class="feature-list sim-parts" role="radiogroup" aria-label="Scénarios">
          {list.map((s) => (
            <li key={s.id} class="scenario-row">
              {renaming === s.id ? (
                <input
                  class="rename-input"
                  aria-label="Nom du scénario"
                  value={s.name}
                  ref={(el) => el?.focus()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => {
                    setRenaming(null);
                    c.renameScenario(s.id, (e.target as HTMLInputElement).value);
                  }}
                />
              ) : (
                <button type="button" role="radio" aria-checked={s.id === current} class={`sim-part${s.id === current ? ' is-current' : ''}`} onClick={() => c.openScenario(s.id)} onDblClick={() => setRenaming(s.id)}>
                  <Icon name="play" />
                  <span>{s.name}</span>
                  <span class="scenario-counts">
                    {s.drivers.length} / {s.sensors.length}
                  </span>
                </button>
              )}
              <IconButton icon="rename" small label={`Renommer « ${s.name} »`} onClick={() => setRenaming(s.id)} />
              <IconButton icon="trash" small label={`Supprimer « ${s.name} »`} onClick={() => c.removeScenario(s.id)} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Scénario ouvert (panneau de droite) : rôle de chaque liaison, curseurs des pilotantes, relevés des pilotées. */
export function ScenarioPanel() {
  const c = useController();
  const scenario = useAppState(() => c.currentScenario());
  const joints = useAppState((s) => s.doc.assembly?.joints ?? []);
  const live = useAppState((s) => s.scenarioLive);
  // Relevés recalculés à chaque réglage (le placement est celui de la vue).
  const state = useAppState(() => c.scenarioState(), (a, b) => JSON.stringify(a?.readings) === JSON.stringify(b?.readings) && a?.blocked === b?.blocked);
  if (!scenario) {
    return (
      <aside class="panel right-panel" aria-label="Scénario de mouvement">
        <div class="panel-title">
          <Icon name="play" />
          <span>Scénarios de mouvement</span>
        </div>
        <div class="panel-content">
          <p class="empty-hint">Aucun scénario.</p>
          <button type="button" class="btn btn-primary" onClick={() => c.addScenario()}>
            Nouveau scénario
          </button>
        </div>
      </aside>
    );
  }
  const roleOf = (jointId: string, dof: MotionDof) =>
    scenario.drivers.some((d) => d.jointId === jointId && d.dof === dof) ? 'driver' : scenario.sensors.some((d) => d.jointId === jointId && d.dof === dof) ? 'sensor' : null;
  const rows = joints.flatMap((j) => jointDofs(j).map((dof) => ({ joint: j, dof, many: jointDofs(j).length > 1 })));
  // Survol d'une liaison (souris ou clavier) : elle est montrée sur l'assemblage.
  // `parts` : liste des liaisons (choix) ; au pilotage (curseurs, relevés), seuls les repères.
  const hoverProps = (jointId: string, parts = false) => ({
    onMouseEnter: () => c.setHoverJoint(jointId, parts),
    onMouseLeave: () => c.setHoverJoint(null),
    onFocusIn: () => c.setHoverJoint(jointId, parts),
    onFocusOut: () => c.setHoverJoint(null),
  });
  const reading = (jointId: string, dof: MotionDof): ScenarioReading | undefined => state?.readings.find((r) => r.jointId === jointId && r.dof === dof);
  return (
    <aside class="panel right-panel" aria-label="Scénario de mouvement">
      <div class="panel-title">
        <Icon name="play" />
        <span>{scenario.name}</span>
      </div>
      <div class="panel-content">
        {state?.blocked ? <Callout kind="warning">Ces réglages ne permettent pas de refermer le mécanisme : les pièces restent à leur dernière position possible.</Callout> : null}
        <h3 class="list-title">Pilotantes</h3>
        {scenario.drivers.length === 0 ? <p class="field-help">Aucune.</p> : null}
        {scenario.drivers.map((d) => {
          const joint = joints.find((j) => j.id === d.jointId);
          if (!joint) return null;
          const [lo, hi] = dofRange(joint, d.dof);
          const value = live[`${d.jointId}:${d.dof}`] ?? d.value;
          return (
            <div key={`${d.jointId}:${d.dof}`} class="field scenario-driver" {...hoverProps(d.jointId)}>
              <label class="field-label" for={`drv-${d.jointId}-${d.dof}`}>
                {joint.name}
                {jointDofs(joint).length > 1 ? ` · ${DOF_LABELS[d.dof]}` : ''} : <strong>{show(value, d.dof)}</strong>
              </label>
              <input
                id={`drv-${d.jointId}-${d.dof}`}
                type="range"
                min={lo}
                max={hi}
                step={d.dof === 'angle' ? 0.5 : 0.1}
                value={value}
                aria-valuetext={show(value, d.dof)}
                onInput={(e) => c.setScenarioDriver(d.jointId, d.dof, Number((e.target as HTMLInputElement).value), true)}
                onChange={(e) => c.setScenarioDriver(d.jointId, d.dof, Number((e.target as HTMLInputElement).value))}
              />
              <NumberInput
                value={formatNumber(d.value, 2)}
                unit={unitOf(d.dof)}
                min={-100000}
                ariaLabel={`${joint.name} : réglage exact`}
                onInput={(t) => {
                  const v = readNumber(t);
                  if (v !== null) c.setScenarioDriver(d.jointId, d.dof, v);
                }}
              />
            </div>
          );
        })}
        <h3 class="list-title">Pilotées</h3>
        {scenario.sensors.length === 0 ? <p class="field-help">Aucune.</p> : null}
        {scenario.sensors.length ? (
          <dl class="props-list scenario-sensors" aria-label="Positions relevées">
            {scenario.sensors.map((s) => {
              const joint = joints.find((j) => j.id === s.jointId);
              if (!joint) return null;
              const r = reading(s.jointId, s.dof);
              return [
                <dt key={`t${s.jointId}${s.dof}`} {...hoverProps(s.jointId)}>
                  {joint.name}
                  {jointDofs(joint).length > 1 ? ` · ${DOF_LABELS[s.dof]}` : ''}
                </dt>,
                <dd key={`d${s.jointId}${s.dof}`} id={`sensor-${s.jointId}-${s.dof}`}>
                  {r && r.value !== null ? show(r.value, s.dof) : '—'}
                </dd>,
              ];
            })}
          </dl>
        ) : null}
        <h3 class="list-title">Liaisons</h3>
        <ul class="scenario-joints" aria-label="Rôle des liaisons dans le scénario">
          {rows.map(({ joint, dof, many }) => {
            const role = roleOf(joint.id, dof);
            const set = (next: 'driver' | 'sensor' | null) => c.setScenarioRole(joint.id, dof, role === next ? null : next);
            return (
              <li key={`${joint.id}:${dof}`} {...hoverProps(joint.id, true)}>
                <Icon name={`joint-${joint.kind}`} />
                <span class="name" title={`${joint.name} · ${JOINT_LABELS[joint.kind]}`}>
                  {joint.name}
                  {many ? ` · ${DOF_LABELS[dof]}` : ''}
                </span>
                <span class="segmented small" role="group" aria-label={`Rôle de ${joint.name}${many ? ` (${DOF_LABELS[dof]})` : ''}`}>
                  <button type="button" aria-pressed={role === 'driver'} onClick={() => set('driver')} title="Pilotante : réglée au curseur">
                    Pilote
                  </button>
                  <button type="button" aria-pressed={role === 'sensor'} onClick={() => set('sensor')} title="Pilotée : position relevée">
                    Relevé
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        <p class="field-help">Les liaisons ni pilotantes ni pilotées suivent le mouvement.</p>
        <ControlLawSection />
      </div>
    </aside>
  );
}

/**
 * Loi de pilotage : pour des positions voulues des pilotées, les réglages à donner aux pilotantes
 * (servomoteurs pilotés par un microcontrôleur). Grille calculée, vérifiée, exportée en C et CSV.
 */
function ControlLawSection() {
  const c = useController();
  const scenario = useAppState(() => c.currentScenario());
  const joints = useAppState((s) => s.doc.assembly?.joints ?? []);
  const spec = useAppState(() => c.controlLawSpec(), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const run = useAppState((s) => (s.controlLaw && s.controlLaw.scenarioId === scenario?.id ? s.controlLaw : null));
  const stale = useAppState(() => c.controlLawStale());
  if (!scenario) return null;
  const nameOf = (x: { jointId: string; dof: MotionDof }) => {
    const j = joints.find((y) => y.id === x.jointId);
    return `${j?.name ?? '?'}${j && jointDofs(j).length > 1 ? ` · ${DOF_LABELS[x.dof]}` : ''}`;
  };
  const same = (a: { jointId: string; dof: MotionDof }, b: { jointId: string; dof: MotionDof }) => a.jointId === b.jointId && a.dof === b.dof;
  if (!spec) {
    return (
      <>
        <h3 class="list-title">Loi de pilotage</h3>
        <p class="field-help">Il faut au moins une pilotante et une pilotée.</p>
      </>
    );
  }
  const rangeOf = (x: { jointId: string; dof: MotionDof }) => {
    const j = joints.find((y) => y.id === x.jointId);
    const [min, max] = j ? dofRange(j, x.dof) : [-90, 90];
    return { min, max };
  };
  // Autant de commandes que de positions voulues : la liste suit quand on coche ou décoche.
  const toggleOutput = (o: { jointId: string; dof: MotionDof }) => {
    const on = spec.outputs.some((x) => same(x, o));
    const outputs = on ? spec.outputs.filter((x) => !same(x, o)) : [...spec.outputs, o].slice(-2);
    if (outputs.length === 0) return;
    const kept = spec.inputs.slice(0, outputs.length);
    const extra = scenario.drivers.filter((d) => !kept.some((x) => same(x, d))).slice(0, outputs.length - kept.length);
    c.setControlLawSpec({ ...spec, outputs, inputs: [...kept, ...extra.map((d) => ({ jointId: d.jointId, dof: d.dof, ...rangeOf(d) }))], steps: outputs.length === 1 ? Math.max(spec.steps, 41) : Math.min(spec.steps, 41) });
  };
  const toggleInput = (d: { jointId: string; dof: MotionDof }) => {
    if (spec.inputs.some((x) => same(x, d))) return;
    const inputs = [...spec.inputs, { jointId: d.jointId, dof: d.dof, ...rangeOf(d) }].slice(-spec.outputs.length);
    c.setControlLawSpec({ ...spec, inputs });
  };
  const setRange = (k: number, patch: { min?: number; max?: number }) => c.setControlLawSpec({ ...spec, inputs: spec.inputs.map((x, i) => (i === k ? { ...x, ...patch } : x)) });
  const law = run?.law;
  return (
    <div class="control-law" role="group" aria-labelledby="law-title">
      <h3 class="list-title" id="law-title">
        Loi de pilotage
      </h3>
      <p class="field-help">Positions voulues des pilotées → réglages à donner aux pilotantes.</p>
      <fieldset class="law-choice">
        <legend class="field-label">Positions voulues</legend>
        {scenario.sensors.map((o) => (
          <label class="checkbox-row" key={`${o.jointId}:${o.dof}`} {...hoverOf(c, o.jointId)}>
            <input type="checkbox" checked={spec.outputs.some((x) => same(x, o))} onChange={() => toggleOutput(o)} />
            <span>{nameOf(o)}</span>
          </label>
        ))}
      </fieldset>
      <fieldset class="law-choice">
        <legend class="field-label">Réglages calculés</legend>
        {scenario.drivers.map((d) => {
          const k = spec.inputs.findIndex((x) => same(x, d));
          return (
            <div key={`${d.jointId}:${d.dof}`} class="law-input" {...hoverOf(c, d.jointId)}>
              <label class="checkbox-row">
                <input type="checkbox" checked={k >= 0} onChange={() => toggleInput(d)} />
                <span>{nameOf(d)}</span>
                {k < 0 ? <span class="field-help"> reste à {show(d.value, d.dof)}</span> : null}
              </label>
              {k >= 0 ? (
                <div class="limits-row">
                  <label class="mini-field">
                    <span>De</span>
                    <NumberInput value={formatNumber(spec.inputs[k]!.min, 2)} unit={unitOf(d.dof)} ariaLabel={`${nameOf(d)} : début du balayage`} onInput={(t) => { const v = readNumber(t); if (v !== null) setRange(k, { min: v }); }} />
                  </label>
                  <label class="mini-field">
                    <span>À</span>
                    <NumberInput value={formatNumber(spec.inputs[k]!.max, 2)} unit={unitOf(d.dof)} ariaLabel={`${nameOf(d)} : fin du balayage`} onInput={(t) => { const v = readNumber(t); if (v !== null) setRange(k, { max: v }); }} />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      <label class="mini-field">
        <span>Points par axe</span>
        <NumberInput
          value={String(spec.steps)}
          unit="pts"
          step={1}
          min={LAW_STEPS_MIN}
          max={LAW_STEPS_MAX}
          ariaLabel="Loi de pilotage : points par axe"
          onInput={(t) => {
            const v = readNumber(t);
            if (v !== null && v >= LAW_STEPS_MIN && v <= LAW_STEPS_MAX) c.setControlLawSpec({ ...spec, steps: Math.round(v) });
          }}
        />
      </label>
      <div class="fab-face">
        <Button small variant="primary" icon="play" disabled={run?.status === 'running'} onClick={() => void c.computeControlLaw()}>
          {run?.status === 'running' ? `Calcul… ${Math.round((100 * run.done) / Math.max(1, run.total))} %` : 'Calculer la loi'}
        </Button>
      </div>
      {law && run?.status === 'done' ? (
        <>
          {stale ? <Callout kind="warning">Les réglages ou l’assemblage ont changé : recalculez la loi.</Callout> : null}
          <LawPreview law={law} />
          <dl class="props-list">
            {law.axes.map((a, k) => (
              <Fragment key={k}>
                <dt>{nameOf(spec.outputs[k]!)}</dt>
                <dd>
                  {show(a.min, spec.outputs[k]!.dof)} à {show(a.max, spec.outputs[k]!.dof)}
                </dd>
              </Fragment>
            ))}
            {law.axes.length === 2 ? (
              <>
                <dt>Accessible</dt>
                <dd>{Math.round(law.coverage * 100)} % de la grille</dd>
              </>
            ) : null}
            {run.maxError ? (
              <>
                <dt>Écart vérifié</dt>
                <dd>{run.maxError.map((e, k) => `± ${show(e, spec.outputs[k]!.dof)}`).join(' · ')}</dd>
              </>
            ) : null}
          </dl>
          {law.notes.map((n) => (
            <Callout key={n} kind="info">
              {n}
            </Callout>
          ))}
          <div class="fab-face">
            <Button small icon="export" onClick={() => void c.exportControlLaw('h')}>
              En-tête C (.h)
            </Button>
            <Button small icon="export" onClick={() => void c.exportControlLaw('csv')}>
              CSV
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Survol d'une liaison dans la loi : ses repères seulement (comme au pilotage). */
const hoverOf = (c: ReturnType<typeof useController>, jointId: string) => ({
  onMouseEnter: () => c.setHoverJoint(jointId, false),
  onMouseLeave: () => c.setHoverJoint(null),
});

/** Aperçu de la loi : courbe (une commande) ou carte des positions accessibles (deux commandes). */
function LawPreview(props: { law: ControlLaw }) {
  const { law } = props;
  const W = 240;
  const H = 120;
  if (law.axes.length === 1) {
    const t = law.tables[0]!;
    const vals = Array.from(t).filter((v) => Number.isFinite(v));
    if (vals.length < 2) return null;
    const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
    const pts = Array.from(t, (v, k) => (Number.isFinite(v) ? `${(k / (t.length - 1)) * W},${H - ((v - lo) / (hi - lo || 1)) * H}` : null)).filter(Boolean);
    return (
      <svg class="law-preview" viewBox={`-4 -4 ${W + 8} ${H + 8}`} role="img" aria-label="Courbe de la loi : réglage en fonction de la position voulue">
        <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" stroke-width="2" />
      </svg>
    );
  }
  const [a1, a2] = law.axes as [LawAxis, LawAxis];
  const t = law.tables[0]!;
  const cw = W / a1.n;
  const ch = H / a2.n;
  return (
    <svg class="law-preview" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Positions voulues accessibles (en couleur)">
      {Array.from(t, (v, k) => (Number.isFinite(v) ? <rect key={k} x={Math.floor(k / a2.n) * cw} y={H - ((k % a2.n) + 1) * ch} width={cw + 0.5} height={ch + 0.5} fill="var(--accent)" opacity="0.55" /> : null))}
    </svg>
  );
}
