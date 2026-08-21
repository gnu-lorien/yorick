// Replay: reconstructing a past character
// =======================================
//
// A pure port of Character.get_transformed. Same rules, no Parse.Object.
//
// The timeline is a list of VampireChange rows in ascending createdAt order.
// Picking index `i` means "show the character as it stood immediately after
// change `i` landed", and the way to get there from the character as it stands
// now is to walk backwards from the newest change to `i + 1` and *undo* each
// one - which is why every branch below writes the `old_*` fields back.
//
// Differences from the Marionette original, both deliberate:
//
//  1. It returns a new snapshot instead of mutating a clone. Same rules, but
//     the caller can hand the result straight to React.
//
//  2. It reads `old_value` / `old_cost` / `old_text` by presence rather than
//     by truthiness. The original writes
//
//         "value": change.get("old_value") || change.get("value")
//
//     which silently discards a recorded old value of 0 and replays the *new*
//     value in its place - so undoing "Athletics 0 -> 3" reconstructs
//     Athletics 3. It is the same 0-is-falsy trap that
//     CharacterHistoryView.format_entry carries a comment about, one layer
//     down. Fixing it here rather than reproducing it means the React page and
//     the Marionette page can disagree, by one trait, on a character that has
//     a change away from zero in its history. That disagreement is the fix,
//     not a porting error.

define([
    "underscore"
], function (_) {

    /**
     * The value to replay: the recorded old one when there is one, otherwise
     * the current one. See note 2 above for why this is not `a || b`.
     */
    function older(change, oldField, field) {
        return !_.isUndefined(change[oldField]) && !_.isNull(change[oldField])
            ? change[oldField]
            : change[field];
    }

    var fauxCounter = 0;

    /**
     * The trait as it was before this change - what the original calls a
     * FauxSimpleTrait. It never gets saved; it exists to be rendered.
     */
    function faux(change) {
        fauxCounter += 1;
        return {
            key: "faux-" + fauxCounter,
            name: older(change, "old_text", "name"),
            free_value: change.free_value,
            value: older(change, "old_value", "value"),
            cost: older(change, "old_cost", "cost"),
            category: change.category
        };
    }

    /**
     * Undo `changes` (newest first) against `snapshot`.
     *
     * Returns a new snapshot carrying a `description` of what was undone, in
     * the shape the print formatters match against.
     */
    function replay(snapshot, changes) {
        var text = _.clone(snapshot.text);
        var traits = _.mapValues(snapshot.traits, function (list) {
            return list.slice();
        });
        var description = [];

        _.each(changes, function (change) {
            // An XP notation is neither a trait nor a text attribute, so there
            // is nothing to replay. `_recorded_changes_query` already filters
            // these out; this is the belt to that pair of braces.
            if ("experience" == change.category) {
                return;
            }

            if ("core" != change.category) {
                var category = change.category;
                var list = traits[category] || [];
                var current = _.find(list, function (t) {
                    return _.isEqual(t.name, change.name);
                });
                var fake = faux(change);

                if ("update" == change.type) {
                    // Swap the current trait for the older one. The original
                    // spells this `_.xor(list, [current, fake])`, which does
                    // the same thing right up until `current` is undefined -
                    // at which point xor appends `undefined` to the category
                    // and the next render walks into it.
                    traits[category] = current
                        ? _.map(list, function (t) { return t === current ? fake : t; })
                        : list.concat([fake]);
                    description.push({
                        category: category,
                        name: change.name,
                        fake: fake,
                        type: "changed"
                    });
                } else if ("define" == change.type) {
                    // The change created this trait, so undoing it removes it.
                    traits[category] = _.without(list, current);
                    description.push({
                        category: category,
                        name: fake.name,
                        fake: undefined,
                        type: "define"
                    });
                } else if ("remove" == change.type) {
                    // The change deleted this trait, so undoing it puts it back.
                    traits[category] = list.concat([fake]);
                    description.push({
                        category: category,
                        name: fake.name,
                        fake: fake,
                        type: "removed"
                    });
                }
            } else {
                if ("core_define" == change.type) {
                    text[change.name] = undefined;
                    description.push({
                        category: "core",
                        name: change.name,
                        old_text: undefined,
                        type: "define"
                    });
                } else if ("core_update" == change.type) {
                    text[change.name] = change.old_text;
                    description.push({
                        category: "core",
                        name: change.name,
                        old_text: change.old_text,
                        type: "update"
                    });
                }
            }
        });

        return _.assign({}, snapshot, {
            text: text,
            traits: traits,
            description: description
        });
    }

    /**
     * The character as it stood at `pickedIndex` in `changes`.
     *
     * The one piece of index arithmetic on the page, kept in a single place so
     * the components never do it. Matches CharacterHistoryView.update_picked:
     * take every change *after* the picked one, newest first, and undo them.
     */
    function at(snapshot, changes, pickedIndex) {
        if (pickedIndex >= changes.length - 1) {
            // Already the newest state - nothing to undo.
            return _.assign({}, snapshot, {description: []});
        }
        var toUndo = changes.slice(pickedIndex + 1).reverse();
        return replay(snapshot, toUndo);
    }

    /**
     * The character at `index`, carrying a description of what the change at
     * `index` did to it.
     *
     * `at` alone cannot supply this. Its description records the changes that
     * were *undone* to arrive at `index`, so every entry's "before" value is
     * the state being rendered - the sheet ends up diffing a value against
     * itself and every marker reads "-5 +5".
     *
     * The description has to come from one step further back: rewind to
     * `index - 1` instead, and the last entry of that walk is the change at
     * `index`, whose "before" is genuinely the previous value. This is the
     * same two-reconstructions trick CharacterApprovalView.update_override
     * uses for its left/right range, with the range narrowed to one step.
     *
     * A trait the change *deleted* is not on the sheet at `index` at all, so
     * it is put back marked `is_deleted` - which the formatters render struck
     * through with no replacement. Ported from the same place.
     */
    function highlighted(snapshot, changes, index) {
        var reconstructed = at(snapshot, changes, index);
        if (index >= changes.length) {
            return reconstructed;
        }
        var earlier = replay(snapshot, changes.slice(index).reverse());
        var description = _.takeRight(earlier.description, 1);

        var traits = _.mapValues(reconstructed.traits, function (list) {
            return list.slice();
        });
        _.each(_.filter(description, {type: "removed"}), function (entry) {
            traits[entry.category] = (traits[entry.category] || []).concat([
                _.assign({}, entry.fake, {is_deleted: true})
            ]);
        });

        return _.assign({}, reconstructed, {
            traits: traits,
            description: description
        });
    }

    return {
        replay: replay,
        at: at,
        highlighted: highlighted
    };
});
