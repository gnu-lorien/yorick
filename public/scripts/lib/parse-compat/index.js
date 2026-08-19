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
      './query',
      './router',
      './storage',
      './thenable'
    ], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      (typeof global !== 'undefined' && global.Backbone) || require('../backbone.js'),
      require('./promise'),
      require('./collection'),
      require('./events'),
      require('./query'),
      require('./router'),
      require('./storage'),
      require('./thenable')
    );
  } else {
    root.ParseCompat = factory(
      root.Backbone,
      root.ParseCompatPromise,
      root.ParseCompatCollection,
      root.ParseCompatEvents,
      root.ParseCompatQuery,
      root.ParseCompatRouter,
      root.ParseCompatStorage,
      root.ParseCompatThenable
    );
  }
}(typeof self !== 'undefined' ? self : this, function (
  Backbone,
  CompatPromise,
  makeParseCollection,
  applyEvents,
  applyQuery,
  applyRouter,
  applyStorage,
  applyThenable
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

    // Controllers first: parse@8.6.0's dist bundle registers only its
    // RESTController, so storage and installation are missing and the first
    // Parse.User.logIn fails with "Cannot read properties of undefined
    // (reading 'currentInstallationId')". See storage.js.
    applyStorage(Parse.CoreManager);

    // Then events: this wraps Parse.Object.prototype.set, and every
    // Parse.Object.extend subclass inherits from that prototype.
    applyEvents(Parse.Object);

    // Then teach Backbone that a parse@8 Parse.Object IS a model.
    //
    // Deliberately here and not behind the `if (!Parse.Collection)` guard
    // below: the patch is about Backbone's own `instanceof` tests, which run
    // whether or not this layer supplied Parse.Collection. See collection.js.
    makeParseCollection.patchBackboneInstanceof(Parse);

    if (!Parse.Promise) {
      Parse.Promise = CompatPromise;
    }
    if (!Parse.Collection) {
      Parse.Collection = makeParseCollection(Parse);
    }

    // Before thenable, so the wrapped find/first/each are what gets converted.
    // See query.js: this restores 1.5's `this.objectClass`, which is what told
    // a query on Werewolf apart from a query on Vampire when both classes
    // register the className "Vampire".
    applyQuery(Parse);

    applyRouter(Parse);

    // Last: make the SDK's own promise-returning methods hand back
    // Parse.Promise-compatible thenables. Without this the shims above are
    // unreachable from the code that needs them -- almost every one of the 456
    // call sites chains off something the SDK returned, not off a promise it
    // constructed, and a native promise has no .fail/.always/.done.
    applyThenable(Parse);

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
  install.patchBackboneInstanceof = makeParseCollection.patchBackboneInstanceof;
  install.applyEvents = applyEvents;
  install.applyQuery = applyQuery;
  install.applyRouter = applyRouter;
  install.applyStorage = applyStorage;
  install.applyThenable = applyThenable;

  return install;
}));
