/**
 * The Parse 1.5 compatibility layer, assembled.
 *
 * `parse@8` keeps almost everything this app calls. Unpacking the shipped
 * package and enumerating `ParseObject`'s surface gives: get, set, unset, has,
 * escape, add, addUnique, remove, increment, relation, op, revert, dirty,
 * dirtyKeys, isNew, existed, save, fetch, destroy, clone, toJSON, validate,
 * plus the statics extend, registerSubclass, saveAll, destroyAll, fetchAll,
 * createWithoutData and fromJSON. `Parse.Query.each`, which
 * `collections/Users.js` depends on, is still there too. Of roughly 32 methods
 * this codebase calls, 30 are unchanged.
 *
 * Four things it dropped, and this restores:
 *
 *   promise.js     Parse.Promise -- ~456 call sites
 *   collection.js  Parse.Collection -- 12 subclasses, 10 feeding Marionette
 *   events.js      change events on Parse.Object -- ~60 listenTo bindings
 *   router.js      Parse.Router / Parse.history -- mobileRouter, LoginView
 *
 * Roughly 280 lines in total, against the ~685 hand edits across 43 files that
 * a direct rewrite would need. The trade is deliberate: this is a compatibility
 * layer, which is debt, and the plan is explicit that a codemod removing the
 * promise sites follows once the migration is green. Carrying it during the
 * migration is what keeps the diff reviewable and the 447-test suite meaningful
 * as an oracle -- a rewrite of 456 call sites and an SDK swap landing together
 * cannot be bisected.
 *
 * Order matters. Events wrap `Parse.Object.prototype.set`, so they must be
 * applied to the real SDK object before any subclass is created by
 * `Parse.Object.extend`.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([
      'backbone',
      './promise',
      './collection',
      './events',
      './router'
    ], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      (typeof global !== 'undefined' && global.Backbone) || require('../backbone.js'),
      require('./promise'),
      require('./collection'),
      require('./events'),
      require('./router')
    );
  } else {
    root.ParseCompat = factory(
      root.Backbone,
      root.ParseCompatPromise,
      root.ParseCompatCollection,
      root.ParseCompatEvents,
      root.ParseCompatRouter
    );
  }
}(typeof self !== 'undefined' ? self : this, function (
  Backbone,
  CompatPromise,
  makeParseCollection,
  applyEvents,
  applyRouter
) {
  'use strict';

  /**
   * Install the compatibility layer onto a Parse namespace, and return it.
   *
   * Idempotent, so loading this twice cannot double-wrap `set`.
   */
  function install(Parse) {
    if (!Parse) {
      throw new Error('parse-compat: no Parse namespace given');
    }
    if (Parse.__compatInstalled) {
      return Parse;
    }

    // Events first: this wraps Parse.Object.prototype.set, and every
    // Parse.Object.extend subclass inherits from that prototype.
    applyEvents(Parse.Object);

    if (!Parse.Promise) {
      Parse.Promise = CompatPromise;
    }
    if (!Parse.Collection) {
      Parse.Collection = makeParseCollection(Parse);
    }

    applyRouter(Parse);

    // Parse.Events was Backbone.Events under a different name, and a few
    // views mix it into themselves directly.
    if (!Parse.Events) {
      Parse.Events = Backbone.Events;
    }

    Parse.__compatInstalled = true;
    return Parse;
  }

  install.install = install;
  install.Promise = CompatPromise;
  install.makeCollection = makeParseCollection;
  install.applyEvents = applyEvents;
  install.applyRouter = applyRouter;

  return install;
}));
