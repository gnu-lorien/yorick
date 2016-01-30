// Includes file dependencies
define([
    "jquery",
    "backbone",
    "backform",
    "../models/Troupe"
], function( $, Backbone, Backform, Troupe) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            var self = this;
            _.bindAll(this, "render");
            self.form = new Backform.Form({
                el: "#troupe-new-form",
                model: new Troupe(),
                fields: [
                    {name: "id", label: "id", control: "uneditable-input"},
                    {name: "name", label: "Name", control: "input"},
                    {name: "shortname", label: "Short Name", control: "input"},
                    {name: "shortdescription", label: "Short Description", control: "input"},
                    {control: "spacer"},
                    {name: "description", label: "Long Description", control: "textarea"},
                    {control: "button", label: "Add New"},
                ],
                events: {
                    "submit": function (e) {
                        e.preventDefault();
                        this.model.save().then(function () {
                            console.log("Saved the troupe");
                        }, function(error) {
                            console.log("Failed to save troupe " + error.message);
                        })
                    }
                }
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
