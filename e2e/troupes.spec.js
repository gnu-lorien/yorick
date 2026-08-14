const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, loginAsAST } = require('./helpers/auth');
const { waitForAppReady, waitForJqmLoader, navigateToHash } = require('./helpers/jqm-helpers');

test.describe('Troupe Interfaces E2E Suite', () => {
  const sampleTroupeId = 'WOad4CBTsG';

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('Troupe Directory lists troupes and Add Troupe action', async ({ page }) => {
    await navigateToHash(page, 'troupes', '#troupes-list');

    const troupesPage = page.locator('#troupes-list');
    await expect(troupesPage).toBeVisible();

    // Verify sample troupe is listed
    await expect(troupesPage).toContainText('Sample Troupe');

    // Verify Add Troupe button for administrator
    const addTroupeBtn = troupesPage.locator('a[href="#troupe/new"]');
    await expect(addTroupeBtn).toBeVisible();
  });

  test('Troupe Detail view renders metadata, action buttons, and staff section', async ({ page }) => {
    await navigateToHash(page, `troupe/${sampleTroupeId}`, '#troupe');

    const troupePage = page.locator('#troupe');
    await expect(troupePage).toBeVisible();

    // Verify action buttons
    await expect(troupePage.locator('.troupe-view-characters')).toBeVisible();
    await expect(troupePage.locator('.troupe-view-character-relationships')).toBeVisible();
    await expect(troupePage.locator('.troupe-view-summarize-characters')).toBeVisible();
    await expect(troupePage.locator('.troupe-view-print-characters')).toBeVisible();

    // Verify Troupe form and staff regions
    await expect(troupePage.locator('#troupe-data')).toBeVisible();
    await expect(troupePage.locator('#troupe-staff')).toBeVisible();
    await expect(troupePage.locator('.troupe-add-staff')).toBeVisible();
  });

  test('Troupe Staff Add interface renders user search and roster selection', async ({ page }) => {
    await navigateToHash(page, `troupe/${sampleTroupeId}/staff/add`, '#troupe-add-staff');

    const addStaffPage = page.locator('#troupe-add-staff');
    await expect(addStaffPage).toBeVisible();
    await expect(addStaffPage.locator('ul')).toBeVisible();
  });

  test('Troupe Characters list view renders character roster', async ({ page }) => {
    await navigateToHash(page, `troupe/${sampleTroupeId}/characters/all`, '#troupe-characters-all');

    const troupeCharsPage = page.locator('#troupe-characters-all');
    await expect(troupeCharsPage).toBeVisible();
  });

  test('Troupe Character Summarize view renders summary layout', async ({ page }) => {
    await navigateToHash(page, `troupe/${sampleTroupeId}/characters/summarize/all`, '#troupe-summarize-characters-all');

    const summarizePage = page.locator('#troupe-summarize-characters-all');
    await expect(summarizePage).toBeVisible();
  });

  test('Troupe Character Select to Print view renders selection list', async ({ page }) => {
    await navigateToHash(page, `troupe/${sampleTroupeId}/characters/selecttoprint/all`, '#troupe-select-to-print-characters-all');

    const printSelectPage = page.locator('#troupe-select-to-print-characters-all');
    await expect(printSelectPage).toBeVisible();
  });

  test('Troupe Character Relationships Network renders graph workspace', async ({ page }) => {
    await navigateToHash(page, `troupe/${sampleTroupeId}/characters/relationships/network`, '#troupe-character-relationships-network');

    const networkPage = page.locator('#troupe-character-relationships-network');
    await expect(networkPage).toBeVisible();
    await expect(networkPage.locator('#relationships-network')).toBeVisible();
  });

  test('Troupe Portrait View renders upload interface', async ({ page }) => {
    await navigateToHash(page, `troupe/${sampleTroupeId}/portrait`, '#troupe-portrait');

    const portraitPage = page.locator('#troupe-portrait');
    await expect(portraitPage).toBeVisible();
    await expect(portraitPage.locator('#troupe-input-portrait')).toBeAttached();
  });
});
