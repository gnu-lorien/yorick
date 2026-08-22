import { cx } from './classes';

/**
 * The fixed header and footer, and the role-dependent navbar inside the footer.
 *
 * In the legacy app these live in `index.html` outside every page, are hidden
 * until a user is logged in (`pagecreate` in app/main.js), and the footer's
 * contents are re-rendered from `templates/footer.html` whenever the user
 * changes. The header's `<h1>` tracked the active page's `data-title`, and the
 * navbar's active tab was found by matching that title against the tab labels.
 *
 * All of that becomes props here.
 */

export interface NavTab {
  label: string;
  href: string;
}

/**
 * The navbar tabs for a user, exactly as templates/footer.html chooses them.
 *
 * Note that the ordering matters: `admininterface` wins over
 * `storytellerinterface`, so an admin who is also a storyteller gets the
 * four-tab bar.
 */
export function navTabsFor(user: { admin: boolean; storyteller: boolean } | null): NavTab[] {
  if (!user) return [];
  const characters = { label: 'Characters', href: '#characters?all' };
  const profile = { label: 'Profile', href: '#profile' };
  const troupes = { label: 'Troupes', href: '#troupes' };
  if (user.admin) {
    return [characters, profile, { label: 'Administration', href: '#administration' }, troupes];
  }
  if (user.storyteller) return [characters, profile, troupes];
  return [characters, profile];
}

/** jQM's grid class for an n-column navbar: 2 -> ui-grid-a, 3 -> b, 4 -> c. */
function gridClass(count: number): string {
  return `ui-grid-${String.fromCharCode('a'.charCodeAt(0) + Math.max(0, count - 2))}`;
}

/** jQM's per-cell class: index 0 -> ui-block-a, 1 -> ui-block-b, ... */
function blockClass(index: number): string {
  return `ui-block-${String.fromCharCode('a'.charCodeAt(0) + index)}`;
}

export function Navbar({ tabs, activeLabel }: { tabs: NavTab[]; activeLabel?: string }) {
  return (
    <div data-role="navbar" className="ui-navbar" role="navigation">
      <ul className={gridClass(tabs.length)}>
        {tabs.map((tab, i) => (
          <li key={tab.href} className={blockClass(i)}>
            <a className={cx('ui-btn', tab.label === activeLabel && 'ui-btn-active')} href={tab.href}>
              {tab.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface HeaderProps {
  /** The active page's title. jQM read this from the page's `data-title`. */
  title: string;
  /** The logged-in username, which the log-out button's label includes. */
  username?: string;
  /**
   * Where Back goes, when the screen has an opinion.
   *
   * The legacy router sets this per route with `set_back_button(url)`, which
   * rewrites `#header-back-button`'s href -- so Back is a destination the
   * screen chooses, not browser history. Screens declare it with
   * `useBackButton()`; see shell/backButton.ts for why the two differ.
   *
   * Without one, Back falls back to `history.back()`.
   */
  backHref?: string;
  onBack?: () => void;
  onLogout?: () => void;
}

export function Header({ title, username, backHref, onBack, onLogout }: HeaderProps) {
  return (
    <div
      data-role="header"
      data-position="fixed"
      data-theme="a"
      role="banner"
      className="ui-header ui-bar-a ui-header-fixed slidedown"
    >
      <a
        href={backHref ?? '#'}
        id="header-back-button"
        data-rel="back"
        role="button"
        className="ui-btn-left ui-link ui-btn ui-icon-arrow-l ui-btn-icon-left ui-shadow ui-corner-all"
        onClick={(e) => {
          if (onBack) {
            e.preventDefault();
            onBack();
            return;
          }
          // With a declared target the href does the work, as it does in the
          // legacy app. Only the default -- a bare "#" -- needs intercepting,
          // because following it would go to the start page rather than back.
          if (!backHref) {
            e.preventDefault();
            window.history.back();
          }
        }}
      >
        Back
      </a>
      <a
        href="#logout"
        id="header-logout-button"
        role="button"
        className="ui-btn-right ui-link ui-btn ui-icon-minus ui-btn-icon-right ui-shadow ui-corner-all"
        onClick={(e) => {
          if (onLogout) {
            e.preventDefault();
            onLogout();
          }
        }}
      >
        {username ? `Log Out ${username}` : 'Log Out'}
      </a>
      <h1 className="ui-title" role="heading" aria-level={1}>
        {title}
      </h1>
    </div>
  );
}

export function Footer({ tabs, activeLabel }: { tabs: NavTab[]; activeLabel?: string }) {
  return (
    <div
      data-role="footer"
      data-position="fixed"
      data-theme="a"
      role="contentinfo"
      className="ui-footer ui-bar-a ui-footer-fixed slideup"
    >
      <Navbar tabs={tabs} activeLabel={activeLabel} />
    </div>
  );
}
