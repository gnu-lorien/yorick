/**
 * Portrait upload helpers for characters and troupes.
 *
 * Uploads only work when the server's `publicServerURL` points at the server
 * actually running. The `crop_and_thumb` beforeSave hook in cloud/main.js
 * generates thumbnails by fetching the just-saved file back over HTTP from that
 * URL, so if it points somewhere unreachable the fetch fails, the beforeSave
 * rejects, and the upload surfaces as a bare "[object Object]" in the form's
 * error div. The Playwright config sets PUBLIC_SERVER_URL for this reason.
 */

const { navigateToHash, waitForJqmLoader } = require('./jqm-helpers');
const { fetchRenderedImage, assertImageColor } = require('./images');

/** Where a character's portrait is expected to appear, by surface. */
const CHARACTER_PORTRAIT_SELECTORS = {
  sheet: '#character img.character-link-portrait',
  roster: '#characters-all img.character-link-portrait',
  print: '#printable-sheet img',
  troupeRoster: '#troupe-characters-all img.character-link-portrait',
  selectToPrint: '#troupe-select-to-print-characters-all img.character-link-portrait'
};

/**
 * Note the asymmetry: the troupe detail page renders the *original* upload in a
 * bare `<img>` with no class, while the directory renders the generated
 * `thumbnail_128.jpg` in `img.troupe-link-portrait`. A selector that assumes the
 * class on both finds nothing on the detail page.
 */
const TROUPE_PORTRAIT_SELECTORS = {
  detail: '#troupe img',
  directory: '#troupes-list img.troupe-link-portrait'
};

/** True when the element is still showing the built-in placeholder. */
function isPlaceholder(src) {
  return !src || /head_skull\.png/.test(src);
}

/**
 * Upload a portrait and wait for it to be accepted.
 * Throws with the form's own error text when the upload is rejected, rather
 * than letting a later assertion fail somewhere unrelated.
 */
async function uploadCharacterPortrait(page, characterId, filePath, { timeout = 30000 } = {}) {
  await navigateToHash(page, `character/${characterId}/portrait`, '#character-portrait');
  await page.setInputFiles('#character-portrait #input-portrait', filePath);
  await page.locator('#character-portrait button.update').click();
  await waitForJqmLoader(page);
  await waitForUploadOutcome(page, '#character-portrait', timeout);
}

async function uploadTroupePortrait(page, troupeId, filePath, { timeout = 30000 } = {}) {
  await navigateToHash(page, `troupe/${troupeId}/portrait`, '#troupe-portrait');
  await page.setInputFiles('#troupe-portrait #troupe-input-portrait', filePath);
  await page.locator('#troupe-portrait button.update').click();
  await waitForJqmLoader(page);
  await waitForUploadOutcome(page, '#troupe-portrait', timeout);
}

/**
 * Wait for the upload to either clear or report an error.
 * The views reveal a `.error` div on failure and leave it hidden on success.
 */
async function waitForUploadOutcome(page, pageSelector, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return { missing: true };
      const err = root.querySelector('.error');
      if (!err) return { visible: false, text: '' };
      const style = window.getComputedStyle(err);
      return {
        visible: style.display !== 'none' && err.textContent.trim().length > 0,
        text: err.textContent.trim()
      };
    }, pageSelector);

    if (state.visible) {
      throw new Error(`portrait upload was rejected: ${state.text}`);
    }
    await page.waitForTimeout(500);
    // Give the beforeSave thumbnail generation a moment, then stop waiting.
    if (Date.now() > deadline - timeout + 4000) return;
  }
}

/**
 * Fetch a rendered portrait and assert it carries the fixture's colour.
 * Returns the decoded image so callers can make further assertions.
 */
async function expectPortraitMatches(page, selector, expectedColor, label) {
  const src = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.getAttribute('src') : null;
  }, selector);

  if (isPlaceholder(src)) {
    throw new Error(`${label}: still showing the placeholder portrait (src=${src})`);
  }

  const fetched = await fetchRenderedImage(page, selector);
  assertImageColor(fetched, expectedColor, { label });
  return fetched;
}

module.exports = {
  CHARACTER_PORTRAIT_SELECTORS,
  TROUPE_PORTRAIT_SELECTORS,
  isPlaceholder,
  uploadCharacterPortrait,
  uploadTroupePortrait,
  expectPortraitMatches
};
