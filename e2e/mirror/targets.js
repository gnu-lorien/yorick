'use strict';

/**
 * Which builds the mirror drives.
 *
 * These are *not* the E2E suite's per-worker backends from `e2e/ports.js` -
 * those are started and torn down by Playwright's `webServer` on 1337+. The
 * mirror talks to servers you start yourself, one per checkout, because the
 * whole point is comparing three different builds of the app.
 *
 * Defaults match the documented dev ports: 41337 on main, and the Vue
 * worktree's own block. Override for anything else:
 *
 *   MIRROR_TARGETS="legacy=http://127.0.0.1:41337,react=http://127.0.0.1:43337"
 */
const DEFAULT_TARGETS = 'legacy=http://127.0.0.1:41337,vue=http://127.0.0.1:42337';

function parseTargets(spec) {
  const raw = (spec || process.env.MIRROR_TARGETS || DEFAULT_TARGETS).trim();

  const targets = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const split = entry.indexOf('=');
      if (split === -1) {
        return { name: `target-${index}`, url: entry.replace(/\/+$/, '') };
      }
      const name = entry.slice(0, split).trim();
      const url = entry.slice(split + 1).trim().replace(/\/+$/, '');
      if (!name || !url) {
        throw new Error(`mirror: cannot parse target "${entry}" - expected name=url`);
      }
      return { name, url };
    });

  if (targets.length < 2) {
    throw new Error(
      'mirror: needs at least two targets to compare. ' +
      'Pass --targets name=url,name=url or set MIRROR_TARGETS.'
    );
  }

  const seen = new Set();
  for (const t of targets) {
    if (seen.has(t.name)) throw new Error(`mirror: duplicate target name "${t.name}"`);
    seen.add(t.name);
    try {
      new URL(t.url);
    } catch (err) {
      throw new Error(`mirror: target "${t.name}" has an invalid url: ${t.url}`);
    }
  }
  return targets;
}

/**
 * Check every target answers before launching browsers, so a forgotten
 * `npm start` in one worktree fails in a second rather than as a timeout
 * three actions into the replay.
 */
async function checkReachable(targets, timeoutMs = 4000) {
  return Promise.all(targets.map(async (t) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(t.url, { signal: controller.signal, redirect: 'manual' });
      return { ...t, reachable: true };
    } catch (err) {
      return { ...t, reachable: false, reason: String(err && err.message || err) };
    } finally {
      clearTimeout(timer);
    }
  }));
}

module.exports = { parseTargets, checkReachable, DEFAULT_TARGETS };

/**
 * Point a recorded URL at the build that is about to load it.
 *
 * `playwright codegen` always writes absolute URLs - it records
 * `page.goto('http://127.0.0.1:41337/')`, not `page.goto('/')`. Replayed as-is
 * that would send every window to whichever build was recorded against, which
 * is the one failure mode that would make the whole harness quietly useless:
 * three windows agreeing perfectly because they are all showing the same app.
 *
 * So any URL whose origin belongs to a *known target* is re-pointed at the
 * origin of the page doing the navigating. Genuinely external URLs are left
 * alone. Targets are assumed to be bare origins; a target with a path prefix
 * keeps the recorded path rather than nesting under it.
 */
function rebaseUrl(url, ownUrl, origins) {
  if (typeof url !== 'string' || !url) return url;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return url;
  }
  if (!origins.has(parsed.origin)) return url;

  const own = new URL(ownUrl);
  parsed.protocol = own.protocol;
  parsed.host = own.host;
  return parsed.toString();
}

/** Every origin the mirror considers "one of ours". */
function originsOf(targets) {
  return new Set(targets.map((t) => new URL(t.url).origin));
}

/**
 * A page that rewrites navigation targets on the way through, and is otherwise
 * the page itself. Methods stay bound to the real page - Playwright's internals
 * use private fields, so calling them with a proxy as `this` throws.
 */
function rebasedPage(page, ownUrl, origins) {
  return new Proxy(page, {
    get(target, prop) {
      if (prop === 'goto') {
        return (url, options) => target.goto(rebaseUrl(url, ownUrl, origins), options);
      }
      if (prop === 'waitForURL') {
        return (url, options) => target.waitForURL(
          typeof url === 'string' ? rebaseUrl(url, ownUrl, origins) : url,
          options
        );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

module.exports.rebaseUrl = rebaseUrl;
module.exports.originsOf = originsOf;
module.exports.rebasedPage = rebasedPage;
