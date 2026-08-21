/**
 * The printable character sheet.
 *
 * `CharacterPrintView` is a `LayoutView` with twenty named regions, a parent
 * template that exists only to provide twenty `<div id="cpp-...">` anchors for
 * them, and a `setup_regions` that news up a child view per region on every
 * change. Here the regions are just where a component sits in the template,
 * and the per-creature differences are the data in `layout.js`.
 *
 * The character is passed as a prop and is never made reactive - see
 * `../bridge.js`. Since Vue cannot see inside a Parse.Object, this component
 * assumes the character it is handed does not mutate: the page gives it a
 * fresh reconstructed clone when the slider moves, and re-keys it on the
 * model's revision when the live character is saved from elsewhere. Nothing in
 * here subscribes to anything. The original wires up about thirty
 * `listenTo(model, "change:backgrounds")` subscriptions to do the same job, one
 * per block, and has to tear them down again by hand.
 *
 * Re-keying is a blunt instrument - it rebuilds the subtree rather than
 * patching it - and it is the honest price of a half-ported data layer. It
 * costs nothing here (a sheet redraw is a few hundred nodes, and it only
 * happens on a save) and it disappears the moment the models themselves become
 * plain reactive objects.
 */
define([
    "vue",
    "underscore",
    "./layout",
    "./parts"
], function (Vue, _, layout, parts) {
    "use strict";

    /**
     * The block of free text a player can attach to their sheet.
     *
     * Faithful to the original, including running the stored text through
     * lodash's template compiler so `<%= character.get("name") %>` in someone's
     * print text keeps working. The one change is the `try`: today a malformed
     * template throws out of `templateHelpers` and takes the whole sheet's
     * render with it, which on the history page means an empty screen with a
     * console error. Here the raw text is shown instead.
     */
    var ExtendedPrintText = {
        name: "ExtendedPrintText",
        props: {
            character: { type: Object, required: true },
            excluded: { type: Boolean, default: false }
        },
        computed: {
            html: function () {
                if (this.excluded) {
                    return "";
                }
                var longText = this.character.get_fetched_long_text
                    ? this.character.get_fetched_long_text("extended_print_text")
                    : null;
                if (!longText || !longText.has("text")) {
                    return "";
                }
                var text = longText.get("text");
                try {
                    return _.template(text)({ character: this.character });
                } catch (e) {
                    return text;
                }
            }
        },
        // eslint-disable-next-line vue/no-v-html -- parity: this text is
        // authored as markup by the character's own player and is rendered as
        // markup today.
        template: `<div v-if="html" class="ui-content" v-html="html"></div>`
    };

    return {
        name: "CharacterSheet",
        components: Object.assign({ ExtendedPrintText: ExtendedPrintText }, parts),
        props: {
            character: { type: Object, required: true },
            // `PrintSettingsForm`'s two settings, which the original keeps in
            // yet another anonymous Backbone.Model and threads through the
            // layout view to reach two of its twenty regions.
            fontSize: { type: Number, default: 100 },
            excludeExtended: { type: Boolean, default: false }
        },
        computed: {
            layout: function () {
                return layout.layoutFor(this.character);
            },
            sizing: function () {
                return { fontSize: this.fontSize + "%" };
            }
        },
        template: `
            <div role="main" class="ui-content force-printing-page-break yv-sheet" :style="sizing">
                <Header :character="character" />
                <TextBar :character="character" :fields="layout.firstBar" />
                <TextBar :character="character" :fields="layout.secondBar" />
                <Attributes :character="character" />

                <div class="ui-grid-b ui-responsive">
                    <div class="ui-block-a"><Pool :character="character" :spec="layout.pool" /></div>
                    <div class="ui-block-b">
                        <Willpower :character="character" />
                        <SecondPool :character="character" :spec="layout.morality" />
                    </div>
                    <div class="ui-block-c"><HealthLevels :character="character" /></div>
                </div>

                <div v-if="layout.totals.length" class="ui-grid-b ui-responsive">
                    <div v-for="(total, i) in layout.totals" :key="total.name" :class="'ui-block-' + 'abc'[i]">
                        <Total :spec="total" />
                    </div>
                </div>

                <Skills :character="character" />

                <div class="ui-grid-b ui-responsive">
                    <div v-for="(column, i) in layout.bottomOne" :key="'one' + i" :class="'ui-block-' + 'abc'[i]">
                        <SectionColumn :character="character" :sections="column" />
                    </div>
                </div>

                <div class="ui-grid-b ui-responsive">
                    <div v-for="(column, i) in layout.bottomTwo" :key="'two' + i" :class="'ui-block-' + 'abc'[i]">
                        <SectionColumn :character="character" :sections="column" />
                    </div>
                </div>

                <ExtendedPrintText :character="character" :excluded="excludeExtended" />
            </div>`
    };
});
