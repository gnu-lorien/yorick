/**
 * jQuery Mobile & DOM Helper functions for Playwright E2E tests
 */

/**
 * Wait for jQuery Mobile and RequireJS to finish initial app bootstrap
 */
async function waitForAppReady(page, timeout = 20000) {
  await page.waitForFunction(() => {
    return typeof window.jQuery !== 'undefined' &&
           typeof window.jQuery.mobile !== 'undefined' &&
           typeof window.Parse !== 'undefined' &&
           window.Parse.applicationId;
  }, { timeout });
  await page.waitForTimeout(300);
}

/**
 * Wait for jQuery Mobile loading spinner overlay to disappear
 */
async function waitForJqmLoader(page, timeout = 8000) {
  try {
    await page.waitForFunction(() => {
      const loader = document.querySelector('.ui-loader');
      if (!loader) return true;
      const style = window.getComputedStyle(loader);
      return style.display === 'none' || style.visibility === 'hidden' || loader.offsetParent === null;
    }, { timeout });
  } catch (e) {
    // Ignore timeout if loader already finished
  }
}

/**
 * Navigate to a specific hash route and wait for the target page to become active
 */
async function navigateToHash(page, hash, targetSelector = null) {
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
  await page.evaluate((h) => {
    window.location.hash = '#' + h;
  }, cleanHash);

  await page.waitForTimeout(400);
  await waitForJqmLoader(page);

  if (targetSelector) {
    await page.waitForSelector(targetSelector, { state: 'visible', timeout: 10000 });
  }
}

/**
 * Set value on a jQuery Mobile slider input and trigger change
 */
async function setJqmSlider(page, selector, value) {
  await page.waitForSelector(selector, { state: 'visible' });
  await page.evaluate(({ sel, val }) => {
    const el = window.$(sel);
    el.val(val).slider('refresh').trigger('change');
  }, { sel: selector, val: value });
  await page.waitForTimeout(200);
}

/**
 * Submit a form and wait for network/loading spinner completion
 */
async function submitJqmForm(page, formSelector) {
  await page.waitForSelector(formSelector, { state: 'visible' });
  await page.locator(formSelector).locator('button[type="submit"], input[type="submit"]').first().click();
  await waitForJqmLoader(page);
  await page.waitForTimeout(500);
}

/**
 * Wait for a jQuery Mobile popup to become open
 */
async function waitForJqmPopup(page, popupSelector) {
  await page.waitForFunction((sel) => {
    const popup = document.querySelector(sel);
    return popup && (popup.classList.contains('ui-popup-active') || window.jQuery(sel).parent().hasClass('ui-popup-active'));
  }, popupSelector, { timeout: 8000 });
}

module.exports = {
  waitForAppReady,
  waitForJqmLoader,
  navigateToHash,
  setJqmSlider,
  submitJqmForm,
  waitForJqmPopup
};
