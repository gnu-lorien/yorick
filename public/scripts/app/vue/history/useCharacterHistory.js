/**
 * The state behind the character history page.
 *
 * Everything the page does lives here; the components below it are all
 * presentational. This is the part `CharacterHistoryView.js` spreads across
 * three Marionette views, two throwaway `Backbone.Model` value holders
 * (`picked` and `override`) and a hidden `<input>` per change used to carry an
 * object id through the DOM.
 */
define([
    "vue",
    "../bridge"
], function (Vue, bridge) {
    "use strict";

    var ref = Vue.ref;
    var shallowRef = Vue.shallowRef;
    var computed = Vue.computed;

    /**
     * @param character a Character (Vampire/Werewolf/ChangelingBetaSlice)
     *                  already fetched with all its categories.
     */
    function useCharacterHistory(character) {
        // `changes` holds Parse objects, so it is a shallowRef: replacing the
        // array is reactive, the objects inside stay untouched.
        var changes = shallowRef([]);
        var pickedIndex = ref(0);
        var loading = ref(true);
        var replaying = ref(false);
        var failure = ref(null);

        // The reconstructed character, or null when the slider is at the end
        // of the timeline and the live character is already the right answer.
        var transformed = shallowRef(null);

        var atLatest = computed(function () {
            return pickedIndex.value >= changes.value.length - 1;
        });

        var pickedChange = computed(function () {
            return changes.value[pickedIndex.value] || null;
        });

        /**
         * The change that the current position undoes - the first one *after*
         * the picked point. Shown as "Reversed Change" in the original.
         */
        var undoneChange = computed(function () {
            if (atLatest.value) {
                return null;
            }
            var next = Math.min(pickedIndex.value + 1, changes.value.length - 1);
            return changes.value[next] || null;
        });

        var sheetCharacter = computed(function () {
            return transformed.value || character;
        });

        /**
         * Replay the timeline backwards to the picked point.
         *
         * `get_transformed` takes the changes to undo, newest first, and
         * returns a clone with them rolled back. The original arrived at that
         * list by reading an object id out of a hidden input and walking the
         * collection with `_.takeRightWhile` until it matched; the index the
         * slider already holds is the same list, without the DOM round trip.
         */
        function transformAt(index) {
            var list = changes.value;
            if (!list.length || index >= list.length - 1) {
                return null;
            }
            var toUndo = list.slice(index + 1).reverse();
            var c = character.get_transformed(toUndo);

            // Thrown away, exactly as the Marionette page throws it away.
            //
            // `get_transformed` also returns a `transform_description`, and
            // `VampirePrintHelper` can render it as red/green diff marks - the
            // approval page is built on that. It is not usable here, and it is
            // worth writing down why, because it looks like free functionality
            // sitting on the table: for an "update" the helper renders the
            // description's `fake` as the removed value AND the trait now on
            // the character as the added value, but rolling an update back is
            // precisely what puts the old value on the character. Both halves
            // of the diff would read the same. The approval page avoids it by
            // computing its description over a *range* of changes rather than
            // over the same ones it rolled back.
            c.transform_description = [];
            return bridge.keep(c);
        }

        // Cloning a fully-populated character is not free, so the sheet lags
        // the slider by a beat exactly as it does today (the Marionette
        // version debounces its `override` listener by 100ms). The two change
        // tables are cheap and update on every tick.
        var recompute = bridge.debounced(function () {
            try {
                transformed.value = transformAt(pickedIndex.value);
            } catch (e) {
                failure.value = e;
            } finally {
                replaying.value = false;
            }
        }, 100);

        Vue.watch(pickedIndex, function () {
            replaying.value = true;
            recompute();
        });

        function syncFromCollection() {
            var models = character.recorded_changes ? character.recorded_changes.models : [];
            var wasAtLatest = atLatest.value;
            changes.value = bridge.keepAll(models);
            if (wasAtLatest || pickedIndex.value > changes.value.length - 1) {
                pickedIndex.value = Math.max(changes.value.length - 1, 0);
            }
        }

        var boundCollection = null;
        function watchCollection() {
            if (boundCollection || !character.recorded_changes) {
                return;
            }
            boundCollection = character.recorded_changes;
            boundCollection.on("add reset", syncFromCollection);
        }

        async function load() {
            loading.value = true;
            failure.value = null;
            try {
                // Character.get_recorded_changes also wires the character's
                // own "saved" event to a refresh of this collection, so an
                // edit made elsewhere in the app lands here without the page
                // having to poll or re-register anything.
                await character.get_recorded_changes();
                watchCollection();
                syncFromCollection();
                pickedIndex.value = Math.max(changes.value.length - 1, 0);
                transformed.value = null;
            } catch (e) {
                failure.value = e;
            } finally {
                loading.value = false;
            }
        }

        function step(delta) {
            var next = pickedIndex.value + delta;
            if (next < 0 || next > changes.value.length - 1) {
                return;
            }
            pickedIndex.value = next;
        }

        Vue.onScopeDispose(function () {
            recompute.cancel();
            if (boundCollection) {
                boundCollection.off("add reset", syncFromCollection);
                boundCollection = null;
            }
        });

        return {
            changes: changes,
            pickedIndex: pickedIndex,
            pickedChange: pickedChange,
            undoneChange: undoneChange,
            atLatest: atLatest,
            sheetCharacter: sheetCharacter,
            transformed: transformed,
            loading: loading,
            replaying: replaying,
            failure: failure,
            load: load,
            step: step
        };
    }

    return useCharacterHistory;
});
