import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('le chat : nom VibeCAD, conseil de départ avec action, masquer puis réafficher, parcours guidé', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle(/VibeCAD/);
  await expect(page.locator('.brand')).toContainText('VibeCAD');

  // Pièce vide : le chat propose de commencer une esquisse.
  const bubble = page.getByRole('status', { name: 'Java, le chat de VibeCAD' });
  await expect(bubble).toContainText('fais une esquisse');
  await page.screenshot({ path: 'tests/output/e2e-chat-conseil.png' });
  await bubble.getByRole('button', { name: 'Nouvelle esquisse' }).click();
  await expect(page.getByRole('button', { name: /Plan XY/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Réduire puis masquer ; le réafficher depuis l'aide.
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: 'Réduire le chat' }).click();
  await expect(bubble).toHaveCount(0);
  await page.getByRole('button', { name: /Afficher le conseil du chat/ }).click();
  await bubble.getByRole('button', { name: 'Masquer le chat' }).click();
  await expect(page.locator('.mascot-bubble, .mascot-mini')).toHaveCount(0);
  await page.getByRole('button', { name: 'Aide' }).click();
  await page.getByRole('checkbox', { name: 'Afficher le chat' }).check();
  await page.keyboard.press('Escape');
  await expect(bubble).toBeVisible();

  // Le choix est retenu après rechargement.
  await bubble.getByRole('button', { name: 'Masquer le chat' }).click();
  // Attendre que la préférence soit écrite dans la base du navigateur avant de recharger.
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('vibecad');
        req.onsuccess = () => {
          const db = req.result;
          const names = Array.from(db.objectStoreNames);
          const store = names.find((n) => n === 'settings');
          if (!store) return resolve(false);
          const get = db.transaction(store).objectStore(store).get('mascot');
          get.onsuccess = () => {
            const v = get.result;
            resolve(!!(v && (v.value?.hidden ?? v.hidden)));
            db.close();
          };
          get.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      }),
  );
  await page.reload();
  await page.waitForFunction(() => (window as any).vibecad?.store?.get().kernel.status === 'ready');
  await page.waitForTimeout(500);
  await expect(page.locator('.mascot-bubble, .mascot-mini')).toHaveCount(0);
  await page.getByRole('button', { name: 'Aide' }).click();
  await page.getByRole('checkbox', { name: 'Afficher le chat' }).check();
  await page.keyboard.press('Escape');

  // Parcours guidé : le chat présente l'étape (la bulle de conseil se tait pendant le parcours).
  await page.getByRole('button', { name: 'Parcours' }).click();
  await expect(page.locator('.tutorial .tutorial-cat')).toBeVisible();
  await expect(bubble).toHaveCount(0);
  await page.screenshot({ path: 'tests/output/e2e-chat-parcours.png' });
});
