// Includes File Dependencies
require([
    "jquery",
    "parse",
], function ( $, Parse) {

    $( document ).on( "mobileinit",

        // Set up the "mobileinit" handler before requiring jQuery Mobile's module
        function () {

            // Prevents all anchor click handling including the addition of active button state and alternate link bluring.
            $.mobile.linkBindingEnabled = false;

            // Disabling this will prevent jQuery Mobile from handling hash changes
            $.mobile.hashListeningEnabled = false;

            $( "[data-role='navbar']" ).navbar();
            $( "[data-role='header'], [data-role='footer']" ).toolbar();
        }
    )

    $( document ).on( "pagecreate", function() {
        $("#splashscreen").remove();
        if (Parse.applicationId && Parse.User.current()) {
            $( "[data-role='navbar']" ).show();
            $( "[data-role='header'], [data-role='footer']" ).show();
        } else {
            $( "[data-role='navbar']" ).hide();
            $( "[data-role='header'], [data-role='footer']" ).hide();
        }
    });

    $( document ).on( "pagecontainertransition", function() {
        if (Parse.applicationId && Parse.User.current()) {
            var current = $(".ui-page-active").jqmData("title");
            // Change the heading
            $("[data-role='header'] h1").text(current);
            // Remove active class from nav buttons
            $("[data-role='navbar'] a.ui-btn-active").removeClass("ui-btn-active");
            // Add active class to current nav button
            $("[data-role='navbar'] a").each(function () {
                if ($(this).text() === current) {
                    $(this).addClass("ui-btn-active");
                }
            });
        }
    });

});
