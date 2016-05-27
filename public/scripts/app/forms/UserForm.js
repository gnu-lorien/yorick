define([
    "jquery",
    "backbone",
    "backform"
], function( $, Backbone, Backform) {
    var Form = Backform.Form.extend({
        fields: [
            {name: "realname", label: "Real Name", control: "input"},
            {name: "email", label: "Email", control: "input", type: "email"},
            {name: "username", label: "User Name", control: "input"},
            {name: "massmailauthorization", label: "I authorize Underground Theater to contact me using this email address", control: "checkbox"},
        ]
    });

    return Form;
} );