/**
 * Load one RequireJS module out of `public/scripts/app` under `node --test`.
 *
 * The application is AMD and the specs that exercise it live in Karma, which
 * needs a browser, a Parse server and about a minute of setup. That is the
 * right home for anything that talks to the network, and much too heavy a
 * price for "does this comparator sort by name".
 *
 * Every module under `app/` is a single `define([...deps], factory)` call, so
 * running the file with a `define` of our own and calling the factory with
 * stubs is enough to get at the real code. Nothing is copied or re-implemented
 * here: the module body under test is the one the app ships.
 *
 * `deps` maps a module id exactly as the file writes it - `"underscore"`,
 * `"../models/Vampire"` - to whatever should be passed in its place. An id the
 * caller does not supply arrives as `undefined`, which is deliberate: a module
 * that turns out to touch a dependency the test did not think about fails
 * loudly rather than silently taking a different path.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..', '..', 'public', 'scripts', 'app');

/**
 * @param {string} relPath  path under public/scripts/app, e.g. "collections/Vampires.js"
 * @param {Object} deps     module id -> value
 */
function loadAppModule(relPath, deps) {
  const file = path.join(APP_ROOT, relPath);
  const source = fs.readFileSync(file, 'utf8');

  let ids = [];
  let factory = null;

  function define(a, b, c) {
    // define(factory) | define(deps, factory) | define(id, deps, factory)
    const args = [a, b, c].filter((x) => x !== undefined);
    factory = args[args.length - 1];
    const maybeDeps = args.length > 1 ? args[args.length - 2] : null;
    ids = Array.isArray(maybeDeps) ? maybeDeps : [];
  }
  define.amd = {};

  // Compiled with `new Function` rather than `vm.runInNewContext`, on purpose.
  //
  // A new vm context is a new realm, so an array or object the module builds
  // has a different `Array.prototype` and `assert.deepStrictEqual` refuses it
  // as "same structure but not reference-equal" - a confusing failure that has
  // nothing to do with the code under test. Compiling in this realm keeps
  // values comparable.
  //
  // `_` is passed in because the module bodies read it off the global
  // (`_.template(...)` at module scope), exactly as they do in the browser.
  const compiled = new Function(
    'define', '_', 'console',
    source + '\n//# sourceURL=' + file.replace(/\\/g, '/'));
  compiled(define, global._, console);

  if (typeof factory !== 'function') {
    throw new Error(relPath + ' did not call define() with a factory');
  }

  const resolved = ids.map(function (id) {
    if (Object.prototype.hasOwnProperty.call(deps || {}, id)) {
      return deps[id];
    }
    return undefined;
  });

  return { exports: factory.apply(null, resolved), dependencyIds: ids };
}

/** Read a template file the way `text!...` would. */
function loadTemplate(relPath) {
  return fs.readFileSync(path.join(APP_ROOT, relPath), 'utf8');
}

/** Read any file under public/, for the few assertions that are about markup. */
function readPublicFile(relPath) {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', relPath), 'utf8');
}

module.exports = { loadAppModule, loadTemplate, readPublicFile, APP_ROOT };
