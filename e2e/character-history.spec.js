const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, logout } = require('./helpers/auth');
const { waitForAppReady, waitForJqmLoader, navigateToHash, waitForJqmPopup, submitJqmForm } = require('./helpers/jqm-helpers');

test.describe('Character History & XP Views E2E Suite', () => {
  let characterId;
  let characterName;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginAsAdmin(page);

    // Create a fresh test character
    const charData = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        require(['app/models/Vampire'], function (Vampire) {
          Vampire.create_test_character('e2e_history').then(function (v) {
            resolve({ id: v.id, name: v.get('name') });
          }).fail(reject);
        });
      });
    });

    characterId = charData.id;
    characterName = charData.name;
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('XP Notations View renders stat summaries and table structure', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/experience/0/10`, '#experience-notations-all');

    // Verify stat cards
    await expect(page.locator('#experience-notations-all')).toContainText(/Earned:/);
    await expect(page.locator('#experience-notations-all')).toContainText(/Spent:/);
    await expect(page.locator('#experience-notations-all')).toContainText(/Available:/);

    // Verify Add button
    const addButton = page.locator('#experience-notations-all button.add');
    await expect(addButton).toBeVisible();

    // Verify table columns
    await expect(page.locator('#experience-notations-all table')).toBeVisible();
    await expect(page.locator('#experience-notations-all table')).toContainText('Date');
    await expect(page.locator('#experience-notations-all table')).toContainText('Reason');
  });

  test('Can add a new XP notation entry', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/experience/0/10`, '#experience-notations-all');

    const initialRows = await page.locator('#experience-notations-all tbody tr').count();

    // Click "+ Add New Experience Notation"
    await page.locator('#experience-notations-all button.add').click();
    await waitForJqmLoader(page);
    await page.waitForTimeout(1000);

    // Verify row count increased
    const newRows = await page.locator('#experience-notations-all tbody tr').count();
    expect(newRows).toBeGreaterThan(initialRows);
  });

  test('Can edit XP notation Reason and Earned alteration via popups', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/experience/0/10`, '#experience-notations-all');

    // Click edit on Reason
    const editReasonBtn = page.locator('.experience-notation-edit[header="reason"]').first();
    await expect(editReasonBtn).toBeVisible();
    await editReasonBtn.click();

    // Wait for Reason popup
    await waitForJqmPopup(page, '#popupEditReason');
    await page.fill('#popupEditReason #reason-input', 'Completed Milestone Quest');
    await page.locator('#edit-reason-popup-form button[type="submit"]').click();
    await waitForJqmLoader(page);
    await page.waitForTimeout(800);

    // Verify table updated
    await expect(page.locator('#experience-notations-all table')).toContainText('Completed Milestone Quest');

    // Click edit on Earned alteration
    const editEarnedBtn = page.locator('.experience-notation-edit[header="alteration_earned"]').first();
    await editEarnedBtn.click();

    // Wait for Alteration popup
    await waitForJqmPopup(page, '#alterationpopupEdit');
    await page.fill('#alterationpopupEdit #alteration-input', '15');
    await page.locator('#alterationpopupEdit button[type="submit"], #alterationpopupEdit button').first().click();
    await waitForJqmLoader(page);
    await page.waitForTimeout(800);

    // Verify Available XP updated
    await expect(page.locator('#experience-notations-all table')).toContainText('15');
  });

  test('Can delete an XP notation entry and observe recalculation', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/experience/0/10`, '#experience-notations-all');

    // Delete the first notation
    const deleteBtn = page.locator('.experience-notation-delete').first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    await waitForJqmLoader(page);
    await page.waitForTimeout(1000);

    // Verify table re-rendered
    await expect(page.locator('#experience-notations-all table')).toBeVisible();
  });

  test('Character History Timeline View renders version viewer and transformed sheet', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/history/0`, '#character-history');

    // Verify history regions exist
    await expect(page.locator('#history-main')).toBeVisible();
    await expect(page.locator('#history-viewing')).toBeVisible();
    await expect(page.locator('#history-sheet')).toBeVisible();
  });

  test('Character Log View renders chronological changes table', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/log/0/10`, '#character-log');

    await expect(page.locator('#character-log')).toBeVisible();
    await expect(page.locator('#character-log')).toContainText(characterName);
    await expect(page.locator('#character-log table')).toBeVisible();
  });

  test('Character Costs View renders trait cost breakdowns', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/costs`, '#character-costs');

    await expect(page.locator('#character-costs')).toBeVisible();
    await expect(page.locator('#character-costs')).toContainText(characterName);
  });

  test('Character Approval View renders approval review interface', async ({ page }) => {
    await navigateToHash(page, `character/${characterId}/approval`, '#character-approval');

    await expect(page.locator('#character-approval')).toBeVisible();
    await expect(page.locator('#approval-changes')).toBeVisible();
    await expect(page.locator('#approval-approvals')).toBeVisible();
  });
});
