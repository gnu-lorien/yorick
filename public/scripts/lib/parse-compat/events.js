/**
 * Backbone change events on Parse.Object.
 *
 * `parse@8` removed event emission from ParseObject entirely — grepping the
 * shipped package for `EventEmitter|trigger(|emit(` in `lib/node/ParseObject.js`
 * returns zero. In 1.5 the prototype mixed in `Parse.Events` (Backbone's) and
 * `set` fired `change:<attr>` then `change`.
 *
 * This app leans on that in about sixty places: `listenTo(self.model, "change")`,
 * `listenTo(self.character, "change:longtextbackground")` and friends, plus six
 * Marionette `modelEvents` / `collectionEvents` blocks that re-render a view
 * when its model changes. Without events those views simply stop updating —
 * no error, the screen just goes stale until something else forces a redraw.
 *
 * Semantics follow `parse-1.5.0.js:5770-5805`:
 *
 *   - `change:<attr>` fires per changed attribute, as `(model, value, options)`
 *   - a single `change` fires afterwards, as `(model, options)`
 *   - only attributes whose value actually changed fire
 *   - `{silent: true}` suppresses both, and the change is remembered so a later
 *     non-silent `set` still reports it
 *   - `changed` and `previousAttributes()` reflect the last non-silent batch
 *
 * Applied by mutating the prototype, because `Parse.Object.extend` subclasses
 * and the SDK's own internals both construct objects this file never sees.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['backbone'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      (typeof global !== 'undefined' && global.Backbone) || require('../backbone.js')
    );
  } else {
    root.ParseCompatEvents = factory(root.Backbone);
  }
}(typeof self !== 'undefined' ? self : this, function (Backbone) {
  'use strict';

  /**
   * Give a Parse.Object prototype Backbone events and change tracking.
   *
   * Idempotent: applying twice is a no-op, so a module loaded down two paths
   * cannot double-wrap `set` and fire everything twice.
   */
  function applyTo(ParseObject) {
    var proto = ParseObject.prototype;
    if (proto.__compatEventsApplied) return ParseObject;

    // Backbone.Events supplies on/off/once/trigger/listenTo/stopListening.
    // Only fill in what is missing, so a future SDK that grows its own
    // emitter is not silently overridden.
    for (var name in Backbone.Events) {
      if (Backbone.Events.hasOwnProperty(name) && typeof proto[name] !== 'function') {
        proto[name] = Backbone.Events[name];
      }
    }

    var originalSet = proto.set;
    var originalUnset = proto.unset;

    // Never call attrs.hasOwnProperty directly.
    //
    // parse@8 builds an object's attribute bag with a null prototype, so it
    // has no hasOwnProperty of its own and the call throws
    // "attrs.hasOwnProperty is not a function" -- from inside setACL, several
    // frames away from anything that looks related. The contract tests missed
    // this because their stand-in used a plain {}, which inherits one.
    var owns = function (obj, key) {
      return Object.prototype.hasOwnProperty.call(obj, key);
    };

    /** Snapshot the attributes this object currently holds. */
    function snapshot(model) {
      var out = {};
      var attrs = model.attributes || {};
      for (var k in attrs) {
        if (owns(attrs, k)) out[k] = model.get(k);
      }
      return out;
    }

    function keysOf(obj) {
      var out = [];
      for (var k in obj) if (owns(obj, k)) out.push(k);
      return out;
    }

    /**
     * Run a mutation, then emit whatever actually changed.
     *
     * The before/after comparison is done against `get()` rather than trusting
     * the arguments, because `set` on a Parse object can be refused by
     * validation, coerced, or applied as an Op (increment, addUnique) whose
     * resulting value is not what was passed in.
     */
    function withChangeEvents(model, options, mutate) {
      var before = snapshot(model);
      var result = mutate();

      var after = snapshot(model);
      var changed = {};
      var names = keysOf(before).concat(keysOf(after));
      for (var i = 0; i < names.length; i++) {
        var attr = names[i];
        if (owns(changed, attr)) continue;
        if (before[attr] !== after[attr]) changed[attr] = true;
      }

      model._compatPending = model._compatPending || {};
      var attrs = keysOf(changed);
      for (var j = 0; j < attrs.length; j++) {
        model._compatPending[attrs[j]] = true;
      }

      if (options && options.silent) {
        // Held back, but remembered: the next non-silent set reports it too,
        // which is what 1.5 did with its `_silent` / `_pending` pair.
        return result;
      }

      var pending = keysOf(model._compatPending);
      if (pending.length === 0) return result;

      model._compatPending = {};
      model.changed = {};
      for (var k = 0; k < pending.length; k++) {
        model.changed[pending[k]] = model.get(pending[k]);
      }
      model._compatPrevious = before;

      for (var m = 0; m < pending.length; m++) {
        model.trigger('change:' + pending[m], model, model.get(pending[m]), options || {});
      }
      model.trigger('change', model, options || {});

      return result;
    }

    proto.set = function (key, value, options) {
      var self = this;
      var opts;
      // set({...}, options) or set(key, value, options)
      if (key !== null && typeof key === 'object') {
        opts = value;
      } else {
        opts = options;
      }
      return withChangeEvents(self, opts, function () {
        return originalSet.call(self, key, value, options);
      });
    };

    if (typeof originalUnset === 'function') {
      proto.unset = function (attr, options) {
        var self = this;
        return withChangeEvents(self, options, function () {
          return originalUnset.call(self, attr, options);
        });
      };
    }

    proto.previousAttributes = function () {
      return this._compatPrevious || {};
    };

    proto.previous = function (attr) {
      return (this._compatPrevious || {})[attr];
    };

    proto.hasChanged = function (attr) {
      if (attr === undefined) return keysOf(this.changed || {}).length > 0;
      return owns(this.changed || {}, attr);
    };

    // Restore protoProps.initialize, which parse@8's extend swallows.
    //
    // Parse 1.5 used Backbone's extend, which copies protoProps wholesale onto
    // the subclass prototype -- so `Parse.Object.extend("X", { initialize:
    // function () {...} })` shadowed the base no-op and ran on construction.
    // parse@8 has its own extend that consumes `initialize` and never attaches
    // it. Measured directly: a subclass declaring both `customMethod` and
    // `initialize` gets the first and not the second.
    //
    // The failure is silent and remote. `BNSCTDBS_ChangelingCosts` declares
    // `initialize` returning a promise; with it dropped, the SDK's no-op runs
    // instead, `get_costs()` returns undefined, and character creation dies
    // three files away at `ChangelingBetaSlice.js:247` on
    // "Cannot read properties of undefined (reading 'then')".
    if (typeof ParseObject.extend === 'function' && !ParseObject.extend.__compatWrapped) {
      var originalExtend = ParseObject.extend;
      var wrappedExtend = function (className, protoProps, classProps) {
        var Sub = originalExtend.apply(this, arguments);
        // extend also accepts (protoProps, classProps) with no className.
        var props = (className !== null && typeof className === 'object')
          ? className
          : protoProps;
        if (Sub && Sub.prototype && props && typeof props.initialize === 'function' &&
            Sub.prototype.initialize !== props.initialize) {
          Sub.prototype.initialize = props.initialize;
        }
        return Sub;
      };
      wrappedExtend.__compatWrapped = true;
      try {
        ParseObject.extend = wrappedExtend;
      } catch (err) {
        Object.defineProperty(ParseObject, 'extend', {
          configurable: true, writable: true, value: wrappedExtend
        });
      }
    }

    proto.__compatEventsApplied = true;
    return ParseObject;
  }

  applyTo.applyTo = applyTo;
  return applyTo;
}));
