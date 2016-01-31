// Includes file dependencies
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
            self.form = new TroupeNewForm({
                el: "#troupe-new-form",
                model: new Troupe(),
            });
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
