import { useState, type FormEvent } from 'react';
import { Page } from '@/jqm/Page';
import { Link } from '@/jqm/Controls';
import { useLogIn } from '@/parse/session';
import { navigate } from '@/router/router';
import type { ScreenProps } from './registry';
import yorickLogo from '@legacy-img/yorick_256.png';

/**
 * The login screen.
 *
 * Ports public/scripts/app/views/LoginView.js and the `#login-template`
 * block in index.html. Two things carried over deliberately:
 *
 * - The submit button is disabled while the request is in flight. The legacy
 *   view achieved this by calling `undelegateEvents()` and setting the
 *   `disabled` attribute; the effect is the same and the reason is the same,
 *   which is that a double submit produces two sessions.
 * - The error is the server's `error.message`, shown in `.login-form .error`.
 *   The Playwright suite fills `#login-username` / `#login-password` and clicks
 *   `#login form.login-form button`, so all three selectors are kept.
 *
 * The Facebook button is not carried over. Facebook login was removed rather
 * than migrated during the Parse 8 work -- see the comment in app/loadall.js --
 * and the button is already hidden in production.
 */
export function LoginScreen(_: ScreenProps) {
  const logIn = useLogIn();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await logIn(username, password);
      // The legacy view calls location.reload() here, because Backbone had no
      // way to re-run the guard that sent it to this screen. React re-renders
      // on the session change, so the route the user asked for appears by
      // itself -- unless they came in with no hash at all, in which case send
      // them to the start page as a reload would have.
      if (!window.location.hash) navigate('', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Page id="login" title="Log In" chrome={false}>
      <div className="login">
        <img className="max-yorick-sizing" src={yorickLogo} alt="" />
        <p>
          Welcome to Yorick, a character management system for{' '}
          <a href="http://www.undergroundtheater.org/">Underground Theater</a>.
        </p>
        <form className="login-form" onSubmit={onSubmit}>
          <h2>Log In</h2>
          {error !== null && <div className="error">{error}</div>}
          <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
            <input
              type="text"
              id="login-username"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
            <input
              type="password"
              id="login-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button className="ui-btn ui-shadow ui-corner-all" disabled={busy}>
            Log in with Username and Password
          </button>
        </form>
        <div>
          <Link href="#signup">Need an account? Sign up!</Link>
        </div>
        <div>
          <Link href="#reset">Forgot your password?</Link>
        </div>
        <div>
          <Link href="#about">About Yorick</Link>
        </div>
      </div>
    </Page>
  );
}
