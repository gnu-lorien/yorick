import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { Button, Link } from '@/jqm/Controls';
import { ButtonField } from '@/forms/Backform';
import { cx, positionClass } from '@/jqm/classes';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { useSession } from '@/parse/session';
import { Parse } from '@/parse/init';
import { registerScreen, type ScreenProps } from './registry';

/**
 * One account, as an administrator sees it.
 *
 * Ports the `administration_user` handler in mobileRouter.js,
 * views/AdministrationUserView.js, forms/UserForm.js, views/PatronagesView.js
 * and views/PatronageListView.js, inside the `#administration-user-view` block
 * in public/index.html. That block is a Marionette LayoutView with five
 * regions, and the section headings, the `<hr>`s and the empty region divs are
 * the page's own scaffolding -- so they are part of the DOM this reproduces,
 * region wrapper divs included.
 *
 * Four things about the original are reproduced rather than fixed:
 *
 * - **The Roles section is always empty.** `RoleView`'s template is
 *   `"The one: <%= attributes.name %>"`, but Marionette hands a template the
 *   model's *attributes*, not the model, so `attributes` is undefined inside
 *   it. The first role added throws a ReferenceError out of `collection.add`,
 *   which rejects the enclosing `q.each` and is swallowed by its `.fail`. The
 *   running app logs "Couldn't list this user's roles: attributes is not
 *   defined" and shows nothing. So the region holds an empty `<div>` -- the
 *   CollectionView's own element -- and nothing else, and this renders exactly
 *   that rather than a roles list the legacy screen has never shown.
 * - **The profile is read-only except for one box.** UserForm's five fields are
 *   all disabled by `initialize`; `admininterface` is appended afterwards and
 *   is the only writable control. Saving writes no user fields at all, only the
 *   Administrator role's user relation.
 * - **The password reset button never shows the address.** See the R51 comment
 *   in the legacy view: Parse does not hand another user's email to a client,
 *   so the cloud function looks it up under the master key.
 * - **A non-admin is left where they were.** The handler's body is inside a
 *   bare `if (is_ad)` with no else -- no error, no redirect, no transition.
 *   React has already routed here by the time that check runs, so the page
 *   renders as the empty scaffolding a non-admin's copy of it always was, and
 *   no request is made for an account they may not read.
 *
 * The markup is written out rather than assembled from `@/jqm/Listview` and
 * `Form`/`InputField`/`CheckboxField` for three reasons, all of them shapes the
 * kits cannot currently express: the patronage list's filter box lives outside
 * `#patronage-list-region` while the `<ul>` lives inside it; jQuery Mobile
 * stamps `ui-state-disabled` on the *wrapper* of a disabled input, which
 * `InputField` has no prop for; and an enhanced checkbox is
 * `div.ui-checkbox > label + input`, where `CheckboxField` still emits
 * Backform's pre-enhancement `label > input`. Reported rather than changed.
 *
 * @compare #administration/user/m91umkbuQq
 */
export function AdministrationUser({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  const session = useSession();
  const { track, show, hide } = useLoading();

  // mobileRouter.js:900, set before anything is fetched.
  useBackButton('#administration/users/all');

  const { data, isFetching, error } = useQuery({
    queryKey: ['administration', 'user', id],
    enabled: !!id && session.admin,
    queryFn: () => loadAccount(id),
  });

  // The handler brackets the whole route in $.mobile.loading("show") /
  // ("hide"), the hide in an `.always()` so a failed load does not strand it.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // `.fail(PromiseFailReport)` only reaches the console, and because the
  // transition lives in the `.then` the legacy app simply never arrives here.
  // React has arrived, so the failure has to be visible: this is the one
  // deliberate addition.
  useEffect(() => {
    if (!error) return;
    showError(error, "Couldn't load that account");
  }, [error]);

  return (
    <Page id="administration-user-view" title="User View">
      <div className="ui-body ui-body-a ui-corner-all">
        <h3>Reset Password</h3>
        <div id="reset-password-view">
          <div>
            <ResetPasswordButton userId={id} enabled={!!data} />
          </div>
        </div>
      </div>
      <hr />
      <div className="ui-body ui-body-a ui-corner-all">
        <h3>Patronage</h3>
        <div id="patronage-new-for-user-button">
          {/* NewPatronButtonView renders the anchor with the id interpolated,
              and re-renders when the id is set -- so before an account is
              loaded the href is "#administration/patronages/new/". */}
          <div>
            <Link href={`#administration/patronages/new/${data ? id : ''}`}>Add New Patronage</Link>
          </div>
        </div>
        <PatronageList patronages={data?.patronages ?? []} owner={data?.user} />
      </div>
      <hr />
      <div className="ui-body ui-body-a ui-corner-all">
        <h3>Profile</h3>
        <div id="abs-form">{data ? <ProfileForm user={data.user} wasAdmin={data.isAdmin} track={track} /> : null}</div>
      </div>
      <div className="ui-body ui-body-a ui-corner-all">
        <h3>Roles</h3>
        {/* The CollectionView's element, and never anything inside it. See the
            file comment. */}
        <div id="administration-user-roles-available">
          <div />
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ data -- */

interface Account {
  user: Parse.User;
  patronages: Parse.Object[];
  /** Whether the account holds Administrator or SiteAdministrator today. */
  isAdmin: boolean;
}

/**
 * The three requests the handler makes, in parallel as `Parse.Promise.when`
 * made them.
 *
 * Two differences from the original, both in what is asked for rather than in
 * what comes back:
 *
 * - The patronage query is scoped to this owner. The legacy handler fetches
 *   *every* Patronage row through `get_patronages()` and filters the result
 *   client-side, because the router keeps one collection for the whole session;
 *   the query cache is what replaces that, so there is nothing left for the
 *   whole-table read to serve.
 * - `UserChannel.get_users()` -- a fetch of the entire user directory -- is not
 *   made. It exists so `patronage-list-item.html` can resolve each row's owner
 *   through the user registry, and every row on this page has the same owner:
 *   the account being viewed, which the first request already returned.
 *
 * The role count runs against a pointer rather than the fetched user, which is
 * what `equalTo` sends either way, so it need not wait for the user request.
 */
async function loadAccount(id: string): Promise<Account> {
  const [user, patronages, adminCount] = await Promise.all([
    getUser(id),
    patronagesFor(id),
    adminRoleCount(id),
  ]);
  return { user, patronages, isAdmin: adminCount > 0 };
}

/**
 * One account, through the Cloud function.
 *
 * UserWreqr.get_user. A client `get` on `_User` answers 101 for anyone private,
 * which took the whole page down; the Cloud function decides entitlement
 * server-side, and a withheld account gets this sentence rather than a code.
 */
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

/** This account's patronages, newest expiry first, as Patronages' comparator orders them. */
async function patronagesFor(id: string): Promise<Parse.Object[]> {
  const owner = Parse.User.createWithoutData(id);
  const found: Parse.Object[] = [];
  // `each` rather than `find`: it pages through every match instead of stopping
  // at the query limit, which is what collections/Patronages.js relies on.
  await new Parse.Query('Patronage').equalTo('owner', owner).each((patronage) => {
    found.push(patronage);
  });
  // The comparator sorts on `expiresOn` descending with lodash `gt`/`lt`, which
  // on Dates is `>` and `<` -- so undated rows compare equal to everything and
  // keep the order they arrived in.
  return found.sort((l, r) => {
    const a = expiry(l);
    const b = expiry(r);
    return a === b ? 0 : b > a ? 1 : -1;
  });
}

/** Does this account hold either administrative role? */
async function adminRoleCount(id: string): Promise<number> {
  const user = Parse.User.createWithoutData(id);
  const admin = new Parse.Query(Parse.Role).equalTo('users', user).equalTo('name', 'Administrator');
  const siteAdmin = new Parse.Query(Parse.Role)
    .equalTo('users', user)
    .equalTo('name', 'SiteAdministrator');
  return Parse.Query.or(admin, siteAdmin).count();
}

/* --------------------------------------------------------------- pieces -- */

function ResetPasswordButton({ userId, enabled }: { userId: string; enabled: boolean }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { track } = useLoading();

  async function onClick() {
    setBusy(true);
    try {
      await track(Parse.Cloud.run('request_password_reset_for', { user_id: userId }));
      setMessage('Password Reset Email Sent');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        disabled={busy || !enabled}
        onClick={() => {
          void onClick();
        }}
      >
        Reset Password
      </Button>
      {/* Rendered whether or not there is anything to say: it is in the view's
          template unconditionally, and it is what the handler writes into. */}
      <p className="message">{message}</p>
    </>
  );
}

function PatronageList({ patronages, owner }: { patronages: Parse.Object[]; owner?: Parse.User }) {
  const [filter, setFilter] = useState('');

  // jQuery Mobile's filterable matches the row's whole text lowercased, with no
  // trimming of what was typed, and hides non-matches with `ui-screen-hidden`
  // rather than removing them. Refreshing the listview then recomputes
  // ui-first-child/ui-last-child over the visible rows only, which is what
  // keeps an inset list's corners rounded while you type.
  const rows = useMemo(() => {
    const needle = filter.toLowerCase();
    const lines = patronages.map((patronage) => rowLines(patronage, owner));
    const shown = new Set(
      lines.filter((line) => !needle || line.text.toLowerCase().includes(needle)),
    );
    const order = [...shown];
    return lines.map((line) => ({
      ...line,
      hidden: !shown.has(line),
      position: positionClass(order.indexOf(line), order.length),
    }));
  }, [patronages, owner, filter]);

  return (
    <>
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
          <input
            id="patronage-list-filter"
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
      <div id="patronage-list-region">
        <ul
          id="patronage-list"
          data-role="listview"
          data-inset="true"
          data-filter="true"
          data-input="#patronage-list-filter"
          className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
        >
          {rows.map((row) => (
            <li key={row.id} className={cx(row.position, row.hidden && 'ui-screen-hidden')}>
              <a
                href={`#administration/patronage/${row.id}`}
                className="ui-btn ui-btn-icon-right ui-icon-carat-r"
              >
                <h2>{row.heading}</h2>
                <p>paidOn: {row.paidOn}</p>
                <p>expiresOn: {row.expiresOn}</p>
                <p>{row.status}</p>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

interface RowLines {
  id: string;
  heading: string;
  paidOn: string;
  expiresOn: string;
  status: string;
  /** Everything the row prints, which is what the filter matches against. */
  text: string;
}

/** templates/patronage-list-item.html, line for line. */
function rowLines(patronage: Parse.Object, owner?: Parse.User): RowLines {
  const ownerId = (patronage.get('owner') as Parse.Object | undefined)?.id ?? '';
  // The template prints "<objectId> User object missing" when the registry
  // cannot resolve the owner. Every row here belongs to the account on show, so
  // the miss branch is reachable only before that account has loaded.
  const heading = owner
    ? [ownerId, owner.get('username'), owner.get('realname'), owner.get('email')]
        .map((part) => (part as string) ?? '')
        .join(' ')
    : `${ownerId} User object missing`;
  const paidOn = formatDate(patronage.get('paidOn'));
  const expiresOn = formatDate(patronage.get('expiresOn'));
  // ExpirationMixin.status: active until the expiry passes, expired after it.
  // A row with no expiry is neither active nor expired, and the mixin's
  // `isActive` is false for it, so it reads "Expired".
  const status = expiry(patronage) > Date.now() ? 'Active' : 'Expired';
  return {
    id: patronage.id ?? '',
    heading,
    paidOn,
    expiresOn,
    status,
    text: [heading, `paidOn: ${paidOn}`, `expiresOn: ${expiresOn}`, status].join(' '),
  };
}

function expiry(patronage: Parse.Object): number {
  const value = patronage.get('expiresOn') as Date | undefined;
  return value instanceof Date ? value.getTime() : Number.NaN;
}

/**
 * `moment(<date>.iso).format('MM/DD/YYYY')`, without moment.
 *
 * moment parses the ISO string into local time before formatting, so a
 * patronage that expires at midnight UTC prints as the previous day west of
 * Greenwich. `Date` does the same conversion, so reading the local components
 * off it gives the same string the legacy row shows.
 */
function formatDate(value: unknown): string {
  if (!(value instanceof Date)) return 'Invalid date';
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${month}/${day}/${value.getFullYear()}`;
}

/* ----------------------------------------------------------------- form -- */

function ProfileForm({
  user,
  wasAdmin,
  track,
}: {
  user: Parse.User;
  wasAdmin: boolean;
  track: <T>(work: Promise<T>) => Promise<T>;
}) {
  const [isAdmin, setIsAdmin] = useState(wasAdmin);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // The legacy view re-queries the role count only when the form is holding a
  // different user than the one being shown -- `if (self.form.model.id !=
  // user.id)` -- so returning to the same account keeps the checkbox and the
  // status line from last time. Mounting fresh per visit is the same thing for
  // a first visit and a truer answer for a repeat one.
  useEffect(() => {
    setIsAdmin(wasAdmin);
    setStatus(null);
  }, [user.id, wasAdmin]);

  async function onSubmit() {
    if (busy) return;
    setBusy(true);
    try {
      await track(setAdministrator(user, isAdmin));
      setStatus({
        kind: 'success',
        message: isAdmin ? 'Made them an admin!' : 'Removed their admin privileges!',
      });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    // A bare `<form>`: the legacy view is a Marionette ItemView with
    // `tagName: 'form'` and no className, so it carries neither an id nor the
    // `profile-form` class that forms/Backform's `Form` adds.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <DisabledInput name="realname" label="Real Name" value={string(user, 'realname')} />
      <DisabledInput name="email" label="Email" type="email" value={string(user, 'email')} />
      <DisabledInput name="username" label="User Name" value={string(user, 'username')} />
      <CheckRow
        name="massmailauthorization"
        label="I authorize Underground Theater to contact me using this email address"
        checked={!!user.get('massmailauthorization')}
        disabled
      />
      <CheckRow
        name="acceptedtos"
        label={
          'Participation in Underground Theater requires agreeing to the rules and regulations ' +
          'set forth by the organization and its board of directors. I agree to adhere to the ' +
          'rules and regulations of Underground Theater and its board of directors. I also ' +
          'acknowledge that I have read and agree to the rules and procedures set forth in the ' +
          'Patron Handbook.'
        }
        checked={!!user.get('acceptedtos')}
        disabled
      />
      <CheckRow name="admininterface" label="Administrator" checked={isAdmin} onChange={setIsAdmin} />
      {/* The legacy field is `{name: "submit", label: "Update", control:
          "button", id: "submit"}`, but Backform's ButtonControl template has no
          slot for `id` -- so the button carries none, and neither does this
          one. */}
      <ButtonField
        name="submit"
        label="Update"
        disabled={busy}
        status={status?.kind}
        message={status?.message}
      />
    </form>
  );
}

/**
 * Grant or revoke the Administrator role.
 *
 * The whole of what this screen writes. Note it edits the *role*, not the user:
 * the `admininterface` flag the checkbox is bound to is set on the user object
 * in memory and never saved, because it is derived from role membership and is
 * refreshed from it by `enforce_logged_in` on the account's next visit.
 *
 * SiteAdministrator is deliberately not touched. It counts towards the box
 * being ticked, so unticking an account that holds only SiteAdministrator
 * reports success and changes nothing -- the legacy behaviour, and the reason
 * the count query asks about both roles while the save asks about one.
 */
async function setAdministrator(user: Parse.User, wanted: boolean): Promise<void> {
  const role = await new Parse.Query(Parse.Role).equalTo('name', 'Administrator').first();
  if (!role) {
    // The original dereferences `role` here and takes a TypeError, which its
    // `.fail` prints beside the button. Same place, sentence instead.
    throw new Error('There is no Administrator role to add them to.');
  }
  if (wanted) {
    role.getUsers().add(user);
  } else {
    role.getUsers().remove(user);
  }
  await role.save();
}

function string(user: Parse.User, key: string): string {
  return (user.get(key) as string) ?? '';
}

/**
 * A disabled Backform input, after jQuery Mobile enhanced it.
 *
 * `ui-state-disabled` sits on the wrapper rather than on the input -- jQM's
 * textinput widget puts it there, and the CSS has no `:disabled` rule to fall
 * back on, so without it a disabled field looks editable.
 */
function DisabledInput({
  name,
  label,
  value,
  type = 'text',
}: {
  name: string;
  label: string;
  value: string;
  type?: string;
}) {
  return (
    <div className={cx('form-group', name)}>
      <label className="control-label col-sm-4">{label}</label>
      <div className="col-sm-8">
        <div className="ui-input-text ui-body-inherit ui-corner-all ui-state-disabled ui-shadow-inset">
          <input type={type} className="form-control" name={name} maxLength={255} value={value} placeholder="" disabled />
        </div>
      </div>
    </div>
  );
}

/**
 * A Backform checkbox, after jQuery Mobile enhanced it.
 *
 * The enhancer lifts the input out of Backform's `<label>` and makes them
 * siblings inside a `div.ui-checkbox`, then styles the label as the visible
 * control -- `ui-checkbox-on` or `-off` is the tick. The real input is moved
 * off-screen by the stylesheet, so the label is what a user clicks, and jQM
 * bound that click itself rather than with a `for` attribute. Neither element
 * may carry an id: the legacy pair have none, and an id is part of the DOM the
 * comparison checks.
 *
 * The left-hand grid column is present but blank, as Backform's BooleanControl
 * leaves it: the text belongs beside the box, and dropping the empty label
 * would shift the control four columns left.
 */
function CheckRow({
  name,
  label,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const toggle = () => {
    if (!disabled) onChange?.(!checked);
  };
  return (
    <div className={cx('form-group', name)}>
      <label className="control-label col-sm-4">{' '}</label>
      <div className="col-sm-8">
        <div className="checkbox">
          <div className={cx('ui-checkbox', disabled && 'ui-state-disabled')}>
            <label
              className={cx(
                'ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left',
                checked ? 'ui-checkbox-on' : 'ui-checkbox-off',
              )}
              onClick={toggle}
            >
              {label}
            </label>
            <input type="checkbox" name={name} checked={checked} disabled={disabled} onChange={toggle} />
          </div>
        </div>
      </div>
    </div>
  );
}

registerScreen('administration_user', AdministrationUser);
