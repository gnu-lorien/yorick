/**
 * Parse.Collection, rebuilt on Backbone.Collection.
 *
 * The Parse JS SDK dropped `Parse.Collection` at 2.0. Twelve collections in
 * this app extend it (`collections/*.js`), and ten of them are consumed by a
 * `Marionette.CollectionView` or `CompositeView`, which require a real
 * Backbone collection interface — `add`, `reset`, `comparator`, `models`,
 * `length`, and the `add`/`remove`/`reset` events.
 *
 * All of that still exists: Backbone 1.1.2 is vendored in this repo and is
 * what `Parse.Collection` was itself built on. The only piece the SDK added is
 * a `fetch` that runs a `Parse.Query` instead of `Backbone.sync`. That is the
 * whole of this file.
 *
 * `fetch` follows `parse-1.5.0.js:6502`'s implementation exactly:
 *
 *   - the query is `this.query` if set, else a fresh `Parse.Query(this.model)`
 *   - `options.add` chooses `add()` over `reset()`; the default is `reset()`
 *   - `useMasterKey` and `sessionToken` are forwarded to `find()`
 *   - it resolves with the COLLECTION, not with the results
 *
 * That last one matters: callers write `.fetch().then(function (collection) {…})`,
 * and resolving with the raw results array instead would give them something
 * with a `length` and no `models`, which fails later and somewhere else.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['backbone', './promise'], factory);
  } else if (typeof module === 'object' && module.exports) {
    // Backbone is vendored in this repo, not installed from npm, so resolve it
    // by path. It reads underscore off the global in CommonJS, which the
    // contract tests set before requiring this.
    module.exports = factory(
      (typeof global !== 'undefined' && global.Backbone) || require('../backbone.js'),
      require('./promise')
    );
  } else {
    root.ParseCompatCollection = factory(root.Backbone, root.ParseCompatPromise);
  }
}(typeof self !== 'undefined' ? self : this, function (Backbone, CompatPromise) {
  'use strict';

  /**
   * Build the collection base against a Parse namespace.
   *
   * Taking `Parse` as an argument rather than importing it keeps this file
   * loadable without the SDK present, which is what lets the contract tests
   * run under `node --test` against a stub query.
   */
  function makeParseCollection(Parse) {
    return Backbone.Collection.extend({

      model: Parse && Parse.Object,

      /**
       * Fetch through a Parse.Query rather than Backbone.sync.
       *
       * Returns a Parse.Promise-compatible thenable resolving with the
       * collection, matching what the twelve existing subclasses and their
       * callers were written against.
       */
      fetch: function (options) {
        options = options ? Object.assign({}, options) : {};
        if (options.parse === undefined) {
          options.parse = true;
        }
        var collection = this;
        var query = this.query || new Parse.Query(this.model);

        var found = query.find({
          useMasterKey: options.useMasterKey,
          sessionToken: options.sessionToken
        });

        return CompatPromise.from(found).then(function (results) {
          if (options.add) {
            collection.add(results, options);
          } else {
            collection.reset(results, options);
          }
          return collection;
        });
      }
    });
  }

  makeParseCollection.make = makeParseCollection;
  return makeParseCollection;
}));
