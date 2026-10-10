import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours navigateur représentatifs. Le serveur de développement sert aux parcours
 * fonctionnels ; l'aperçu du build de production sert au test hors ligne (service worker).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    viewport: { width: 1440, height: 900 },
    locale: 'fr-FR',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    // Safari (moteur WebKit) et Edge : à lancer explicitement (voir docs/navigateurs.md), car ils
    // demandent des installations supplémentaires sur la machine de test.
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npx vite build && npx vite preview --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: true, timeout: 120_000 },
  ],
});
