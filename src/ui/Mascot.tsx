/**
 * Java, le chat de VibeCAD : mascotte facultative (Préférences › Environnement des jeunes) qui accompagne le parcours et explique les
 * soucis. Le dessin vient de `mascot-art.ts` ; les animations sont légères et désactivées par la
 * préférence « réduire les animations ». Le chat complète les textes, il ne les remplace jamais.
 */
import { useState } from 'preact/hooks';
import { currentAdvice } from '../app/advice';
import { IconButton } from './components/controls';
import { useAppState, useController } from './context';
import { CAT_COLORS, catShapes, SILHOUETTE_PARTS, type CatMood, type CatShape } from './mascot-art';

const MOOD_LABELS: Record<CatMood, string> = {
  tip: 'Java, le chat de VibeCAD, donne un conseil',
  happy: 'Java, le chat de VibeCAD, est content',
  warning: 'Java, le chat de VibeCAD, signale un souci',
};

function Shape({ s, outline }: { s: CatShape; outline: boolean }) {
  const fill = outline ? CAT_COLORS.outline : CAT_COLORS[s.part];
  const stroke = outline
    ? { stroke: CAT_COLORS.outline, 'stroke-width': 3, 'stroke-linejoin': 'round' as const }
    : s.part === 'belly'
      ? { stroke: CAT_COLORS.bellyEdge, 'stroke-width': 0.8, 'stroke-linejoin': 'round' as const }
      : {};
  const cls = s.part === 'iris' || s.part === 'pupil' ? 'cat-eye' : s.part === 'accent' ? 'cat-accent' : undefined;
  if (s.kind === 'rect') return <rect class={cls} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} fill={fill} {...stroke} />;
  const points = s.points.map(([x, y]) => `${x},${y}`).join(' ');
  if (s.kind === 'poly') return <polygon class={cls} points={points} fill={fill} {...stroke} />;
  return <polyline class={cls} points={points} fill="none" stroke={fill} stroke-width={s.width} stroke-linecap="round" stroke-linejoin="round" />;
}

export function CatFigure(props: { mood?: CatMood; size?: number; class?: string; decorative?: boolean; animated?: boolean }) {
  const mood = props.mood ?? 'tip';
  const shapes = catShapes(mood);
  const size = props.size ?? 48;
  return (
    <svg
      class={`cat cat-${mood}${props.animated ? ' cat-animated' : ''}${props.class ? ` ${props.class}` : ''}`}
      viewBox="-2 -2 52 52"
      width={size}
      height={size}
      role={props.decorative ? undefined : 'img'}
      aria-hidden={props.decorative ? 'true' : undefined}
      aria-label={props.decorative ? undefined : MOOD_LABELS[mood]}
      focusable="false"
    >
      <g class="cat-outline">
        {shapes.filter((s) => SILHOUETTE_PARTS.includes(s.part)).map((s, i) => (
          <Shape key={`o${i}`} s={s} outline />
        ))}
      </g>
      <g class="cat-body">
        {shapes.map((s, i) => (
          <Shape key={`b${i}`} s={s} outline={false} />
        ))}
      </g>
    </svg>
  );
}

const LEVEL_LABELS = { conseil: 'Conseil', avertissement: 'Attention', erreur: 'Souci' } as const;

/**
 * Bulle du chat dans la vue 3D : apparaît seulement quand il a quelque chose d'utile à dire
 * (souci à corriger, conseil de départ). Réductible en un petit chat, ou masquable.
 */
export function MascotBubble() {
  const c = useController();
  const advice = useAppState(currentAdvice, (a, b) => a?.id === b?.id && a?.text === b?.text);
  const mascot = useAppState((s) => s.mascot);
  // En esquisse, le panneau de droite affiche déjà le message : le chat reste petit (déplié sur demande).
  const sketching = useAppState((s) => s.mode.kind === 'sketch');
  const [opened, setOpened] = useState<string | null>(null);
  if (!advice || mascot.hidden) return null;
  const reduced = (mascot.collapsed || mascot.dismissed === advice.id || sketching) && opened !== advice.id;
  if (reduced) {
    return (
      <button
        type="button"
        class={`mascot-mini level-${advice.level}`}
        title={`${LEVEL_LABELS[advice.level]} du chat : ${advice.text}`}
        aria-label={`Afficher le ${LEVEL_LABELS[advice.level].toLowerCase()} du chat`}
        onClick={() => {
          setOpened(advice.id);
          c.setMascot({ collapsed: false, dismissed: null });
        }}
      >
        <CatFigure mood={advice.mood} size={40} decorative />
        {advice.level !== 'conseil' ? <span class="mascot-badge" aria-hidden="true">!</span> : null}
      </button>
    );
  }
  return (
    <aside class={`mascot-bubble level-${advice.level}`} role={advice.level === 'erreur' ? 'alert' : 'status'} aria-label="Java, le chat de VibeCAD">
      <CatFigure mood={advice.mood} size={58} animated decorative />
      <div class="mascot-content">
        <div class="mascot-title">
          <span class="mascot-level">{LEVEL_LABELS[advice.level]}</span>
          <span class="spacer" />
          <IconButton
            icon="close"
            small
            label="Réduire le chat"
            onClick={() => {
              setOpened(null);
              c.setMascot({ dismissed: advice.id });
            }}
          />
        </div>
        <p>{advice.text}</p>
        <div class="mascot-actions">
          {advice.action ? (
            <button type="button" class="btn btn-small btn-primary" onClick={() => c.runAdviceAction(advice.action!)}>
              {advice.action.label}
            </button>
          ) : null}
          <button type="button" class="tl-link" onClick={() => c.setMascot({ hidden: true })}>
            Masquer le chat
          </button>
        </div>
      </div>
    </aside>
  );
}
