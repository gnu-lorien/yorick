// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "text!../templates/character-list-item.html"
], function( $, Backbone, character_list_item_html ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {

            _.bindAll(this, "render", "clicked");
            var debounced_render = _.debounce(this.render, 150);
            this.listenTo(this.collection, "add", debounced_render);
            this.listenTo(this.collection, "remove", debounced_render);
            this.listenTo(this.collection, "reset", this.render);
            this.click_url = "#";
        },

        register: function(click_url) {
            var self = this;
            self.click_url = click_url;
            return self.render();
        },

        events: {
            "click .character-list-item": "clicked",
        },

        clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            var targete = $(e.currentTarget);
            var pickedId = targete.attr("backendId");
            var tmpl = _.template(self.click_url)({character_id: pickedId});
            window.location.hash = tmpl;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( character_list_item_html )(
                { "collection": this.collection,
                "click_url": this.click_url} );

            // Renders the view's template inside of the current div element,
            // then re-enhances the list.
            //
            // Without this the rows lose their rounded ends on every render
            // after the first. jQuery Mobile enhances the whole page once, on
            // `pagecreate`, which happens after the first batch of `<li>`s is
            // already in the `<ul>` - so the first visit looks right. On any
            // later render jQM does not touch the page again, and the freshly
            // written rows never receive `ui-first-child` / `ui-last-child`,
            // the classes that round the top and bottom of an inset list.
            //
            // Measured: first visit to `#characters?all` gives
            // `li.ui-li-has-thumb.ui-first-child` and
            // `li.ui-li-has-thumb.ui-last-child`; going on to
            // `#administration/characters/all` and back - both render into
            // `#characters-all` - gives bare `li.ui-li-has-thumb`.
            //
            // `listview("refresh")` rather than the `enhanceWithin()` the
            // other 41 views call: `enhanceWithin` skips an element that is
            // already enhanced, and the `<ul>` is. Only `refresh` re-walks the
            // rows and re-applies the position classes.
            //
            // Guarded, because the first render runs BEFORE the page is
            // enhanced - the route calls `register()` and only then
            // `changePage` - and the jQuery UI widget bridge throws "cannot
            // call methods on listview prior to initialization" if the widget
            // does not exist yet. On that first pass there is nothing to
            // refresh: `pagecreate` is about to enhance the rows anyway.
            var $list = this.$el.find("ul[data-role='listview']");
            $list.html(this.template);
            if ($list.data("mobile-listview")) {
                $list.listview("refresh");
            }

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );