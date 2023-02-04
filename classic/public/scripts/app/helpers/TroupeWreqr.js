define([
    "jquery",
    "underscore",
    "parse",
    "backbone",
    "marionette",
    "../collections/Troupes",
], function( $, _, Parse, Backbone, Marionette, Troupes ) {

    var TroupeHelper = Backbone.Model.extend({
        initialize: function() {
            var self = this;

            self.channel = Backbone.Wreqr.radio.channel('troupe');
            self.troupes = new Troupes;

            Backbone.Wreqr.radio.reqres.setHandler("troupe", "get", function (id) {
                return self.troupes.get(id);
            });
            Backbone.Wreqr.radio.reqres.setHandler("troupe", "all", function () {
                return self.troupes;
            });
        },

        get_troupes: function() {
            var self = this;
            var incoming = [];
            var q = new Parse.Query("Troupe");
            q.select("id", "name", "portrait", "shortdescription", "location", "staffemail");
            q.include("portrait");
            return q.each(function (t) {
                incoming.push(t);
            }).then(function () {
                self.troupes.reset(incoming);
            });
        }
    });

    return new TroupeHelper;
} );
