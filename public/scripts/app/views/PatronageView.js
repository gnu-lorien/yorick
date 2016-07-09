// Includes file dependencies
define([
	"jquery",
	"backbone",
    "marionette",
    "text!../templates/patronage-list-item.html",
    "backform",
    "bootstrap-datepicker",
    "moment"
], function( $, Backbone, Marionette, patronage_html, Backform, datepicker, moment ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {
        initialize: function(options) {
            var view = this;
            view.options = options;
            var momentFormat = 'MM/DD/YYYY';
            var datepickerFormat = 'mm/dd/yyyy';
            var backmodel = view.model.clone();
            backmodel.set("paidOn", moment(backmodel.get("paidOn")).format(momentFormat))
            backmodel.set("expiresOn", moment(backmodel.get("expiresOn")).format(momentFormat))
            view.form = new Backform.Form({
                el: view.$el,
                model: backmodel,
                fields: [
                    {
                        name: "owner.objectId",
                        label: "Owner",
                        control: "input",
                        disabled: true
                    },
                    {
                        name: "paidOn",
                        control: "datepicker",
                        type: "text",
                        options: {
                            autoclose: true,
                            format: datepickerFormat
                        }
                    },
                    {
                        name: "expiresOn",
                        control: "datepicker",
                        type: "text",
                        options: {
                            autoclose: true,
                            format: datepickerFormat
                        }
                    },
                    {
                        name: "submit",
                        control: "button",
                        label: "Save Changes"
                    }
                ],
                events: {
                    "submit": function (e) {
                        var self = this;
                        e.preventDefault();
                        view.model.set({
                            "paidOn": moment(self.model.get("paidOn"), momentFormat).toDate(),
                            "expiresOn": moment(self.model.get("expiresOn"), momentFormat).toDate()
                        })
                        view.model.save().then(function () {
                            self.fields.at(3).set({status: "success", message: "Save completed"});
                        }).fail(function(error) {
                            self.model.errorModel.set("owner", _.escape(error.message));
                        })
                    }
                }
            });
        },
        tagName: 'form',
        render: function() {
            this.form.render();
            this.$el.enhanceWithin();

            return this;
        }
    } );

    // Returns the View class
    return View;

} );