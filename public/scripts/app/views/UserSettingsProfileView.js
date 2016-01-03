// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse"
], function ($, Backbone, Parse) {

    // Extends Backbone.View
    var UserSettingsProfileView = Backbone.View.extend({
        initialize: function () {
            _.bindAll(this, "allowUpdates");
        },

        events: {
            "submit form.profile-form": "update",
            "change #input-name": "allowUpdates",
            "change #input-email": "allowUpdates",
            "click .update": "update",
        },

        allowUpdates: function(e) {
            this.$(".update").removeAttr("disabled");
        },

        update: function(e) {
            var self = this;
            var user = Parse.User.current();
            user.set("realname", this.$("#input-name").val());
            user.set("email", this.$("#input-email").val());
            $.mobile.loading("show");
            self.undelegateEvents();
            user.save().then(function () {
                self.$(".error").hide();
                self.render();
            }, function(error) {
                self.$(".error").html(_.escape(error.message)).show();
            }).always(function() {
                $.mobile.loading("hide");
                self.delegateEvents();
            });

            return false;
        },

        render: function () {
            this.template = _.template($("#userSettingsProfileView").html())({
                "user": Parse.User.current(),
            });
            this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();
        }
    });

    // Returns the View class
    return UserSettingsProfileView;

});
