/**
 * Scénarios de mouvement (atelier Simulation) : on choisit, liaison par liaison, celles qui
 * pilotent (un curseur règle leur position) et celles qui sont pilotées (leur position est
 * relevée, comme par un capteur). Les autres suivent. Plusieurs scénarios se gardent dans le
 * projet, pour comparer différents choix de pilotage.
 */
import { useState } from 'preact/hooks';
import { dofRange, jointDofs, type ScenarioReading } from '../app/mechanism';
import type { MotionDof } from '../domain/model';
import { formatNumber, readNumber } from '../domain/units';
import { JOINT_LABELS } from '../domain/document';
import { useAppState, useController } from './context';
import { Callout, IconButton } from './components/controls';
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
            <div key={`${d.jointId}:${d.dof}`} class="field scenario-driver">
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
                <dt key={`t${s.jointId}${s.dof}`}>
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
              <li key={`${joint.id}:${dof}`}>
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
      </div>
    </aside>
  );
}
