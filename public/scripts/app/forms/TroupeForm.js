define([
    "jquery",
    "backbone",
    "backform",
    "../models/Troupe"
], function( $, Backbone, Backform, Troupe) {
    var Form = Backform.Form.extend({
        fields: [
            {name: "name", label: "Name", control: "input"},
            {name: "shortname", label: "Short Name", control: "input"},
            {name: "shortdescription", label: "Short Public Description", control: "input"},
            {name: "location", label: "Location", control: "input"},
            {control: "spacer"},
            {name: "description", label: "Long Public Description", control: "textarea"},
            //{control: "button", label: "Add New"},
        ]
    });

    return Form;
} );