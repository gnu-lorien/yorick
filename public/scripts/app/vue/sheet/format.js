/**
 * VampirePrintHelper, ported.
 *
 * One deliberate difference: every helper here returns an array of
 * `{text, tone}` segments instead of a string of HTML. The originals build
 * markup by concatenation - `"<span style='color: indianred'>...</span>" +
 * trait_name` - and every print template renders it through `<%= %>`, which in
 * lodash is the *unescaped* interpolation. Trait names and specialisations are
 * free text typed by players, so that path puts user input into the document
 * as markup. Segments make the same visual output impossible to inject
 * through, because Vue escapes text bindings.
 *
 * The functions are pure and take the character explicitly, so they can be
 * unit tested without a view, which the mixin versions cannot.
 */
define([], function () {
    "use strict";

    var DOT = "O";

    function segment(text, tone) {
        return { text: text === undefined || text === null ? "" : String(text), tone: tone || "plain" };
    }

    function plain(text) {
        return [segment(text)];
    }

    /** `_.filter(transform_description, matcher)`, without lodash. */
    function matching(character, matcher) {
        var description = character && character.transform_description;
        if (!description || !description.length) {
            return [];
        }
        var keys = Object.keys(matcher);
        return description.filter(function (entry) {
            return keys.every(function (key) {
                return entry[key] === matcher[key];
            });
        });
    }

    function repeat(text, count) {
        var n = parseInt(count, 10);
        return isFinite(n) && n > 0 ? new Array(n + 1).join(text) : "";
    }

    function traitString(trait, style) {
        if (!trait) {
            return "";
        }
        if (style === undefined || style === null) {
            style = 2;
        }
        var name = trait.get("name") || "";
        var value = trait.get("value");
        var base = typeof trait.get_base_name === "function" ? trait.get_base_name() : name.split(": ")[0];
        var spec = typeof trait.get_specialization === "function" ? trait.get_specialization() : name.split(": ")[1];
        var specialized = typeof trait.has_specialization === "function"
            ? trait.has_specialization()
            : name.indexOf(": ") !== -1;

        switch (style) {
        case 0:
            return name;
        case 1:
            return specialized ? base + " x" + value + ": " + spec : name + " x" + value;
        case 2:
            var dots = " x" + value + " " + repeat(DOT, value);
            return specialized ? base + dots + ": " + spec : name + dots;
        case 3:
            var bare = " " + repeat(DOT, value);
            return specialized ? base + bare + ": " + spec : name + bare;
        case 4:
            return specialized ? base + " (" + value + ", " + spec + ")" : name + " (" + value + ")";
        case 5:
            return specialized ? base + " (" + spec + ")" : name;
        case 6:
            return name + " (" + value + ")";
        case 7:
            return repeat(specialized ? name + " (" + spec + ")" + DOT : name + DOT, value);
        case 8:
            return repeat(DOT, value);
        case 9:
            return value;
        case 10:
            return spec;
        default:
            return name;
        }
    }

    /**
     * The shared shape of every diff-aware helper: the values this attribute
     * used to hold, oldest last, then the value it holds now.
     */
    function diffSegments(character, matcher, oldOf, current, includeCurrent) {
        var entries = matching(character, matcher);
        if (!entries.length) {
            return null;
        }
        var segments = entries
            .map(oldOf)
            .filter(function (value) { return value !== undefined; })
            .reverse()
            .map(function (value) { return segment(value, "removed"); });
        if (includeCurrent !== false) {
            segments.push(segment(current, "added"));
        }
        return segments;
    }

    function formatSimpleText(character, attributeName) {
        var current = character.get(attributeName);
        var diff = diffSegments(
            character,
            { name: attributeName, category: "core" },
            function (entry) { return entry.old_text; },
            current
        );
        return diff || plain(current);
    }

    function formatAttributeValue(character, attribute) {
        var diff = diffSegments(
            character,
            { name: attribute.get("name"), category: "attributes" },
            function (entry) { return entry.fake && entry.fake.get("value"); },
            attribute.get("value")
        );
        return diff || plain(attribute.get("value"));
    }

    function formatTrait(character, trait, style) {
        var current = traitString(trait, style);
        var diff = diffSegments(
            character,
            { name: trait.get("name"), category: trait.get("category") },
            function (entry) { return entry.fake ? traitString(entry.fake, style) : undefined; },
            current,
            !trait.is_deleted
        );
        return diff || plain(current);
    }

    /**
     * Focuses and other name-only lists: one group of segments per entry, so
     * the caller can space them out without gluing strings together.
     */
    function formatNameList(character, categoryName) {
        var traits = character.get(categoryName) || [];
        var touched = matching(character, { category: categoryName }).length > 0;
        return traits.map(function (trait) {
            if (!touched) {
                return plain(trait.get("name"));
            }
            var diff = diffSegments(
                character,
                { category: categoryName, name: trait.get("name") },
                function (entry) { return entry.fake ? trait.get("name") : undefined; },
                trait.get("name"),
                !trait.is_deleted
            );
            return diff || plain(trait.get("name"));
        });
    }

    function formatAttributeFocus(character, attributeName) {
        return formatNameList(character, "focus_" + attributeName.toLowerCase() + "s");
    }

    return {
        segment: segment,
        plain: plain,
        traitString: traitString,
        formatSimpleText: formatSimpleText,
        formatAttributeValue: formatAttributeValue,
        formatAttributeFocus: formatAttributeFocus,
        formatNameList: formatNameList,
        formatTrait: formatTrait
    };
});
