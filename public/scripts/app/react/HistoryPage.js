// The character history page
// ==========================
//
// A port of views/CharacterHistoryView. Props are plain data; there is no
// Parse and no Backbone below this line.
//
// The Marionette original is three sibling views - a slider, a pair of change
// tables, and the print sheet - that cannot see each other, so they are wired
// together through two Backbone models used as an event bus:
//
//     this.picked   = new Backbone.Model({value: 0})
//     this.override = new Backbone.Model({character: null})
//
// The slider writes `picked`, the tables listen to it, the slider *also*
// computes the reconstructed character and writes it to `override`, and the
// sheet listens to that. So the slider's change handler is where the index
// arithmetic, the replay, and the cross-view notification all live at once,
// and the two listeners are both debounced by 100ms to keep dragging from
// melting the page.
//
// That shape is the reason this page is hard to get right in React. Ported
// literally, `picked` and `override` become two useStates that have to be kept
// consistent by hand, and the debounce becomes a stale-closure bug farm. The
// fix is to notice that `override` is not state at all: it is a pure function
// of `picked` and the timeline. One useState, two useMemos, and the bus
// disappears.
//
// The debounces go too, replaced by useDeferredValue: the slider tracks the
// drag at full speed while the sheet re-renders at lower priority. Same intent
// as `_.debounce(render, 100, {trailing: true})`, but it degrades by dropping
// intermediate frames rather than by showing the wrong sheet for 100ms.

define([
    "underscore",
    "react",
    "moment",
    "./html",
    "./transform",
    "./CharacterSheet"
], function (_, React, moment, html, Transform, CharacterSheet) {

    var useState = React.useState;
    var useMemo = React.useMemo;
    var useCallback = React.useCallback;
    // useDeferredValue is React 18. Guarded so this module still renders under
    // 17 if the vendored bundle is ever rolled back - it just loses the
    // priority split and re-renders the sheet synchronously.
    var useDeferredValue = React.useDeferredValue || function (v) { return v; };

    var COLUMNS = [
        "createdAt", "category", "name", "type",
        "old_value", "value",
        "old_free_value", "free_value",
        "old_cost", "cost",
        "old_text", "new_text"
    ];

    /**
     * One cell of a change table.
     *
     * The presence test matters: a recorded 0 is a real old value and must not
     * render as an empty cell. CharacterHistoryView.format_entry carries the
     * same note, pointing at CharacterApprovalView where it was first fixed.
     */
    function formatEntry(log, column) {
        if (!log) {
            return "";
        }
        var v = log[column];
        if (_.isUndefined(v) || _.isNull(v)) {
            return "";
        }
        return _.isDate(v) ? moment(v).format("lll") : String(v);
    }

    function ChangeTable(props) {
        return html`<${React.Fragment}>
            <span>${props.caption}</span>
            <table className="ui-responsive table-stroke chr-table">
                <thead>
                    <tr>
                        ${_.map(COLUMNS, function (h) {
                            return html`<th key=${h}>${h}</th>`;
                        })}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        ${_.map(COLUMNS, function (h) {
                            return html`<td key=${h}>${formatEntry(props.log, h)}</td>`;
                        })}
                    </tr>
                </tbody>
            </table>
        <//>`;
    }

    /**
     * The point-in-time picker.
     *
     * The original also emits one hidden input per change, `#history-changes-N`
     * holding that change's objectId, purely so the change handler can read the
     * id back out of the DOM to feed `takeRightWhile`. There are no hidden
     * inputs here: the index is state, and the timeline is a prop, so the id is
     * already in hand.
     */
    function TimeSlider(props) {
        var log = props.changes[props.value];
        return html`<p>
            <label htmlFor="chr-slider">Point in time:</label>
            <input
                type="range"
                id="chr-slider"
                name="historyChangePicker"
                min=${0}
                max=${Math.max(0, props.changes.length - 1)}
                value=${props.value}
                onChange=${props.onChange}
                style=${{width: "100%"}}/>
            <span className="chr-slider-caption">
                ${"Change " + (props.value + 1) + " of " + props.changes.length}
                ${log && log.createdAt ? " — " + moment(log.createdAt).format("lll") : ""}
            </span>
        </p>`;
    }

    function HistoryPage(props) {
        var changes = props.changes;
        var last = Math.max(0, changes.length - 1);

        // The only state on the page. Everything visible is derived from it.
        var picked = useState(last);
        var pickedIndex = Math.min(picked[0], last);
        var setPickedIndex = picked[1];

        // Whether to colour the sheet with what the selected change did.
        //
        // The Marionette page cannot offer this: it reconstructs the character
        // and then throws the diff away (`c.transform_description = []`) before
        // handing it to the sheet, because the print formatters read the diff
        // off the character itself and there is no other way to turn them off.
        // Here the diff is a prop, so it is a checkbox.
        var highlight = useState(false);
        var showDiff = highlight[0];
        var setShowDiff = highlight[1];

        // Print settings, ported from forms/PrintSettingsForm. In the original
        // these live on a Backbone model the print view listens to, with
        // `match_font_size` reaching in to set CSS on the view's element. Here
        // they are state on the page that owns the sheet.
        var settings = useState({fontSize: 100, excludeExtended: false});
        var printSettings = settings[0];
        var setPrintSettings = settings[1];

        var onSettingsChange = useCallback(function (patch) {
            setPrintSettings(function (prev) { return _.assign({}, prev, patch); });
        }, [setPrintSettings]);

        // Dragging updates this at full speed; the sheet below reads the
        // deferred copy and re-renders when React has a spare frame.
        var deferredIndex = useDeferredValue(pickedIndex);

        var onChange = useCallback(function (e) {
            setPickedIndex(_.parseInt(e.target.value));
        }, [setPickedIndex]);

        var sheetCharacter = useMemo(function () {
            return showDiff
                ? Transform.highlighted(props.character, changes, deferredIndex)
                : Transform.at(props.character, changes, deferredIndex);
        }, [props.character, changes, deferredIndex, showDiff]);

        if (!changes.length) {
            return html`<p>This character has no recorded changes yet.</p>`;
        }

        // The change that is undone by stepping back one notch. At the newest
        // position nothing has been reversed, so the table is not shown at all.
        var reversed = pickedIndex != last
            ? changes[Math.min(pickedIndex + 1, last)]
            : null;

        return html`<div className="chr-history">
            <${TimeSlider}
                value=${pickedIndex}
                changes=${changes}
                onChange=${onChange}/>

            <label className="chr-highlight-toggle">
                <input
                    type="checkbox"
                    checked=${showDiff}
                    onChange=${function (e) { setShowDiff(e.target.checked); }}/>
                ${" Highlight what changed on the sheet"}
            </label>

            ${reversed ? html`<${ChangeTable} caption="Reversed Change" log=${reversed}/>` : null}
            <${ChangeTable} caption="Most Recent Change Applied" log=${changes[pickedIndex]}/>

            <${CharacterSheet}
                character=${sheetCharacter}
                fontSize=${printSettings.fontSize}
                excludeExtended=${printSettings.excludeExtended}
                onSettingsChange=${onSettingsChange}/>
        </div>`;
    }

    return HistoryPage;
});
