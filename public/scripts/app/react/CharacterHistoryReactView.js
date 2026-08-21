// The Marionette-to-React seam
// ============================
//
// This is the whole interop story, and it is the file to read if the question
// is "can this application be ported incrementally".
//
// It presents the interface the router already knows how to call - construct
// with an `el`, then `register(character)` returning a promise - and behind
// that interface there is a React root instead of a Marionette LayoutView. The
// router change is one line. Nothing else in the app knows this page is React,
// and this page does not know anything else in the app is not.
//
// Three jobs, in order of how much thought they took:
//
//   1. Fetch. Unchanged from the original: `get_recorded_changes()` off the
//      Character model, which owns the query and the incremental refetch. A
//      port does not need to touch the data layer, and should not.
//
//   2. Convert. Parse objects in, plain snapshots out, once per fetch. See
//      snapshot.js for why this is the load-bearing step.
//
//   3. Subscribe. The Character model fires "saved" when anything about it is
//      written, and the original re-renders on it. Here it refetches, converts,
//      and sets state - React does the rest.
//
// The one thing this file must NOT do is call `$.el.enhanceWithin()`. Every
// other view in the app ends its onRender with it, because jQuery Mobile only
// styles widgets it has been told about. Calling it on a React subtree lets
// jQM rewrite the DOM React believes it owns - it wraps inputs in generated
// divs, moves nodes, and stamps its own classes - and the next React render
// reconciles against a tree that no longer matches, which is where "I could
// never get this right in React" usually starts. The rule for the port is:
// jQuery Mobile owns the page shell, React owns everything inside its root,
// and neither reaches across. The stylesheet below dresses the React subtree
// to match without letting jQM near it.

define([
    "underscore",
    "jquery",
    "parse",
    "react",
    "react-dom",
    "./html",
    "./snapshot",
    "./HistoryPage"
], function (_, $, Parse, React, ReactDOM, html, Snapshot, HistoryPage) {

    /**
     * The container component.
     *
     * State is a single object rather than two, so a refetch cannot leave the
     * character and the timeline momentarily disagreeing about which version
     * of the world they describe.
     */
    function HistoryContainer(props) {
        var state = React.useState(function () {
            return {character: props.snapshot, changes: props.changes};
        });
        var value = state[0];
        var setValue = state[1];

        React.useEffect(function () {
            var model = props.model;

            function refresh() {
                model.update_recorded_changes().then(function () {
                    setValue({
                        character: Snapshot.character(model),
                        changes: _.map(model.recorded_changes.models, Snapshot.change)
                    });
                });
            }

            // Same event the Marionette MainView binds to. Backbone's off()
            // with the handler and context is the whole teardown; there is no
            // other subscription on this page to leak.
            model.on("saved", refresh, null);
            return function () {
                model.off("saved", refresh, null);
            };
        }, [props.model]);

        return html`<${HistoryPage} character=${value.character} changes=${value.changes}/>`;
    }

    var STYLE_ID = "character-history-react-style";

    /**
     * Enough CSS to make the React subtree sit in the jQuery Mobile page
     * without asking jQM to enhance it. These rules reproduce what jQM's
     * table-stroke and slider widgets would have produced, minus the DOM
     * rewriting that makes them unsafe to mix with React.
     */
    var STYLE = [
        ".chr-history .chr-table { width: 100%; border-collapse: collapse; margin: .5em 0 1em; font-size: .85em; }",
        ".chr-history .chr-table th, .chr-history .chr-table td { border: 1px solid #ddd; padding: .3em .5em; text-align: left; }",
        ".chr-history .chr-table th { background: #f6f6f6; font-weight: bold; white-space: nowrap; }",
        ".chr-history .chr-table td { white-space: nowrap; }",
        ".chr-history .chr-slider-caption { display: block; margin-top: .25em; font-size: .85em; color: #666; }",
        ".chr-history .chr-highlight-toggle { display: block; margin: .5em 0 1em; font-size: .9em; }",
        ".chr-history > p > label { font-weight: bold; }",
        ".chr-history .chr-print-settings { margin-bottom: .75em; font-size: .9em; }",
        ".chr-history .chr-print-settings label { margin-right: 1.5em; }"
    ].join("\n");

    function installStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var el = document.createElement("style");
        el.id = STYLE_ID;
        el.appendChild(document.createTextNode(STYLE));
        document.head.appendChild(el);
    }

    function View(options) {
        this.el = options.el;
        this.root = null;
        this.model = null;
    }

    _.extend(View.prototype, {

        /**
         * The router's entry point, matching CharacterHistoryView.register:
         * take a Character, resolve once the page is ready to be shown.
         */
        register: function (model) {
            var self = this;

            if (model === self.model && self.root) {
                return Parse.Promise.as(self);
            }

            installStyle();

            return model.get_recorded_changes().then(function () {
                self.model = model;

                var snapshot = Snapshot.character(model);
                var changes = _.map(model.recorded_changes.models, Snapshot.change);

                if (!self.root) {
                    self.root = ReactDOM.createRoot($(self.el)[0]);
                }
                self.root.render(html`<${HistoryContainer}
                    key=${model.id}
                    model=${model}
                    snapshot=${snapshot}
                    changes=${changes}/>`);

                return Parse.Promise.as(self);
            });
        },

        remove: function () {
            if (this.root) {
                this.root.unmount();
                this.root = null;
                this.model = null;
            }
        }
    });

    return View;
});
