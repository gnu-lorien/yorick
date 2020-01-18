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
            {name: "massmailauthorization", label: "I authorize After Twilight to contact me using this email address", control: "checkbox"},
            {name: "acceptedtos",
             label: "Participation in After Twilight requires agreeing to the rules and regulations set forth by the organization and its board of directors. I agree to adhere to the rules and regulations of Niktuku Twilight.",
             control: "checkbox"},
        ]
    });

    return Form;
} );