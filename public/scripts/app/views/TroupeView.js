define([
    "jquery",
    "backbone",
    "backform",
    "../models/Troupe",
    "../forms/TroupeForm"
], function( $, Backbone, Backform, Troupe, TroupeForm) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            var self = this;
            _.bindAll(this, "render", "addstaff");
        },

        register: function(troupe) {
            var self = this;
            var changed = false;
            if (troupe !== self.troupe) {
                self.troupe = troupe;
                self.form = new TroupeForm({
                    el: "#troupe-data",
                    model: self.troupe,
                    events: {
                        "submit": function (e) {
                            e.preventDefault();
                            $.mobile.loading("show");
                            this.model.save().then(function (t) {
                                console.log("Saved the troupe");
                            }).fail(function (error) {
                                console.log("Failed to save troupe " + error.message);
                                window.location.hash = "#administration";
                            }).always(function () {
                                $.mobile.loading("hide");
                            })
                        }
                    }
                });
                self.form.fields.add(new Backform.Field({control: "button", label: "Update"}))
                changed = true;
            }

            if (changed) {
                return self.render();
            } else {
                return self;
            }
        },

        events: {
            "click .troupe-add-staff": "addstaff",
        },

        addstaff: function (e) {
            var self = this;
            e.preventDefault();
            window.location.hash = "#troupe/" + self.troupe.id + "/staff/add";
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
