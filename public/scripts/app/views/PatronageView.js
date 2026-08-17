// Includes file dependencies
define([
	"jquery",
	"backbone",
    "marionette",
    "backform",
    "bootstrap-datepicker",
    "moment",
    "../helpers/UserWreqr",
    "../helpers/ReportError"
], function( $, Backbone, Marionette, Backform, datepicker, moment, UserChannel, ReportError ) {

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

        events: {
            "click .patronage-delete": "delete_clicked"
        },

        /**
         * R43: there was no way to delete a Patronage anywhere in the
         * application - no button here, no control on the list rows, no route.
         * A record created by mistake, or one that has to be revoked, could
         * only be removed by someone with direct database access.
         */
        delete_clicked: function (e) {
            var self = this;
            e.preventDefault();
            if (self.isNew || !self.model.id) {
                return false;
            }
            $.mobile.loading("show");
            self.model.destroy().then(function () {
                ReportError.clear();
                window.location.hash = "#administration/patronages";
            }).fail(ReportError.on("Couldn't delete this patronage")).always(function () {
                $.mobile.loading("hide");
            });
            return false;
        },

        render: function() {
            var self = this;
            self.form.render();
            if (!self.isNew && self.model.id) {
                // Only an existing record can be deleted; the "new patronage"
                // route reuses this same view with an unsaved model.
                $('<button type="button" class="patronage-delete ui-btn ui-btn-b ui-icon-delete ui-btn-icon-left"></button>')
                    .text("Delete Patronage")
                    .appendTo(self.$el);
            }
            self.$el.enhanceWithin();

            return self;
        }
    } );

    // Returns the View class
    return View;

} );