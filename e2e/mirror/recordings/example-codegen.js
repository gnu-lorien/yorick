// Exactly what `playwright codegen --target=playwright-test` writes, kept
// unedited to show that no editing is needed. `run.js` pulls the body out of
// the test callback and binds `page` to the mirror, so every line below drives
// all of your builds at once, and the absolute URL in `goto` is re-pointed at
// each build's own origin.
//
//   node e2e/mirror/run.js e2e/mirror/recordings/example-codegen.js
//
// Replace this file's contents wholesale with your own recording.

const { test, expect } = require('@playwright/test');

test('test', async ({ page }) => {
  await page.goto('http://127.0.0.1:41337/');
  await page.locator('#login-username').fill('devuser');
  await page.locator('#login-password').fill('thedumbness');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.getByRole('link', { name: 'Characters' }).click();
});
