// The shape to promote a recording to once it is worth keeping: named capture
// points, and assertions that run per build rather than through the mirror.
//
//   node e2e/mirror/run.js e2e/mirror/recordings/example-module.js
//
// Arguments:
//   page   the mirror - every call fans out to all builds
//   pages  the real Playwright pages, in target order, for anything per-build
//   step   force a screenshot + diff right here, with a label you choose
//   expect Playwright's expect, which only works against entries in `pages`

module.exports = async ({ page, pages, step, expect }) => {
  await page.goto('/');
  await step('landing');

  await page.locator('#login-username').fill('devuser');
  await page.locator('#login-password').fill('thedumbness');
  await page.getByRole('button', { name: 'Login' }).click();
  await step('logged in');

  await page.getByRole('link', { name: 'Characters' }).click();
  await step('character list');

  // Assertions go against the real pages. `expect(page.getByRole(...))` cannot
  // work - the mirror hands back one locator per build, and expect has no idea
  // what to do with several at once.
  for (const p of pages) {
    await expect(p.getByRole('heading', { name: /characters/i })).toBeVisible();
  }

  // Reads fan out too, so an awaited value is an *array*, one entry per build,
  // in target order. That makes it a direct way to compare state that never
  // reaches the screen - and a trap if you branch on it expecting a scalar.
  const counts = await page.locator('.character-list li').count();
  if (new Set(counts).size > 1) {
    console.log(`  !! character counts differ across builds: ${JSON.stringify(counts)}`);
  }
};
