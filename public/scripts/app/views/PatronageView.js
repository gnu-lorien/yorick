// Includes file dependencies
define([
	"jquery",
	"backbone",
    "marionette",
    "text!../templates/patronage-list-item.html",
    "backform",
    "bootstrap-datepicker",
    "moment",
    "../helpers/UserWreqr"
], function( $, Backbone, Marionette, patronage_html, Backform, datepicker, moment, UserChannel ) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {
        initialize: function(options) {
            var view = this;
            view.options = options;
            var momentFormat = 'MM/DD/YYYY';
            var datepickerFormat = 'mm/dd/yyyy';
            var backmodel = view.model.clone();
            if (backmodel.has("owner")) {
                backmodel.set("owner", backmodel.get("owner").id);
            } else {
                view.isNew = true;
            }
            if (backmodel.has("paidOn")) {
                backmodel.set("paidOn", moment(backmodel.get("paidOn")).format(momentFormat));
            }
            if (backmodel.has("expiresOn")) {
                backmodel.set("expiresOn", moment(backmodel.get("expiresOn")).format(momentFormat));
            }
            var ownerOptions = UserChannel.channel.reqres.request('all').map(function (u) {
                return {
                    label: "" + u.get("username") + " " + u.get("realname") + " " + u.get("email"),
                    value: u.id
                }
            });
            ownerOptions.unshift({label: "Invalid", value: ""});

            view.form = new Backform.Form({
                el: view.$el,
                model: backmodel,
                fields: [
                    {
                        name: "owner",
                        label: "Owner",
                        control: "select",
                        options: ownerOptions
                    },
                    {
                        name: "paidOn",
                        label: "Paid on",
                        control: "datepicker",
                        type: "text",
                        options: {
                            autoclose: true,
                            format: datepickerFormat
                        }
                    },
                    {
                        name: "expiresOn",
                        label: "Expires on",
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
                        self.fields.at(3).set({status: "", message: ""});
                        self.model.errorModel.clear();
                        view.model.set({
                            "paidOn": moment(self.model.get("paidOn"), momentFormat).toDate(),
                            "expiresOn": moment(self.model.get("expiresOn"), momentFormat).toDate(),
                            "owner": new Parse.User({id: self.model.get("owner")})
                        })
                        var acl = new Parse.ACL;
                        acl.setPublicReadAccess(true);
                        acl.setPublicWriteAccess(false);
                        acl.setRoleReadAccess("Administrator", true);
                        acl.setRoleWriteAccess("Administrator", true);
                        view.model.setACL(acl);
                        view.model.save().then(function () {
                            self.fields.at(3).set({status: "success", message: "Save completed"});
                            _.defer(function () {
                                $("body").enhanceWithin();
                            });
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