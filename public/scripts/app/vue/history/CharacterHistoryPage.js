/**
 * The character history page.
 *
 * This is the Vue equivalent of `views/CharacterHistoryView.js` and the two
 * templates beside it. That file is a `LayoutView` holding three regions, two
 * `ItemView`s and two `Backbone.Model`s used as message-passing channels
 * between them: `picked` carries an integer from the slider view to the table
 * view, and `override` carries a reconstructed character from the slider view
 * to the sheet. Here both are ordinary reactive values in one composable, and
 * the views that read them are children.
 *
 * The page also gains two things that fall out of the state being reactive
 * rather than pushed through the DOM: button and arrow-key stepping through
 * the timeline, and a timestamp plus one-line summary of the change the
 * timeline is currently sitting on. Neither needed new plumbing.
 */
define([
    "vue",
    "./useCharacterHistory",
    "./HistoryTimeline",
    "./ChangeTable",
    "../sheet/CharacterSheet",
    "../bridge"
], function (Vue, useCharacterHistory, HistoryTimeline, ChangeTable, CharacterSheet, bridge) {
    "use strict";

    return {
        name: "CharacterHistoryPage",
        components: {
            HistoryTimeline: HistoryTimeline,
            ChangeTable: ChangeTable,
            CharacterSheet: CharacterSheet
        },
        props: {
            character: { type: Object, required: true }
        },
        setup: function (props) {
            var history = useCharacterHistory(props.character);

            // PrintSettingsForm, which the sheet carries on the print and
            // history pages alike.
            var fontSize = Vue.ref(100);
            var excludeExtended = Vue.ref(false);
            var FONT_SIZES = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

            // A save anywhere else in the app fires "saved" on the character;
            // Character.get_recorded_changes has already arranged for the
            // timeline to refetch itself when that happens, so all this needs
            // to do is make sure the sheet redraws too.
            var revision = bridge.useModelRevision(props.character, ["saved", "change"]);

            // Only the live model's revision belongs in the key. When the
            // slider moves the sheet is handed a *different* character object
            // and Vue patches it in place, which is what should happen; a
            // remount is only the right answer when the object it is already
            // holding has changed underneath it.
            var sheetKey = Vue.computed(function () {
                return "revision:" + revision.value;
            });

            var characterName = Vue.computed(function () {
                void revision.value;
                return props.character.get("name");
            });

            var classicHref = Vue.computed(function () {
                return "#character/" + props.character.id + "/history/0";
            });

            var characterHref = Vue.computed(function () {
                return "#character?" + props.character.id;
            });

            Vue.onMounted(history.load);

            function onKey(event) {
                if (event.key === "ArrowLeft") {
                    history.step(-1);
                } else if (event.key === "ArrowRight") {
                    history.step(1);
                }
            }

            return Object.assign({}, history, {
                fontSize: fontSize,
                excludeExtended: excludeExtended,
                fontSizes: FONT_SIZES,
                sheetKey: sheetKey,
                characterName: characterName,
                classicHref: classicHref,
                characterHref: characterHref,
                onKey: onKey
            });
        },
        template: `
            <div class="yv-page" tabindex="0" @keydown="onKey">
                <div class="yv-bar">
                    <div>
                        <span class="yv-title">{{ characterName }}</span>
                        <span class="yv-badge">Vue</span>
                    </div>
                    <div class="yv-bar-links">
                        <a :href="characterHref">Character</a>
                        <a :href="classicHref">Marionette version</a>
                    </div>
                </div>

                <p v-if="loading" class="yv-status">Loading recorded changes&hellip;</p>

                <p v-else-if="failure" class="yv-status yv-failure">
                    Couldn't load this character's history: {{ failure.message || failure }}
                </p>

                <p v-else-if="!changes.length" class="yv-status">
                    This character has no recorded changes yet, so there is nothing to replay.
                </p>

                <template v-else>
                    <HistoryTimeline
                        v-model="pickedIndex"
                        :count="changes.length"
                        :change="pickedChange"
                        :replaying="replaying" />

                    <ChangeTable v-if="undoneChange" title="Reversed Change" tone="reversed" :change="undoneChange" />
                    <ChangeTable title="Most Recent Change Applied" tone="applied" :change="pickedChange" />

                    <div class="yv-print-settings hidden-when-printing">
                        <label>
                            Font Size
                            <select data-role="none" v-model.number="fontSize">
                                <option v-for="size in fontSizes" :key="size" :value="size">{{ size }}%</option>
                            </select>
                        </label>
                        <label>
                            <input type="checkbox" data-role="none" v-model="excludeExtended" />
                            Exclude Extended Print Text
                        </label>
                    </div>

                    <CharacterSheet
                        :key="sheetKey"
                        :character="sheetCharacter"
                        :font-size="fontSize"
                        :exclude-extended="excludeExtended" />
                </template>
            </div>`
    };
});
