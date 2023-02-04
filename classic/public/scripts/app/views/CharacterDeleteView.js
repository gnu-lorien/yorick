// Includes file dependencies
define([
    "jquery",
    "backbone",
    "parse"
], function ($, Backbone, Parse) {

    // Extends Backbone.View
    var View = Backbone.View.extend({
        initialize: function () {
        },

        register: function(character, success_url, success_cb) {
            var self = this;
            self.character = character;
            self.success_url = success_url;
            self.success_cb = success_cb;
            return self.render();
        },

        events: {
            "click .delete-character": "delete",
        },

        delete: function() {
            var self = this;
            $.mobile.loading("show");
            self.character.archive().then(self.success_cb).always(function () {
                $.mobile.loading("hide");
                window.location.hash = self.success_url;
            })
        },

        render: function () {
            this.template = _.template($("#characterDeleteView").html())({
                "character": this.character,
            });
            this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();
        }
    });

    // Returns the View class
    return View;

});
