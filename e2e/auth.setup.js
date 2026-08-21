const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, loginAsAST, logout } = require('./helpers/auth');
const { waitForAppReady } = require('./helpers/jqm-helpers');

test.describe('E2E Test Infrastructure & Auth Setup', () => {
  test('Application loads and renders index page', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page).toHaveTitle(/(Yorick|Log In)/);
  });

  test('Can log in as Administrator (devuser)', async ({ page }) => {
    await loginAsAdmin(page);
    const username = await page.evaluate(() => window.Parse.User.current().get('username'));
    expect(username).toBe('devuser');
  });

  test('Can log in as Regular Member (sampmem)', async ({ page }) => {
    await loginAsMember(page);
    const username = await page.evaluate(() => window.Parse.User.current().get('username'));
    expect(username).toBe('sampmem');
  });

  test('Can log in as Assistant Storyteller (sampast)', async ({ page }) => {
    await loginAsAST(page);
    const username = await page.evaluate(() => window.Parse.User.current().get('username'));
    expect(username).toBe('sampast');
  });

  test('Can log out successfully', async ({ page }) => {
    await loginAsMember(page);
    await logout(page);
    const isLoggedOut = await page.evaluate(() => !window.Parse.User.current());
    expect(isLoggedOut).toBe(true);
  });
});
