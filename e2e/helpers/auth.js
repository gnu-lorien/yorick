const { waitForAppReady, waitForJqmLoader } = require('./jqm-helpers');

/**
 * Authentication helper for Playwright E2E tests
 */

/**
 * Perform login via UI and wait for session initialization
 */
async function loginAs(page, username, password) {
  await page.goto('/');
  await waitForAppReady(page);

  // Check if already logged in as this user
  const currentUser = await page.evaluate(() => {
    return window.Parse && window.Parse.User.current() ? window.Parse.User.current().get('username') : null;
  });

  if (currentUser === username) {
    return;
  }

  // If logged in as another user, log out first
  if (currentUser) {
    await logout(page);
  }

  // Transition to login page
  await page.evaluate(() => {
    window.location.hash = '#login';
    if (window.jQuery && window.jQuery.mobile) {
      window.jQuery.mobile.changePage('#login', { reverse: false, changeHash: false });
    }
  });

  await page.waitForSelector('#login.ui-page-active #login-username, #login #login-username', { state: 'visible', timeout: 15000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);

  // Submit form
  await page.locator('#login form.login-form button, #login form button, #login button').first().click();

  // Wait for login processing and page reload
  await page.waitForTimeout(1000);
  await waitForAppReady(page);
  await waitForJqmLoader(page);

  // Verify Parse.User.current() is logged in
  await page.waitForFunction((u) => {
    return window.Parse && window.Parse.User.current() && window.Parse.User.current().get('username') === u;
  }, username, { timeout: 15000 });
}

/**
 * Log in as Admin / Storyteller ('devuser')
 */
async function loginAsAdmin(page) {
  return loginAs(page, 'devuser', 'thedumbness');
}

/**
 * Log in as Assistant Storyteller ('sampast')
 */
async function loginAsAST(page) {
  return loginAs(page, 'sampast', 'sampast');
}

/**
 * Log in as Regular Member ('sampmem')
 */
async function loginAsMember(page) {
  return loginAs(page, 'sampmem', 'sampmem');
}

/**
 * Log out current session
 */
async function logout(page) {
  await page.evaluate(() => {
    if (window.Parse && window.Parse.User) {
      window.Parse.User.logOut();
    }
    window.localStorage.clear();
  });
  await page.goto('/');
  await waitForAppReady(page);
}

module.exports = {
  loginAs,
  loginAsAdmin,
  loginAsAST,
  loginAsMember,
  logout
};
