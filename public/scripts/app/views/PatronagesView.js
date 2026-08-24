// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "marionette",
    "../views/PatronageListView"
], function( $, Backbone, Marionette, PatronageListView) {

    // Extends Backbone.View
    var View = Marionette.CollectionView.extend( {
        childView: PatronageListView,
        initialize: function(options) {
            this.options = options;
        },
        childViewOptions: function () {
            var self = this;
            return {
                back_url_base: self.options.back_url_base
            }
        },

        /**
         * Re-enhance the list whenever its rows change.
         *
         * This one view backs all five patronage lists in the app - Patronage
         * on `#profile`, the admin user detail page, and the three
         * `#administration/patronage*` screens - and every one of them binds it
         * straight to a `<ul data-role="listview">` that jQuery Mobile has
         * already enhanced. A CollectionView appends its own children, so the
         * rows arrive with nothing touching the list afterwards and never
         * receive `ui-first-child` / `ui-last-child`, the classes that round
         * the top and bottom of an inset list. Same defect as #16's roster,
         * five more times.
         *
         * Fixed here rather than at the five call sites: they all share this
         * view, so one guarded refresh covers them and cannot drift apart.
         *
         * The guard is not optional - the first render can happen before the
         * page is enhanced, and the jQuery UI widget bridge throws "cannot call
         * methods on listview prior to initialization" if the widget does not
         * exist yet. On that pass there is nothing to refresh anyway:
         * `pagecreate` is about to enhance the rows.
         */
        refresh_listview: function () {
            var self = this;
            if (self.$el.data("mobile-listview")) {
                self.$el.listview("refresh");
            }
        },
        onRender: function () {
            this.refresh_listview();
        },
        onAddChild: function () {
            // Rows arrive one at a time from a `collection.add`, after the
            // initial render, so `onRender` alone is not enough.
            this.refresh_listview();
        },
        onRemoveChild: function () {
            this.refresh_listview();
        }
    } );

    // Returns the View class
    return View;

} );