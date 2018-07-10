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
            {name: "acceptedtos",
             label: "Participation in Underground Theater requires agreeing to the rules and regulations set forth by the organization and its board of directors. I agree to adhere to the rules and regulations of Underground Theater and its board of directors. I also acknowledge that I have read and agree to the rules and procedures set forth in the Patron Handbook.",
             control: "checkbox"},
        ]
    });

    return Form;
} );