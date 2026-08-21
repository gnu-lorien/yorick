// Parse model -> plain snapshot
// =============================
//
// The boundary between Parse/Backbone and React. Everything on the Parse side
// of this file is mutable and identity-stable; everything on the React side is
// plain, frozen-by-convention data that a `useMemo` can compare.
//
// This is the whole trick to making the history page work in React.
//
// `Character.get_transformed` reconstructs a past version of a character by
// calling `this.clone()` on a Parse.Object and mutating the clone. That is
// where the Marionette version gets its reputation: a Parse.Object clone
// shares its Relations with the original, which is why `get_transformed` has
// to reach into `this.troupes.parent` and null it out before returning. Under
// Marionette that is survivable, because every view re-renders from an event
// and reads the object fresh. Under React it is not: the reconstructed
// character is `===` to nothing and `!==` to everything, so memoisation is
// either always-stale or always-busted, and a mutation that lands after render
// is invisible until something unrelated re-renders.
//
// Converting once, here, at the edge, removes the entire problem. Replay
// (see transform.js) then operates on plain arrays and objects and returns new
// ones, so referential equality means what React expects it to mean.

define([
    "underscore"
], function (_) {

    /**
     * One SimpleTrait as plain data.
     *
     * `key` is React's list key. SimpleTraitMixin.linkId() is the established
     * answer to "what identifies this trait" - the saved objectId, or the
     * Backbone cid while it is still unsaved - so it is reused rather than
     * inventing a parallel identity scheme.
     */
    function trait(st) {
        return {
            key: st.id || st.cid,
            name: st.get("name"),
            value: st.get("value"),
            free_value: st.get("free_value"),
            cost: st.get("cost"),
            category: st.get("category")
        };
    }

    // SimpleTraitMixin's three name accessors, as functions over plain data.
    // "Potence: Claws" is a base name and a specialization joined by ": ".
    function baseName(t) {
        return (t.name || "").split(": ")[0];
    }

    function specialization(t) {
        return (t.name || "").split(": ")[1];
    }

    function hasSpecialization(t) {
        return -1 != (t.name || "").indexOf(": ");
    }

    /**
     * One VampireChange row as plain data.
     *
     * The history tables print these columns verbatim, so every column the
     * template names is carried across whether or not the row has it.
     */
    var CHANGE_FIELDS = [
        "category", "name", "type",
        "old_value", "value",
        "old_free_value", "free_value",
        "old_cost", "cost",
        "old_text", "new_text"
    ];

    function change(vc) {
        var out = {
            key: vc.id || vc.cid,
            id: vc.id,
            createdAt: vc.createdAt
        };
        _.each(CHANGE_FIELDS, function (f) {
            // `has` rather than a truthiness test: a recorded 0 is a real
            // value. This is the same trap CharacterHistoryView.format_entry
            // documents on the Marionette side.
            out[f] = vc.has(f) ? vc.get(f) : undefined;
        });
        return out;
    }

    /**
     * A whole character as plain data.
     *
     * Text attributes and trait categories are kept in separate maps because
     * replay treats them as separate things: the "core" category rewrites text
     * attributes, every other category rewrites a list of traits.
     */
    function character(model) {
        var text = {name: model.get("name")};
        _.each(model.all_text_attributes(), function (a) {
            text[a] = model.get(a);
        });

        var traits = {};
        _.each(model.all_simpletrait_categories(), function (c) {
            var category = c[0];
            traits[category] = _.map(
                _.filter(model.get(category), function (st) { return !!st; }),
                trait);
        });

        var lt = model.get_fetched_long_text &&
            model.get_fetched_long_text("extended_print_text");

        return {
            id: model.id,
            type: model.get("type") || "Vampire",
            text: text,
            traits: traits,
            extended_print_text: (lt && lt.has("text")) ? lt.get("text") : "",
            // Populated by replay. Empty means "this is the character as it
            // stands", which is what the sheet renders with no highlighting.
            description: []
        };
    }

    /**
     * A snapshot dressed up to look like a Parse model, for one specific
     * caller: the extended print text.
     *
     * That text is an underscore template a storyteller writes and stores on
     * the character, and it is evaluated with `{character: <the model>}` in
     * scope - so the templates already out there in the database are full of
     * `character.get("name")`. Those templates are user data, not code this
     * project controls, and a port that breaks them breaks other people's
     * character sheets.
     *
     * So the accessor survives even though nothing else in the React tree
     * uses it. `get` looks in text attributes first and falls back to trait
     * categories, which is what Parse.Object.get did when both lived in one
     * attribute bag.
     */
    function asTemplateContext(snapshot) {
        function get(key) {
            if (_.has(snapshot.text, key)) {
                return snapshot.text[key];
            }
            return snapshot.traits[key];
        }
        return {
            get: get,
            has: function (key) { return !_.isUndefined(get(key)); },
            id: snapshot.id,
            attributes: _.assign({}, snapshot.text, snapshot.traits)
        };
    }

    return {
        trait: trait,
        change: change,
        character: character,
        asTemplateContext: asTemplateContext,
        baseName: baseName,
        specialization: specialization,
        hasSpecialization: hasSpecialization
    };
});
