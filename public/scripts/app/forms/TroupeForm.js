define([
    "jquery",
    "backbone",
    "backform"
], function( $, Backbone, Backform) {
    var Form = Backform.Form.extend({
        fields: [
            {name: "name", label: "Name", control: "input"},
            {name: "shortname", label: "Short Name", control: "input"},
            {name: "shortdescription", label: "Short Public Description", control: "input"},
            {name: "location", label: "Location", control: "input"},
            {name: "staffemail", label: "Staff Email Address", control: "input"},
            {control: "spacer"},
            {name: "description", label: "Long Public Description", control: "textarea"},
            {name: "proxypolicy", label: "Policies for Proxied Characters", control: "textarea"},
            //{control: "button", label: "Add New"},
        ]
    });

    return Form;
} );