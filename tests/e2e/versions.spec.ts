import { expect, test, type Page } from '@playwright/test';
import { appState, expectVolume, openApp } from './helpers';

const ctl = <T>(page: Page, fn: (c: any) => T) => page.evaluate(`(${fn.toString()})(window.vibecad.controller)`) as Promise<T>;
const viewKeys = (page: Page) => ctl(page, (c) => [...c.viewport.parts.keys()] as string[]);

async function addBox(page: Page, x: number, index: number) {
  if (index > 0) await page.click('#part-add');
  await page.click('#tool-primitive');
  await page.locator('#draft-pos-x').fill(String(x));
  await expect(page.getByText('Aperçu à jour')).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expectVolume(page, 8000, index);
}

async function createVersion(page: Page, message: string) {
  await page.getByLabel('Message de la version').fill(message);
  await page.getByRole('button', { name: 'Créer', exact: true }).first().click();
  await expect(page.getByRole('option', { name: new RegExp(message) })).toBeVisible();
}

test('versions : deux branches fusionnées, un conflit tranché, une pièce supprimée montrée', async ({ page }) => {
  await openApp(page);
  await addBox(page, 0, 0);
  await addBox(page, 30, 1);
  await addBox(page, 60, 2);
  const ids = await appState(page, (s) => s.doc.parts.map((p: any) => p.id as string));
  await ctl(page, (c) => c.setWorkspace('versions'));
  await createVersion(page, 'Base');

  // Branche « essai » depuis « Base » : pièce 1 renommée, pièce 3 supprimée.
  await page.getByRole('option', { name: /Base/ }).click();
  await page.getByLabel('Nom de la nouvelle branche').fill('essai');
  await page.getByRole('button', { name: 'Créer', exact: true }).last().click();
  await expect.poll(() => appState(page, (s) => s.versions.current)).toBe('essai');
  await page.evaluate(([a, c3]) => {
    const c = (window as any).vibecad.controller;
    c.renamePart(a, 'Socle long');
    c.deletePart(c3);
  }, [ids[0]!, ids[2]!]);
  await createVersion(page, 'Essai');

  // La version qui supprime la pièce 3 la montre encore, à son ancienne place.
  await page.getByRole('option', { name: /Essai/ }).click();
  await expect.poll(async () => (await viewKeys(page)).filter((k) => k.startsWith('gone:')).length).toBe(1);
  await expect(page.locator('.versions-changes')).toContainText('Pièce 3');
  await page.screenshot({ path: 'tests/output/e2e-versions-supprimee.png' });

  // Retour sur « principal » : pièce 1 recolorée (conflit avec le renommage), pièce 2 renommée (seul côté).
  await ctl(page, (c) => c.switchVersionBranch('principal'));
  await expect.poll(() => appState(page, (s) => s.versions.current)).toBe('principal');
  await expect.poll(() => appState(page, (s) => s.doc.parts.length)).toBe(3);
  await page.evaluate(([a, b]) => {
    const c = (window as any).vibecad.controller;
    c.setPartColor(a, '#aa3344');
    c.renamePart(b, 'Montant');
  }, [ids[0]!, ids[1]!]);

  // Tant que l'état actuel n'est pas une version, la fusion est refusée.
  await page.getByRole('option', { name: /Essai/ }).click();
  await page.getByRole('button', { name: 'Fusionner dans « principal »' }).click();
  await expect(page.getByText('Créez d’abord une version de l’état actuel.')).toBeVisible();
  await createVersion(page, 'Couleur');

  await page.getByRole('option', { name: /Essai/ }).click();
  await page.getByRole('button', { name: 'Fusionner dans « principal »' }).click();
  const conflicts = page.getByRole('group', { name: 'Conflits de la fusion' });
  await expect(conflicts.locator('li')).toHaveCount(1);
  await expect(conflicts).toContainText('Pièce 1');
  await expect(conflicts.getByRole('button', { name: 'Fusionner' })).toBeDisabled();
  await page.screenshot({ path: 'tests/output/e2e-versions-conflit.png' });
  await conflicts.getByRole('button', { name: /essai/ }).click();
  await conflicts.getByRole('button', { name: 'Fusionner' }).click();

  // Pièce 1 : le côté choisi ; pièce 2 : notre changement ; pièce 3 : supprimée par l'autre côté.
  await expect.poll(() => appState(page, (s) => s.doc.parts.map((p: any) => p.name))).toEqual(['Socle long', 'Montant']);
  const head = await appState(page, (s) => {
    const h = s.versions;
    const c = h.commits.find((k: any) => k.id === h.branches.find((b: any) => b.name === h.current).head);
    return { message: c.message, parents: c.parents.length, count: h.commits.length };
  });
  expect(head).toEqual({ message: 'Fusion de « essai »', parents: 2, count: 4 });
  await expect(page.getByRole('option', { name: /État actuel/ })).toContainText('à jour');
  await expectVolume(page, 8000, 0);
  await page.screenshot({ path: 'tests/output/e2e-versions-fusion.png' });

  // La branche fusionnée ne propose plus de fusion ; l'annulation rend l'état d'avant.
  await page.getByRole('option', { name: /Essai/ }).click();
  await expect(page.getByRole('button', { name: 'Fusionner dans « principal »' })).toHaveCount(0);
  await ctl(page, (c) => c.undo());
  await expect.poll(() => appState(page, (s) => s.doc.parts.length)).toBe(3);
});
