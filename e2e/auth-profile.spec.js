const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsMember, logout } = require('./helpers/auth');
const { waitForAppReady, waitForJqmLoader, navigateToHash } = require('./helpers/jqm-helpers');

test.describe('Authentication, User Profile & Navigation E2E Suite', () => {

  test.describe('Unauthenticated User Flows', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);
      // Ensure user is logged out
      await page.evaluate(() => {
        if (window.Parse && window.Parse.User.current()) {
          window.Parse.User.logOut();
        }
      });
      await page.reload();
      await waitForAppReady(page);
    });

    test('Login view displays all required fields and links', async ({ page }) => {
      await navigateToHash(page, 'login', '#login');

      const loginPage = page.locator('#login');
      await expect(loginPage).toBeVisible();

      // Form inputs and buttons
      await expect(loginPage.locator('#login-username')).toBeVisible();
      await expect(loginPage.locator('#login-password')).toBeVisible();
      await expect(loginPage.locator('button:has-text("Log in with Username and Password")')).toBeVisible();

      // Auxiliary links
      await expect(loginPage.locator('a[href="#signup"]')).toBeVisible();
      await expect(loginPage.locator('a[href="#reset"]')).toBeVisible();
      await expect(loginPage.locator('a[href="#about"]')).toBeVisible();
    });

    test('Login with invalid credentials displays error message', async ({ page }) => {
      await navigateToHash(page, 'login', '#login');

      const loginPage = page.locator('#login');
      await loginPage.locator('#login-username').fill('invalid_test_user');
      await loginPage.locator('#login-password').fill('wrong_password_123');

      await loginPage.locator('button:has-text("Log in with Username and Password")').click();

      const errorBox = loginPage.locator('.login-form .error');
      await expect(errorBox).toBeVisible({ timeout: 10000 });
      await expect(errorBox).not.toBeEmpty();
    });

    test('Signup view displays username and password registration fields', async ({ page }) => {
      await navigateToHash(page, 'signup', '#signup');

      const signupPage = page.locator('#signup');
      await expect(signupPage).toBeVisible();
      await expect(signupPage.locator('#signup-username')).toBeVisible();
      await expect(signupPage.locator('#signup-password')).toBeVisible();
      await expect(signupPage.locator('button:has-text("Sign Up")').first()).toBeVisible();
    });

    test('Signup with empty fields displays error message', async ({ page }) => {
      await navigateToHash(page, 'signup', '#signup');

      const signupPage = page.locator('#signup');
      await signupPage.locator('#signup-username').fill('');
      await signupPage.locator('#signup-password').fill('');

      await signupPage.locator('form.signup-form button').click();

      const errorBox = signupPage.locator('.signup-form .error');
      await expect(errorBox).toBeVisible({ timeout: 10000 });
      await expect(errorBox).not.toBeEmpty();
    });
  });

  test.describe('Authenticated User Flows', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page);
    });

    test('Header displays logged in username and logout button', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      const logoutBtn = page.locator('#header-logout-button');
      await expect(logoutBtn).toBeVisible();
      await expect(logoutBtn).toContainText('devuser');
    });

    test('Footer navbar provides persistent navigation across views', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      const footer = page.locator('div[data-role="footer"]');
      await expect(footer).toBeAttached();

      const charactersLink = footer.locator('a[href="#characters?all"], a[href="#characters"]');
      const profileLink = footer.locator('a[href="#profile"]');

      await expect(charactersLink.first()).toBeAttached();
      await expect(profileLink.first()).toBeAttached();
    });

    test('User Profile view renders profile form and role associations', async ({ page }) => {
      await navigateToHash(page, 'profile', '#user-settings-profile');

      const profilePage = page.locator('#user-settings-profile');
      await expect(profilePage).toBeVisible();

      // Profile form region
      await expect(profilePage.locator('#user-settings-profile-abs-form')).toBeAttached();
      await expect(profilePage.locator('#user-roles-available')).toBeAttached();
      await expect(profilePage.locator('#usp-patronage-list-region')).toBeAttached();
    });

    test('Logout action clears session and redirects to login', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      await page.evaluate(() => {
        window.location.hash = '#logout';
      });

      await page.waitForTimeout(1000);
      await waitForAppReady(page);

      // Verify user is logged out
      const isLoggedOut = await page.evaluate(() => {
        return !window.Parse.User.current();
      });
      expect(isLoggedOut).toBe(true);
    });
  });
});
