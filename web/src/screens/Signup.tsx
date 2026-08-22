import { useEffect, useState, type FormEvent } from 'react';
import { Page } from '@/jqm/Page';
import { Parse } from '@/parse/init';
import { sessionChanged, useSession } from '@/parse/session';
import { navigate } from '@/router/router';
import { registerScreen, type ScreenProps } from './registry';
import yorickLogo from '@legacy-img/yorick_256.png';

/**
 * Sign up for an account.
 *
 * Ports views/SignupView.js and the `#signup-template` block in index.html.
 * The "Sign up with Facebook" button is dropped for the same reason as the
 * login one: Facebook auth was removed during the Parse 8 migration.
 *
 * Note that signUp logs the new user in as a side effect, which is why this
 * navigates to the start page rather than back to the login screen.
 *
 * @compare #signup
 */
export function SignupScreen(_: ScreenProps) {
  const session = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in: go home. The legacy handler does exactly this --
  // `if (!Parse.User.current()) { changePage("#signup") } else { hash = "" }`
  // -- so an authenticated user cannot land on the signup form at all.
  useEffect(() => {
    if (session.loggedIn) navigate('', { replace: true });
  }, [session.loggedIn]);
  if (session.loggedIn) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = new Parse.User();
      user.set('username', username);
      user.set('password', password);
      await user.signUp();
      sessionChanged();
      navigate('', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Page id="signup" title="Sign Up" chrome={false}>
      <div className="signup">
        <img className="max-yorick-sizing" src={yorickLogo} alt="" />
        Sign up for Yorick.
        <form className="signup-form" onSubmit={onSubmit}>
          <h2>Sign Up</h2>
          {error !== null && <div className="error">{error}</div>}
          <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
            <input
              type="text"
              id="signup-username"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
            <input
              type="password"
              id="signup-password"
              placeholder="Create a Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <button className="ui-btn ui-shadow ui-corner-all" disabled={busy}>
            Sign Up
          </button>
        </form>
      </div>
    </Page>
  );
}

registerScreen('signup', SignupScreen);
