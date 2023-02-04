define([
	"jquery",
	"parse"
], function( $, Parse ) {

    var Model = Parse.Object.extend( "Referendum", {
        get_thumbnail: function (size) {
            var self = this;
            if (self.get("portrait")) {
                var portrait = self.get("portrait");
                return portrait.fetch().then(function (portrait) {
                    console.log(self.get_thumbnail_sync(size));
                    return Parse.Promise.as(portrait.get("thumb_" + size).url());
                });
            } else {
                return Parse.Promise.as("head_skull.png");
            }
        },

        get_thumbnail_sync: function (size) {
            var self = this;
            return _.result(self, "attributes.portrait.attributes.thumb_" + size + ".url", "head_skull.png");
        }
    } );

    return Model;

} );