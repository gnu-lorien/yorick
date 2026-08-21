/**
 * One row of the VampireChange log, as a table.
 *
 * `character-history-selected-view.html` renders this twice with the same
 * twelve columns and a copy-pasted `<table>` for each, wrapped in a `<% if %>`
 * that decides whether the first one appears. Both copies carry
 * `id="table-column-toggle"`, so the page ships two elements with the same id.
 */
define(["vue", "moment"], function (Vue, moment) {
    "use strict";

    var HEADERS = [
        "createdAt", "category", "name", "type",
        "old_value", "value", "old_free_value", "free_value",
        "old_cost", "cost", "old_text", "new_text"
    ];

    return {
        name: "ChangeTable",
        props: {
            title: { type: String, required: true },
            change: { type: Object, default: null },
            tone: { type: String, default: "applied" }
        },
        computed: {
            cells: function () {
                var change = this.change;
                if (!change) {
                    return [];
                }
                return HEADERS.map(function (header) {
                    return { header: header, value: formatEntry(change, header) };
                });
            },
            headers: function () {
                return HEADERS;
            }
        },
        template: `
            <div class="yv-change" :class="'yv-change-' + tone">
                <span class="yv-change-title">{{ title }}</span>
                <div class="yv-table-scroll">
                    <table class="ui-responsive table-stroke yv-table">
                        <thead>
                            <tr><th v-for="header in headers" :key="header">{{ header }}</th></tr>
                        </thead>
                        <tbody>
                            <tr v-if="cells.length">
                                <td v-for="cell in cells" :key="cell.header">{{ cell.value }}</td>
                            </tr>
                            <tr v-else>
                                <td :colspan="headers.length" class="yv-empty">No change at this point.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>`
    };

    /**
     * Port of `ViewingView.format_entry`.
     *
     * The `has()` check before the property read is load-bearing and is
     * commented as such in the original: `createdAt` is a property of the Parse
     * object rather than one of its attributes, and a recorded value of 0 must
     * not come out as an empty cell.
     */
    function formatEntry(change, entry) {
        if (change.has(entry)) {
            var value = change.get(entry);
            return value instanceof Date ? moment(value).format("lll") : value;
        }
        var property = change[entry];
        if (property instanceof Date) {
            return moment(property).format("lll");
        }
        return property === undefined || property === null ? "" : property;
    }
});
