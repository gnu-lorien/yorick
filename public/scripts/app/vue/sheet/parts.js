/**
 * The pieces of a character sheet.
 *
 * Each of these is one `Marionette.ItemView` from `CharacterPrintView.js` plus
 * its `text!` template, collapsed into a single component. The originals are
 * mostly boilerplate: a `templateHelpers` that re-exposes the model, a
 * `_.bindAll` of six format helpers whether the template uses them or not, an
 * `initialize` that subscribes to the one attribute the block reads, and - for
 * five of them - an `onRender` that unwraps Marionette's own wrapper element
 * back out of the DOM. None of that survives the port.
 *
 * The jQuery Mobile class names (`ui-bar`, `ui-grid-b`, `ui-block-a`) are kept
 * deliberately. They are plain CSS in the jQM stylesheet, so the sheet looks
 * exactly like the Marionette one without anything ever calling
 * `enhanceWithin()` on this subtree - which matters, because jQM enhancement
 * rewrites the DOM underneath Vue and is the usual reason a Vue page inside
 * this app comes apart.
 */
define(["vue", "./format"], function (Vue, format) {
    "use strict";

    /** Diff-aware text: plain by default, red/green when replaying a change. */
    var Segments = {
        name: "Segments",
        props: {
            segments: { type: Array, default: function () { return []; } }
        },
        template: `
            <span class="yv-segments"
            ><span v-for="(seg, i) in segments" :key="i" :class="['yv-seg', 'yv-' + seg.tone]"
                ><i v-if="seg.tone === 'removed'" class="fa fa-minus"></i
                ><i v-else-if="seg.tone === 'added'" class="fa fa-plus"></i
                >{{ seg.text }}</span
            ></span>`
    };

    /** A row of boxes, optionally grouped, optionally with filled circles after. */
    var DotTrack = {
        name: "DotTrack",
        props: {
            count: { type: [Number, String], default: 0 },
            split: { type: Number, default: 0 },
            linebreak: { type: Number, default: 0 },
            filled: { type: [Number, String], default: 0 }
        },
        computed: {
            boxes: function () {
                var n = parseInt(this.count, 10);
                return isFinite(n) && n > 0 ? n : 0;
            },
            circles: function () {
                var n = parseInt(this.filled, 10);
                return isFinite(n) && n > 0 ? n : 0;
            }
        },
        template: `
            <span class="yv-dots">
                <template v-for="i in boxes" :key="i"><i class="fa fa-square-o"></i><template
                    v-if="split && i % split === 0">&nbsp;</template><br v-if="linebreak && i % linebreak === 0" /></template
                ><i v-for="i in circles" :key="'filled' + i" class="fa fa-circle"></i>
            </span>`
    };

    var Header = {
        name: "SheetHeader",
        components: { Segments: Segments },
        props: { character: { type: Object, required: true } },
        computed: {
            name: function () {
                return format.formatSimpleText(this.character, "name");
            }
        },
        template: `<h1 class="ui-bar ui-bar-a"><Segments :segments="name" /></h1>`
    };

    /**
     * `TextBarView`, whose original builds a template string per render by
     * concatenating field names into `<%= format_simpletext("clan") %>` and
     * compiling the result - a fresh `_.template` compile on every redraw.
     */
    var TextBar = {
        name: "TextBar",
        components: { Segments: Segments },
        props: {
            character: { type: Object, required: true },
            fields: { type: Array, default: function () { return []; } }
        },
        computed: {
            present: function () {
                var character = this.character;
                return this.fields
                    .filter(function (field) { return character.get(field.name); })
                    .map(function (field) {
                        return {
                            display: field.display,
                            segments: format.formatSimpleText(character, field.name)
                        };
                    });
            }
        },
        template: `
            <div v-if="present.length" class="ui-grid-b ui-responsive">
                <div v-for="(field, i) in present" :key="field.display + i" :class="'ui-block-' + 'abcd'[i % 4]">
                    <h2 class="ui-bar ui-bar-a">{{ field.display }}: <Segments :segments="field.segments" /></h2>
                </div>
            </div>`
    };

    var Attributes = {
        name: "Attributes",
        components: { Segments: Segments },
        props: { character: { type: Object, required: true } },
        computed: {
            columns: function () {
                var character = this.character;
                return ["Physical", "Social", "Mental"].map(function (name) {
                    var attribute = (character.get("attributes") || []).find(function (a) {
                        return a.get("name") === name;
                    });
                    return {
                        name: name,
                        value: attribute ? format.formatAttributeValue(character, attribute) : null,
                        focuses: format.formatAttributeFocus(character, name)
                    };
                });
            }
        },
        template: `
            <div class="ui-grid-b ui-responsive">
                <div v-for="(column, i) in columns" :key="column.name" :class="'ui-block-' + 'abc'[i]">
                    <h4 class="ui-bar ui-bar-a ui-corner-all">{{ column.name }}</h4>
                    <div class="ui-body">
                        <Segments v-if="column.value" :segments="column.value" />
                        <br />
                        <span v-for="(focus, f) in column.focuses" :key="f" class="yv-focus"><Segments :segments="focus" /></span>
                    </div>
                </div>
            </div>`
    };

    var Skills = {
        name: "Skills",
        components: { Segments: Segments },
        props: { character: { type: Object, required: true } },
        computed: {
            rows: function () {
                var character = this.character;
                var sorted = character.get_sorted_skills() || [];
                var perColumn = Math.ceil(sorted.length / 3);
                var columns = [
                    sorted.slice(0, perColumn),
                    sorted.slice(perColumn, perColumn * 2),
                    sorted.slice(perColumn * 2)
                ];
                var rows = [];
                for (var i = 0; i < perColumn; i++) {
                    rows.push(columns.map(function (column) {
                        var skill = column[i];
                        return skill
                            ? { key: skill.linkId(), segments: format.formatTrait(character, skill, 1) }
                            : null;
                    }));
                }
                return rows;
            }
        },
        template: `
            <div>
                <h4 class="ui-bar ui-bar-a">Skills</h4>
                <div class="ui-grid-b ui-responsive">
                    <template v-for="(row, r) in rows" :key="r">
                        <template v-for="(cell, c) in row" :key="c">
                            <div v-if="cell" :class="'ui-block-' + 'abc'[c]">
                                <div class="ui-body yv-skill"><Segments :segments="cell.segments" /></div>
                            </div>
                        </template>
                    </template>
                </div>
            </div>`
    };

    /** Ordering that matches lodash 3's `sortByAll`: plain `<` comparison. */
    function compare(a, b) {
        if (a === b) return 0;
        if (a === undefined || a === null) return 1;
        if (b === undefined || b === null) return -1;
        return a < b ? -1 : 1;
    }

    /** `SectionsView`: a column of titled trait lists. */
    var SectionColumn = {
        name: "SectionColumn",
        components: { Segments: Segments },
        props: {
            character: { type: Object, required: true },
            sections: { type: Array, default: function () { return []; } }
        },
        computed: {
            populated: function () {
                var character = this.character;
                return this.sections
                    .filter(function (section) {
                        var values = character.get(section.name);
                        return character.has(section.name) && values && values.length;
                    })
                    .map(function (section) {
                        var values = (character.get(section.name) || []).slice();
                        values.sort(function (a, b) {
                            if (section.sort === "value") {
                                return compare(a.get("value"), b.get("value")) ||
                                    compare(a.get("name"), b.get("name"));
                            }
                            return compare(a.get("name"), b.get("name"));
                        });
                        if (section.direction === "desc") {
                            values.reverse();
                        }
                        return {
                            display: section.display,
                            entries: values.map(function (trait, i) {
                                return {
                                    key: trait.linkId() || i,
                                    segments: format.formatTrait(character, trait, section.format)
                                };
                            })
                        };
                    });
            }
        },
        template: `
            <div>
                <div v-for="section in populated" :key="section.display" class="yv-section">
                    <h4 class="ui-bar ui-bar-a ui-corner-all">{{ section.display }}</h4>
                    <div v-for="entry in section.entries" :key="entry.key" class="yv-section-entry">
                        <Segments :segments="entry.segments" />
                    </div>
                </div>
            </div>`
    };

    var HealthLevels = {
        name: "HealthLevels",
        components: { DotTrack: DotTrack },
        props: { character: { type: Object, required: true } },
        computed: {
            levels: function () {
                return (this.character.health_levels() || []).map(function (pair) {
                    return { name: pair[0], count: parseInt(pair[1], 10) || 0 };
                });
            }
        },
        template: `
            <div>
                <h4 class="ui-bar ui-bar-a ui-corner-all">Health Levels</h4>
                <div v-for="level in levels" :key="level.name">
                    <DotTrack :count="level.count" /> {{ level.name }}
                </div>
            </div>`
    };

    // Blood per turn by generation, and glamour by seeming: the two lookup
    // tables that print/blood.html and print/glamour.html declare inline.
    var BLOOD_PER_TURN = { 1: 10, 2: 12, 3: 15, 4: 20, 5: 30 };
    var GLAMOUR_BY_SEEMING = { 1: 14, 2: 13, 3: 12, 4: 11, 5: 10 };

    /** The first pool slot: blood, gnosis or glamour depending on the venue. */
    var Pool = {
        name: "Pool",
        components: { DotTrack: DotTrack },
        props: {
            character: { type: Object, required: true },
            spec: { type: Object, default: null }
        },
        computed: {
            kind: function () { return this.spec ? this.spec.kind : null; },
            generation: function () {
                return typeof this.character.generation === "function" ? this.character.generation() : 1;
            },
            seeming: function () {
                return typeof this.character.seeming === "function" ? this.character.seeming() : 0;
            },
            gnosis: function () {
                return typeof this.character.get_gnosis_total === "function" ? this.character.get_gnosis_total() : 0;
            },
            bloodPerTurn: function () { return BLOOD_PER_TURN[this.generation]; },
            glamourPool: function () { return GLAMOUR_BY_SEEMING[this.seeming]; }
        },
        template: `
            <div v-if="kind === 'blood'">
                <h4 class="ui-bar ui-bar-a ui-corner-all">Blood</h4>
                <DotTrack :count="30" :split="5" :linebreak="10" :filled="generation" />
                {{ bloodPerTurn }} / {{ generation }}
            </div>
            <div v-else-if="kind === 'gnosis'">
                <h4 class="ui-bar ui-bar-a ui-corner-all">Gnosis</h4>
                <DotTrack :count="gnosis" :split="5" />
            </div>
            <div v-else-if="kind === 'glamour'">
                <h4 class="ui-bar ui-bar-a ui-corner-all">Glamour</h4>
                <template v-if="seeming">
                    <DotTrack :count="glamourPool" :split="5" :linebreak="10" />
                    <br />{{ glamourPool }}
                </template>
                <template v-else>Kinain</template>
            </div>`
    };

    var Willpower = {
        name: "Willpower",
        components: { DotTrack: DotTrack },
        props: { character: { type: Object, required: true } },
        computed: {
            total: function () { return this.character.get_willpower_total(); }
        },
        template: `
            <div>
                <h4 class="ui-bar ui-bar-a ui-corner-all">Willpower</h4>
                <DotTrack :count="total" :split="5" />
            </div>`
    };

    /**
     * The second pool slot: Morality for vampires, Rage for most werewolves, a
     * fixed blood pool for Ananasi, nothing at all for changelings.
     */
    var SecondPool = {
        name: "SecondPool",
        components: { DotTrack: DotTrack },
        props: {
            character: { type: Object, required: true },
            spec: { type: Object, default: null }
        },
        computed: {
            morality: function () {
                if (typeof this.character.morality !== "function") {
                    return null;
                }
                var path = this.character.morality();
                return path ? { name: path.get("name"), value: parseInt(path.get("value"), 10) || 0 } : null;
            }
        },
        template: `
            <div v-if="spec && spec.kind === 'morality' && morality">
                <h4 class="ui-bar ui-bar-a ui-corner-all">Morality</h4>
                {{ morality.name }}<br />
                <DotTrack :count="morality.value" :split="5" />
            </div>
            <div v-else-if="spec && spec.kind === 'total'">
                <h4 class="ui-bar ui-bar-a ui-corner-all">{{ spec.name }}</h4>
                <DotTrack :count="spec.total" :split="spec.split" />
            </div>
            <div v-else-if="spec && spec.kind === 'fixed-blood'">
                <h4 class="ui-bar ui-bar-a ui-corner-all">Blood</h4>
                <DotTrack :count="spec.total" :split="spec.split" :linebreak="spec.linebreak" :filled="spec.blood_per_turn" />
                {{ spec.total }} / {{ spec.blood_per_turn }}
            </div>`
    };

    var Total = {
        name: "Total",
        components: { DotTrack: DotTrack },
        props: { spec: { type: Object, required: true } },
        template: `
            <div>
                <h4 class="ui-bar ui-bar-a ui-corner-all">{{ spec.name }}</h4>
                <DotTrack :count="spec.total" :split="spec.split" />
            </div>`
    };

    return {
        Segments: Segments,
        DotTrack: DotTrack,
        Header: Header,
        TextBar: TextBar,
        Attributes: Attributes,
        Skills: Skills,
        SectionColumn: SectionColumn,
        HealthLevels: HealthLevels,
        Pool: Pool,
        SecondPool: SecondPool,
        Willpower: Willpower,
        Total: Total
    };
});
