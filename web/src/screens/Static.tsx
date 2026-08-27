import { useState } from 'react';
import { Page } from '@/jqm/Page';
import { Link } from '@/jqm/Controls';
import { Form, InputField, ButtonField } from '@/forms/Backform';
import { Parse } from '@/parse/init';
import { useLoading } from '@/jqm/Loader';
import { registerScreen, type ScreenProps } from './registry';
import privacyPolicyHtml from '@legacy-img/scripts/app/templates/privacy-policy.html?raw';

/**
 * The About page, from the `#about` block in public/index.html.
 *
 * @compare #about
 */
export function AboutScreen(_: ScreenProps) {
  return (
    <Page id="about" title="About">
      <p>
        <a href="https://github.com/gnu-lorien/yorick">Yorick</a> is a troupe and character
        management application designed to support role-playing game systems published by{' '}
        <a href="http://www.bynightstudios.com/">By Night Studios</a>.
      </p>
      <p>
        This website is primarily maintained for usage by the non-profit{' '}
        <a href="http://www.undergroundtheater.org/">Underground Theater</a>.
      </p>
      <p>
        <a href="https://github.com/gnu-lorien/yorick">Yorick</a> is an open-source project that
        anybody may contribute to. It is licensed under the AGPLv3.
      </p>
      <p>
        Real-time analytics and error reported is provided by{' '}
        <a href="https://trackjs.com/">Track JS</a>.
      </p>
      <p>
        Some icons are provided by <a href="http://game-icons.net/">Game-icons.net</a> under the
        terms of the <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a> license.
      </p>
      <p>
        <Link href="#">Return to Login</Link>
      </p>
    </Page>
  );
}

/**
 * The privacy notice.
 *
 * Ports views/PrivacyPolicyView.js, which does nothing but drop that template
 * into the page.
 *
 * The text is imported from templates/privacy-policy.html rather than
 * transcribed into JSX. It is a legal notice with an effective date on it, and
 * two copies of it in one repository is how they end up disagreeing. The file
 * contains no template interpolation -- the legacy view runs it through
 * `_.template()` with no data -- so it is static markup either way.
 *
 * @compare #privacy
 */
export function PrivacyPolicyScreen(_: ScreenProps) {
  return <Page id="privacy" title="Privacy Policy" contentHtml={privacyPolicyHtml} />;
}

/**
 * Request a password-reset email.
 *
 * Ports views/PasswordReset.js, field for field: an email input and a submit
 * button, both Backform controls, so they use the Backform components rather
 * than the plain jQM ones -- the two produce different markup and only one of
 * them lays the label out beside the field.
 *
 * Both outcomes are reported through the button's own status line, as the
 * original does with `set({status, message})`. Note that success says the mail
 * was sent without revealing whether the address exists.
 *
 * @compare #reset
 */
export function PasswordResetScreen(_: ScreenProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { track } = useLoading();

  async function onSubmit() {
    setBusy(true);
    setStatus(null);
    try {
      await track(Parse.User.requestPasswordReset(email));
      setStatus({ kind: 'success', message: 'Password Reset Email Sent' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page id="user-reset-password" title="Reset Password" chrome={false}>
      {/* The one form in the app that carries `profile-form`. It is written
          into index.html's #user-reset-password block, and PasswordReset.js
          uses it as the selector for the element it renders into. Every other
          Backform form is a bare <form>. */}
      <Form className="profile-form" onSubmit={onSubmit}>
        <InputField
          name="email"
          type="email"
          label="Email Address for the Account"
          value={email}
          onChange={setEmail}
        />
        <ButtonField
          name="reset"
          label="Reset Password"
          extraClasses={['reset-user-password']}
          disabled={busy}
          status={status?.kind}
          message={status?.message}
        />
      </Form>
    </Page>
  );
}

registerScreen('about', AboutScreen);
registerScreen('privacy_policy', PrivacyPolicyScreen);
registerScreen('resetpassword', PasswordResetScreen);
