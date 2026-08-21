// Print formatters, as pure functions returning React nodes
// =========================================================
//
// A port of helpers/VampirePrintHelper.
//
// The original is a mixin: it is spliced onto eight Marionette view prototypes
// so that `this.model` is in scope, and every formatter returns an HTML
// *string* with inline styles baked in, because underscore templates can only
// interpolate strings. Those two properties are what make it awkward to move.
//
// Here they are ordinary functions of (character, ...) -> React node. The
// character carries its own `description` (see transform.js), so nothing needs
// `this`, and the diff markers are elements rather than strings, so no part of
// the sheet needs dangerouslySetInnerHTML.
//
// That last point is the real win. The Marionette sheet builds highlighted
// values by string concatenation and hands them to `<%= %>`, which means every
// trait name on a character sheet is interpolated unescaped into the document.
// Returning nodes closes that off by construction.

define([
    "underscore",
    "./html",
    "./snapshot"
], function (_, html, Snapshot) {

    var REMOVED = {color: "indianred"};
    var ADDED = {color: "darkseagreen"};

    function removed(node, key) {
        return html`<span key=${key} style=${REMOVED}><i className="fa fa-minus"></i>${node}</span>`;
    }

    function added(node, key) {
        return html`<span key=${key} style=${ADDED}><i className="fa fa-plus"></i>${node}</span>`;
    }

    /**
     * Join nodes with spaces, the way the original joins strings.
     */
    function spaced(nodes) {
        return _.flatten(_.map(nodes, function (n, i) {
            return i ? [" ", n] : [n];
        }));
    }

    /**
     * The shared shape of every formatter below: find the description entries
     * matching `matcher`, render each one's prior state struck through in red,
     * and finish with the current state in green.
     *
     * `renderOld` turns one description entry into a node. `field` is the
     * property that has to be present for the entry to count - "fake" for
     * traits, "old_text" for text attributes - matching the original's
     * `.reject({fake: undefined})`.
     */
    function diff(description, matcher, field, renderOld, current, includeCurrent) {
        if (!description || !description.length) {
            return null;
        }
        if (!_.find(description, matcher)) {
            return null;
        }
        var olds = _.filter(description, matcher);
        olds = _.filter(olds, function (d) { return !_.isUndefined(d[field]); });
        var nodes = _.map(olds.slice().reverse(), function (d, i) {
            return removed(renderOld(d), "old-" + i);
        });
        if (includeCurrent) {
            nodes.push(added(current, "new"));
        }
        return html`<span>${spaced(nodes)}</span>`;
    }

    /**
     * SimpleTraitMixin's ten print styles, verbatim from
     * VampirePrintHelper._format_skill_string. Styles are referenced by number
     * from the section configuration, so the numbering is load-bearing.
     */
    function skillString(skill, style) {
        var dot = "O";
        if (_.isUndefined(style)) {
            style = 2;
        }
        var name = skill.name;
        var base = Snapshot.baseName(skill);
        var spec = Snapshot.specialization(skill);
        var has = Snapshot.hasSpecialization(skill);

        if (0 == style) { return name; }
        if (1 == style) {
            return has ? base + " x" + skill.value + ": " + spec
                       : name + " x" + skill.value;
        }
        if (2 == style) {
            var v = " x" + skill.value + " " + _.repeat(dot, skill.value);
            return has ? base + v + ": " + spec : name + v;
        }
        if (3 == style) {
            var v3 = " " + _.repeat(dot, skill.value);
            return has ? base + v3 + ": " + spec : name + v3;
        }
        if (4 == style) {
            return has ? base + " (" + skill.value + ", " + spec + ")"
                       : name + " (" + skill.value + ")";
        }
        if (5 == style) {
            return has ? base + " (" + spec + ")" : name;
        }
        if (6 == style) { return name + " (" + skill.value + ")"; }
        if (7 == style) {
            var words = has ? name + " (" + spec + ")" + dot : name + dot;
            return _.repeat(words, skill.value);
        }
        if (8 == style) { return _.repeat(dot, skill.value); }
        if (9 == style) { return skill.value; }
        if (10 == style) { return spec; }
        return name;
    }

    function formatSimpleText(character, attrname) {
        var current = character.text[attrname];
        var d = diff(
            character.description,
            {name: attrname, category: "core"},
            "old_text",
            function (entry) { return entry.old_text; },
            current,
            true);
        return d || current;
    }

    function formatAttributeValue(character, attribute) {
        var d = diff(
            character.description,
            {name: attribute.name, category: "attributes"},
            "fake",
            function (entry) { return entry.fake.value; },
            attribute.value,
            true);
        return d || attribute.value;
    }

    function formatAttributeFocus(character, name) {
        var focusName = "focus_" + name.toLowerCase() + "s";
        var foci = character.traits[focusName] || [];
        if (!_.find(character.description, {category: focusName})) {
            return _.map(foci, function (f) { return f.name; }).join(" ");
        }
        // Matching the original: the struck-through label is the *current*
        // focus name, not the fake's, because a focus has no value to diff -
        // only presence or absence.
        return html`<span>${spaced(_.map(foci, function (focus, i) {
            var d = diff(
                character.description,
                {category: focusName, name: focus.name},
                "fake",
                function () { return focus.name; },
                focus.name,
                !focus.is_deleted);
            return html`<span key=${focus.key || i}>${d || focus.name}</span>`;
        }))}</span>`;
    }

    function formatSkill(character, skill, style) {
        var current = skillString(skill, style);
        var d = diff(
            character.description,
            {name: skill.name, category: skill.category},
            "fake",
            function (entry) { return skillString(entry.fake, style); },
            current,
            !skill.is_deleted);
        return d || current;
    }

    return {
        skillString: skillString,
        formatSimpleText: formatSimpleText,
        formatAttributeValue: formatAttributeValue,
        formatAttributeFocus: formatAttributeFocus,
        formatSkill: formatSkill
    };
});
