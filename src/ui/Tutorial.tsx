import { useEffect } from 'preact/hooks';
import { TUTORIALS, tutorialById } from '../tutorials';
import { useAppState, useController } from './context';
import { Button, IconButton } from './components/controls';
import { Icon } from './icons';
import { CatFigure } from './Mascot';

function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p))}</>;
}

/** Choix du parcours guidé. */
function TutorialChooser({ showCat }: { showCat: boolean }) {
  const c = useController();
  return (
    <section class="tutorial" aria-labelledby="tutorial-title" aria-live="polite">
      <div class="tutorial-header">
        <Icon name="graduation" />
        <span>Parcours guidés</span>
        <span class="spacer" />
        <IconButton icon="close" label="Quitter le parcours guidé" small onClick={() => c.closeTutorial()} />
      </div>
      <div class={`tutorial-body${showCat ? ' with-cat' : ''}`}>
        {showCat ? <CatFigure mood="tip" size={64} animated decorative class="tutorial-cat" /> : null}
        <div>
          <h3 id="tutorial-title">Que veux-tu apprendre ?</h3>
          <ul class="tutorial-choices">
            {TUTORIALS.map((t) => (
              <li key={t.id}>
                <button type="button" class="tutorial-choice" onClick={() => c.startTutorial(t.id)}>
                  <strong>{t.title}</strong>
                  <span>{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Tutorial() {
  const c = useController();
  const tutorial = useAppState((s) => s.tutorial);
  const steps = tutorial?.id ? tutorialById(tutorial.id).steps : [];
  const stepIndex = tutorial?.step ?? 0;
  const step = steps[stepIndex];
  const done = useAppState((s) => (step?.check ? step.check(s) : false));
  const showCat = useAppState((s) => !s.mascot.hidden);

  useEffect(() => {
    if (!tutorial || !step?.target) return;
    const el = document.getElementById(step.target);
    el?.classList.add('tutorial-target');
    return () => el?.classList.remove('tutorial-target');
  }, [tutorial, step?.target, done]);

  if (!tutorial) return null;
  if (!tutorial.id) return <TutorialChooser showCat={showCat} />;
  if (!step) return null;
  const last = stepIndex === steps.length - 1;
  return (
    <section class="tutorial" aria-labelledby="tutorial-title" aria-live="polite">
      <div class="tutorial-progress" aria-hidden="true">
        <span style={{ width: `${((stepIndex + (done ? 1 : 0)) / steps.length) * 100}%` }} />
      </div>
      <div class="tutorial-header">
        <Icon name="graduation" />
        <span>
          {tutorialById(tutorial.id).title} · étape {stepIndex + 1} / {steps.length}
        </span>
        <span class="spacer" />
        <IconButton icon="close" label="Quitter le parcours guidé" small onClick={() => c.closeTutorial()} />
      </div>
      <div class={`tutorial-body${showCat ? ' with-cat' : ''}`}>
        {showCat ? <CatFigure mood={done ? 'happy' : 'tip'} size={64} animated decorative class="tutorial-cat" /> : null}
        <div>
          <h3 id="tutorial-title">{step.title}</h3>
          {step.body.map((p) => (
            <p key={p}>
              <RichText text={p} />
            </p>
          ))}
        </div>
      </div>
      <div class="tutorial-footer">
        {done ? (
          <span class="done">
            <Icon name="ok" /> Bravo, c’est fait !
          </span>
        ) : (
          <span class="spacer" style={{ flex: 1 }} />
        )}
        {stepIndex > 0 ? (
          <Button small onClick={() => c.setTutorialStep(stepIndex - 1)}>
            Précédent
          </Button>
        ) : (
          <Button small onClick={() => c.startTutorial()}>
            Autres parcours
          </Button>
        )}
        {last ? (
          <Button small variant="primary" onClick={() => c.closeTutorial()}>
            Terminer
          </Button>
        ) : (
          <Button small variant={done || !step.check ? 'primary' : 'default'} onClick={() => c.setTutorialStep(stepIndex + 1)}>
            {done || !step.check ? 'Suivant' : 'Passer'}
          </Button>
        )}
      </div>
    </section>
  );
}
