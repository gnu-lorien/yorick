define([
    "jquery",
    "backbone",
    "backform",
    "../models/Troupe",
    "../forms/TroupeForm",
    "text!../templates/troupe-staff-list.html",
    "parse",
    "text!../templates/troupe-portrait-display.html",
    "text!../templates/troupe.html"
], function( $, Backbone, Backform, Troupe, TroupeForm, troupe_staff_list_html, Parse, troupe_portrait_display_html, troupe_html) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            var self = this;
            _.bindAll(this, "render", "addstaff");
        },

        register: function(troupe, readonly) {
            var self = this;
            var changed = false;
            if (troupe !== self.troupe || readonly != self.readonly) {
                self.troupe = troupe;
                self.readonly = readonly;
                self.form = new TroupeForm({
                    el: "#troupe-data",
                    model: self.troupe,
                    events: {
                        "submit": function (e) {
                            e.preventDefault();
                            $.mobile.loading("show");
                            console.log(Parse.User.current().get("username"));
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
                if (!readonly) {
                    self.form.fields.add(new Backform.Field({control: "button", label: "Update"}))
                }
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
            "click .troupe-view-characters": "viewcharacters",
            "click .troupe-view-character-relationships": "viewrelationships",
            "click .troupe-view-summarize-characters": "viewsummarizecharacters",
            "click .troupe-view-print-characters": "viewprintcharacters",
        },

        addstaff: function (e) {
            var self = this;
            e.preventDefault();
            window.location.hash = "#troupe/" + self.troupe.id + "/staff/add";
        },

        viewcharacters: function (e) {
            var self = this;
            e.preventDefault();
            window.location.hash = "#troupe/" + self.troupe.id + "/characters/all";
        },
        
        viewsummarizecharacters: function (e) {
            var self = this;
            e.preventDefault();
            window.location.hash = "#troupe/" + self.troupe.id + "/characters/summarize/all";
        },
        
        viewprintcharacters: function (e) {
            var self = this;
            e.preventDefault();
            window.location.hash = "#troupe/" + self.troupe.id + "/characters/print/all";
        },

        viewrelationships: function (e) {
            var self = this;
            e.preventDefault();
            window.location.hash = "#troupe/" + self.troupe.id + "/characters/relationships/network";
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            self.template = _.template(troupe_html)({readonly: self.readonly});
            self.$el.find("div[role='main']").html(self.template);
            self.form.setElement($("#troupe-data"));
            self.form.render();

            // Sets the view's template property
            self.troupe.get_staff().then(function (users) {
                self.staff_template = _.template(troupe_staff_list_html)({collection: users});
                self.$el.find("#troupe-staff").html(self.staff_template);
                self.$el.enhanceWithin();
            })

            var p = self.troupe.get("portrait") ? self.troupe.get("portrait").fetch() : Parse.Promise.as([]);
            p.then(function() {
                var t = _.template(troupe_portrait_display_html)({troupe: self.troupe});
                self.$el.find("#troupe-portrait-display").html(t);
                self.$el.enhanceWithin();
            })

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
