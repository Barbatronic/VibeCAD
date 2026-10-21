/** Fenêtre modale : titre, contenu, boutons ; Échap ou clic à côté la ferme, Tab reste dedans. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { IconButton } from './controls';

export function Modal(props: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // L'élément marqué `data-autofocus` d'abord, sinon le premier bouton ou champ.
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('.modal-body button, .modal-body input, .modal-footer button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const focusables = Array.from(ref.current.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')).filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const firstEl = focusables[0]!;
        const lastEl = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);
  return (
    <div class="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`modal${props.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <div class="modal-header">
          <h2 id="modal-title">{props.title}</h2>
          <IconButton icon="close" label="Fermer" onClick={props.onClose} />
        </div>
        <div class="modal-body">{props.children}</div>
        {props.footer ? <div class="modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  );
}
