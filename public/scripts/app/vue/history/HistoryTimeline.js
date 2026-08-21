/**
 * The point-in-time picker.
 *
 * The original is a `<input type="range">` plus one hidden `<input>` per
 * recorded change, holding that change's object id, so the change handler can
 * read `$("#history-changes-" + index).val()` back out of the DOM. On a
 * character with a thousand changes that is a thousand extra elements whose
 * only job is to carry data the view already had in memory.
 *
 * `data-role="none"` keeps jQuery Mobile's slider widget off this input. jQM
 * enhancement replaces the element with a wrapper, a handle div and a paired
 * text input, all built outside Vue's knowledge - and then Vue's next patch
 * fights it. Opting out is what makes the two frameworks coexist on one page.
 */
define(["vue", "moment"], function (Vue, moment) {
    "use strict";

    return {
        name: "HistoryTimeline",
        props: {
            modelValue: { type: Number, required: true },
            count: { type: Number, required: true },
            change: { type: Object, default: null },
            replaying: { type: Boolean, default: false }
        },
        emits: ["update:modelValue"],
        computed: {
            max: function () {
                return Math.max(this.count - 1, 0);
            },
            position: function () {
                return this.count ? (this.modelValue + 1) + " of " + this.count : "0 of 0";
            },
            stamp: function () {
                if (!this.change || !this.change.createdAt) {
                    return "";
                }
                return moment(this.change.createdAt).format("lll");
            },
            summary: function () {
                if (!this.change) {
                    return "";
                }
                var category = this.change.get("category");
                var name = this.change.get("name");
                var type = this.change.get("type");
                return [type, category, name].filter(Boolean).join(" · ");
            }
        },
        methods: {
            pick: function (event) {
                this.$emit("update:modelValue", parseInt(event.target.value, 10));
            },
            step: function (delta) {
                var next = this.modelValue + delta;
                if (next < 0 || next > this.max) {
                    return;
                }
                this.$emit("update:modelValue", next);
            }
        },
        template: `
            <div class="yv-timeline">
                <div class="yv-timeline-row">
                    <label for="yv-slider">Point in time:</label>
                    <button type="button" class="yv-step" :disabled="modelValue <= 0"
                            @click="step(-1)" aria-label="Previous change">&#8592;</button>
                    <input id="yv-slider" type="range" data-role="none"
                           :min="0" :max="max" :value="modelValue" :disabled="!count"
                           @input="pick" />
                    <button type="button" class="yv-step" :disabled="modelValue >= max"
                            @click="step(1)" aria-label="Next change">&#8594;</button>
                    <span class="yv-position">{{ position }}</span>
                </div>
                <div class="yv-timeline-meta">
                    <span v-if="stamp" class="yv-stamp">{{ stamp }}</span>
                    <span v-if="summary" class="yv-summary">{{ summary }}</span>
                    <span v-if="replaying" class="yv-replaying">rebuilding sheet&hellip;</span>
                </div>
            </div>`
    };
});
