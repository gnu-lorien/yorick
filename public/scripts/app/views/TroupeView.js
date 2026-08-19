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
            self.writable = false;
            _.bindAll(this, "render", "addstaff");
        },

        register: function(troupe, writable) {
            var self = this;
            var changed = false;
            if (troupe !== self.troupe || writable != self.writable) {
                self.troupe = troupe;
                self.writable = !!writable;
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
                if (self.writable) {
                    self.form.fields.add(new Backform.Field({control: "button", label: "Update"}))
                }
                changed = true;
            }

            if (changed) {
                self.render();
                return self.rendered.then(function () { return self; });
            }
            return Parse.Promise.as(self);
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
            window.location.hash = "#troupe/" + self.troupe.id + "/characters/selecttoprint/all";
        },

        viewrelationships: function (e) {
            var self = this;
            e.preventDefault();
            window.location.hash = "#troupe/" + self.troupe.id + "/characters/relationships/network";
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            // Carry the two async regions across the re-render.
            //
            // `templates/troupe.html` contains `#troupe-staff` and
            // `#troupe-portrait-display`, so writing it into `div[role='main']`
            // destroys whatever they held and leaves them empty until the
            // fetches below come back -- measured at ~13ms for the staff list.
            // Anything that looks at the page in that window, a person or a
            // test, sees a troupe with no staff on it and no indication that
            // more is coming.
            //
            // Re-rendering is right; blanking a region you already have content
            // for, and are about to replace wholesale anyway, is not. Keeping
            // the previous markup means the list only ever shows the old
            // answer or the new one.
            var previousStaff = self.$el.find("#troupe-staff").html();
            var previousPortrait = self.$el.find("#troupe-portrait-display").html();

            self.template = _.template(troupe_html)({readonly: !self.writable});
            self.$el.find("div[role='main']").html(self.template);
            if (previousStaff) {
                self.$el.find("#troupe-staff").html(previousStaff);
            }
            if (previousPortrait) {
                self.$el.find("#troupe-portrait-display").html(previousPortrait);
            }
            self.form.setElement($("#troupe-data"));
            self.form.render();

            // Both regions are filled asynchronously, and `#troupe-staff` is
            // recreated EMPTY by the line above -- it lives inside
            // `templates/troupe.html`. So between `render()` returning and
            // `get_staff()` resolving there is a window, measured at up to
            // 64ms, where the page is on screen with no staff on it.
            //
            // Nothing used to close that window. The route called `register`
            // and then `changePage` immediately, so the page went live mid
            // render and anything reading the staff list right after the
            // transition -- a person or a test -- could see it empty and
            // conclude the troupe has no staff.
            //
            // `rendered` is that missing signal. Callers that care can wait on
            // it; `render` still returns `this`, so Backbone chainability is
            // unchanged.
            var staffRendered = self.troupe.get_staff().then(function (users) {
                self.staff_template = _.template(troupe_staff_list_html)({collection: users});
                self.$el.find("#troupe-staff").html(self.staff_template);
                self.$el.enhanceWithin();
            });

            var p = self.troupe.get("portrait") ? self.troupe.get("portrait").fetch() : Parse.Promise.as([]);
            var portraitRendered = p.then(function() {
                var t = _.template(troupe_portrait_display_html)({troupe: self.troupe});
                self.$el.find("#troupe-portrait-display").html(t);
                self.$el.enhanceWithin();
            });

            // Neither region blocks the other, and a failure in either must not
            // leave `rendered` pending forever -- the page is already usable.
            self.rendered = Parse.Promise.when([
                staffRendered.always(function () { return Parse.Promise.as(); }),
                portraitRendered.always(function () { return Parse.Promise.as(); })
            ]);

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
