/**
 * Réglages d'un texte d'esquisse : avec l'outil Texte, ceux du prochain texte posé ; avec un
 * texte sélectionné, ses lettres, sa hauteur et son inclinaison (appliquées à chaque frappe
 * valide, la saisie invalide est conservée avec son message).
 */
import { useEffect, useState } from 'preact/hooks';
import type { SketchText } from '../domain/model';
import { formatLength, parseLength, readNumber } from '../domain/units';
import { editText, setTextOptions, type SketchSession } from '../sketch/session';
import { LengthField } from './components/controls';
import { useController } from './context';

const fmt = (v: number) => formatLength(v, 2, false);

export function useField(value: string, key: string): [string, (t: string) => void, string | null, (e: string | null) => void] {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // Autre texte sélectionné, ou valeur changée ailleurs (annuler) : on reprend la valeur réelle.
  useEffect(() => {
    setText(value);
    setError(null);
  }, [key, value]);
  return [text, setText, error, setError];
}

export function SketchTextFields({ session }: { session: SketchSession }) {
  const c = useController();
  const selected = session.selection.map((id) => session.sketch.entities.find((e) => e.id === id)).filter((e): e is SketchText => e?.type === 'text');
  const target = session.tool === 'text' ? null : selected.length === 1 ? selected[0]! : null;
  if (session.tool !== 'text' && !target) return null;
  const key = target?.id ?? 'tool';
  const value = target ? { text: target.text, height: target.height, angle: target.angle ?? 0 } : { ...session.textOptions, angle: 0 };
  const apply = (patch: { text?: string; height?: number; angle?: number }) =>
    c.updateSession((s) => (target ? editText(s, target.id, patch) : setTextOptions(s, patch)));
  return <TextForm key={key} id={key} value={value} withAngle={!!target} onApply={apply} />;
}

function TextForm(props: { id: string; value: { text: string; height: number; angle: number }; withAngle: boolean; onApply: (p: { text?: string; height?: number; angle?: number }) => void }) {
  const { value, onApply } = props;
  const [text, setText] = useState(value.text);
  useEffect(() => setText(value.text), [value.text]);
  const [height, setHeight, heightError, setHeightError] = useField(fmt(value.height), props.id);
  const [angle, setAngle, angleError, setAngleError] = useField(fmt(value.angle), props.id);
  const textError = text.trim() === '' ? 'Écrivez au moins une lettre.' : null;
  return (
    <div class="sketch-text-fields">
      <div class="field">
        <label class="field-label" for="sketch-text-content">
          {props.withAngle ? 'Texte sélectionné' : 'Texte à poser'}
        </label>
        <div class={`input-with-unit${textError ? ' has-error' : ''}`}>
        <input
          id="sketch-text-content"
          type="text"
          value={text}
          maxLength={60}
          spellcheck={false}
          aria-invalid={!!textError}
          onInput={(e) => {
            const t = (e.target as HTMLInputElement).value;
            setText(t);
            if (t.trim() !== '') onApply({ text: t });
          }}
        />
        </div>
        {textError ? <span class="field-error" role="alert">{textError}</span> : null}
      </div>
      <LengthField
        id="sketch-text-height"
        label="Hauteur des majuscules"
        value={height}
        error={heightError}
        min={0.5}
        onInput={(t) => {
          setHeight(t);
          const r = parseLength(t, { label: 'La hauteur', min: 0.5 });
          setHeightError(r.ok ? null : r.error);
          if (r.ok) onApply({ height: r.value });
        }}
      />
      {props.withAngle ? (
        <LengthField
          id="sketch-text-angle"
          label="Inclinaison"
          unit="°"
          step={5}
          value={angle}
          error={angleError}

          onInput={(t) => {
            setAngle(t);
            const v = readNumber(t);
            const ok = v !== null && Math.abs(v) <= 360;
            setAngleError(ok ? null : 'L’inclinaison doit être un nombre de degrés entre −360 et 360.');
            if (ok) onApply({ angle: v });
          }}
        />
      ) : (
        <p class="field-help">Cliquez pour poser le texte.</p>
      )}
    </div>
  );
}
