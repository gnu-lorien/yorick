/**
 * Mounts the Vue character history page into a jQuery Mobile page.
 *
 * This is the seam. It presents the same interface to the router that the
 * Marionette view does - `new View({el: "#..."})`, then `register(character)`
 * returning a promise - so the router does not have to know or care which
 * framework is behind a given page. A port can proceed one route at a time
 * behind seams like this one, and each one can be reverted by editing a single
 * line of the router.
 *
 * Two things it has to get right, both of them consequences of jQuery Mobile
 * owning the page lifecycle:
 *
 *  1. Vue mounts into a child element, never into the jQM page div itself. Vue
 *     replaces the element it is given, and the page div carries jQM's own
 *     classes and data.
 *
 *  2. The app is unmounted when the page is handed a different character, so
 *     the composables' `onScopeDispose` hooks run and the model listeners come
 *     off. jQM keeps every page it has visited in the DOM forever, so a view
 *     that leaks a listener per visit leaks for the life of the tab - which is
 *     the failure mode `stopListening` exists to prevent on the Marionette
 *     side.
 */
define([
    "jquery",
    "parse",
    "vue",
    "../vue/history/CharacterHistoryPage",
    "../helpers/ReportError"
], function ($, Parse, Vue, CharacterHistoryPage, ReportError) {
    "use strict";

    var MOUNT_CLASS = "yv-mount";

    function CharacterHistoryVueView(options) {
        this.el = options.el;
        this.app = null;
        this.character = null;
    }

    CharacterHistoryVueView.prototype._mountPoint = function () {
        var $host = $(this.el);
        var $mount = $host.find("." + MOUNT_CLASS);
        if (!$mount.length) {
            $mount = $("<div></div>").addClass(MOUNT_CLASS);
            $host.append($mount);
        }
        return $mount.get(0);
    };

    CharacterHistoryVueView.prototype.destroy = function () {
        if (this.app) {
            this.app.unmount();
            this.app = null;
        }
        this.character = null;
    };

    CharacterHistoryVueView.prototype.register = function (character) {
        var self = this;

        if (self.character === character && self.app) {
            return Parse.Promise.as(self);
        }
        self.destroy();
        self.character = character;

        // markRaw, not just "do not wrap it": createApp deep-reactivates its
        // props object, and a reactive Proxy around a Parse.Object breaks
        // identity comparisons inside the SDK and inside get_transformed.
        self.app = Vue.createApp(CharacterHistoryPage, {
            character: Vue.markRaw(character)
        });

        self.app.config.errorHandler = function (error, instance, info) {
            console.error("Vue history page error (" + info + ")", error);
            ReportError(error, "Couldn't render the character history");
        };

        self.app.mount(self._mountPoint());

        // Mounting is synchronous; the page fetches its own recorded changes
        // and shows its own loading state. The router's promise therefore
        // resolves as soon as there is something on screen, rather than after
        // every query has come back, which is when the Marionette version
        // finally calls changePage.
        return Parse.Promise.as(self);
    };

    return CharacterHistoryVueView;
});
