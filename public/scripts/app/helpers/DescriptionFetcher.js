define([
    "jquery",
    "underscore",
    "parse",
    "../models/Description",
    "../collections/DescriptionCollection"
], function( $, _, Parse, Description, DescriptionCollection ) {

    var descriptions = {};
    var collection_for_category = function(category) {
        var collection = _.get(descriptions, category, new DescriptionCollection);
        collection.query = (new Parse.Query(Description)).equalTo("category", category);
        descriptions[category] = collection;
        return collection;
    };

    return collection_for_category;
} );
