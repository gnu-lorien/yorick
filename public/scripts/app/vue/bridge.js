/**
 * The bridge between Parse/Backbone models and Vue's reactivity.
 *
 * This is the whole trick to porting this application a page at a time, so it
 * is worth being explicit about the rules it encodes.
 *
 * 1. A Parse.Object must NEVER become reactive. `reactive()` and the deep
 *    unwrapping inside `ref()` hand back a Proxy, and everything in this
 *    codebase that compares object identity then breaks: `_.xor(traits,
 *    [current, fake])` in `Character.get_transformed` would stop finding
 *    `current`, `Parse.Object._findUnsavedChildren` would stop recognising its
 *    own children, and a `save()` would post a mangled object graph. Every
 *    model that crosses into a component goes through `keep()` (markRaw) or
 *    lives in a `shallowRef`.
 *
 * 2. Because the models are opaque to Vue, changes inside them cannot be
 *    tracked. `useModelRevision` turns the Backbone event a model already
 *    fires into a plain incrementing number, which IS reactive - so a
 *    component can depend on "this model changed" without Vue having to see
 *    inside it. That number is the only reason the sheet redraws after a save.
 *
 * Both rules go away, per model, whenever a model is eventually rewritten as
 * a plain object. Nothing here has to be undone in one go.
 */
define(["vue"], function (Vue) {
    "use strict";

    /** Hand a model to Vue without letting Vue wrap it in a Proxy. */
    function keep(object) {
        if (!object || typeof object !== "object") {
            return object;
        }
        return Vue.markRaw(object);
    }

    function keepAll(objects) {
        var out = [];
        for (var i = 0; i < (objects || []).length; i++) {
            out.push(keep(objects[i]));
        }
        return out;
    }

    /**
     * A reactive counter that ticks every time `model` fires one of `events`.
     *
     * Depend on `revision.value` from a computed and it re-evaluates when the
     * model changes; use it as part of a `:key` and the subtree re-renders.
     * Unbinds itself when the owning component unmounts.
     */
    function useModelRevision(model, events) {
        var revision = Vue.ref(0);
        if (!model || typeof model.on !== "function") {
            return revision;
        }
        var names = (events || ["change"]).join(" ");
        var bump = function () {
            revision.value += 1;
        };
        model.on(names, bump);
        Vue.onScopeDispose(function () {
            model.off(names, bump);
        });
        return revision;
    }

    /**
     * Trailing-edge debounce, standing in for `_.debounce(fn, wait, {trailing: true})`.
     *
     * Kept local so the Vue layer does not depend on lodash 3, which is
     * vendored here at a version whose `_.sum(collection, "path")` and
     * `_.sortByAll` shorthands no longer exist in lodash 4. A port that leans
     * on them inherits that upgrade problem; this one does not.
     */
    function debounced(fn, wait) {
        var timer = null;
        var wrapped = function () {
            var args = arguments;
            var self = this;
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(function () {
                timer = null;
                fn.apply(self, args);
            }, wait);
        };
        wrapped.cancel = function () {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };
        return wrapped;
    }

    return {
        keep: keep,
        keepAll: keepAll,
        useModelRevision: useModelRevision,
        debounced: debounced
    };
});
