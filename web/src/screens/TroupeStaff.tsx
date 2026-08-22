import { useEffect, useMemo, useState, type AnchorHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { cx, positionClass } from '@/jqm/classes';
import { SelectField, ButtonField, SpacerField } from '@/forms/Backform';
import { navigate } from '@/router/router';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { Parse } from '@/parse/init';
import { useSession } from '@/parse/session';
import { Troupe, TROUPE_TITLES, type TroupeTitle } from '@/parse/models/Troupe';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Picking an account, and then setting what that account is in a troupe.
 *
 * Three handlers, two pages. `administration_users` and `troupeaddstaff` both
 * render the `#troupe-add-staff` page from views/UsersView.js -- the same
 * account picker, arriving with different intent:
 *
 * | handler              | Back            | a row goes to                       | gate        |
 * |----------------------|-----------------|-------------------------------------|-------------|
 * | administration_users | #administration | #administration/user/<id>           | admin only  |
 * | troupeaddstaff       | #troupe/<id>    | #troupe/<tid>/staff/edit/<id>       | logged in   |
 *
 * That destination is the view's whole configuration: `register` takes an
 * underscore template for the click target and nothing else. So the picker is
 * one component here, parameterised by `hrefFor`, and the two handlers are the
 * two callers.
 *
 * `troupeeditstaff` is the second page: the form the picker leads to.
 */

/** The identity directory. `list_users` is the only way to enumerate accounts. */
interface Directory {
  /** "all" when the server was willing to list everyone, "self" when it was not. */
  scope: string;
  users: Parse.User[];
}

/**
 * Every account the server will name for this caller.
 *
 * `Parse.Cloud.run("list_users")`, exactly as collections/Users.js#fetch does,
 * and for the reason its comment gives: a client-side `_User` query cannot do
 * this any more. Under `enforcePrivateUsers` a new signup has no public read,
 * so the old sweep returned fewer people every week and said nothing about it.
 *
 * One cache for both handlers -- helpers/UserWreqr.js keeps one `Users`
 * collection shared by every screen that needs a name, so a second visit to the
 * picker made no second request. A query key is that, without the singleton.
 */
function useUserDirectory(enabled: boolean) {
  return useQuery({
    queryKey: ['users', 'directory'],
    enabled,
    queryFn: async () => (await Parse.Cloud.run('list_users')) as Directory,
  });
}

/**
 * collections/Users.js's comparator, dead branch and all.
 *
 * The live branch compares `paidOn`, and `list_users` returns four fields --
 * username, realname, massmailauthorization, acceptedtos (cloud/main.js:1139)
 * -- so `paidOn` is `undefined` on every row, `undefined > undefined` is false
 * both ways, and this returns 0 for every pair. `Array#sort` is stable, so the
 * order is the server's: `each` over `_User`, which is objectId order.
 *
 * The other branch is the `sortbycreated` one README.md documents as never
 * having run: five call sites in mobileRouter.js set the flag on a local array
 * while the comparator reads it off the collection, and `reset()` copies the
 * array's elements rather than its properties. It is reproduced rather than
 * removed because a port that also deletes code cannot be reviewed -- but note
 * that reproducing it faithfully means *not* sorting by createdAt.
 */
function directoryOrder(users: Parse.User[]): Parse.User[] {
  return [...users].sort((left, right) => {
    const l = left.get('paidOn');
    const r = right.get('paidOn');
    // `_.gt` / `_.lt` are bare `>` and `<`; on undefined both are false.
    return l > r ? 1 : l < r ? -1 : 0;
  });
}

/** What a row shows, which is also what jQM's filterable matches against. */
function rowText(user: Parse.User): string {
  return [user.get('username'), user.get('email'), user.get('realname')]
    .filter(Boolean)
    .join(' ');
}

/**
 * templates/choose-user.html: a filter box over a listview of accounts.
 *
 * Renders nothing until the directory answers. views/UsersView.js only calls
 * `render()` from the `then`, so the page is genuinely empty while the request
 * is in flight -- and on failure it stays empty apart from the message, because
 * the failure arm prepends the message and never renders the list.
 */
function UserPicker({ hrefFor, enabled = true }: { hrefFor: (id: string) => string; enabled?: boolean }) {
  const { data, isFetching, error } = useUserDirectory(enabled);
  const [filter, setFilter] = useState('');
  const [leaving, setLeaving] = useState(false);
  const { show, hide } = useLoading();

  // Both handlers bracket the route in $.mobile.loading("show") / ("hide"),
  // the hide in an `.always()` so a refusal does not strand the spinner.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // UsersView.clicked shows the spinner and then changes the hash without ever
  // hiding it: jQM's loader is one document-level element, so the destination
  // route's own `hide` clears it. React's is reference-counted, so an unpaired
  // show would stick forever. Hiding on unmount is the same thing to look at
  // and cannot leak. Same reasoning as TroupesList.
  useEffect(() => {
    if (!leaving) return;
    show();
    return hide;
  }, [leaving, show, hide]);

  const rows = useMemo(() => {
    const sorted = directoryOrder(data?.users ?? []);
    // jQM's filterable hides non-matches with `ui-screen-hidden` rather than
    // removing them, matching the row's whole text lowercased with no trimming
    // of what was typed, and then recomputes ui-first-child / ui-last-child
    // over the rows still visible.
    const needle = filter.toLowerCase();
    const shown = sorted.filter((u) => !needle || rowText(u).toLowerCase().includes(needle));
    const position = new Map(shown.map((u, i) => [u, positionClass(i, shown.length)]));
    return sorted.map((user) => ({
      user,
      hidden: !position.has(user),
      position: position.get(user) ?? '',
    }));
  }, [data, filter]);

  if (error) {
    // UsersView's failure arm. It replaced a bare `console.log`, which rendered
    // an empty picker and told the user nothing.
    return (
      <p className="message">
        The member list could not be loaded: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!data) return null;

  return (
    <>
      {/* Prepended by UsersView when the server served the "self" tier: a list
          of one is indistinguishable from a broken page unless it says so. */}
      {data.scope !== 'all' ? (
        <p className="message">
          Only storytellers and administrators can browse the full member list.
        </p>
      ) : null}
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
          <input
            id="filter-choose-user"
            data-type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <a
            href="#"
            tabIndex={-1}
            aria-hidden="true"
            title="Clear text"
            className={cx(
              'ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all',
              !filter && 'ui-input-clear-hidden',
            )}
            onClick={(e) => {
              e.preventDefault();
              setFilter('');
            }}
          >
            Clear text
          </a>
        </div>
      </form>
      <ul
        data-role="listview"
        data-filter="true"
        data-input="#filter-choose-user"
        className="ui-listview"
      >
        {rows.map(({ user, hidden, position }) => (
          <li key={user.id} className={cx(position, hidden && 'ui-screen-hidden')}>
            <a
              href="#"
              // `name` is `e.get('name')` in the template and `_User` has no
              // `name` field, so it has always been empty; `backendId` is what
              // the click handler reads the picked id back out of. Both kept,
              // lowercased -- HTML attribute names are case-insensitive, so the
              // DOM is identical and React does not warn.
              {...({ name: '', backendid: user.id } as AnchorHTMLAttributes<HTMLAnchorElement>)}
              className="ui-btn ui-btn-icon-right ui-icon-carat-r user-listing"
              onClick={(e) => {
                e.preventDefault();
                setLeaving(true);
                // `Parse.Object#id` is optional in the typings because an
                // unsaved object has none; every row here came back from the
                // server, so this is always set.
                navigate(hrefFor(user.id ?? ''));
              }}
            >
              {String(user.get('username') ?? '')} {String(user.get('email') ?? '')}{' '}
              {String(user.get('realname') ?? '')}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The administration account directory.
 *
 * @compare #administration/users/all
 */
export function AdministrationUsers(_: ScreenProps) {
  const session = useSession();
  useBackButton('#administration');

  // The handler's gate is `if (is_ad) { ...changePage }` with no else: a
  // non-admin gets no transition, no message and no redirect -- the app simply
  // stays on whatever page it was already showing while the hash changes
  // underneath it. React renders the screen the URL names, so the closest
  // reproduction is to render nothing at all. Deliberately not the
  // `enforce_admin` treatment AdministrationScreen gives #administration: that
  // handler reports and bounces, and this one does neither.
  if (session.loggedIn && !session.admin) return null;

  return (
    <Page id="troupe-add-staff" title="Add Staff">
      <UserPicker hrefFor={(id) => `#administration/user/${id}`} />
    </Page>
  );
}

/**
 * Pick somebody to put on a troupe's staff.
 *
 * The handler fetches the troupe before showing the picker and uses nothing
 * from it but `troupe.id`, which is the id it was already given. The fetch is
 * kept because its failure is load-bearing: a bad troupe id means the `.then`
 * never runs, so the picker is never shown.
 *
 * No `@compare` marker: the URL needs a real troupe id, and a hard-coded one
 * would fail for everyone the moment the database is reseeded. Checked by hand
 * with `npm run compare:dom -- "#troupe/<id>/staff/add"`.
 */
export function TroupeAddStaff({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  useBackButton(`#troupe/${id}`);
  const { show, hide } = useLoading();

  const troupe = useQuery({
    queryKey: ['troupe', id],
    enabled: !!id,
    queryFn: () => new Parse.Query(Troupe).get(id),
  });

  useEffect(() => {
    if (!troupe.isFetching) return;
    show();
    return hide;
  }, [troupe.isFetching, show, hide]);

  // The legacy chain has no failure handler at all here, so a troupe that
  // cannot be read leaves the user where they were with an unhandled rejection
  // in the console. Saying so is the one deliberate addition, as in TroupesList.
  useEffect(() => {
    if (troupe.error) showError(troupe.error, "Couldn't open that troupe");
  }, [troupe.error]);

  const found = troupe.data;
  return (
    <Page id="troupe-add-staff" title="Add Staff">
      {found ? <UserPicker hrefFor={(uid) => `#troupe/${found.id}/staff/edit/${uid}`} /> : null}
    </Page>
  );
}

/** One account, by id. helpers/UserWreqr.js#get_user, including its message. */
async function getUser(id: string): Promise<Parse.User> {
  const payload = (await Parse.Cloud.run('get_users_by_id', { ids: [id] })) as {
    users: Parse.User[];
  };
  const user = payload.users[0];
  if (!user) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'That account is not available to you.');
  }
  return user;
}

type Role = TroupeTitle | 'None';

/**
 * Backform's UneditableInputControl, which is its base `Control` unchanged
 * (backform.js:299) -- a `span.form-control.uneditable-input` in the grid's
 * right-hand column.
 *
 * Written here rather than in web/src/forms/Backform.tsx because that file is
 * shared and this is the first screen to need the control; see the summary.
 */
function UneditableField({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <div className={cx('form-group', name)}>
      <label className="control-label col-sm-4">{label}</label>
      <div className="col-sm-8">
        <span className="form-control uneditable-input">{value}</span>
      </div>
    </div>
  );
}

/**
 * Set one account's title in one troupe.
 *
 * Ports views/TroupeEditStaffView.js. Two things in it are load-bearing and
 * both are carried across:
 *
 * - The held title is read from `_Role` -- "which of this troupe's roles
 *   contains this user" -- and never by counting a title's `_User` relation.
 *   A relation query on `_User` is a `_User` find, refused outright now; and
 *   before it was refused it silently returned 0 for a row the caller cannot
 *   read, which displayed "Not on Staff" for a real storyteller and then
 *   stripped all three of their roles when the form was submitted unchanged.
 * - The title is picked in fixed LST, AST, Narrator order rather than in
 *   whichever order the answers arrived, so a user holding two titles in one
 *   troupe always shows the same one.
 *
 * No `@compare` marker: the URL needs a troupe id and a user id, and a
 * hard-coded pair would fail for everyone after a reseed. There is also a known
 * difference that a marker could not pass -- see the summary: jQuery Mobile
 * gives the enhanced `<select>`'s button div an id of `select-<counter>-button`
 * built from a global widget counter, and React's generated id is not that
 * string. Nothing else about the page differs.
 */
export function TroupeEditStaff({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  const uid = route.named['uid'] ?? '';
  useBackButton(`#troupe/${id}`);
  const { show, hide, track } = useLoading();
  const [picked, setPicked] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  const staff = useQuery({
    queryKey: ['troupe-staff-member', id, uid],
    enabled: !!id && !!uid,
    queryFn: async () => {
      // The handler's own pair, run together as `Parse.Promise.when` does.
      // `include("portrait")` is the handler's; this page never draws it, but
      // fetching it is what the legacy request does.
      const [troupe, user] = await Promise.all([
        new Parse.Query(Troupe).include('portrait').get(id),
        getUser(uid),
      ]);
      const names = TROUPE_TITLES.map((title) => `${title}_${troupe.id}`);
      const held = await new Parse.Query(Parse.Role)
        .containedIn('name', names)
        .equalTo('users', user)
        .find();
      const titles = held.map((role) => String(role.get('name')).split('_')[0]);
      const current: Role = TROUPE_TITLES.find((title) => titles.includes(title)) ?? 'None';
      return { troupe, user, current };
    },
  });

  useEffect(() => {
    if (!staff.isFetching) return;
    show();
    return hide;
  }, [staff.isFetching, show, hide]);

  // The legacy `.fail` here logs to the console and nothing else, so a user who
  // may not be named renders as a permanently empty form.
  useEffect(() => {
    if (staff.error) showError(staff.error, "Couldn't load that staff member");
  }, [staff.error]);

  const data = staff.data;
  const role: Role = picked ?? data?.current ?? 'None';

  async function onSubmit() {
    if (!data) return;
    // `_.xor(titles, [role])`: everything this troupe has a role for except the
    // one being granted. "None" grants nothing and therefore removes all three.
    const add: string[] = role === 'None' ? [] : [role];
    const remove = TROUPE_TITLES.filter((title) => !add.includes(title));
    setBusy(true);
    try {
      await track(
        Parse.Cloud.run('change_troupe_staff', {
          troupe_id: data.troupe.id,
          user_to_change_id: data.user.id,
          roles_to_add: add,
          roles_to_remove: remove,
        }),
      );
    } catch (error) {
      // The legacy pair is `.always(go to the troupe).fail(PromiseFailReport)`,
      // so the redirect happens either way and the report follows it. Reported
      // before navigating rather than after because the banner follows exactly
      // one navigation: raising it first is what lands it on the troupe page,
      // which is where the person will be reading.
      showError(error, "Couldn't change the troupe's staff");
    } finally {
      setBusy(false);
    }
    navigate(`troupe/${data.troupe.id}`);
  }

  return (
    <Page id="troupe-edit-staff" title="Edit Staff">
      <h1>Edit Staff</h1>
      {/* Not the shared `Form` component: Backform attaches to this element
          rather than creating it (`el: "#troupe-edit-staff-form"`, and index.html
          declares the empty form), and Backbone applies a view's `className`
          only to an element it created itself. So the legacy form carries no
          class, while `Form` always adds `profile-form`. */}
      <form
        id="troupe-edit-staff-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        {data ? (
          <>
            <UneditableField
              name="username"
              label="Username"
              value={String(data.user.get('username') ?? '')}
            />
            <UneditableField
              name="realname"
              label="Name"
              value={String(data.user.get('realname') ?? '')}
            />
            <SelectField
              name="role"
              label="Role"
              value={role}
              onChange={(next) => setPicked(next as Role)}
              options={[
                { label: 'Lead Storyteller', value: 'LST' },
                { label: 'Assistant Storyteller', value: 'AST' },
                { label: 'Narrator', value: 'Narrator' },
                { label: 'Not on Staff', value: 'None' },
              ]}
            />
            {/* Both fields are declared without a `name` in the view, and
                Backform's `addClass(field.name)` on an empty string adds
                nothing -- so the group is a bare `form-group`. */}
            <SpacerField name="" />
            <ButtonField name="" label="Save" disabled={busy} />
          </>
        ) : null}
      </form>
    </Page>
  );
}

registerScreen('administration_users', AdministrationUsers);
registerScreen('troupeaddstaff', TroupeAddStaff);
registerScreen('troupeeditstaff', TroupeEditStaff);
