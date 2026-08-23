// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "../views/CharacterListItem"
], function( $, Backbone, CharacterListItem) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            _.bindAll(this, "scroll_back_after_page_change");
        },

        scroll_back_after_page_change: function() {
            var self = this;
            $(document).one("pagechange", function() {
                var top = _.parseInt(self.backToTop);
                $.mobile.silentScroll(top);
                self.backToTop = 0;
            });
        },


        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#characterView" ).html())({ "character": this.model } );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);
            // Built fresh every render, not memoised.
            //
            // `new CharacterListItem(this.model)` passes the MODEL where
            // Backbone.View expects an options bag, and the View constructor
            // picks `id` and `className` off whatever it is handed -- so a
            // Parse.Object donates its objectId and its className to the
            // wrapper element. Memoising the view therefore froze the wrapper
            // at whichever character was opened FIRST: open a vampire, then a
            // werewolf, and the werewolf's details sat inside
            // `<div id="<the vampire's objectId>" class="Vampire">`.
            //
            // `empty()` before `append()` because a fresh view each time would
            // otherwise stack a second header on every revisit; with the
            // memoised view, re-appending the same element merely moved it.
            this.subview = new CharacterListItem(this.model);
            this.subview.character = this.model;
            this.$el.find("div#insertheader").empty().append(this.subview.render().el);
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );