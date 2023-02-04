// Includes file dependencies
define([
	"jquery",
	"backbone",
    "marionette",
    "text!../templates/patronage-list-item-csv.html",
    "moment",
    "../helpers/UserWreqr"
], function( $, Backbone, Marionette, patronage_html, moment, UserChannel ) {

    // Extends Backbone.View
    var View = Marionette.ItemView.extend( {
        tagName: 'li',
        template: function(serialized_model) {
            var self = this;
            return _.template(patronage_html)(serialized_model);
        },
        templateHelpers: function () {
            var self = this;
            return {
                moment: moment,
                user: function () {
                    return UserChannel.channel.reqres.request("get", this.owner.objectId);
                },
                status: function () {
                    return self.model.status();
                }
            }
        },
        modelEvents: {
            "change": "render",
        },
        onRender: function () {
            this.$el.enhanceWithin();
        }
    } );

    // Returns the View class
    return View;

} );