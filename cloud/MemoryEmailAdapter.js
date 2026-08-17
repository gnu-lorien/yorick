/**
 * An email adapter that captures mail instead of sending it.
 *
 * Parse Server refuses `requestPasswordReset` and email verification outright
 * unless an `appName`, a `publicServerURL` *and* an `emailAdapter` are all
 * configured - it rejects with "An appName, publicServerURL, and emailAdapter
 * are required for password reset and email verification functionality." This
 * deployment has the first two and had no adapter at all, so the password-reset
 * button was wired correctly end to end and could never succeed (remediation
 * R51).
 *
 * Supplying a *real* provider is a deployment decision with credentials
 * attached, and the ruling on R51 is explicit that the test suite must never
 * send real email. So this is the default: the feature works, the message body
 * is retained in memory so it can be asserted against, and nothing leaves the
 * process. Point `MAIL_ADAPTER_MODULE` at a real adapter to actually send.
 *
 * The captured bodies contain live password-reset links, which is why
 * `get_captured_emails` (cloud/main.js) both exists only while this adapter is
 * in use and is restricted to administrators even then.
 */
module.exports = function MemoryEmailAdapter(options) {
    options = options || {};
    var limit = options.limit || 100;
    var sent = [];

    return {
        /**
         * Parse Server calls this with `{to, subject, text}`. Returning a
         * resolved promise is what tells it the send succeeded.
         */
        sendMail: function (mail) {
            mail = mail || {};
            sent.push({
                to: mail.to,
                subject: mail.subject,
                text: mail.text,
                sentAt: new Date()
            });
            // Keep the buffer bounded; a long-lived server should not grow one
            // entry per password reset forever.
            if (sent.length > limit) {
                sent.splice(0, sent.length - limit);
            }
            console.log("[MemoryEmailAdapter] captured mail to " + mail.to +
                " - \"" + mail.subject + "\" (not sent)");
            return Promise.resolve();
        },

        /** Newest last. Callers must treat the bodies as secrets. */
        captured: function () {
            return sent.slice();
        },

        clear: function () {
            sent.length = 0;
        }
    };
};
