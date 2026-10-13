/**
 * Engrenages et crémaillères entre liaisons (onglet Assemblage) : la liste sous les liaisons et le
 * panneau de réglage. Voir `JointCoupling` et `solveAssembly`.
 */
import { useEffect, useState } from 'preact/hooks';
import { couplingProblem, couplingRatio, jointFreedoms } from '../app/assembly';
import type { JointCoupling } from '../domain/model';
import { formatNumber, readNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { Button, Callout, IconButton, Segmented } from './components/controls';
import { NumberInput } from './components/number-input';
import { Icon } from './icons';

const KIND_LABELS = { gear: 'Engrenage', rack: 'Crémaillère' } as const;

/** Liste des couplages, sous les liaisons, avec le bouton pour en ajouter un. */
export function CouplingList() {
  const c = useController();
  const data = useAppState(
    (s) => {
      const a = s.doc.assembly;
      const joints = a?.joints ?? [];
      const name = (id: string) => joints.find((j) => j.id === id)?.name ?? '?';
      return {
        canAdd: joints.length >= 2 && joints.some((j) => j.kind === 'revolute' || j.kind === 'cylindrical'),
        couplings: (a?.couplings ?? []).map((k) => ({ id: k.id, name: k.name, kind: k.kind, text: `${name(k.driver)} → ${name(k.driven)}`, problem: a ? couplingProblem(a, k) : null })),
        sel: s.assemblySelection,
      };
    },
    (x, y) => JSON.stringify(x) === JSON.stringify(y),
  );
  if (!data.canAdd && data.couplings.length === 0) return null;
  return (
    <>
      <h3 class="list-title">Engrenages et crémaillères</h3>
      <ul class="feature-list" aria-label="Engrenages et crémaillères">
        {data.couplings.map((k) => {
          const selected = data.sel?.kind === 'coupling' && data.sel.id === k.id;
          return (
            <li key={k.id}>
              <div class={`feature-row${selected ? ' is-selected' : ''}`}>
                <button type="button" class="feature-main" aria-pressed={selected} onClick={() => c.selectInAssembly({ kind: 'coupling', id: k.id })}>
                  <Icon name={k.kind === 'rack' ? 'gear-rack' : 'gear-spur'} class="feature-icon" />
                  <span class="feature-texts">
                    <span class="name">{k.name}</span>
                    <span class="status-line">
                      {k.problem ? <span class="status-badge status-error">Souci</span> : null}
                      <span class="summary">{k.text}</span>
                    </span>
                  </span>
                </button>
                <span class="row-actions">
                  <IconButton icon="trash" small label={`Supprimer « ${k.name} »`} onClick={() => c.removeCoupling(k.id)} />
                </span>
              </div>
              {k.problem ? <div class="feature-issue error">{k.problem}</div> : null}
            </li>
          );
        })}
      </ul>
      {data.canAdd ? (
        <Button small icon="plus" onClick={() => c.addCoupling()}>
          Coupler deux liaisons
        </Button>
      ) : null}
    </>
  );
}

/** Champ numérique validé à chaque saisie correcte. */
function CouplingNumber(props: { id: string; label: string; unit: string; value: number; help?: string; onChange: (v: number) => void }) {
  const [text, setText] = useState(formatNumber(props.value, 3));
  useEffect(() => setText(formatNumber(props.value, 3)), [props.value]);
  return (
    <div class="field">
      <label class="field-label" for={props.id}>
        {props.label}
      </label>
      <NumberInput
        id={props.id}
        value={text}
        unit={props.unit}
        onInput={(t) => {
          setText(t);
          const v = readNumber(t);
          if (v !== null) props.onChange(v);
        }}
      />
      {props.help ? <span class="field-help">{props.help}</span> : null}
    </div>
  );
}

/** Panneau de réglage d'un couplage (panneau de droite). */
export function CouplingPanel({ coupling: k }: { coupling: JointCoupling }) {
  const c = useController();
  const assembly = useAppState((s) => s.doc.assembly);
  if (!assembly) return null;
  const joints = assembly.joints;
  const drivers = joints.filter((j) => j.kind === 'revolute' || j.kind === 'cylindrical');
  const drivens = joints.filter((j) => j.id !== k.driver && (jointFreedoms(j.kind).angle || jointFreedoms(j.kind).offset) && j.kind !== 'spherical');
  const problem = couplingProblem(assembly, k);
  const ratio = couplingRatio(k);
  const set = (patch: Partial<JointCoupling>) => c.updateCoupling(k.id, patch);
  return (
    <>
      <div class="panel-title">
        <Icon name={k.kind === 'rack' ? 'gear-rack' : 'gear-spur'} />
        <span>{k.name}</span>
      </div>
      <p class="panel-intro">
        {k.kind === 'gear'
          ? 'Deux roues qui engrènent : quand la première tourne, la seconde tourne aussi, plus ou moins vite selon le nombre de dents.'
          : 'Une roue et une crémaillère : quand la roue tourne, la crémaillère avance.'}
      </p>
      <div class="panel-content">
        <Segmented<'gear' | 'rack'>
          label="Type"
          value={k.kind}
          options={[
            { value: 'gear', label: KIND_LABELS.gear, title: 'Deux pivots : roue dentée, poulies et courroie' },
            { value: 'rack', label: KIND_LABELS.rack, title: 'Un pivot (la roue) et une glissière (la crémaillère)' },
          ]}
          onChange={(kind) => set({ kind })}
        />
        <label class="field">
          <span class="field-label">Liaison menante (la roue que l’on tourne)</span>
          <select id="coupling-driver" class="select" value={k.driver} onChange={(e) => set({ driver: (e.target as HTMLSelectElement).value })}>
            {drivers.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="field-label">{k.kind === 'rack' ? 'Liaison de la crémaillère (glissière)' : 'Liaison menée (l’autre roue)'}</span>
          <select id="coupling-driven" class="select" value={k.driven} onChange={(e) => set({ driven: (e.target as HTMLSelectElement).value })}>
            {drivens.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        {k.kind === 'gear' ? (
          <div class="limits-row">
            <CouplingNumber id="coupling-teeth1" label="Dents (menante)" unit="dents" value={k.teeth[0]} onChange={(v) => v >= 1 && set({ teeth: [Math.round(v), k.teeth[1]] })} />
            <CouplingNumber id="coupling-teeth2" label="Dents (menée)" unit="dents" value={k.teeth[1]} onChange={(v) => v >= 1 && set({ teeth: [k.teeth[0], Math.round(v)] })} />
          </div>
        ) : (
          <CouplingNumber
            id="coupling-diameter"
            label="Diamètre primitif de la roue"
            unit="mm"
            value={k.pitchDiameter}
            help="Module × nombre de dents (le générateur de roue dentée l’indique)."
            onChange={(v) => v > 0 && set({ pitchDiameter: v })}
          />
        )}
        <label class="checkbox-row">
          <input id="coupling-reversed" type="checkbox" checked={k.reversed} onChange={() => set({ reversed: !k.reversed })} />
          <span>{k.kind === 'gear' ? 'Même sens de rotation (courroie, couronne intérieure)' : 'Inverser le sens d’avance'}</span>
        </label>
        <CouplingNumber
          id="coupling-phase"
          label="Calage"
          unit={k.kind === 'rack' ? 'mm' : '°'}
          value={k.phase}
          help="Tourne (ou fait glisser) la pièce menée seule, pour que les dents tombent bien entre elles."
          onChange={(phase) => set({ phase })}
        />
        <p class="field-help" id="coupling-ratio">
          {k.kind === 'gear'
            ? `Un tour de la menante fait ${formatNumber(Math.abs(ratio), 3)} tour de la menée${ratio > 0 ? ', dans le même sens' : ', en sens opposé'}.`
            : `Un tour de la roue fait avancer la crémaillère de ${formatNumber(Math.abs(ratio) * 360, 2)} mm.`}{' '}
          Animez la liaison menante (dans ses réglages) pour voir le mécanisme tourner.
        </p>
        {problem ? (
          <Callout kind="error">
            <p>{problem}</p>
          </Callout>
        ) : null}
      </div>
      <div class="panel-actions">
        <Button icon="trash" onClick={() => c.removeCoupling(k.id)}>
          Supprimer
        </Button>
      </div>
    </>
  );
}
