/**
 * Paramètres du projet (panneau de gauche, onglet Pièces) : des nombres nommés (nom = valeur ou
 * équation) utilisables dans les cotes d'esquisse et dans tous les champs numériques. Changer un
 * paramètre met à jour tout ce qui l'utilise.
 */
import { useState } from 'preact/hooks';
import { resolveParameters } from '../features/parameters';
import { formatNumber } from '../domain/units';
import { useAppState, useController } from './context';
import { IconButton } from './components/controls';
import { Icon } from './icons';

/** Champ texte validé à la sortie (Entrée ou clic ailleurs) ; une saisie vide ou refusée revient à l'ancienne valeur. */
function CommitInput(props: { value: string; label: string; class: string; onCommit: (text: string) => void }) {
  return (
    <input
      key={props.value}
      class={`input ${props.class}`}
      aria-label={props.label}
      defaultValue={props.value}
      spellcheck={false}
      autoComplete="off"
      onChange={(e) => {
        const input = e.target as HTMLInputElement;
        const text = input.value.trim();
        if (text && text !== props.value) props.onCommit(text);
        // Saisie acceptée : le champ est recréé avec la nouvelle valeur (clé) ; refusée : il revient à l'ancienne.
        input.value = props.value;
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          (e.target as HTMLInputElement).value = props.value;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Valeur tapée telle quelle : inutile de répéter le résultat en dessous. */
const PLAIN_NUMBER = /^\s*-?\d+([.,]\d+)?\s*$/;

export function ParametersSection() {
  const c = useController();
  const params = useAppState((s) => s.doc.parameters ?? []);
  // Repliée tant qu'il n'y a aucun paramètre : elle ne prend pas de place à qui ne s'en sert pas.
  const [open, setOpen] = useState(params.length > 0);
  const { values, errors } = resolveParameters(params);
  return (
    <section class="panel-section params-section" aria-labelledby="params-title">
      <div class="panel-header">
        <button type="button" class="section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          <span id="params-title">Paramètres</span>
          {params.length ? <span class="count">{params.length}</span> : null}
        </button>
        <span class="spacer" />
        <IconButton
          icon="plus"
          label="Ajouter un paramètre"
          small
          onClick={() => {
            setOpen(true);
            c.addParameter();
          }}
        />
      </div>
      {open ? (
        <div class="panel-body">
          {params.length === 0 ? (
            <p class="field-help">
              Des nombres nommés à utiliser dans les cotes et les champs (par exemple <code>largeur/2</code>). Changer un paramètre met à jour toute la
              pièce.
            </p>
          ) : (
            <ul class="params-list">
              {params.map((p, i) => {
                const error = errors.get(p.name);
                const value = values.get(p.name.toLowerCase());
                return (
                  <li key={i} class={`param-row${error ? ' has-error' : ''}`}>
                    <CommitInput class="param-name" label={`Nom du paramètre ${i + 1}`} value={p.name} onCommit={(name) => c.updateParameter(i, { name })} />
                    <span class="param-equals">=</span>
                    <CommitInput
                      class="param-expression"
                      label={`Valeur ou équation de « ${p.name} »`}
                      value={p.expression}
                      onCommit={(expression) => c.updateParameter(i, { expression })}
                    />
                    <IconButton icon="trash" small label={`Supprimer le paramètre « ${p.name} »`} onClick={() => c.removeParameter(i)} />
                    {error ? (
                      <span class="param-value">
                        <Icon name="warning" /> {error}
                      </span>
                    ) : value !== undefined && !PLAIN_NUMBER.test(p.expression) ? (
                      <span class="param-value">= {formatNumber(value, 3)}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
