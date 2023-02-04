// Includes file dependencies
define([
	"jquery",
	"backbone",
    "parse"
], function( $, Backbone, Parse ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function(options) {
            var self = this;
            _.bindAll(self, "update");
        },

        register: function(troupe) {
            var self = this;
            var changed = false;
            if (troupe !== self.troupe) {
                if (self.troupe)
                    self.stopListening(self.troupe);
                var p = troupe.get("portrait") ? troupe.get("portrait").fetch() : Parse.Promise.as([]);
                return p.then(function () {
                    self.troupe = troupe;
                    self.listenTo(self.troupe, "change:portrait", self.render);
                    return Parse.Promise.as(self.render());
                });
            }

            return Parse.Promise.as(self);
        },

        events: {
            "submit form.portrait-form": "update",
            "click .update": "update",
        },

        update: function(e) {
            var self = this;
            var portraitFile = self.$("#troupe-input-portrait")[0].files[0];
            var extension = portraitFile.name.split('.').pop();
            if (portraitFile.size > 1000000) {
                self.$(".error").html(_.escape("Picture too large. Limit is 1MB")).show();
            }
            var parseFile = new Parse.File("portrait" + extension, portraitFile);
            $.mobile.loading("show");
            self.undelegateEvents();
            parseFile.save().done(function(file) {
                var troupePortrait;
                if (self.troupe.get("portrait")) {
                    troupePortrait = self.troupe.get("portrait");
                } else {
                    troupePortrait = new Parse.Object("TroupePortrait");
                }
                var acl = new Parse.ACL;
                acl.setPublicReadAccess(true);
                acl.setPublicWriteAccess(false);
                acl.setRoleReadAccess("LST", true);
                acl.setRoleWriteAccess("LST", true);
                troupePortrait.setACL(acl);
                troupePortrait.set("original", file);
                return troupePortrait.save();
            }).done(function (portrait) {
                self.troupe.set("portrait", portrait);
                return self.troupe.save();
            }).done(function() {
                self.$(".error").hide();
            }).fail(function(error) {
                self.$(".error").html(_.escape(error.message)).show();
                console.log(error.message);
            }).always(function() {
                self.delegateEvents();
                $.mobile.loading("hide");
            })

            return false;
        },

        // Renders all of the Category models on the UI
        render: function() {

            // Sets the view's template property
            this.template = _.template( $( "script#troupePortraitView" ).html())({
                "troupe": this.troupe,
            } );

            // Renders the view's template inside of the current listview element
            this.$el.find("div[role='main']").html(this.template);

            this.$el.enhanceWithin();

            // Maintains chainability
            return this;
        }

    } );

    // Returns the View class
    return View;

} );