// Venue class identity
// ====================
//
// Vampire, Werewolf and ChangelingBetaSlice all register the className
// "Vampire" -- deliberately, because they share one Mongo table. Under Parse
// 1.5 that produced three DISTINCT classes: a repeated className was turned
// into inheritance (`parse-1.5.0.js:6127` -> `OldClassObject._extend(protoProps,
// classProps)`), so each module got its own constructor, its own prototype, and
// its own copy of the statics.
//
// parse@8 has exactly one class per className by construction:
//
//     if (classMap[adjustedClassName]) ParseObjectSubclass = classMap[...];
//
// (`parse-8.6.0.js:44461`), and it merges every registration's protoProps into
// that one prototype. So all three modules receive the same function object and
// the same prototype, and the last module RequireJS loads wins -- for every
// venue, in two separate ways:
//
//   statics    `Model.create = ...` in three modules is three writes to one
//              slot. Measured: choosing "Vampire" in the new-character form
//              produced a row with `type: "ChangelingBetaSlice"`, and
//              `Vampire.all_text_attributes()` returned the Changeling list.
//
//   methods    `calculate_trait_cost` resolved to the Changeling
//              implementation for every character. Measured:
//              `Vampire.create()` died on "Cannot read properties of undefined
//              (reading 'calculate_trait_cost')" -- the Changeling version
//              reaches for `self.Costs`, and a vampire has `self.VampireCosts`.
//
// This restores both halves without splitting the table:
//
//   - one registered Parse class, shared, exactly as before;
//   - a per-module constructor with its own statics;
//   - a per-module prototype that inherits the shared one and layers this
//     venue's methods on top -- which is precisely the resolution order 1.5's
//     inheritance chain produced for that venue;
//   - `__compatCast`, which `lib/parse-compat/query.js` calls on query results
//     so that `new Parse.Query(Werewolf)` yields Werewolf-flavoured objects,
//     restoring 1.5's `obj = new self.objectClass()` (`parse-1.5.0.js:8277`).
//
// Nothing here depends on parse@8. Under 1.5 every one of these would be a
// redundant but harmless wrapper around behaviour the SDK already provided.
define([], function () {

    // parse@8 skips these two when copying protoProps (`parse-8.6.0.js:44476`,
    // `:44486`), and so must this: `className` is set as an own property by the
    // constructor and must not be shadowed, and `initialize` is consumed into
    // `_initializers`. None of the three venues declares an `initialize`, but
    // copying one here would make it run twice if one ever did.
    var SKIP = { className: true, initialize: true };

    /**
     * Wrap a registered Parse class in a per-module identity.
     *
     * @param {Function} ParseClass what `Parse.Object.extend(className, ...)`
     *     returned -- shared between every module using that className.
     * @param {Object} instanceMethods this venue's own method set, the same
     *     object handed to `extend`. Layered onto the venue prototype so this
     *     venue's overrides win over whichever module registered last.
     * @returns {Function} a distinct constructor owning its own statics.
     */
    return function VenueClass(ParseClass, instanceMethods) {
        var Venue = function (attributes, options) {
            // Construct straight onto the venue prototype rather than
            // re-parenting afterwards, so anything the SDK constructor reads off
            // the prototype -- `initialize`, `_initializers` -- resolves to this
            // venue's view of the class.
            var instance = Object.create(Venue.prototype);
            ParseClass.call(instance, attributes, options);
            return instance;
        };

        Venue.prototype = Object.create(ParseClass.prototype);

        if (instanceMethods) {
            for (var name in instanceMethods) {
                if (!Object.prototype.hasOwnProperty.call(instanceMethods, name)) continue;
                if (SKIP[name]) continue;
                Object.defineProperty(Venue.prototype, name, {
                    value: instanceMethods[name],
                    enumerable: false,
                    writable: true,
                    configurable: true
                });
            }
        }

        // What Parse.Query and Parse.Object.fromJSON key off.
        Venue.className = ParseClass.className;

        // The escape hatch, for code that needs the registered class itself.
        Venue.parseClass = ParseClass;

        /**
         * Re-flavour an object off the shared table as this venue.
         *
         * Called by the query shim on every result. The guard is deliberately
         * loose about which venue the object currently wears: 1.5 rebuilt every
         * result as `new self.objectClass()` regardless, so querying a werewolf
         * row through `Vampire` gave it Vampire's methods there too.
         */
        Venue.__compatCast = function (object) {
            if (!object || typeof object !== 'object') return object;
            if (Object.getPrototypeOf(object) === Venue.prototype) return object;
            if (!ParseClass.prototype.isPrototypeOf(object)) return object;
            Object.setPrototypeOf(object, Venue.prototype);
            return object;
        };

        Venue.createWithoutData = function (id) {
            var instance = new Venue();
            instance.id = id;
            return instance;
        };

        Venue.extend = function () {
            return ParseClass.extend.apply(ParseClass, arguments);
        };

        return Venue;
    };

});
