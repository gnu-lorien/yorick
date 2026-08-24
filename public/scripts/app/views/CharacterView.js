// Category View
// =============

// Includes file dependencies
define([
	"jquery",
	"backbone",
    "../views/CharacterListItem"
], function( $, Backbone, CharacterListItem) {

    // How long to keep waiting for the sheet to grow tall enough to restore
    // the reader's scroll position. 40 x 50ms is two seconds, comfortably past
    // the ~500ms the regions take to fill and short enough that a sheet which
    // never gets there stops trying while the reader is still on the page.
    var SCROLL_RESTORE_MAX_ATTEMPTS = 40;
    var SCROLL_RESTORE_INTERVAL_MS = 50;
    // Anything past this counts as the reader having scrolled themselves.
    var SCROLL_RESTORE_TOP_SLACK = 2;

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function() {
            _.bindAll(this, "restore_scroll_after_page_change");
        },

        /**
         * Return the sheet to the offset the router recorded, once it is tall
         * enough to go there.
         *
         * Replaces this view's own `scroll_back_after_page_change`, which
         * scrolled immediately on `pagechange` and therefore almost never
         * worked. jQuery Mobile fires that event before the sheet has finished
         * growing: measured on return from a text picker, with 400 correctly
         * recorded, the page was 81px scrollable at `pagechange` and 1879px a
         * moment later. `silentScroll(400)` against 81px goes nowhere, and
         * nothing ran again once the sheet had its height - so the sheet
         * usually landed at the top, and occasionally, when the render won the
         * race, did not. Inconsistent either way.
         *
         * Deliberately a NEW method on this view rather than an edit to a
         * shared one. There is no shared one: `CharacterCreateViewNew.js` and
         * `CharacterCreateView.js` each carry their own copy, so changing this
         * cannot reach either.
         *
         * An earlier version of this comment claimed the wizard's copy "works".
         * That was repeated from the report that raised the defect and never
         * measured, and it is wrong - the wizard raced the render exactly as
         * the sheet did. It now carries the same treatment, separately, in
         * `CharacterCreateViewNew.restore_scroll_after_page_change`.
         *
         * Bounded, because "wait until it is tall enough" must not become
         * "spin forever" on a sheet that never gets there - a character whose
         * content shrank, say. On giving up the user is left at the top, which
         * is where they were anyway.
         */
        restore_scroll_after_page_change: function() {
            var self = this;
            $(document).one("pagechange", function() {
                var top = _.parseInt(self.backToTop);
                // Consumed on sight, exactly as before: a stale offset must
                // not be reused by the next visit.
                self.backToTop = 0;
                if (!_.isFinite(top) || top <= 0) {
                    // No offset to restore, so this is a fresh arrival - open
                    // at the top.
                    //
                    // Not redundant. Every character sheet is the SAME jQuery
                    // Mobile page, `#character`, so moving from one character
                    // to another is a same-page transition and neither the
                    // browser nor jQuery Mobile resets the scroll position.
                    // Measured: scroll character A, leave through a text
                    // picker, come back (restores to 400 as intended), then
                    // open character B - the window stayed at 400, on a
                    // character the reader had never scrolled.
                    //
                    // `pagechange` DOES fire on that navigation, which is why
                    // this is the right place for it: the handler runs, finds
                    // nothing to restore, and until now returned having done
                    // nothing at all.
                    $.mobile.silentScroll(0);
                    return;
                }

                var attempts = 0;
                var attempt = function () {
                    attempts++;
                    // If the reader has scrolled for themselves, they have
                    // taken over and we must not yank the page from under
                    // them. A fresh page change starts at the top, so anything
                    // else means a real scroll happened.
                    if (window.scrollY > SCROLL_RESTORE_TOP_SLACK) {
                        return;
                    }
                    var room = document.documentElement.scrollHeight - window.innerHeight;
                    if (room >= top) {
                        $.mobile.silentScroll(top);
                        return;
                    }
                    if (attempts < SCROLL_RESTORE_MAX_ATTEMPTS) {
                        _.delay(attempt, SCROLL_RESTORE_INTERVAL_MS);
                    }
                };
                attempt();
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