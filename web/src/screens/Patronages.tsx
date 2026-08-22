import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { cx, positionClass } from '@/jqm/classes';
import { SelectField, InputField, ButtonField, type SelectOption } from '@/forms/Backform';
import { navigate } from '@/router/router';
import { useSession } from '@/parse/session';
import { showError } from '@/shell/reportError';
import { useBackButton } from '@/shell/backButton';
import { Parse } from '@/parse/init';
import {
  Patronage,
  patronagesQuery,
  sortPatronages,
  formatPatronageDate,
  parsePatronageDate,
  listUsers,
  getUserById,
  userLabel,
} from '@/parse/models/Patronage';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Every patronage screen: the admin listing, its CSV twin, the per-user
 * listing, and the one form that serves the detail, new and self-service
 * routes.
 *
 * Ports views/PatronagesView.js, views/PatronageListView.js,
 * views/PatronagesCSVView.js, views/PatronageCSVListView.js,
 * views/PatronageView.js, collections/Patronages.js,
 * templates/patronage-list-item.html and templates/patronage-list-item-csv.html,
 * inside the four `#administration-patronage*` page blocks in public/index.html.
 *
 * One thing runs through all of them: **a patronage row's owner is a bare
 * pointer.** The collection's query does not `include("owner")`, so the row
 * knows an objectId and nothing else, and every template resolves the name
 * through the account directory (`list_users`) instead. That is not an
 * oversight -- an `include` of an account the caller may not read is refused
 * outright, which would take the whole listing down rather than one row's name.
 * A pointer the directory cannot resolve renders as "<objectId> User object
 * missing", which is the legacy string and worth keeping: it names the id, so
 * an admin can act on it.
 */

/* ------------------------------------------------------------------ data -- */

/** The whole Patronage class, ordered as collections/Patronages.js orders it. */
function usePatronages() {
  return useQuery({
    queryKey: ['patronages'],
    queryFn: async () => {
      const found: Patronage[] = [];
      // `each`, not `find`: collections/Patronages.js pages the class, and a
      // `find` would cap at 100 and quietly lose most of the records.
      await patronagesQuery().each((patronage) => {
        found.push(patronage);
      });
      return sortPatronages(found);
    },
  });
}

/**
 * The account directory, as `UserChannel.get_users()` loads it, and a lookup
 * over it.
 *
 * `load` is which of the two behaviours a route has. Most patronage routes ask
 * for the directory in the same `Parse.Promise.when` as the patronages, so the
 * names are there when the rows render. `administration_user_patronages` does
 * not -- it fetches the one account it names in its heading and never populates
 * the registry -- so its rows read "<objectId> User object missing" on a fresh
 * load, and resolve only if some earlier route in the same session happened to
 * fill the registry first. Passing `load: false` reproduces that exactly:
 * whatever the cache already holds is used, and nothing is fetched.
 */
function useUserLookup(load: boolean) {
  const directory = useQuery({
    queryKey: ['users', 'directory'],
    queryFn: listUsers,
    enabled: load,
  });

  const lookup = useMemo(() => {
    const byId = new Map((directory.data?.users ?? []).map((u) => [u.id, u]));
    return (id: string | undefined): Parse.User | undefined => {
      if (!id) return undefined;
      // UserWreqr answers the caller's own id from `Parse.User.current()`
      // before consulting the directory, and says why: parse-server always
      // grants the caller read on their own row, so #profile's patronage rows
      // resolve with no directory call at all. Without it every paying member
      // would see "User object missing" on their own profile.
      const current = Parse.User.current();
      if (current && current.id === id) return current;
      return byId.get(id);
    };
  }, [directory.data]);

  return { lookup, directory };
}

/** Raise the spinner while a route's fetches are in flight, and always drop it. */
function useSpinnerWhile(busy: boolean) {
  const { show, hide } = useLoading();
  useEffect(() => {
    if (!busy) return;
    show();
    return hide;
  }, [busy, show, hide]);
}

/* ------------------------------------------------------------- list rows -- */

/**
 * One row of the admin listing, from templates/patronage-list-item.html.
 *
 * The anchor's `ui-btn ui-btn-icon-right ui-icon-carat-r` is written into the
 * template by hand rather than added by jQuery Mobile's listview enhancement,
 * so it is written out here too -- the enhancer leaves an anchor that already
 * has `ui-btn` alone, and the two paths happen to agree.
 */
function PatronageRow({
  patronage,
  user,
  href,
  position,
  hidden,
}: {
  patronage: Patronage;
  user: Parse.User | undefined;
  href: string;
  position: string;
  hidden: boolean;
}) {
  // `owner.objectId` in the template, straight off the serialized model. A
  // patronage with no owner at all throws there and takes the whole listing
  // down with it; this renders the same "User object missing" line an
  // unresolvable owner gets, which is the closest thing to the intent.
  const ownerId = patronage.ownerId ?? '';
  return (
    <li className={cx(position, hidden && 'ui-screen-hidden')}>
      <a href={href} className="ui-btn ui-btn-icon-right ui-icon-carat-r">
        <h2>
          {user ? `${ownerId} ${userLabel(user, 'interpolate')}` : `${ownerId} User object missing`}
        </h2>
        <p>paidOn: {formatPatronageDate(patronage.paidOn)}</p>
        <p>expiresOn: {formatPatronageDate(patronage.expiresOn)}</p>
        <p>{patronage.status()}</p>
      </a>
    </li>
  );
}

/** What jQM's filterable matches a row against: the row's whole text. */
function rowText(patronage: Patronage, user: Parse.User | undefined): string {
  const ownerId = patronage.ownerId ?? '';
  return [
    ownerId,
    user ? userLabel(user, 'interpolate') : 'User object missing',
    `paidOn: ${formatPatronageDate(patronage.paidOn)}`,
    `expiresOn: ${formatPatronageDate(patronage.expiresOn)}`,
    patronage.status(),
  ].join(' ');
}

/**
 * One row of the CSV listing, from templates/patronage-list-item-csv.html.
 *
 * The line breaks and the four-space indent are the template's own, produced by
 * the whitespace either side of its `<% %>` blocks -- so a row is *not* one CSV
 * line, it is five. That is what the page has always emitted and what anyone
 * copying it out of the browser gets; test 06 of e2e/admin-patronage.spec.js
 * matches on the quoted fields rather than on line shape for exactly that
 * reason.
 *
 * The `li` carries `ui-li-static ui-body-inherit` because it holds no anchor,
 * which is jQuery Mobile's classification for a row that is text only.
 */
function csvRowText(patronage: Patronage, user: Parse.User | undefined): string {
  const ownerId = patronage.ownerId ?? '';
  const identity = user
    ? `    "${ownerId}","${user.get('username') ?? ''}","${user.get('realname') ?? ''}","${
        user.get('email') ?? ''
      }",`
    : `    "","","","",`;
  return [
    '',
    identity,
    '',
    `"${formatPatronageDate(patronage.paidOn)}",`,
    `"${formatPatronageDate(patronage.expiresOn)}",`,
    `"${patronage.status()}"`,
  ].join('\n');
}

/* ----------------------------------------------------------- the screens -- */

/**
 * The admin patronage listing.
 *
 * Ports the `administration_patronages` handler and the
 * `#administration-patronages-view` block in index.html -- the "Add New
 * Patronage" list and the filter box above the listview are that block's own
 * scaffolding, so they are part of the DOM this has to reproduce.
 *
 * The gate is `enforce_logged_in()` followed by a bare `if (is_ad)` with no
 * else, so a non-admin's route simply never calls `changePage` and the legacy
 * app leaves them looking at whatever page they were already on, with no
 * message. React has already left that page by the time this renders, so the
 * closest available behaviour is to render nothing. Unlike the detail routes
 * below -- which use `enforce_admin` and do explain themselves -- there is
 * deliberately no error banner and no bounce here, because the original raises
 * neither.
 *
 * @compare #administration/patronages
 */
export function PatronagesListScreen(_: ScreenProps) {
  const session = useSession();
  const patronages = usePatronages();
  const { lookup, directory } = useUserLookup(true);
  const [filter, setFilter] = useState('');

  useBackButton('#administration');
  useSpinnerWhile(patronages.isFetching || directory.isFetching);

  const rows = useMemo(() => {
    const all = patronages.data ?? [];
    // jQuery Mobile's filterable lowercases the row's whole text and hides
    // non-matches with `ui-screen-hidden` rather than removing them; the
    // first/last-child classes are then recomputed over the visible rows only,
    // which is what keeps an inset list's corners rounded while filtering.
    const needle = filter.toLowerCase();
    const shown = all.filter((p) => !needle || rowText(p, lookup(p.ownerId)).toLowerCase().includes(needle));
    const position = new Map(shown.map((p, i) => [p, positionClass(i, shown.length)]));
    return all.map((patronage) => ({
      patronage,
      hidden: !position.has(patronage),
      position: position.get(patronage) ?? '',
    }));
  }, [patronages.data, lookup, filter]);

  if (session.loggedIn && !session.admin) return null;

  return (
    <Page id="administration-patronages-view" title="Patronages">
      <ul>
        <li>
          <a href="#administration/patronages/new">Add New Patronage</a>
        </li>
      </ul>
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
          <input
            id="patronages-filter"
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
        id="administration-patronages-view-list"
        data-role="listview"
        data-inset="true"
        data-filter="true"
        data-input="#patronages-filter"
        className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        {rows.map(({ patronage, hidden, position }) => (
          <PatronageRow
            key={patronage.id}
            patronage={patronage}
            user={lookup(patronage.ownerId)}
            // `back_url_base` is the same string on both listings; nothing in
            // the app passes another one.
            href={`#administration/patronage/${patronage.id}`}
            position={position}
            hidden={hidden}
          />
        ))}
      </ul>
    </Page>
  );
}

/**
 * The same records, rendered as pasteable CSV.
 *
 * Ports `administration_patronages_csv` and the
 * `#administration-patronages-view-csv` block in index.html.
 *
 * The listview declares `data-filter="true" data-input="#patronages-filter"`,
 * pointing at an input that lives on the *other* patronages page. In the legacy
 * app all 59 pages sit in one document, so this binds to a search box the user
 * cannot see from here and the CSV page has no filter of its own; in React only
 * the active page is rendered, so the selector matches nothing and the filter is
 * simply inert. The attributes are kept because they are part of the markup, but
 * there is no filter state here -- there was never a visible filter on this page.
 *
 * @compare #administration/patronagescsv
 */
export function PatronagesCSVScreen(_: ScreenProps) {
  const session = useSession();
  const patronages = usePatronages();
  const { lookup, directory } = useUserLookup(true);

  useBackButton('#administration');
  useSpinnerWhile(patronages.isFetching || directory.isFetching);

  const all = patronages.data ?? [];

  // Same bare `if (is_ad)` as the listing above: no message, no bounce.
  if (session.loggedIn && !session.admin) return null;

  return (
    <Page id="administration-patronages-view-csv" title="Patronages">
      <ul
        id="administration-patronages-view-csv-list"
        data-role="listview"
        data-inset="true"
        data-filter="true"
        data-input="#patronages-filter"
        className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        {all.map((patronage, i) => (
          <li
            key={patronage.id}
            className={cx('ui-li-static ui-body-inherit', positionClass(i, all.length))}
          >
            {csvRowText(patronage, lookup(patronage.ownerId))}
          </li>
        ))}
      </ul>
    </Page>
  );
}

/**
 * One user's patronages.
 *
 * Ports `administration_user_patronages` and the
 * `#administration-user-patronages-view` block in index.html.
 *
 * R44 is the reason this page has a listview at all: the route used to point
 * AdministrationUserView -- a LayoutView whose regions only exist inside
 * `#administration-user-view` -- at this page, so Marionette threw during
 * construction, inside a promise callback that does not catch synchronous
 * throws, and the route died before `changePage` with the loader still up. The
 * page was broken for everyone, admin included.
 *
 * The listing is filtered client-side from the whole class rather than queried
 * per owner, which is what the original does; the collection is already loaded
 * for the other routes, so it costs nothing extra.
 *
 * No `@compare`: the URL needs a user id, and the ids differ between any two
 * databases, so there is no fixed hash to check it at. Its rows are the same
 * component the admin listing compares.
 */
export function UserPatronagesScreen({ route }: ScreenProps) {
  const id = route.named['id'];
  const session = useSession();
  const patronages = usePatronages();
  // `load: false`. This route never calls `UserChannel.get_users()`, so on a
  // fresh load every row here reads "<objectId> User object missing" even
  // though the heading above them names the account -- the heading comes from
  // `get_user(id)`, which answers from the Cloud function and does not populate
  // the registry the rows consult. Confirmed live against the legacy app.
  // Fetching the directory here would be a fix, and a port that also fixes
  // things cannot be reviewed.
  const { lookup } = useUserLookup(false);

  const owner = useQuery({
    queryKey: ['users', 'byId', id],
    enabled: !!id,
    queryFn: () => getUserById(id!),
  });

  useBackButton('#administration/users/all');
  useSpinnerWhile(patronages.isFetching || owner.isFetching);

  // `enforce_admin()` + `admin_route_failed(...)`: report, then bounce to the
  // empty hash. The banner follows exactly one navigation, so it is still on
  // screen when the start page lands.
  const blocked = session.loggedIn && !session.admin;
  useEffect(() => {
    if (!blocked) return;
    showError(
      'Administrator access is required for that page.',
      "Couldn't list that user's patronages",
    );
    navigate('');
  }, [blocked]);

  useEffect(() => {
    if (!owner.error) return;
    showError(owner.error, "Couldn't list that user's patronages");
    navigate('');
  }, [owner.error]);

  const theirs = (patronages.data ?? []).filter((p) => p.ownerId === id);

  if (blocked) return null;

  return (
    <Page id="administration-user-patronages-view" title="Patronages">
      {/* The heading is `.text("Patronages for " + user.get("username"))`, set
          after the fetch -- so it reads the bare "Patronages" from index.html
          until the account resolves, and keeps reading it if the account never
          does. */}
      <h3 id="administration-user-patronages-heading">
        {owner.data ? `Patronages for ${owner.data.get('username')}` : 'Patronages'}
      </h3>
      <ul
        id="administration-user-patronages-list"
        data-role="listview"
        data-inset="true"
        className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        {theirs.map((patronage, i) => (
          <PatronageRow
            key={patronage.id}
            patronage={patronage}
            user={lookup(patronage.ownerId)}
            href={`#administration/patronage/${patronage.id}`}
            position={positionClass(i, theirs.length)}
            hidden={false}
          />
        ))}
      </ul>
    </Page>
  );
}

/**
 * The patronage form: owner, paid-on, expires-on, save, and -- for a record
 * that already exists -- delete.
 *
 * Ports views/PatronageView.js and serves three handlers that differ only in
 * their guard and their Back target:
 *
 * - `administration_patronage` (#administration/patronage/:id) -- admin only,
 *   Back to the listing.
 * - `administration_patronage_new` (#administration/patronages/new[/:userid])
 *   -- admin only, Back to the listing, owner taken from the *route* rather
 *   than from the directory. A bare pointer, deliberately: `users.get(userid)`
 *   returned undefined for anyone the directory did not hold -- which is now
 *   every private account -- and `set(undefined)` created the patronage with no
 *   owner at all, a paid subscription attached to nobody. A pointer also avoids
 *   a deep save of the `_User` row and the 403 that comes with it.
 * - `a_patronage` (#patronage/:id) -- any logged-in user, Back to #profile.
 *   R36 notes the detail routes had no admin gate; `a_patronage` still has
 *   none, on purpose, because this is how a member opens their own record.
 *
 * The owner select's options come from UserWreqr's `all` handler, which returns
 * the whole directory to an admin or storyteller and only the caller to
 * everyone else -- so a member on `#patronage/:id` sees one option. An
 * "Invalid" entry with an empty value is unshifted onto the front, and it is
 * what a brand-new record shows, because a new patronage's owner pointer has no
 * id to match.
 *
 * Two known gaps against the original, both in the shared form kit rather than
 * here, and neither changing what the form does:
 *
 * - The date fields are Backform's `DatepickerControl`, which renders exactly
 *   InputControl's markup and then attaches bootstrap-datepicker to it. The
 *   markup is identical; the calendar popup is not reproduced, so the fields
 *   are typed rather than picked. The format is MM/DD/YYYY either way.
 * - A failed save sets `model.errorModel.set("owner", ...)`, which Backform
 *   renders as a help-block under the owner select. `@/forms/Backform`'s
 *   SelectField has no error slot, so the message goes to the submit button's
 *   status line instead -- the same place a successful save reports.
 *
 * No `@compare`: every one of the three URLs needs an id, and there is no fixed
 * hash to check them at.
 */
export function PatronageFormScreen({ route }: ScreenProps) {
  const handler = route.entry.handler;
  const isNewRoute = handler === 'administration_patronage_new';
  const id = isNewRoute ? undefined : route.named['id'];
  const routeOwnerId = isNewRoute ? route.named['userid'] : undefined;

  const session = useSession();
  // All three of this form's routes load the directory, `a_patronage`
  // included -- the owner select would otherwise have only "Invalid" in it.
  const { directory } = useUserLookup(true);
  const { track } = useLoading();
  const queryClient = useQueryClient();

  useBackButton(handler === 'a_patronage' ? '#profile' : '#administration/patronages');

  const record = useQuery({
    queryKey: ['patronage', id],
    enabled: !isNewRoute && !!id,
    queryFn: () => patronagesQuery().get(id!),
  });

  const [owner, setOwner] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // PatronageView clones the model once, in `initialize`, and formats its dates
  // for the datepicker there. The form is not re-seeded afterwards -- a
  // successful save leaves the fields showing exactly what was submitted, which
  // e2e/admin-patronage.spec.js:263 notes and does not treat as a bug. Seeding
  // once, when the record arrives, is the same thing.
  const loaded = record.data;
  useEffect(() => {
    if (!loaded) return;
    setOwner(loaded.ownerId ?? '');
    setPaidOn(formatPatronageDate(loaded.paidOn));
    setExpiresOn(formatPatronageDate(loaded.expiresOn));
  }, [loaded]);

  useEffect(() => {
    if (!routeOwnerId) return;
    setOwner(routeOwnerId);
  }, [routeOwnerId]);

  useSpinnerWhile(directory.isFetching || record.isFetching);

  // `enforce_admin()` guards the two administration routes; `a_patronage` runs
  // on `enforce_logged_in` alone. Each route names what it was attempting, and
  // `a_patronage` -- which has no admin gate and so nothing to refuse -- falls
  // back to `PromiseFailReport`'s bare message.
  const blocked = handler !== 'a_patronage' && session.loggedIn && !session.admin;
  const failureContext = isNewRoute
    ? "Couldn't start a new patronage"
    : "Couldn't open that patronage";
  useEffect(() => {
    if (!blocked) return;
    showError('Administrator access is required for that page.', failureContext);
    navigate('');
  }, [blocked, failureContext]);

  // A failed load reports on all three routes, but only the two admin ones
  // bounce: `a_patronage` ends in a bare `.fail(PromiseFailReport)`, which
  // reports and leaves the user where they are.
  useEffect(() => {
    if (!record.error) return;
    showError(record.error, handler === 'a_patronage' ? undefined : failureContext);
    if (handler !== 'a_patronage') navigate('');
  }, [record.error, failureContext, handler]);

  const ownerOptions: SelectOption[] = useMemo(() => {
    const all = directory.data?.users ?? [];
    // UserWreqr's `all`: the whole directory for an admin or a storyteller,
    // otherwise the caller alone.
    const visible =
      session.admin || session.storyteller
        ? all
        : all.filter((u) => u.id === Parse.User.current()?.id);
    return [
      { label: 'Invalid', value: '' },
      ...visible.map((u) => ({ label: userLabel(u, 'concat'), value: u.id ?? '' })),
    ];
  }, [directory.data, session.admin, session.storyteller]);

  async function onSubmit() {
    setBusy(true);
    setStatus(null);
    try {
      const patronage = loaded ?? new Patronage();
      patronage.set('paidOn', parsePatronageDate(paidOn));
      patronage.set('expiresOn', parsePatronageDate(expiresOn));
      // A pointer, never a fetched account: setting a real `_User` makes the
      // next save deep-save that row and take a 403 on it.
      patronage.set('owner', Parse.User.createWithoutData(owner));
      patronage.applyAdminACL();
      await track(patronage.save());
      setStatus({ kind: 'success', message: 'Save completed' });
      queryClient.invalidateQueries({ queryKey: ['patronages'] });
      queryClient.invalidateQueries({ queryKey: ['patronage'] });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    // "Only an existing record can be deleted" -- the new-patronage route
    // reuses this view with an unsaved model, and there the button is not
    // rendered at all.
    if (!loaded?.id) return;
    try {
      await track(loaded.destroy());
      queryClient.invalidateQueries({ queryKey: ['patronages'] });
      navigate('administration/patronages');
    } catch (err) {
      showError(err, "Couldn't delete this patronage");
    }
  }

  if (blocked) return null;

  return (
    <Page id="administration-patronage-view" title="Patronage">
      {/* A bare <form>, with none of `Form`'s `profile-form` class: PatronageView
          is `tagName: 'form'` and sets no className, and the class is what the
          profile screens' own stylesheet keys off. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <SelectField
          name="owner"
          label="Owner"
          options={ownerOptions}
          value={owner}
          onChange={setOwner}
        />
        <InputField name="paidOn" label="Paid on" type="text" value={paidOn} onChange={setPaidOn} />
        <InputField
          name="expiresOn"
          label="Expires on"
          type="text"
          value={expiresOn}
          onChange={setExpiresOn}
        />
        <ButtonField
          name="submit"
          label="Save Changes"
          disabled={busy}
          status={status?.kind}
          message={status?.message}
        />
        {/* R43: there was no way to delete a patronage anywhere in the app --
            no button, no control on the list rows, no route -- so a record
            created by mistake could only be removed with database access. */}
        {loaded?.id ? (
          <button
            type="button"
            className="patronage-delete ui-btn ui-btn-b ui-icon-delete ui-btn-icon-left"
            onClick={() => void onDelete()}
          >
            Delete Patronage
          </button>
        ) : null}
      </form>
    </Page>
  );
}

registerScreen('administration_patronages', PatronagesListScreen);
registerScreen('administration_patronages_csv', PatronagesCSVScreen);
registerScreen('administration_user_patronages', UserPatronagesScreen);
registerScreen('administration_patronage', PatronageFormScreen);
registerScreen('administration_patronage_new', PatronageFormScreen);
registerScreen('a_patronage', PatronageFormScreen);
