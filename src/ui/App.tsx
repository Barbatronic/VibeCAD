import { useEffect, useMemo } from 'preact/hooks';
import { formatNumber } from '../domain/units';
import { resolveParameters } from '../features/parameters';
import { InputSuggestions, type InputSuggestion } from './components/number-input';
import { Dialogs, Toasts } from './Dialogs';
import { LaserEditor } from './LaserEditor';
import { HelpDrawer } from './HelpDrawer';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { TipLayer } from './TipLayer';
import { Tutorial } from './Tutorial';
import { ViewportHost } from './ViewportHost';
import { useAppState, useController } from './context';
import { Icon } from './icons';

export function App() {
  const c = useController();
  const leftOpen = useAppState((s) => s.leftPanelOpen);
  const leftHidden = useAppState((s) => s.leftPanelHidden);
  const rightHidden = useAppState((s) => s.rightPanelHidden);
  const modeKind = useAppState((s) => s.mode.kind);
  const parameters = useAppState((s) => s.doc.parameters);
  // Paramètres du projet proposés sous chaque champ numérique (cotes, distances…).
  const suggestions = useMemo((): InputSuggestion[] => {
    const params = parameters ?? [];
    const { values } = resolveParameters(params);
    return params.map((p) => {
      const v = values.get(p.name.toLowerCase());
      return { name: p.name, detail: v === undefined ? '?' : `= ${formatNumber(v)}` };
    });
  }, [parameters]);
  // Une nouvelle opération rouvre ses réglages (sinon « Valider » resterait caché).
  useEffect(() => {
    if (modeKind !== 'model') c.toggleRightPanel(true);
  }, [modeKind]);
  return (
    <InputSuggestions.Provider value={suggestions}>
      <div class="app">
        <TopBar />
        <main class={`main${leftOpen ? ' left-open' : ''}${leftHidden ? ' left-collapsed' : ''}${rightHidden ? ' right-collapsed' : ''}`}>
          <LeftPanel />
          <div class="viewport-area">
            <ViewportHost />
            <Tutorial />
          </div>
          <RightPanel />
          {/* Languettes des panneaux flottants (écran large) : replier contre le bord, ou rouvrir. */}
          <button
            type="button"
            class="panel-handle left"
            aria-label={leftHidden ? 'Afficher le panneau de gauche' : 'Replier le panneau de gauche'}
            title={leftHidden ? 'Afficher le panneau de gauche' : 'Replier le panneau de gauche'}
            aria-expanded={!leftHidden}
            onClick={() => c.toggleLeftPanel()}
          >
            <Icon name={leftHidden ? 'chevron-right' : 'chevron-left'} />
          </button>
          <button
            type="button"
            class="panel-handle right"
            aria-label={rightHidden ? 'Afficher le panneau de droite' : 'Replier le panneau de droite'}
            title={rightHidden ? 'Afficher le panneau de droite' : 'Replier le panneau de droite'}
            aria-expanded={!rightHidden}
            onClick={() => c.toggleRightPanel()}
          >
            <Icon name={rightHidden ? 'chevron-left' : 'chevron-right'} />
          </button>
        </main>
        <StatusBar />
        <LaserEditor />
        <HelpDrawer />
        <Dialogs />
        <Toasts />
        <TipLayer />
      </div>
    </InputSuggestions.Provider>
  );
}
