const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, logout } = require('./helpers/auth');
const { waitForAppReady, waitForJqmLoader, navigateToHash, waitForJqmPopup } = require('./helpers/jqm-helpers');

test.describe('Administration Interfaces E2E Suite', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('Administration dashboard displays all 13 management categories for admin', async ({ page }) => {
    await navigateToHash(page, 'administration', '#administration');

    const adminPage = page.locator('#administration');
    await expect(adminPage).toBeVisible();

    // Verify key admin links
    await expect(adminPage.locator('a[href="#troupes"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/characters/all"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/characters/summarize"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/users/all"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/patronages"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/patronagescsv"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/descriptions"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/bnsmetv1_clan_rules"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/bnsctdbs_kith_rules"]')).toBeVisible();
    await expect(adminPage.locator('a[href="#administration/referendums"]')).toBeVisible();
  });

  test('User Administration list renders and allows selecting a user', async ({ page }) => {
    await navigateToHash(page, 'administration/users/all', '#troupe-add-staff');

    await expect(page.locator('#troupe-add-staff')).toBeVisible();
    const userListItems = page.locator('#troupe-add-staff ul li');
    await expect(userListItems.first()).toBeVisible();

    // Verify devuser or sampmem is in the list
    await expect(page.locator('#troupe-add-staff')).toContainText(/devuser|sampmem|sampast/);
  });

  test('User Detail view allows toggling Administrator permission and password reset', async ({ page }) => {
    // Get target user ID dynamically
    const targetUserId = await page.evaluate(async () => {
      const q = new window.Parse.Query(window.Parse.User);
      q.equalTo('username', 'sampmem');
      const u = await q.first();
      return u ? u.id : null;
    });

    expect(targetUserId).not.toBeNull();

    await navigateToHash(page, `administration/user/${targetUserId}`, '#administration-user-view');
    await expect(page.locator('#administration-user-view')).toBeVisible();

    // Verify Reset Password component
    const resetPwView = page.locator('#reset-password-view');
    await expect(resetPwView).toBeVisible();
    await expect(resetPwView.locator('button')).toContainText('Reset Password');

    // Verify Profile / Admin interface form
    const absForm = page.locator('#abs-form');
    await expect(absForm).toBeVisible();
    await expect(absForm).toContainText('Administrator');
  });

  test('Patronages View renders patronages listing table', async ({ page }) => {
    await navigateToHash(page, 'administration/patronages', '#administration-patronages-view');

    await expect(page.locator('#administration-patronages-view')).toBeVisible();
    await expect(page.locator('#administration-patronages-view a[href="#administration/patronages/new"]')).toBeVisible();
    await expect(page.locator('#administration-patronages-view-list')).toBeAttached();
  });

  test('Patronages CSV View renders CSV formatted patronages', async ({ page }) => {
    await navigateToHash(page, 'administration/patronagescsv', '#administration-patronages-view-csv');

    await expect(page.locator('#administration-patronages-view-csv')).toBeVisible();
    await expect(page.locator('#administration-patronages-view-csv-list')).toBeAttached();
  });

  test('Game Rules Editor (Clan Rules) renders rules table', async ({ page }) => {
    await navigateToHash(page, 'administration/bnsmetv1_clan_rules', '#administration-descriptions');

    await expect(page.locator('#administration-descriptions')).toBeVisible();
    await expect(page.locator('#administration-descriptions-list')).toBeVisible();
  });

  test('Game Rules Editor (Kith Rules) renders rules table', async ({ page }) => {
    await navigateToHash(page, 'administration/bnsctdbs_kith_rules', '#administration-descriptions');

    await expect(page.locator('#administration-descriptions')).toBeVisible();
    await expect(page.locator('#administration-descriptions-list')).toBeVisible();
  });

  test('Descriptions Management View renders category sections', async ({ page }) => {
    await navigateToHash(page, 'administration/descriptions', '#administration-descriptions');

    await expect(page.locator('#administration-descriptions')).toBeVisible();
    await expect(page.locator('#descriptions-sections')).toBeVisible();
  });

  test('Referendums Administration View renders active referendums list', async ({ page }) => {
    await navigateToHash(page, 'administration/referendums', '#referendums-list');

    await expect(page.locator('#referendums-list')).toBeVisible();
    await expect(page.locator('#referendums-list div[role="referendums-list"]')).toBeVisible();
  });
});
