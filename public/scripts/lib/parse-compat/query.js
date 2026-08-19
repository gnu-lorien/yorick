/**
 * `Parse.Query` remembers the class it was built from.
 *
 * Parse 1.5 kept the constructor, not just the name:
 *
 *     Parse.Query = function (objectClass) {          // parse-1.5.0.js:8124
 *       if (_.isString(objectClass)) objectClass = Parse.Object._getSubclass(objectClass);
 *       this.objectClass = objectClass;
 *       this.className = objectClass.prototype.className;
 *     };
 *
 * and built every result from it -- `obj = new self.objectClass();` at `:8277`
 * and `:8364`. parse@8 keeps only `this.className` (`parse-8.6.0.js:45404-45407`)
 * and decodes through `classMap[className]`, which holds exactly one class per
 * className.
 *
 * For almost every class in this app those are the same thing. For the four
 * that share the className "Vampire" -- Character, Vampire, Werewolf,
 * ChangelingBetaSlice -- they are not, and the difference is the venue. Under
 * 1.5, `new Parse.Query(Werewolf).get(id)` produced an object with Werewolf's
 * methods and `new Parse.Query(Vampire).get(id)` produced one with Vampire's.
 * Under parse@8 both produce whichever venue module RequireJS loaded last.
 *
 * Measured, before this landed: `Vampire.create()` died on "Cannot read
 * properties of undefined (reading 'calculate_trait_cost')", because the
 * Changeling implementation ran against a vampire and reached for `self.Costs`
 * where the vampire had `self.VampireCosts`.
 *
 * Scope is deliberately narrow. This casts a result ONLY when the query was
 * constructed from a class carrying `__compatCast` -- which is set by
 * `app/helpers/VenueClass.js` and by nothing else. A query on a string, or on
 * any ordinary `Parse.Object.extend` subclass, goes through completely
 * untouched.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ParseCompatQuery = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Replace `Parse.Query` with a subclass that records its `objectClass`.
   *
   * Idempotent. Returns the namespace.
   */
  function applyTo(Parse) {
    if (!Parse || !Parse.Query || Parse.Query.__compatQuery) return Parse;

    var Base = Parse.Query;
    var proto = Base.prototype;
    if (!proto) return Parse;

    /** The cast function for a query, or null if it should not cast. */
    function castFor(query) {
      var objectClass = query && query.__compatObjectClass;
      if (objectClass && typeof objectClass.__compatCast === 'function') {
        return objectClass.__compatCast;
      }
      return null;
    }

    // `find` and `first` are the only two places the SDK turns JSON into
    // objects; `get` is `first` with an objectId constraint
    // (`parse-8.6.0.js:45641`), so it is covered by wrapping `first`.
    //
    // `each`/`eachBatch` are wrapped separately rather than through `find`,
    // because `eachBatch` runs its pages through a CLONE it builds itself with
    // `ParseQuery.fromJSON(this.className, ...)` (`:45860`) -- a plain Base
    // instance that never saw the objectClass. Casting in the callback reaches
    // the same objects without having to reconstruct that clone.
    var originalFind = proto.find;
    var originalFirst = proto.first;
    var originalEachBatch = proto.eachBatch;
    var originalEach = proto.each;

    var Compat = function ParseCompatQuery(objectClass) {
      var self = new.target
        ? Reflect.construct(Base, arguments, new.target)
        : new Base(objectClass);
      if (objectClass && typeof objectClass === 'function' &&
          typeof objectClass.__compatCast === 'function') {
        Object.defineProperty(self, '__compatObjectClass', {
          configurable: true, enumerable: false, writable: true, value: objectClass
        });
      }
      return self;
    };

    // Statics (`fromJSON`, `or`, `and`, `nor`, ...) resolve through the
    // prototype chain rather than being copied, so nothing has to be kept in
    // step when the SDK grows one.
    Object.setPrototypeOf(Compat, Base);
    Compat.prototype = Object.create(proto, {
      constructor: { value: Compat, enumerable: false, writable: true, configurable: true }
    });
    Compat.__compatQuery = true;

    Compat.prototype.find = function (options) {
      var cast = castFor(this);
      var result = originalFind.call(this, options);
      if (!cast) return result;
      return result.then(function (results) {
        // `find` resolves with {results, count} when `withCount` is on.
        if (results && !Array.isArray(results) && Array.isArray(results.results)) {
          results.results.forEach(cast);
          return results;
        }
        if (Array.isArray(results)) results.forEach(cast);
        return results;
      });
    };

    Compat.prototype.first = function (options) {
      var cast = castFor(this);
      var result = originalFirst.call(this, options);
      if (!cast) return result;
      return result.then(function (object) { return object ? cast(object) : object; });
    };

    Compat.prototype.eachBatch = function (callback, options) {
      var cast = castFor(this);
      if (!cast) return originalEachBatch.call(this, callback, options);
      return originalEachBatch.call(this, function (results) {
        if (Array.isArray(results)) results.forEach(cast);
        return callback(results);
      }, options);
    };

    Compat.prototype.each = function (callback, options) {
      var cast = castFor(this);
      if (!cast) return originalEach.call(this, callback, options);
      return originalEach.call(this, function (object) {
        return callback(object ? cast(object) : object);
      }, options);
    };

    try {
      Parse.Query = Compat;
    } catch (err) {
      try {
        Object.defineProperty(Parse, 'Query', {
          configurable: true, writable: true, value: Compat
        });
      } catch (err2) {
        // Leave the SDK's Query in place rather than abort the install. Venue
        // casting is then lost, which shows up as a venue method running
        // against the wrong venue -- loudly, at the call site.
        return Parse;
      }
    }

    return Parse;
  }

  applyTo.applyTo = applyTo;
  return applyTo;
}));
