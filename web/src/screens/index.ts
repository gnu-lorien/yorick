import { registerScreen } from './registry';
import { LoginScreen } from './Login';
import { SignupScreen } from './Signup';
import { AboutScreen, PrivacyPolicyScreen, PasswordResetScreen } from './Static';
import { PlayerOptions } from './PlayerOptions';
import { CharactersList } from './CharactersList';

/**
 * Every ported screen, registered under its legacy handler name.
 *
 * Importing this module is what wires the routes up; App.tsx does it once. A
 * handler missing from here renders the "not migrated yet" placeholder, so this
 * list is the migration's progress bar -- `npm run migration:status` counts it.
 */

registerScreen('home', PlayerOptions);
registerScreen('signup', SignupScreen);
registerScreen('about', AboutScreen);
registerScreen('privacy_policy', PrivacyPolicyScreen);
registerScreen('resetpassword', PasswordResetScreen);
registerScreen('characters', CharactersList);

// `login` is not in the route table -- the legacy app reaches the login page
// through `enforce_logged_in` rather than a URL -- so App.tsx renders it
// directly. Registered anyway so the status report counts it as done.
registerScreen('__login', LoginScreen);
