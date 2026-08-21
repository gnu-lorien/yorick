const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { navigateToHash, normalize, runInApp } = require('./helpers/jqm-helpers');

/**
 * The Vue rendering of the character history page.
 *
 * Same route, same character, same recorded changes as
 * `character-history.spec.js` - a second implementation of one page, so the
 * interesting assertions are the ones that compare it against the original
 * rather than the ones that check it renders at all.
 *
 * Two of them carry the weight. "replaying the timeline rebuilds the sheet as
 * it was" is the behaviour the page exists for - stepping back has to actually
 * take a trait off the sheet - and "draws exactly the same sheet" compares the
 * two implementations character for character rather than settling for "renders
 * something plausible".
 */
test.describe('Character History (Vue)', () => {
  let characterId;
  let characterName;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginAsAdmin(page);

    const charData = await runInApp(page, ['app/models/Vampire'], `
      const Vampire = mods[0];
      return Vampire.create_test_character('e2e_vue_history').then(function (v) {
        // One more change on the end of the timeline, so stepping back one
        // position has something visible to undo.
        return v.update_trait('Auspex', 3, 'disciplines', 0, true).then(function () {
          return { id: v.id, name: v.get('name') };
        });
      });
    `);

    characterId = charData.id;
    characterName = charData.name;
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('renders the timeline, both change tables and the sheet', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/vue-history/0`, '#character-vue-history');

    const root = page.locator('#character-vue-history .yv-page');
    await expect(root).toBeVisible();

    // Vue has taken over the page, not just mounted an empty shell.
    await expect(page.locator('#yv-slider')).toBeVisible();
    await expect(page.locator('.yv-change-applied .yv-change-title')).toHaveText('Most Recent Change Applied');
    await expect(page.locator('.yv-sheet h1')).toContainText(characterName);

    // The timeline opens at the newest change, so nothing is reversed yet.
    await expect(page.locator('.yv-change-reversed')).toHaveCount(0);

    const position = normalize(await page.locator('.yv-position').textContent());
    expect(position).toMatch(/^(\d+) of \1$/);
  });

  test('stepping back in time reveals the reversed change', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/vue-history/0`, '#character-vue-history');

    await page.locator('#yv-slider').fill('0');

    await expect(page.locator('.yv-change-reversed .yv-change-title')).toHaveText('Reversed Change');
    await expect(page.locator('.yv-position')).toContainText(/^1 of /);

    // Both tables carry the same twelve columns as the Marionette page.
    await expect(page.locator('.yv-change-applied thead th')).toHaveCount(12);
    await expect(page.locator('.yv-change-applied thead th').first()).toHaveText('createdAt');
  });

  test('replaying the timeline rebuilds the sheet as it was', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/vue-history/0`, '#character-vue-history');

    const sheet = page.locator('.yv-sheet');
    await expect(sheet).toContainText('Auspex');

    const max = await page.locator('#yv-slider').getAttribute('max');
    await page.locator('#yv-slider').fill(String(Number(max) - 1));

    // The sheet is rebuilt from a clone of the character with the last change
    // rolled back, so the discipline added above is gone again.
    await expect(sheet).not.toContainText('Auspex');
    await expect(sheet).toContainText(characterName);

    await page.locator('#yv-slider').fill(String(max));
    await expect(sheet).toContainText('Auspex');
  });

  test('carries the print settings the Marionette sheet has', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/vue-history/0`, '#character-vue-history');

    const sheet = page.locator('.yv-sheet');
    await expect(sheet).toHaveAttribute('style', /font-size:\s*100%/);

    await page.locator('.yv-print-settings select').selectOption('70');
    await expect(sheet).toHaveAttribute('style', /font-size:\s*70%/);
  });

  test('draws exactly the same sheet as the Marionette page', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/history/0`, '#character-history');

    // Everything except the print settings form, which the Vue page renders
    // above its sheet rather than inside it.
    const classic = await page.evaluate(() => {
      const settings = document.querySelector('#history-sheet #cpp-settings');
      const was = settings ? settings.style.display : null;
      if (settings) settings.style.display = 'none';
      const text = document.querySelector('#history-sheet').innerText;
      if (settings) settings.style.display = was;
      return text;
    });

    await navigateToHash(page, `character/${characterId}/vue-history/0`, '#character-vue-history');
    const ported = await page.locator('.yv-sheet').innerText();

    // Not "renders something plausible": the same characters, in the same
    // order. Dot tracks, trait formats, section ordering and all.
    expect(normalize(ported)).toEqual(normalize(classic));
  });
});
