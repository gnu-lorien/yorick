// Includes file dependencies
define([
    "underscore",
    "jquery",
    "backbone",
    "text!../templates/referendums-list.html",
    "parse",
    "../collections/Referendums",
    "../helpers/PromiseFailReport"
], function( _, $, Backbone, referendums_list_html, Parse, Referendums, PromiseFailReport) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            _.bindAll(this, "render", "register");
            this.collection = new Referendums();
            this.listenTo(this.collection, "add remove reset", this.render);
        },

        register: function(base_url, filter) {
            var self = this;
            var changed;
            base_url = base_url || "#referendum/<%= referendum_id %>";
            if (!_.eq(base_url, self.base_url)) {
                self.base_url = base_url;
                changed = true;
            }

            filter = filter || function () {};
            if (!_.eq(filter, self.filter)) {
                var incoming = [];
                var q = new Parse.Query("Referendum");
                q.select("id", "name", "portrait", "shortdescription", "order");
                q.include("portrait");
                filter(q);
                return q.each(function (t) {
                    incoming.push(t);
                }).then(function () {
                    self.collection.reset(incoming);
                }).fail(PromiseFailReport)
            }

            return Parse.Promise.as([]);
        },

        events: {
            "click .referendum-listing": "clicked",
        },

        clicked: function(e) {
            var self = this;
            e.preventDefault();
            $.mobile.loading("show");
            var pickedId = $(e.currentTarget).attr("backendId");
            var tmpl = _.template(self.base_url)({referendum_id: pickedId});
            window.location.hash = tmpl;
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            // Sets the view's template property
            this.template = _.template(referendums_list_html)({collection: self.collection.models});

            // Renders the view's template inside of the current div element
            this.$el.find("div[role='referendums-list']").html(this.template);
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
