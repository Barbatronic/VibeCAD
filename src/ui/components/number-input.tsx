/**
 * Champ numérique avec unité, petites flèches ▲▼ et molette : utilisé pour toutes les saisies
 * de valeurs (paramètres d'opérations, cotes, dimensions tapées pendant un tracé).
 * Pas : 1 (Maj : ×10, Alt : ×0,1). Les flèches du clavier ↑ ↓ font de même.
 * La saisie reste du texte libre (virgule, expressions comme 60/2) : seules les flèches et la
 * molette la transforment en nombre.
 */
import type { JSX, Ref } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
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
    <div class={`input-with-unit has-stepper${props.invalid ? ' has-error' : ''}`} onWheel={onWheel}>
      <input
        ref={props.inputRef}
        id={props.id}
        inputMode="decimal"
        autoComplete="off"
        spellcheck={false}
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        aria-invalid={props.invalid ? 'true' : 'false'}
        aria-describedby={props.describedBy}
        onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
        onFocus={props.onFocus}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            stepBy(e.key === 'ArrowUp' ? 1 : -1, stepFor(base, e));
            return;
          }
          props.onKeyDown?.(e);
        }}
      />
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
    </div>
  );
}
