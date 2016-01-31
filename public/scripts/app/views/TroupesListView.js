// Includes file dependencies
define([
    "jquery",
    "backbone",
    "text!../templates/troupes-list.html",
    "parse"
], function( $, Backbone, troupes_list_html, Parse) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            _.bindAll(this, "render");
        },

        register: function() {
            var self = this;
            self.collection = [];
            var q = new Parse.Query("Troupe");
            q.select("id", "name");
            q.each(function (t) {
                self.collection.push(t);
            }).then(function () {
                self.render();
            }, function (error) {
                console.log("No troupes? " + error.message);
            })
        },

        events: {
            "click .troupe-listing": "clicked",
        },

        clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            var pickedId = $(e.target).attr("backendId");
            window.location.hash = "#troupe/" + pickedId;
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            // Sets the view's template property
            this.template = _.template(troupes_list_html)({collection: self.collection});

            // Renders the view's template inside of the current div element
            this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
