define([
    "jquery",
    "backbone",
    "backform",
    "../models/Troupe",
    "../forms/TroupeNewForm"
], function( $, Backbone, Backform, Troupe, TroupeNewForm) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            var self = this;
            _.bindAll(this, "render");
        },

        register: function(troupe) {
            var self = this;
            var changed = false;
            if (troupe !== self.troupe) {
                self.troupe = troupe;
                self.form = new TroupeNewForm({
                    el: "#troupe-data",
                    model: self.troupe,
                });
                changed = true;
            }

            if (changed) {
                return self.render();
            } else {
                return self;
            }
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            // Sets the view's template property
            //this.template = _.template(player_options_html)();
            self.form.render();

            // Renders the view's template inside of the current div element
            //this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
