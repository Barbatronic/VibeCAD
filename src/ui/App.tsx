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
import { useAppState } from './context';

export function App() {
  const leftOpen = useAppState((s) => s.leftPanelOpen);
  const leftHidden = useAppState((s) => s.leftPanelHidden);
  return (
    <div class="app">
      <TopBar />
      <main class={`main${leftOpen ? ' left-open' : ''}${leftHidden ? ' left-collapsed' : ''}`}>
        <LeftPanel />
        <div style={{ position: 'relative', minWidth: 0, minHeight: 0, display: 'grid' }}>
          <ViewportHost />
          <Tutorial />
        </div>
        <RightPanel />
      </main>
      <StatusBar />
      <LaserEditor />
      <HelpDrawer />
      <Dialogs />
      <Toasts />
      <TipLayer />
    </div>
  );
}
