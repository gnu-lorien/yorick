/**
 * jQuery Mobile / Marionette / Parse helpers for the Playwright E2E suite.
 *
 * Yorick renders every route into a jQuery Mobile page inside one document, so
 * "navigation" means changing the hash and waiting for a different page element
 * to become the active one. There is no document-level load event to hang a
 * wait on, which is why these helpers wait on application state rather than
 * sleeping for a fixed interval.
 */

const DEFAULT_TIMEOUT = parseInt(process.env.E2E_NAV_TIMEOUT || '20000', 10);

/**
 * Which front end answered.
 *
 * The suite runs unchanged against both: `E2E_FRONTEND=react` serves the Vite
 * build instead of `public/`, and the helpers below ask the page rather than
 * take a flag, so no spec has to know which one it is driving.
 *
 * Detected from the page rather than from the environment variable, because
 * what matters is what actually loaded. A run pointed at a stale build would
 * otherwise report a confusing failure three helpers later.
 */
async function isReact(page) {
  return page.evaluate(() => !!window.__yorick).catch(() => false);
}

/**
 * Wait for the app to finish bootstrapping.
 *
 * Legacy: RequireJS, jQuery Mobile and the Parse SDK. React: the test bridge
 * and the Parse SDK. `Parse.applicationId` is checked on both because
 * `window.Parse` exists a moment before `initialize` has run, and every helper
 * after this one assumes the SDK will answer.
 */
async function waitForAppReady(page, timeout = DEFAULT_TIMEOUT) {
  await page.waitForFunction(() => {
    if (typeof window.Parse === 'undefined' || !window.Parse.applicationId) return false;
    if (window.__yorick) return true;
    return typeof window.jQuery !== 'undefined' &&
           typeof window.jQuery.mobile !== 'undefined' &&
           typeof window.require === 'function';
  }, { timeout });
}

/** Wait for the jQuery Mobile loading spinner to clear. */
async function waitForJqmLoader(page, timeout = 15000) {
  await page.waitForFunction(() => {
    const loader = document.querySelector('.ui-loader');
    if (!loader) return true;
    const style = window.getComputedStyle(loader);
    return style.display === 'none' || style.visibility === 'hidden' || loader.offsetParent === null;
  }, { timeout }).catch(() => { /* loader may never have appeared */ });
}

/** The id of the currently active jQuery Mobile page, or null. */
async function activePageId(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.ui-page-active');
    return el ? el.id : null;
  });
}

/**
 * Wait until `expectedId` is the active jQuery Mobile page.
 *
 * Marionette re-renders regions asynchronously after the page becomes active,
 * so this also waits for the page to stop being empty.
 */
async function waitForActivePage(page, expectedId, timeout = DEFAULT_TIMEOUT) {
  const id = expectedId.startsWith('#') ? expectedId.slice(1) : expectedId;
  try {
    await page.waitForFunction((wanted) => {
      const el = document.querySelector('.ui-page-active');
      if (!el || el.id !== wanted) return false;
      const main = el.querySelector('div[role="main"]') || el;
      return main.textContent.trim().length > 0 || main.children.length > 0;
    }, id, { timeout });
  } catch (err) {
    // A bare "waitForFunction timed out" says nothing about what went wrong.
    // Report where the app actually ended up, which is almost always the answer.
    const actual = await page.evaluate(() => {
      const el = document.querySelector('.ui-page-active');
      return {
        activePage: el ? el.id : null,
        empty: el ? (el.querySelector('div[role="main"]') || el).textContent.trim().length === 0 : null,
        hash: window.location.hash
      };
    }).catch(() => null);
    throw new Error(
      `expected jQuery Mobile page "#${id}" to become active within ${timeout}ms; ` +
      (actual
        ? `active page is "${actual.activePage ? '#' + actual.activePage : 'none'}"` +
          (actual.empty ? ' (rendered but empty)' : '') +
          `, hash is "${actual.hash}"`
        : 'could not read the page state')
    );
  }
  await waitForJqmLoader(page);
}

/**
 * Navigate to a hash route and wait for it to render.
 *
 * When `targetSelector` names a page id, this waits for that page to become the
 * *active* one rather than merely present, because every route's markup stays
 * in the document once visited and a plain selector wait would match a stale
 * hidden copy.
 */
async function navigateToHash(page, hash, targetSelector = null, timeout = DEFAULT_TIMEOUT) {
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;

  await page.evaluate((h) => {
    const current = window.location.hash.replace(/^#/, '');
    if (current !== h) {
      window.location.hash = '#' + h;
      return null;
    }
    // The hash is already what we want, so no hashchange will fire and the
    // route handler would never run.
    //
    // React renders from the hash, so an unchanged hash renders nothing new;
    // what "go there again" means there is "discard what is on screen and
    // fetch it fresh", which is what the bridge does. On the legacy side,
    // bouncing through a dummy hash to force a hashchange races jQuery
    // Mobile's transition queue and can strand the app mid transition, so
    // Backbone's router is driven directly instead.
    if (window.__yorick) {
      window.__yorick.redispatch();
      return null;
    }
    return new Promise((resolve) => {
      window.require(['backbone'], function (Backbone) {
        Backbone.history.loadUrl(h);
        resolve(null);
      });
    });
  }, cleanHash);

  await waitForJqmLoader(page, timeout);

  if (!targetSelector) return;

  const asId = targetSelector.startsWith('#') ? targetSelector.slice(1) : null;
  const isPageId = asId && /^[A-Za-z0-9_-]+$/.test(asId);

  if (!isPageId) {
    await page.waitForSelector(targetSelector, { state: 'visible', timeout });
    return;
  }

  // No retry, no reload: if the page does not become active, that is a real
  // failure and it is reported as one. This used to have two fallback tiers
  // (re-run the route handler, then reload the whole app) which existed solely
  // to absorb the jQuery Mobile transition-queue leak — see the YORICK PATCH in
  // `public/scripts/lib/jquery.mobile-1.4.5.js`. With that fixed the tiers stop
  // firing entirely, and keeping them would mean the suite could no longer
  // detect a regression of the very defect they were papering over. Absorbing
  // it silently is what produced two wrong diagnoses of this bug in the first
  // place, so honest failure is worth more here than automatic recovery.
  await waitForActivePage(page, asId, timeout);
}

/**
 * Reload the app from scratch, then wait for it to re-bootstrap.
 *
 * The Parse session lives in localStorage, so the user stays signed in across
 * the reload. Several router properties (`self.administrationEditRules`,
 * `self.administrationDescriptionsView`, ...) are memoized on the *router
 * instance* and only constructed once per page load; reloading is the only
 * reliable way to force a route handler to build a genuinely fresh view.
 */
async function hardReload(page, timeout = DEFAULT_TIMEOUT) {
  await page.evaluate(() => { window.location.reload(); });
  await waitForAppReady(page, timeout);
  // React survives the reload with a warm query cache in memory only, so this
  // is already a fresh app -- but the caller's intent is "forget everything",
  // and a reload that leaves a service-worker-style cache behind would make a
  // React run quietly easier than a legacy one.
  await page.evaluate(() => { if (window.__yorick) window.__yorick.hardReset(); });
}

/**
 * Set a slider and fire the event the app listens for.
 *
 * Two apps, two mechanisms. jQuery Mobile keeps the real value on the hidden
 * input and needs `slider("refresh")` to redraw the handle, and it listens for
 * a jQuery-triggered `change`. React owns the input's value through its own
 * state, so assigning `.value` is discarded on the next render unless the
 * assignment goes through the *native* value setter -- React tracks the last
 * value it wrote on the DOM node and skips any event whose value looks
 * unchanged. Both an `input` and a `change` event are dispatched because
 * controlled inputs listen for the former and `<select>`-style handlers for the
 * latter.
 */
async function setJqmSlider(page, selector, value) {
  await page.waitForSelector(selector, { state: 'attached' });
  await page.evaluate(({ sel, val }) => {
    if (window.jQuery) {
      const el = window.jQuery(sel);
      el.val(val);
      try { el.slider('refresh'); } catch (e) { /* not enhanced as a slider */ }
      el.trigger('change');
      return;
    }
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element matches ' + sel);
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

/** Submit a form and wait for the resulting work to finish. */
async function submitJqmForm(page, formSelector) {
  await page.waitForSelector(formSelector, { state: 'visible' });
  await page.locator(formSelector)
    .locator('button[type="submit"], input[type="submit"], button')
    .first()
    .click();
  await waitForJqmLoader(page);
}

/**
 * Popups are duplicated in the DOM, so ids are not unique.
 *
 * Every time a view re-renders, jQuery Mobile enhances a fresh copy of the
 * popup markup and leaves the previous copies behind. A character with four
 * experience notations ends up with sixteen elements carrying
 * `id="alteration-input"`. `document.querySelector('#alteration-input')` and
 * `page.fill('#alteration-input', ...)` therefore address an arbitrary — often
 * detached — copy, and the edit silently does nothing.
 *
 * Everything popup-related below is scoped to the one container jQuery Mobile
 * has actually opened and made visible.
 */
const ACTIVE_POPUP = '.ui-popup-container.ui-popup-active:visible';

/**
 * True when at least one copy of the named popup is open.
 *
 * On timeout this reports the popup state rather than only "waited 15000ms".
 * `xp-history` 75 fails here roughly one run in three and has moved between
 * three different waits as its surroundings changed, so a bare timeout costs a
 * whole run to learn nothing. Three explanations have already been disproved by
 * measurement - a late re-render closing the popup, `popup("close")` targeting
 * the wrong copy, and duplicate copies confusing the locator - and what is left
 * needs the state at the moment it fails. See test_timing_report.md.
 */
async function waitForJqmPopup(page, popupSelector, timeout = 15000) {
  try {
    await page.waitForFunction((sel) => {
      return Array.from(document.querySelectorAll(sel)).some((popup) => {
        const container = popup.closest('.ui-popup-container');
        return !!container &&
               container.classList.contains('ui-popup-active') &&
               container.offsetParent !== null;
      });
    }, popupSelector, { timeout });
  } catch (e) {
    const state = await page.evaluate((sel) => {
      const copies = Array.from(document.querySelectorAll(sel));
      const jqm = window.jQuery && window.jQuery.mobile;
      return {
        copies: copies.length,
        inAnyContainer: copies.filter((p) => !!p.closest('.ui-popup-container')).length,
        inActiveContainer: copies.filter((p) => {
          const c = p.closest('.ui-popup-container');
          return !!c && c.classList.contains('ui-popup-active');
        }).length,
        withLayoutBox: copies.filter((p) => {
          const c = p.closest('.ui-popup-container');
          return !!c && c.offsetParent !== null;
        }).length,
        activeContainersOnPage: document.querySelectorAll('.ui-popup-container.ui-popup-active').length,
        // Is jQuery Mobile already holding a popup open, or mid page change?
        jqmPopupActive: !!(jqm && jqm.popup && jqm.popup.active) ? 'yes' : 'no',
        activePageId: (document.querySelector('.ui-page-active') || {}).id || null,
        loaderVisible: (() => {
          const l = document.querySelector('.ui-loader');
          return !!(l && l.offsetParent !== null);
        })()
      };
    }, popupSelector).catch(() => null);

    throw new Error(
      `${e.message}\n` +
      `  popup state for "${popupSelector}" at timeout: ${state ? JSON.stringify(state) : '(could not read)'}\n` +
      `  copies>1 means the render leak is back; inActiveContainer=0 with jqmPopupActive=yes\n` +
      `  means jQuery Mobile thinks another popup owns the screen.`
    );
  }
}

/** True when no copy of the named popup is open. */
async function waitForJqmPopupClosed(page, popupSelector, timeout = 15000) {
  await page.waitForFunction((sel) => {
    return !Array.from(document.querySelectorAll(sel)).some((popup) => {
      const container = popup.closest('.ui-popup-container');
      return !!container &&
             container.classList.contains('ui-popup-active') &&
             container.offsetParent !== null;
    });
  }, popupSelector, { timeout });
}

/**
 * A locator for the visible copy of a specific popup.
 *
 * Scoping merely to "the active popup container" is not enough: more than one
 * container can still carry `ui-popup-active`, so the last one may belong to a
 * different popup entirely (the reason editor rather than the alteration
 * editor, say). Selecting the visible instance of the popup we actually named
 * is what makes this deterministic.
 */
function activePopup(page, popupSelector) {
  if (!popupSelector) return page.locator(ACTIVE_POPUP).last();
  // Scope to the copy sitting inside the container jQuery Mobile actually
  // opened, not merely to a copy that is `:visible`.
  //
  // These two used to disagree. `waitForJqmPopup` asks whether *any* copy's
  // container carries `ui-popup-active`; this asked only for a `:visible` copy
  // and took the last one. Duplicate popups are real here - 4 to 7 copies of
  // `#popupEditReason` can be live at once - so the wait could be satisfied by
  // the copy jQuery Mobile opened while the locator latched onto a different
  // one, whose input never becomes visible because nothing is going to open it.
  //
  // Fixing that did NOT stop `xp-history` 75 being flaky, so it is not the
  // whole story - see test_timing_report.md §5a. It is kept because a locator
  // that can select a copy other than the opened one is a latent defect either
  // way.
  return page.locator(`${ACTIVE_POPUP} ${popupSelector}`).last();
}

/** Fill a field inside the named popup's visible copy. */
async function fillInActivePopup(page, popupSelector, fieldSelector, value) {
  const field = activePopup(page, popupSelector).locator(fieldSelector).last();
  await field.waitFor({ state: 'visible', timeout: 10000 });
  await field.fill(String(value));
  return field;
}

/** Submit the named popup's visible copy. */
async function submitActivePopup(page, popupSelector) {
  const popup = activePopup(page, popupSelector);
  const submit = popup.locator('button[type="submit"]');
  const target = (await submit.count()) > 0 ? submit.last() : popup.locator('button').last();
  await target.click();
}

/**
 * Backform (the form library behind PatronageView, UserSettingsProfileView's
 * UserForm, AdministrationUserView's UserForm, and others) renders real native
 * `<select>`/`<input>` elements with a plain `name="..."` attribute, but two of
 * its behaviours are easy to silently get wrong from a test:
 *
 * 1. `SelectControl` formats option values through `Backform.JSONFormatter`,
 *    so the DOM `value` attribute a browser actually assigns an `<option>` is
 *    `JSON.stringify(rawValue)` - e.g. the option for user id `user_abc` has
 *    `value` literally `"user_abc"` *including the quote characters*, not the
 *    plain id. Selecting by that raw value is fragile and opaque, so
 *    `selectBackformOption` resolves the right `<option>` by its visible text
 *    and reads back whatever value the browser actually assigned it.
 * 2. Every Backform control only copies the DOM value into the backing model
 *    on a `change` (or, for `DatepickerControl`, `blur`) event - see
 *    `Control.onChange` in backform.js. Playwright's `fill()` is not
 *    guaranteed to raise a `change` event the way a real user's blur does, so
 *    a field can look filled on screen while the model - and therefore the
 *    eventual submit, which reads straight from the model - never sees the
 *    new value. `fillBackformInput` fills, then dispatches `change`
 *    explicitly, the same defensive pattern `setJqmSlider` above already uses
 *    for jQuery Mobile's own custom controls.
 */
async function selectBackformOption(page, selectSelector, optionText) {
  const select = page.locator(selectSelector);
  const option = select.locator('option', { hasText: optionText }).first();
  await option.waitFor({ state: 'attached' });
  const value = await option.evaluate((el) => el.value);
  await select.selectOption(value);
  await select.dispatchEvent('change');
  return value;
}

/**
 * Force-clear a stuck jQuery Mobile loading overlay.
 *
 * Several admin routes (`administration_patronage*` in mobileRouter.js, and -
 * identically - the five `administration_bnsmetv1_*_rules` / `administration_
 * bnsctdbs_kith_rules` / `administration_descriptions` routes) call
 * `$.mobile.loading("show")` up front but only call the matching `.hide()`
 * inside a `.fail(...)` branch, never unconditionally on success (unlike
 * sibling routes that correctly use `.always(...)`). After a *successful*
 * navigation to any of these, `<html>` is left with the `ui-loading` class
 * permanently applied, whose full-page overlay then intercepts the next click
 * anywhere on the page. Confirmed live. This does not paper over a wrong
 * result anywhere - it only clears a confirmed, named UI bug from blocking an
 * unrelated later click.
 */
async function clearStuckLoader(page) {
  await page.evaluate(() => {
    if (window.jQuery && window.jQuery.mobile) window.jQuery.mobile.loading('hide');
  });
}

async function fillBackformInput(page, inputSelector, value) {
  const input = page.locator(inputSelector);
  await input.fill(String(value));
  await input.dispatchEvent('change');

  // DatepickerControl fields specifically (bootstrap-datepicker) race the
  // submit click if the field is still focused when it happens: clicking
  // Submit blurs the input a second time, and whichever handler - bootstrap-
  // datepicker's own or Backform's delegated "blur input" onChange - runs
  // last on that blur can leave the model holding something other than what
  // was just typed. Confirmed live: the *last* field filled before a submit
  // click silently saved as "now" instead of the typed date, while an
  // earlier-filled, already-blurred field on the same form saved correctly.
  // Blurring here, immediately after dispatching our own change, means that
  // race has already settled well before any later submit click.
  await input.blur();
}

/**
 * Parse the first integer out of a piece of text.
 * Returns null rather than NaN so callers can assert on absence explicitly.
 */
function parseIntOrNull(text) {
  if (text === null || text === undefined) return null;
  const m = String(text).replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Collapse whitespace so assertions are not defeated by template indentation. */
function normalize(text) {
  return String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * Run a function against the app's own models inside the page, and surface
 * failures as real errors.
 *
 * This is how the suite does fixture setup and assertion read-back: through the
 * models rather than the UI, so a test that drives the UI is not also asserting
 * against the UI. `fnBody` is a function body string receiving `(mods, arg)`.
 *
 * Two things the bodies must not assume, because they run on both front ends:
 * lodash is not a global on the React side, so write plain JS; and a rejection
 * may arrive via `.fail` rather than the second `.then` argument, because Parse
 * 1.9's promises are jQuery-style -- both are wired up below.
 */
async function runInApp(page, modules, fnBody, arg) {
  return page.evaluate(({ modules, fnBody, arg }) => {
    return new Promise((resolve, reject) => {
      const fail = (e) => reject(new Error(e && e.message ? e.message : String(e)));
      // RequireJS on the legacy front end; the test bridge on React, which
      // answers the same module names with the same method names over the
      // ported modules. See web/src/shell/e2eModelApi.ts.
      const load = window.require || (window.__yorick && window.__yorick.require);
      if (typeof load !== 'function') {
        fail(new Error('no module loader: neither window.require nor window.__yorick'));
        return;
      }
      load(modules, function () {
        const mods = Array.prototype.slice.call(arguments);
        let result;
        try {
          // eslint-disable-next-line no-new-func
          result = new Function('mods', 'arg', fnBody)(mods, arg);
        } catch (e) {
          fail(e);
          return;
        }
        if (result && typeof result.then === 'function') {
          result.then(resolve, fail);
          if (typeof result.fail === 'function') result.fail(fail);
        } else {
          resolve(result);
        }
      }, fail);
    });
  }, { modules, fnBody, arg });
}

module.exports = {
  DEFAULT_TIMEOUT,
  isReact,
  waitForAppReady,
  waitForJqmLoader,
  activePageId,
  waitForActivePage,
  navigateToHash,
  hardReload,
  setJqmSlider,
  submitJqmForm,
  waitForJqmPopup,
  waitForJqmPopupClosed,
  ACTIVE_POPUP,
  activePopup,
  fillInActivePopup,
  submitActivePopup,
  clearStuckLoader,
  selectBackformOption,
  fillBackformInput,
  parseIntOrNull,
  normalize,
  runInApp
};
