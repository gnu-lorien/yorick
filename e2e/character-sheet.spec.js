const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, logout } = require('./helpers/auth');
const { waitForAppReady, waitForJqmLoader, navigateToHash, setJqmSlider, submitJqmForm } = require('./helpers/jqm-helpers');

test.describe('Core Character Management & Sheet Views E2E Suite', () => {
  let characterId;
  let characterName;
  let traitId;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginAsAdmin(page);

    // Create a populated test character, and give it a trait to edit.
    //
    // `create_test_character` is `Vampire.create` (Vampire.js:427-431), which
    // seeds Humanity, the three health levels and Willpower -- and nothing in
    // `attributes`. That is not a bug: attributes are chosen in the creation
    // wizard, which is what `attributes_7_remaining` / `_5_` / `_3_` on
    // VampireCreation exist to meter, so a character that has never entered
    // the wizard correctly has none. The trait this file edits therefore has
    // to be added here.
    //
    // It used to not be, and the read below returned null every time, which
    // the trait-edit test turned into a runtime `test.skip()`. It had never
    // executed a single assertion on any stack.
    //
    // free_value 0 is deliberate. `update_creation_rules_for_changed_trait`
    // returns early on a falsy free value (Vampire.js:65-70). At free_value >= 1
    // `attributes` is in its category list, so it instead goes on to fetch and
    // write creation-pool bookkeeping through `self.get("creation")` -- and a
    // character straight out of `Vampire.create` has never entered the wizard
    // and has no creation record for it to write to. free_value 7 would be the
    // canonical creation pick, but it only makes sense for a character that is
    // actually in creation, which this one is not.
    //
    // The 3 XP this costs (`BNSMETV1_VampireCosts.calculate_trait_cost`:
    // attributes are `(value - free_value) * 3`) is spent on a throwaway
    // character, and nothing in this file asserts its XP.
    const charData = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        require(['app/models/Vampire'], function (Vampire) {
          Vampire.create_test_character('e2e_sheet_test').then(function (v) {
            return v.update_trait('Physical', 1, 'attributes', 0, true).then(function () {
              // Re-read rather than trusting the in-memory copy: parse-server
              // omits an array field from the save response when the op did
              // not change it, and parse@8 then applies the pending AddUnique
              // to undefined -- see the long note in Character.update_trait.
              return Vampire.get_character(v.id, ['attributes']);
            });
          }).then(function (fresh) {
            const attributes = fresh.get('attributes') || [];
            resolve({
              id: fresh.id,
              name: fresh.get('name'),
              traitId: attributes.length > 0 ? attributes[0].id : null
            });
          }).fail(reject);
        });
      });
    });

    characterId = charData.id;
    characterName = charData.name;
    traitId = charData.traitId;
    await page.close();

    // Loud, not silent. A missing trait id is a broken fixture, and the whole
    // point of this change is that it can no longer masquerade as a skip.
    if (!traitId) {
      throw new Error(
        'character-sheet fixture: no attributes trait id after seeding. ' +
        'The trait-edit test cannot run, and must not quietly skip.'
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('User Character Roster lists characters and shows creation link', async ({ page }) => {
    await navigateToHash(page, 'characters?all', '#characters-all');

    const charsPage = page.locator('#characters-all');
    await expect(charsPage).toBeVisible();
    await expect(charsPage.locator('input#characters-filter')).toBeAttached();
    await expect(charsPage.locator('ul[data-role="listview"]')).toBeAttached();
  });

  test('New Character View renders creation form with venue selection', async ({ page }) => {
    await navigateToHash(page, 'characternew', '#character-new');

    const newCharPage = page.locator('#character-new');
    await expect(newCharPage).toBeVisible();
    await expect(newCharPage.locator('input[name="name"]')).toBeVisible();
    await expect(newCharPage.locator('select[name="type"]')).toBeAttached();
    await expect(newCharPage.locator('button[type="submit"]')).toBeVisible();
  });

  test('Character Creation View renders archetype, clan and trait slots', async ({ page }) => {
    // Create a new uncompleted character for creation view
    const creationChar = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        require(['app/models/Vampire'], function (Vampire) {
          Vampire.create('Creation Test Char').then(function (v) {
            resolve({ id: v.id, name: v.get('name') });
          }).fail(reject);
        });
      });
    });

    await navigateToHash(page, `charactercreate/${creationChar.id}`, '#character-create');

    const createPage = page.locator('#character-create');
    await expect(createPage).toBeVisible();
  });

  test('Main Character Sheet renders XP counters, action buttons and trait sections', async ({ page }) => {
    await navigateToHash(page, `character?${characterId}`, '#character');

    const charPage = page.locator('#character');
    await expect(charPage).toBeVisible();

    // Verify XP counter texts
    await expect(charPage.getByText('Earned XP:')).toBeVisible();
    await expect(charPage.getByText('Spent XP:')).toBeVisible();
    await expect(charPage.getByText('Available XP:')).toBeVisible();

    // Verify Action links
    await expect(charPage.locator(`a[href="#character/${characterId}/print"]`).first()).toBeAttached();
    await expect(charPage.locator(`a[href="#character/${characterId}/portrait"]`).first()).toBeAttached();
    await expect(charPage.locator(`a[href="#character/${characterId}/rename"]`).first()).toBeAttached();

    // Verify Progression links
    await expect(charPage.locator(`a[href="#character/${characterId}/history/0"]`).first()).toBeAttached();
    await expect(charPage.locator(`a[href="#character/${characterId}/experience/0/10"]`).first()).toBeAttached();
    await expect(charPage.locator(`a[href="#character/${characterId}/costs"]`).first()).toBeAttached();
    await expect(charPage.locator(`a[href="#character/${characterId}/log/0/10"]`).first()).toBeAttached();
  });

  test('SimpleTrait Category View renders trait listing and add action', async ({ page }) => {
    await navigateToHash(page, `simpletraits/attributes/${characterId}/all`, '#simpletraitcategory-all');

    const catPage = page.locator('#simpletraitcategory-all');
    await expect(catPage).toBeVisible();
    await expect(catPage.locator(`a[href="#simpletraits/attributes/${characterId}/new"]`)).toBeAttached();
  });

  // The `if (!traitId) test.skip(...)` guard that used to open this test is
  // gone on purpose. `beforeAll` now guarantees the trait, and throws if it
  // cannot -- a guard here would let the test go back to silently not running,
  // which is exactly how it spent its whole life until now.
  test('SimpleTrait Edit View renders trait sliders and save button', async ({ page }) => {
    await navigateToHash(page, `simpletrait/attributes/${characterId}/${traitId}`, '#simpletrait-change');

    const traitPage = page.locator('#simpletrait-change');
    await expect(traitPage).toBeVisible();
    await expect(traitPage.locator('input.value-slider')).toBeAttached();
    await expect(traitPage.locator('button.save')).toBeVisible();
    await expect(traitPage.locator('button.remove')).toBeVisible();

    // Not just "a slider exists": it is bound to THIS trait. The seeded value
    // is 1, and jQuery Mobile's range enhancement keeps the underlying input
    // in sync with the handle it draws.
    await expect(traitPage.locator('input.value-slider')).toHaveValue('1');

    // And the view identifies the trait it is editing, so a page that rendered
    // the right furniture for the wrong record cannot pass.
    await expect(traitPage.locator('#simpletrait-viewing')).toContainText('Physical');
  });

  test('Character Printable Sheet renders full sheet layout and print options', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/print`, '#printable-sheet');

    const printPage = page.locator('#printable-sheet');
    await expect(printPage).toBeVisible();
    await expect(printPage.locator('#cpp-header')).toBeAttached();
    await expect(printPage.locator('#cpp-attributes')).toBeAttached();
  });

  test('Character Rename View renders input and updates character name', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/rename`, '#character-rename');

    const renamePage = page.locator('#character-rename');
    await expect(renamePage).toBeVisible();

    const nameInput = renamePage.locator('input[name="name"]');
    await expect(nameInput).toBeVisible();

    const newName = `Renamed Char ${Date.now()}`;
    await nameInput.fill(newName);
    await nameInput.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));

    const submitBtn = renamePage.locator('button[name="submit"], button#submit');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();
    await waitForJqmLoader(page);

    // Verify success feedback
    await expect(renamePage.getByText('Successfully Updated')).toBeVisible({ timeout: 10000 });
  });

  test('Character Portrait View renders file upload form', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/portrait`, '#character-portrait');

    const portraitPage = page.locator('#character-portrait');
    await expect(portraitPage).toBeVisible();
    await expect(portraitPage.locator('#input-portrait')).toBeAttached();
  });

  test('Character Delete View renders archive action and allows character deletion', async ({ page }) => {
    // Create an expendable character to delete
    const deleteChar = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        require(['app/models/Vampire'], function (Vampire) {
          Vampire.create('Char To Delete').then(function (v) {
            resolve({ id: v.id, name: v.get('name') });
          }).fail(reject);
        });
      });
    });

    await navigateToHash(page, `character/${deleteChar.id}/delete`, '#character-delete');

    const deletePage = page.locator('#character-delete');
    await expect(deletePage).toBeVisible();

    const deleteBtn = deletePage.locator('.delete-character');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    await waitForJqmLoader(page);

    // Should navigate back to characters list
    await expect(page.locator('#characters-all')).toBeVisible({ timeout: 10000 });
  });
});
