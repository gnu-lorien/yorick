// Derived character values
// ========================
//
// The handful of computed properties the sheet needs, lifted off the Parse
// model classes (Character, Vampire, Werewolf, ChangelingBetaSlice) and
// rewritten against a plain snapshot.
//
// These are the methods the print templates call directly - `character.
// generation()`, `character.morality()`, `character.health_levels()` - and
// they are the reason the sheet cannot simply be handed serialized JSON in the
// Marionette version: an underscore template calling a method needs a live
// object with that method on it. A React sheet calls a function instead, so
// the model class stops being a rendering dependency.
//
// Nothing here reads from the network, and nothing here mutates. Every one is
// a pure function of the snapshot, which is what makes the whole sheet safe to
// wrap in useMemo.

define([
    "underscore",
    "./snapshot"
], function (_, Snapshot) {

    function traits(character, category) {
        return character.traits[category] || [];
    }

    /**
     * Blood pool is driven by the Generation background. Vampire.generation()
     * falls back to 1 when the character has no Generation trait yet, which
     * happens during creation.
     */
    function generation(character) {
        var found;
        _.each(traits(character, "backgrounds"), function (b) {
            if ("Generation" == Snapshot.baseName(b)) {
                found = b.value;
            }
        });
        return found || 1;
    }

    /**
     * Glamour is driven by the Seeming background, and 0 is meaningful here -
     * it means Kinain, and the template branches on it. So this one keeps the
     * `|| 0` fallback of ChangelingBetaSlice.seeming() rather than treating
     * absence as 1.
     */
    function seeming(character) {
        var found;
        _.each(traits(character, "ctdbs_backgrounds"), function (b) {
            if ("Seeming" == Snapshot.baseName(b)) {
                found = b.value;
            }
        });
        return found || 0;
    }

    function morality(character) {
        var paths = traits(character, "paths");
        if (!paths.length) {
            return {name: "Humanity", value: 1};
        }
        return paths[0];
    }

    /**
     * Health levels in fixed order, not in whatever order the traits came back
     * in. A level the character does not have shows as undefined, and the
     * template renders no boxes for it.
     */
    function healthLevels(character) {
        var order = ["Healthy", "Injured", "Incapacitated"];
        var byName = {};
        _.each(traits(character, "health_levels"), function (hl) {
            byName[hl.name] = hl.value;
        });
        return _.map(order, function (n) {
            return [n, byName[n]];
        });
    }

    function willpowerTotal(character) {
        return _.sum(traits(character, "willpower_sources"), "value");
    }

    function gnosisTotal(character) {
        return _.sum(traits(character, "wta_gnosis_sources"), "value");
    }

    function sortedSkills(character) {
        return _.sortBy(traits(character, "skills"), "name");
    }

    /**
     * Skills laid out down three columns rather than across three, matching
     * Character.get_grouped_skills. `_.ceil` here, not `_.floor`: with 10
     * skills the columns are 4/4/2, so the last column is the short one.
     */
    function groupedSkills(character, columnCount) {
        columnCount = columnCount || 3;
        var remaining = sortedSkills(character);
        var shift = _.ceil(remaining.length / columnCount);
        return _.map(_.range(columnCount), function () {
            var take = _.take(remaining, shift);
            remaining = _.drop(remaining, shift);
            return take;
        });
    }

    /**
     * A section's traits in the order it asks for. SectionsView sorts by name
     * by default and by value where the section says so - Gifts being the one
     * that does, so they group by rank.
     */
    function sectionValues(character, section) {
        var values = traits(character, section.name);
        // _.sortByAll, not _.sortBy: the vendored lodash is 3.10, where
        // sortBy takes a single iteratee and multi-key sorting has its own
        // name. SectionsView uses sortByAll for the same reason.
        if ("value" == section.sort) {
            values = _.sortByAll(values, ["value", "name"]);
        } else {
            values = _.sortByAll(values, ["name"]);
        }
        if ("desc" == section.direction) {
            values = values.slice().reverse();
        }
        return values;
    }

    return {
        traits: traits,
        generation: generation,
        seeming: seeming,
        morality: morality,
        healthLevels: healthLevels,
        willpowerTotal: willpowerTotal,
        gnosisTotal: gnosisTotal,
        sortedSkills: sortedSkills,
        groupedSkills: groupedSkills,
        sectionValues: sectionValues
    };
});
