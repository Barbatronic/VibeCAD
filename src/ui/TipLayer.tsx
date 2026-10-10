/**
 * Bulles d'explication présentées par Java, le chat : au survol prolongé d'un élément qui a une
 * info-bulle (`title`), son texte s'affiche dans une bulle avec le chat, plus lisible que
 * l'info-bulle du navigateur. Désactivables dans l'Aide (on retrouve alors les info-bulles
 * simples). Le `title` est retiré pendant l'affichage pour éviter le doublon, puis remis.
 */
import { useEffect, useState } from 'preact/hooks';
import { useAppState } from './context';
import { CatFigure } from './Mascot';

const DELAY_MS = 550;

interface Tip {
  title: string;
  text: string;
  /** Pourquoi l'outil est indisponible (partie après « — » de l'info-bulle). */
  reason?: string;
  x: number;
  y: number;
  below: boolean;
}

/** Nom visible de l'élément (texte du bouton ou libellé accessible). */
function nameOf(el: HTMLElement): string {
  const own = el.getAttribute('aria-label');
  if (own) return own;
  const text = (el.querySelector('span:not(.visually-hidden)')?.textContent ?? el.textContent ?? '').replace(/[▾▸]/g, '').trim();
  return text.length <= 40 ? text : '';
}

/** Découpe « Nom : explication » ; sinon titre = nom visible, texte = info-bulle. */
function split(el: HTMLElement, title: string): { title: string; text: string } {
  const name = nameOf(el);
  const m = /^([^:—\n]{2,40}) : (.+)$/s.exec(title);
  if (m) return { title: m[1]!.trim(), text: m[2]!.trim() };
  if (name && title.toLowerCase().startsWith(name.toLowerCase())) return { title: name, text: title.slice(name.length).replace(/^[\s:—-]+/, '') || title };
  return { title: name, text: title };
}

export function TipLayer() {
  const enabled = useAppState((s) => s.tips);
  const showCat = useAppState((s) => !s.mascot.hidden);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let current: { el: HTMLElement; title: string } | null = null;
    const restore = () => {
      window.clearTimeout(timer);
      if (current) {
        if (!current.el.getAttribute('title')) current.el.setAttribute('title', current.title);
        current = null;
      }
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[title]');
      if (current && (el === current.el || current.el.contains(e.target as Node))) return;
      restore();
      if (!el || el.closest('.vp-canvas, .tip')) return;
      const title = el.getAttribute('title') ?? '';
      if (!title.trim()) return;
      // L'info-bulle du navigateur ferait doublon : retirée le temps de la bulle.
      el.removeAttribute('title');
      current = { el, title };
      timer = window.setTimeout(() => {
        if (!current || !document.body.contains(current.el)) return;
        const r = current.el.getBoundingClientRect();
        const below = r.bottom + 160 < window.innerHeight;
        const parts = split(current.el, current.title);
        const [text, ...rest] = parts.text.split(' — ');
        const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
        setTip({ title: parts.title, text: cap(text!.trim()), ...(rest.length ? { reason: cap(rest.join(' — ').trim()) } : {}), x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, DELAY_MS);
    };
    const onOut = (e: PointerEvent) => {
      if (!current) return;
      const to = e.relatedTarget as Node | null;
      if (to && current.el.contains(to)) return;
      restore();
    };
    window.addEventListener('pointerover', onOver);
    window.addEventListener('pointerout', onOut);
    window.addEventListener('pointerdown', restore, true);
    window.addEventListener('keydown', restore, true);
    window.addEventListener('scroll', restore, true);
    return () => {
      restore();
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerout', onOut);
      window.removeEventListener('pointerdown', restore, true);
      window.removeEventListener('keydown', restore, true);
      window.removeEventListener('scroll', restore, true);
    };
  }, [enabled]);

  if (!enabled || !tip) return null;
  const width = 300;
  const left = Math.max(8, Math.min(tip.x - width / 2, window.innerWidth - width - 8));
  const style = tip.below ? { left: `${left}px`, top: `${tip.y}px`, width: `${width}px` } : { left: `${left}px`, bottom: `${window.innerHeight - tip.y}px`, width: `${width}px` };
  return (
    <div class="tip" role="tooltip" style={style}>
      {showCat ? <CatFigure mood="tip" size={40} decorative class="tip-cat" /> : null}
      <div>
        {tip.title ? <strong class="tip-title">{tip.title}</strong> : null}
        <p>{tip.text}</p>
        {tip.reason ? <p class="tip-reason">{tip.reason}</p> : null}
      </div>
    </div>
  );
}
