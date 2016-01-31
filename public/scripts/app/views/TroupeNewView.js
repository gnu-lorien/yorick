// Includes file dependencies
define([
    "jquery",
    "backbone",
    "backform",
    "../models/Troupe"
], function( $, Backbone, Backform, Troupe) {

    // Extends Backbone.View
    var View = Backbone.View.extend( {

        // The View Constructor
        initialize: function () {
            var self = this;
            _.bindAll(this, "render");
            self.form = new Backform.Form({
                el: "#troupe-new-form",
                model: new Troupe(),
                fields: [
                    {name: "id", label: "id", control: "uneditable-input"},
                    {name: "name", label: "Name", control: "input"},
                    {name: "shortname", label: "Short Name", control: "input"},
                    {name: "shortdescription", label: "Short Public Description", control: "input"},
                    {control: "spacer"},
                    {name: "description", label: "Long Public Description", control: "textarea"},
                    {control: "button", label: "Add New"},
                ],
                events: {
                    "submit": function (e) {
                        e.preventDefault();
                        var troupe;
                        $.mobile.loading("show");
                        this.model.save().then(function (t) {
                            console.log("Saved the troupe");
                            troupe = t;
                            var q = new Parse.Query(Parse.Role);
                            q.equalTo("name", "Administrator");
                            return q.first();
                        }).then(function (adminRole) {
                            var roleACL = new Parse.ACL();
                            roleACL.setPublicReadAccess(true);
                            roleACL.setPublicWriteAccess(false);
                            roleACL.setRoleReadAccess("Administrator", true);
                            roleACL.setRoleWriteAccess("Administrator", true);
                            var lst_role = new Parse.Role("LST_" + troupe.id, roleACL);
                            lst_role.getRoles().add(adminRole);

                            var ast_acl = new Parse.ACL();
                            ast_acl.setPublicReadAccess(true);
                            ast_acl.setPublicWriteAccess(false);
                            ast_acl.setRoleReadAccess("Administrator", true);
                            ast_acl.setRoleWriteAccess("Administrator", true);
                            ast_acl.setRoleReadAccess(lst_role, true);
                            ast_acl.setRoleWriteAccess(lst_role, true);
                            var ast_role = new Parse.Role("AST_" + troupe.id, ast_acl);
                            ast_role.getRoles().add(adminRole);

                            var nar_acl = new Parse.ACL();
                            nar_acl.setPublicReadAccess(true);
                            nar_acl.setPublicWriteAccess(false);
                            nar_acl.setRoleReadAccess("Administrator", true);
                            nar_acl.setRoleWriteAccess("Administrator", true);
                            nar_acl.setRoleReadAccess(lst_role, true);
                            nar_acl.setRoleWriteAccess(lst_role, true);
                            nar_acl.setRoleReadAccess(ast_role, true);
                            nar_acl.setRoleWriteAccess(ast_role, true);
                            var nar_role = new Parse.Role("Narrator_" + troupe.id, nar_acl);
                            nar_role.getRoles().add(adminRole);
                            return Parse.Object.saveAll([lst_role, ast_role, nar_role]);
                        }).then(function (saved_roles) {
                            console.log("Saved roles");
                            var lst_role = saved_roles[0],
                                ast_role = saved_roles[1],
                                nar_role = saved_roles[2];
                            ast_role.getRoles().add(lst_role);
                            nar_role.getRoles().add([lst_role, ast_role]);
                            return Parse.Object.saveAll([lst_role, ast_role, nar_role]);
                        }).then(function (saved_roles) {
                            var lst_role = saved_roles[0];
                            var acl = troupe.getACL();
                            acl.setRoleReadAccess(lst_role, true);
                            acl.setRoleWriteAccess(lst_role, true);
                            return troupe.save();
                        }).then(function (t) {
                            console.log("Saved troupe again");
                            window.location.hash = "#troupe/" + t.id;
                        }).fail(function(error) {
                            console.log("Failed to save troupe " + error.message);
                            window.location.hash = "#administration";
                        }).always(function () {
                            $.mobile.loading("hide");
                        })
                    }
                }
            });
        },

        // Renders all of the Category models on the UI
        render: function() {
            var self = this;

            // Sets the view's template property
            //this.template = _.template(player_options_html)();
            self.form.render();

            // Renders the view's template inside of the current div element
            //this.$el.find("div[role='main']").html(this.template);
            this.$el.enhanceWithin();

            // Maintains chainability
            return this;

        }

    } );

    // Returns the View class
    return View;

} );
