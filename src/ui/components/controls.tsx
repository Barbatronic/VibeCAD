/** Contrôles de base accessibles : cibles d'au moins 40 px, focus visible, libellés explicites. */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Availability } from '../../app/availability';
import { Icon } from '../icons';
import { NumberInput } from './number-input';

export function ToolButton(props: {
  icon: string;
  label: string;
  onClick: () => void;
  availability?: Availability;
  pressed?: boolean;
  shortcut?: string;
  hint?: string;
  suggested?: boolean;
  id?: string;
}) {
  const disabled = props.availability && !props.availability.ok;
  const reason = disabled && props.availability && !props.availability.ok ? props.availability.reason : null;
  const title = [props.hint ?? props.label, props.shortcut ? `(${props.shortcut})` : '', reason ? `— ${reason}` : ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      id={props.id}
      class={`tool-btn${props.suggested ? ' is-suggested' : ''}`}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed}
      aria-disabled={disabled ? 'true' : undefined}
      aria-describedby={reason ? `${props.id ?? props.label}-reason` : undefined}
      title={title}
      onClick={() => props.onClick()}
    >
      <Icon name={props.icon} />
      <span>{props.label}</span>
      {reason ? (
        <span id={`${props.id ?? props.label}-reason`} class="visually-hidden">
          {reason}
        </span>
      ) : null}
    </button>
  );
}

export function IconButton(props: {
  icon: string;
  label: string;
  onClick: (e: MouseEvent) => void;
  disabled?: boolean;
  small?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      class={`icon-btn${props.small ? ' small' : ''}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick(e);
      }}
    >
      <Icon name={props.icon} />
    </button>
  );
}

export function Button(props: {
  children: ComponentChildren;
  onClick: () => void;
  variant?: 'primary' | 'danger' | 'ghost' | 'default';
  icon?: string;
  disabled?: boolean;
  /** Raison affichée quand le bouton est indisponible (il reste focalisable). */
  disabledReason?: string | null;
  small?: boolean;
  autoFocus?: boolean;
  type?: 'button' | 'submit';
}) {
  const unavailable = !!props.disabledReason;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, []);
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      class={`btn${props.variant && props.variant !== 'default' ? ` btn-${props.variant}` : ''}${props.small ? ' btn-small' : ''}`}
      disabled={props.disabled}
      aria-disabled={unavailable ? 'true' : undefined}
      title={props.disabledReason ?? undefined}
      onClick={() => {
        if (!unavailable) props.onClick();
      }}
    >
      {props.icon ? <Icon name={props.icon} /> : null}
      {props.children}
    </button>
  );
}

export function Callout(props: { kind: 'info' | 'success' | 'warning' | 'error'; children: ComponentChildren }) {
  const icon = { info: 'info', success: 'ok', warning: 'warning', error: 'error' }[props.kind];
  return (
    <div class={`callout ${props.kind}`} role={props.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>{props.children}</div>
    </div>
  );
}

/** Champ de longueur en millimètres : accepte la virgule, conserve la saisie invalide, affiche l'erreur. */
export function LengthField(props: {
  id: string;
  label: string;
  value: string;
  error: string | null;
  help?: string;
  onInput: (text: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  unit?: string;
  step?: number;
  min?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.autoFocus) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, []);
  const errorId = `${props.id}-error`;
  const helpId = `${props.id}-help`;
  return (
    <div class="field">
      <label class="field-label" for={props.id}>
        {props.label}
      </label>
      <NumberInput
        inputRef={ref}
        id={props.id}
        value={props.value}
        unit={props.unit ?? 'mm'}
        {...(props.step !== undefined ? { step: props.step } : {})}
        {...(props.min !== undefined ? { min: props.min } : {})}
        invalid={!!props.error}
        describedBy={[props.error ? errorId : '', props.help ? helpId : ''].filter(Boolean).join(' ') || undefined}
        onInput={props.onInput}
        onFocus={(e) => props.selectOnFocus && (e.target as HTMLInputElement).select()}
        onKeyDown={(e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && props.onEnter) {
            e.preventDefault();
            e.stopPropagation();
            props.onEnter();
          } else if (e.key === 'Escape' && props.onEscape) {
            e.preventDefault();
            e.stopPropagation();
            props.onEscape();
          }
        }}
      />
      {props.help ? (
        <span id={helpId} class="field-help">
          {props.help}
        </span>
      ) : null}
      {props.error ? (
        <span id={errorId} class="field-error" role="alert">
          <Icon name="error" />
          {props.error}
        </span>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div class="field" role="group" aria-label={props.label}>
      <span class="field-label">{props.label}</span>
      <div class="segmented">
        {props.options.map((o) => (
          <button type="button" key={o.value} aria-pressed={o.value === props.value} title={o.title ?? o.label} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
