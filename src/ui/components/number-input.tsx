/**
 * Champ numérique avec unité, petites flèches ▲▼ et molette : utilisé pour toutes les saisies
 * de valeurs (paramètres d'opérations, cotes, dimensions tapées pendant un tracé).
 * Pas : 1 (Maj : ×10, Alt : ×0,1). Les flèches du clavier ↑ ↓ font de même.
 * La saisie reste du texte libre (virgule, expressions comme 60/2) : seules les flèches et la
 * molette la transforment en nombre.
 *
 * Noms proposés (paramètres du projet, fournis par `InputSuggestions`) : une liste s'ouvre sous le
 * champ dès qu'on tape des lettres, ou par le bouton « ƒ » ; elle est triée du nom le plus proche
 * au plus lointain. ↑ ↓ pour choisir, Entrée ou Tab pour insérer, Échap pour fermer.
 */
import { createContext, type JSX, type Ref } from 'preact';
import { createPortal } from 'preact/compat';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { formatNumber, stepNumberText, type StepRules } from '../../domain/units';
import { Icon } from '../icons';

export interface NumberInputProps extends StepRules {
  value: string;
  onInput: (text: string) => void;
  unit?: string;
  /** Pas de base (1 par défaut). */
  step?: number;
  id?: string;
  ariaLabel?: string;
  describedBy?: string;
  invalid?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => void;
  onFocus?: (e: JSX.TargetedFocusEvent<HTMLInputElement>) => void;
}

export interface InputSuggestion {
  name: string;
  /** Précision affichée à droite (valeur, équation). */
  detail?: string;
}

/** Noms proposés sous les champs numériques ; liste vide : ni bouton ni liste. */
export const InputSuggestions = createContext<readonly InputSuggestion[]>([]);

/** Minuscules sans accents, pour comparer des noms. */
const fold = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Nom en cours de saisie juste avant le curseur (vide si on tape un nombre ou un opérateur). */
export function tokenBefore(text: string, caret: number): string {
  return /[\p{L}_][\p{L}\p{N}_]*$/u.exec(text.slice(0, caret))?.[0] ?? '';
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Noms triés du plus proche au plus lointain de `token` (casse et accents ignorés) : début du nom,
 * début d'un mot du nom (après _), contenu, lettres dans l'ordre, puis les autres par ressemblance.
 */
export function rankSuggestions<T extends InputSuggestion>(items: readonly T[], token: string): T[] {
  const t = fold(token);
  const rank = (name: string): [number, number] => {
    const n = fold(name);
    if (!t) return [0, 0];
    if (n.startsWith(t)) return [0, n.length - t.length];
    if (n.split('_').some((w) => w.startsWith(t))) return [1, n.length];
    if (n.includes(t)) return [2, n.indexOf(t)];
    let k = 0;
    for (const ch of n) if (ch === t[k]) k++;
    if (k === t.length) return [3, n.length];
    return [4, editDistance(t, n.slice(0, t.length + 2))];
  };
  return items
    .map((item) => ({ item, r: rank(item.name) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.item.name.localeCompare(b.item.name))
    .map((x) => x.item);
}

const WHEEL_THRESHOLD = 40;
const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 70;

export function stepFor(base: number, e: { shiftKey: boolean; altKey: boolean }): number {
  if (e.shiftKey) return base * 10;
  if (e.altKey) return base / 10;
  return base;
}

export function NumberInput(props: NumberInputProps) {
  const latest = useRef(props);
  latest.current = props;
  const wheelAcc = useRef(0);
  const repeat = useRef<{ timer: number; interval: number | null } | null>(null);
  const unit = props.unit ?? 'mm';
  const base = props.step ?? 1;
  const suggestions = useContext(InputSuggestions);
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  /** Liste ouverte par le bouton ƒ (sinon : seulement pendant qu'on tape un nom). */
  const [forced, setForced] = useState(false);
  const [choice, setChoice] = useState({ key: '', index: 0 });
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const token = caret === null ? '' : tokenBefore(props.value, caret);
  const ranked = suggestions.length && (forced || (token && closedFor !== token)) ? rankSuggestions(suggestions, token) : [];
  // Nom déjà tapé en entier : Entrée valide la saisie au lieu d'insérer.
  const complete = !forced && ranked.some((x) => fold(x.name) === fold(token));
  const open = ranked.length > 0;
  const listId = useRef(`suggest-${Math.random().toString(36).slice(2, 9)}`).current;
  // Le choix dans la liste revient au premier nom dès que la saisie change.
  const choiceKey = `${forced}|${token}`;
  const active = choice.key === choiceKey ? choice.index : 0;
  const setActive = (index: number) => setChoice({ key: choiceKey, index });

  const setInputRef = (el: HTMLInputElement | null) => {
    input.current = el;
    const r = props.inputRef;
    if (typeof r === 'function') r(el);
    else if (r) r.current = el;
  };
  const trackCaret = () => setCaret(input.current?.selectionStart ?? null);
  const close = () => {
    setForced(false);
    setClosedFor(token);
  };
  const insert = (name: string) => {
    const el = input.current;
    const at = caret ?? props.value.length;
    const before = props.value.slice(0, at - token.length);
    props.onInput(before + name + props.value.slice(at));
    setForced(false);
    setClosedFor(name);
    const pos = before.length + name.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const stepBy = (direction: 1 | -1, step: number) => {
    const p = latest.current;
    const rules: StepRules = {};
    if (p.min !== undefined) rules.min = p.min;
    if (p.max !== undefined) rules.max = p.max;
    if (p.fallback !== undefined) rules.fallback = p.fallback;
    const next = stepNumberText(p.value, direction, step, rules);
    if (next !== null) p.onInput(next);
  };

  const stopRepeat = () => {
    const r = repeat.current;
    if (!r) return;
    clearTimeout(r.timer);
    if (r.interval !== null) clearInterval(r.interval);
    repeat.current = null;
  };
  useEffect(() => stopRepeat, []);

  const startRepeat = (direction: 1 | -1, e: PointerEvent) => {
    // Le champ garde le focus (Entrée valide toujours la saisie).
    e.preventDefault();
    if (e.button !== 0) return;
    const step = stepFor(base, e);
    stepBy(direction, step);
    stopRepeat();
    const r: { timer: number; interval: number | null } = { timer: 0, interval: null };
    r.timer = window.setTimeout(() => {
      r.interval = window.setInterval(() => stepBy(direction, step), REPEAT_INTERVAL);
    }, REPEAT_DELAY);
    repeat.current = r;
  };

  const onWheel = (e: WheelEvent) => {
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (delta === 0) return;
    e.preventDefault();
    // Une encoche de molette = un pas ; les pavés tactiles (petits déplacements) sont cumulés.
    wheelAcc.current += e.deltaMode === 0 ? delta : Math.sign(delta) * WHEEL_THRESHOLD;
    if (Math.abs(wheelAcc.current) < WHEEL_THRESHOLD) return;
    const direction = wheelAcc.current < 0 ? 1 : -1;
    wheelAcc.current = 0;
    stepBy(direction, stepFor(base, e));
  };

  const stepLabel = `${formatNumber(base)} ${unit}`;
  return (
    <div class={`input-with-unit has-stepper${props.invalid ? ' has-error' : ''}`} onWheel={onWheel} ref={field}>
      <input
        ref={setInputRef}
        id={props.id}
        inputMode="decimal"
        autoComplete="off"
        spellcheck={false}
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        aria-invalid={props.invalid ? 'true' : 'false'}
        aria-describedby={props.describedBy}
        {...(suggestions.length
          ? {
              role: 'combobox',
              'aria-autocomplete': 'list',
              'aria-expanded': open ? 'true' : 'false',
              'aria-controls': listId,
              ...(open ? { 'aria-activedescendant': `${listId}-${active}` } : {}),
            }
          : {})}
        onInput={(e) => {
          const el = e.target as HTMLInputElement;
          setCaret(el.selectionStart);
          props.onInput(el.value);
        }}
        onFocus={(e) => {
          trackCaret();
          props.onFocus?.(e);
        }}
        onBlur={() => {
          setCaret(null);
          setForced(false);
        }}
        onClick={trackCaret}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') trackCaret();
        }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              e.stopPropagation();
              setActive((active + (e.key === 'ArrowDown' ? 1 : ranked.length - 1)) % ranked.length);
              return;
            }
            if ((e.key === 'Enter' && !complete) || (e.key === 'Tab' && !e.shiftKey)) {
              e.preventDefault();
              e.stopPropagation();
              insert(ranked[active]!.name);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
              return;
            }
            if (e.key === 'Enter') close();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            stepBy(e.key === 'ArrowUp' ? 1 : -1, stepFor(base, e));
            return;
          }
          props.onKeyDown?.(e);
        }}
      />
      {suggestions.length ? (
        <button
          type="button"
          class={`suggest-toggle${forced ? ' is-on' : ''}`}
          tabIndex={-1}
          aria-label="Insérer un paramètre du projet"
          title="Insérer un paramètre du projet (ou tapez le début de son nom)"
          onPointerDown={(e) => {
            // Le champ garde le focus et la position du curseur.
            e.preventDefault();
            if (!forced) trackCaret();
            input.current?.focus();
            setForced(!forced);
          }}
        >
          ƒ
        </button>
      ) : null}
      <span class="unit" aria-hidden="true">
        {unit}
      </span>
      <span class="spin">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Augmenter de ${stepLabel}`}
          title={`Augmenter de ${stepLabel} (Maj : ×10, Alt : ×0,1) — molette ou flèche ↑`}
          onPointerDown={(e) => startRepeat(1, e)}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
        >
          <Icon name="chevron-up" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Diminuer de ${stepLabel}`}
          title={`Diminuer de ${stepLabel} (Maj : ×10, Alt : ×0,1) — molette ou flèche ↓`}
          onPointerDown={(e) => startRepeat(-1, e)}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
        >
          <Icon name="chevron-down" />
        </button>
      </span>
      {open ? <SuggestionList id={listId} anchor={field} items={ranked} active={active} onPick={insert} onHover={setActive} /> : null}
    </div>
  );
}

/** Liste des noms proposés, posée sous le champ (au-dessus de tout, même d'une fenêtre flottante). */
function SuggestionList(props: {
  id: string;
  anchor: { current: HTMLDivElement | null };
  items: readonly InputSuggestion[];
  active: number;
  onPick: (name: string) => void;
  onHover: (i: number) => void;
}) {
  const [box, setBox] = useState<DOMRect | null>(null);
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const update = () => setBox(props.anchor.current?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [props.active]);
  if (!box || typeof document === 'undefined') return null;
  // Sous le champ, ou au-dessus s'il est trop près du bas de l'écran.
  const below = window.innerHeight - box.bottom > 180 || box.top < 200;
  const style = {
    left: `${box.left}px`,
    minWidth: `${Math.max(box.width, 200)}px`,
    ...(below ? { top: `${box.bottom + 4}px` } : { bottom: `${window.innerHeight - box.top + 4}px` }),
  };
  return createPortal(
    <ul class="suggest-list" id={props.id} role="listbox" aria-label="Paramètres du projet" style={style} ref={list}>
      {props.items.map((item, i) => (
        <li
          key={item.name}
          id={`${props.id}-${i}`}
          role="option"
          aria-selected={i === props.active ? 'true' : 'false'}
          onPointerDown={(e) => {
            e.preventDefault();
            props.onPick(item.name);
          }}
          onPointerEnter={() => props.onHover(i)}
        >
          <span class="suggest-name">{item.name}</span>
          {item.detail ? <span class="suggest-detail">{item.detail}</span> : null}
        </li>
      ))}
    </ul>,
    document.body,
  );
}
