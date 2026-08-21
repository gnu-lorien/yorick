// Shared error reporting
// ======================
//
// The application's long-standing habit is to swallow its own failures - a
// bare `.fail(console.log)`, or no failure handler at all - so a save that
// 404s looks exactly like a save that worked. `PromiseFailReport` logs and
// reports to trackJs, but it renders nothing: a user cannot tell success from
// failure, and neither can a developer reading the screen.
//
// This module is the one place that puts a failure *where the user is
// looking*. It renders an inline `.error` banner into the active jQuery
// Mobile page.
//
// Following the navigation matters. Several failure handlers surface the
// error and then redirect (`SimpleTraitSpecializationView.save_clicked`, for
// one), so a banner pinned to the page the user is leaving would never be
// read. The banner therefore follows exactly one page change - the one the
// failure itself triggers - and is then cleared by the next navigation the
// user makes, or by clicking it.
define([
    "jquery",
    "underscore",
    "parse"
], function ($, _, Parse) {

    var REGION_ID = "global-error-region";

    // Where we are in the "follow the redirect" dance:
    //   "idle"   - nothing showing
    //   "follow" - showing, and the next page change should carry it along
    //   "settle" - showing on its final page; the next page change clears it
    var phase = "idle";

    // The page element the banner is currently rendered into.
    var showing_on = null;

    var message_for = function (error) {
        if (_.isUndefined(error) || _.isNull(error)) {
            return "An unknown error occurred.";
        }
        if (_.isString(error)) {
            return error;
        }
        if (_.isArray(error)) {
            return _(error).map(message_for).uniq().value().join("; ");
        }
        if (error.message) {
            return error.message;
        }
        if (error.error) {
            return "" + error.error;
        }
        try {
            return JSON.stringify(error);
        } catch (e) {
            return "" + error;
        }
    };

    var active_page = function () {
        if ($.mobile && $.mobile.activePage && $.mobile.activePage.length) {
            return $.mobile.activePage;
        }
        return $(".ui-page-active").first();
    };

    var attach = function () {
        var $region = $("#" + REGION_ID);
        if (0 === $region.length) {
            return $region;
        }
        var $page = active_page();
        if (0 === $page.length) {
            $page = $("body");
        }
        var $main = $page.find("div[role='main']").first();
        ($main.length ? $main : $page).prepend($region.detach());
        showing_on = $page[0];
        return $region;
    };

    var clear = function () {
        phase = "idle";
        showing_on = null;
        $(document).off(".reporterror");
        $("#" + REGION_ID).remove();
    };

    var on_page_change = function () {
        // jQuery Mobile fires both `pagecontainershow` and a bubbling
        // `pageshow` for a single transition; keying off the page element
        // rather than the event count keeps one navigation from counting
        // twice and clearing the banner the user was meant to read.
        var $page = active_page();
        if (0 === $page.length || $page[0] === showing_on) {
            return;
        }
        if ("follow" == phase) {
            // The redirect the failure itself triggered. Carry the banner to
            // wherever the user actually landed, then wait there.
            phase = "settle";
            attach();
            return;
        }
        clear();
    };

    // `error` is a Parse.Error, an exception, an array of either, or a string.
    // `context` names what was being attempted, so the message reads as
    // "Couldn't save the rule: ..." rather than a bare Parse message.
    var report = function (error, context) {
        if (error && Parse.Error.USERNAME_MISSING === error.code) {
            // "Not logged in" - `enforce_logged_in` has already put the user
            // on the login page, which says everything a banner would.
            // `PromiseFailReport` skips this code for the same reason.
            return Parse.Promise.error(error);
        }
        var message = message_for(error);
        var full = context ? (context + ": " + message) : message;

        console.error("ReportError " + full, error);
        try {
            if (!_.isUndefined(trackJs)) {
                trackJs.console.error("ReportError " + full);
            }
        } catch (e) {
            // trackJs is optional; never let reporting an error throw one.
        }

        $("#" + REGION_ID).remove();
        $(document).off(".reporterror");

        var $region = $('<div></div>')
            .attr("id", REGION_ID)
            .attr("role", "alert")
            .addClass("error ui-body ui-body-a")
            .css({
                "margin": "0.5em 0",
                "padding": "0.5em",
                "border": "1px solid #b00",
                "color": "#b00",
                "cursor": "pointer"
            })
            .text(full)
            .on("click", clear);

        $("body").append($region);
        attach();

        phase = "follow";
        $(document).on("pagecontainershow.reporterror pageshow.reporterror", on_page_change);

        // Keep the chain rejected. A `.fail()` handler that returns a plain
        // value resolves the promise, which is exactly how
        // `.fail(PromiseFailReport).fail(hide_the_loader)` ends up never
        // hiding the loader.
        return Parse.Promise.error(error);
    };

    // Handy as a bare promise handler: `.fail(ReportError.on("Couldn't save"))`
    report.on = function (context) {
        return function (error) {
            return report(error, context);
        };
    };

    report.clear = clear;
    report.region_id = REGION_ID;

    return report;
});
