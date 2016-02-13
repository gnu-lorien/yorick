// Includes file dependencies
define([
    "underscore",
    "jquery",
    "backbone",
    "text!../templates/troupes-list.html",
    "parse",
    "../collections/Troupes",
    "../helpers/PromiseFailReport"
], function( _, $, Backbone, troupes_list_html, Parse, Troupes, PromiseFailReport) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            _.bindAll(this, "render", "register");
            this.collection = new Troupes();
            this.listenTo(this.collection, "add remove reset", this.render);
        },

        register: function(base_url, filter) {
            var self = this;
            var changed;
            base_url = base_url || "#troupe/";
            if (!_.eq(base_url, self.base_url)) {
                self.base_url = base_url;
                changed = true;
            }

            filter = filter || function () {};
            if (!_.eq(filter, self.filter)) {
                var incoming = [];
                var q = new Parse.Query("Troupe");
                q.select("id", "name");
                filter(q);
                q.each(function (t) {
                    incoming.push(t);
                }).then(function () {
                    self.collection.reset(incoming);
                }).fail(PromiseFailReport)
            }
        },

        events: {
            "click .troupe-listing": "clicked",
        },

        clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            var pickedId = $(e.target).attr("backendId");
            var tmpl = _.template(self.base_url)({troupe_id: pickedId});
            window.location.hash = tmpl;
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            // Sets the view's template property
            this.template = _.template(troupes_list_html)({collection: self.collection.models});

            // Renders the view's template inside of the current div element
            this.$el.find("div[role='troupe-list']").html(this.template);
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
