import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { Listview, ListItem } from '@/jqm/Listview';
import { InputField, ButtonField } from '@/forms/Backform';
import { cx } from '@/jqm/classes';
import { useLoading } from '@/jqm/Loader';
import { showError } from '@/shell/reportError';
import { useBackButton } from '@/shell/backButton';
import { Parse } from '@/parse/init';
import { useCurrentRoles } from '@/data/queries';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The signed-in user's own settings page.
 *
 * Ports the `profile` handler, views/UserSettingsProfileView.js,
 * forms/UserForm.js, templates/user-settings-profile.html and
 * templates/patronage-list-item.html.
 *
 * The legacy LayoutView is four regions inside one template: the profile form,
 * the PayPal donate button, the patronage list and the roles list. Each
 * region's child view rendered into a `div` that the template already
 * contained, so the region divs -- `#user-settings-profile-abs-form`,
 * `#usp-paypal-button`, `#usp-patronage-list-region`, `#user-roles-available`
 * -- are part of the DOM this has to reproduce, not scaffolding of the old
 * framework.
 *
 * There were five. The Facebook section is gone: legacy bug #3 removed the
 * region, its view and its template rather than repairing a button whose click
 * handler called a `Parse.FacebookUtils` that `loadall.js` deliberately never
 * initialises. The port used to keep the empty region div and omit the button,
 * which was the one place this screen diverged on purpose; both sides now have
 * neither.
 *
 * The handler calls `UserChannel.get_users()` before showing the page. That is
 * a `_User` find, which parse-server now refuses, and this screen does not need
 * it: see the comment on `ownerOf` below.
 *
 * @compare-known #profile -- legacy patronage rows lose their first/last classes
 * once another screen has been visited in the same page; see legacy bug #18
 */
export function Profile(_: ScreenProps) {
  // mobileRouter.js:368 -- `self.set_back_button("#")`, before the fetch.
  useBackButton('#');

  return (
    <Page id="user-settings-profile" title="Profile">
      <div className="ui-body ui-body-a ui-corner-all">
        <h3>Profile</h3>
        <div id="user-settings-profile-abs-form">
          <ProfileForm />
        </div>
      </div>
      <hr />
      <div className="ui-body ui-body-a ui-corner-all">
        <h3>Patronage</h3>
        <div id="usp-paypal-button">
          <PaypalButton />
        </div>
        <PatronageList />
      </div>
      <hr />
      <div className="ui-body ui-body-a ui-corner-all">
        <h3>Roles</h3>
        <div id="user-roles-available">
          <RolesList />
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------- the form -- */

interface ProfileFields {
  realname: string;
  email: string;
  username: string;
  massmailauthorization: boolean;
  acceptedtos: boolean;
}

/**
 * forms/UserForm.js, field for field, over `Parse.User.current()`.
 *
 * The form element carries no class: UserSettingsProfileView's inner View is a
 * Marionette ItemView with `tagName: 'form'` and no `className`, so the
 * `profile-form` class that `forms/Backform`'s own `Form` emits would be wrong
 * here. Same reasoning as TroupeNew.
 */
function ProfileForm() {
  const user = Parse.User.current();
  const { track } = useLoading();

  const [fields, setFields] = useState<ProfileFields>(() => ({
    realname: str(user?.get('realname')),
    email: str(user?.get('email')),
    username: str(user?.get('username')),
    massmailauthorization: !!user?.get('massmailauthorization'),
    acceptedtos: !!user?.get('acceptedtos'),
  }));
  // Backform's submit button starts disabled and the view's `"change"` handler
  // re-enables it on the first edit, so "Update" is only ever clickable when
  // there is something to update.
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function edit<K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    // The same `"change"` handler clears a previous "Successfully Updated", so
    // an edit made after a save does not sit under a stale success message.
    setStatus((previous) => (previous?.kind === 'success' ? null : previous));
  }

  async function onSubmit() {
    if (!user || busy) return;
    setBusy(true);
    // helpers/InjectAuthData is not ported: its whole body is `if the authData
    // has a facebook key, refresh the token from hello.js`. There is no
    // hello.js and no Facebook auth any more, so it was a no-op by the time it
    // reached this branch.
    user.set(fields);
    try {
      await track(user.save());
      setStatus({ kind: 'success', message: 'Successfully Updated' });
      setDirty(false);
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      setDirty(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <InputField
        name="realname"
        label="Real Name"
        value={fields.realname}
        onChange={(v) => edit('realname', v)}
      />
      <InputField
        name="email"
        type="email"
        label="Email"
        value={fields.email}
        onChange={(v) => edit('email', v)}
      />
      <InputField
        name="username"
        label="User Name"
        value={fields.username}
        onChange={(v) => edit('username', v)}
      />
      <CheckboxGroup
        name="massmailauthorization"
        label="I authorize Underground Theater to contact me using this email address"
        checked={fields.massmailauthorization}
        onChange={(v) => edit('massmailauthorization', v)}
      />
      <CheckboxGroup
        name="acceptedtos"
        label="Participation in Underground Theater requires agreeing to the rules and regulations set forth by the organization and its board of directors. I agree to adhere to the rules and regulations of Underground Theater and its board of directors. I also acknowledge that I have read and agree to the rules and procedures set forth in the Patron Handbook."
        checked={fields.acceptedtos}
        onChange={(v) => edit('acceptedtos', v)}
      />
      {/* Not in UserForm.js's field list -- UserSettingsProfileView appends it
          in `initialize`, which is also where `disabled: true` comes from. The
          field is also given `id: "submit"`, which Backform's ButtonControl
          template does not use, so the rendered button carries no id. */}
      <ButtonField
        name="submit"
        label="Update"
        disabled={!dirty || busy}
        status={status?.kind}
        message={status?.message}
      />
    </form>
  );
}

/**
 * Backform's checkbox group, with jQuery Mobile's enhancement applied.
 *
 * `forms/Backform`'s own `CheckboxField` emits Backform's *pre-enhancement*
 * markup -- `div.checkbox > label > input` -- but every Backform form in this
 * app is `enhanceWithin()`'d immediately after it renders, which replaces that
 * with `div.checkbox > div.ui-checkbox > (label.ui-btn…, input)`. Harvested
 * from the running legacy #profile, and it is what jqm/Controls' `Checkbox`
 * already emits -- except that `Checkbox` generates an `id` for the input so
 * the label can be `for`-linked, and the legacy markup has neither an id nor a
 * `for`: jQM binds the label's click in JavaScript instead. Both of those
 * files are shared and being edited by other screens right now, so the markup
 * is composed locally here rather than changed there. Reported for a central
 * fix.
 */
function CheckboxGroup({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={cx('form-group', name)}>
      {/* Backform writes &nbsp; into the label column of a boolean field: the
          text belongs beside the box, and the four grid columns still have to
          be reserved or the control slides left. */}
      <label className="control-label col-sm-4">{' '}</label>
      <div className="col-sm-8">
        <div className="checkbox">
          <div className="ui-checkbox">
            {/* `ui-checkbox-on`/`-off` is the whole of the widget's look, and
                the label's click handler is the whole of its behaviour: the
                stylesheet positions the real input off the control, so without
                it the box cannot be ticked. */}
            <label
              className={cx(
                'ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left',
                checked ? 'ui-checkbox-on' : 'ui-checkbox-off',
              )}
              onClick={() => onChange(!checked)}
            >
              {label}
            </label>
            <input
              type="checkbox"
              name={name}
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ patronage -- */

/** templates/paypal-button.html. `custom` is how PayPal returns the payer's id. */
function PaypalButton() {
  const userid = Parse.User.current()?.id ?? '';
  return (
    <div>
      <form action="https://www.paypal.com/cgi-bin/webscr" method="post" target="_top">
        <input type="hidden" name="cmd" value="_s-xclick" />
        <input type="hidden" name="hosted_button_id" value="N54QYTKNK9GUL" />
        <input type="hidden" name="custom" value={userid} />
        {/* `border="0"` is in the template PayPal generated. React has no prop
            for the presentational attribute, so it is spread on as one. */}
        <input
          type="image"
          src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif"
          name="submit"
          alt="PayPal - The safer, easier way to pay online!"
          {...{ border: '0' }}
        />
        <img
          alt=""
          src="https://www.paypalobjects.com/en_US/i/scr/pixel.gif"
          width="1"
          height="1"
          {...{ border: '0' }}
        />
      </form>
    </div>
  );
}

interface PatronageRow {
  id: string;
  ownerId: string;
  owner: { username: string; realname: string; email: string } | null;
  paidOn?: Date;
  expiresOn?: Date;
}

/**
 * The signed-in user's patronage history, newest expiry first.
 *
 * collections/Patronages.js sorts on `expiresOn` descending, with the two
 * operands swapped in the comparator rather than the sign flipped. The
 * `sortbycreated` branch above it is one of the dead ones documented in
 * docs/react-migration/README.md and is not ported.
 *
 * The filter input lives *outside* `#usp-patronage-list-region` in
 * templates/user-settings-profile.html, before the region rather than inside
 * it, so it is written out here rather than taken from `Listview`'s own
 * `filter` prop -- that one renders the search box as the list's immediate
 * sibling and would nest it one element differently.
 */
function PatronageList() {
  const user = Parse.User.current();
  const [filter, setFilter] = useState('');

  const { data, error } = useQuery({
    queryKey: ['patronages', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const rows: PatronageRow[] = [];
      // `each` rather than `find`, as Patronages.fetch does: it pages past the
      // query limit instead of stopping at it.
      await new Parse.Query('Patronage').equalTo('owner', user!).each((patronage) => {
        rows.push({
          id: patronage.id ?? '',
          ownerId: (patronage.get('owner') as Parse.Object | undefined)?.id ?? '',
          owner: ownerOf(patronage.get('owner') as Parse.Object | undefined),
          paidOn: patronage.get('paidOn') as Date | undefined,
          expiresOn: patronage.get('expiresOn') as Date | undefined,
        });
      });
      return rows;
    },
  });

  // The legacy `self.patronages.fetch()` has no failure handler at all, so a
  // refused or broken query leaves an empty list and no explanation. Saying so
  // is the one deliberate addition here; `showError` does not rethrow, which
  // matches the original carrying on.
  useEffect(() => {
    if (error) showError(error, "Couldn't load your patronage history");
  }, [error]);

  const rows = useMemo(() => {
    const sorted = [...(data ?? [])].sort((l, r) => {
      const a = r.expiresOn;
      const b = l.expiresOn;
      // lodash `gt`/`lt`, which are bare `>` and `<`; on Dates that is a
      // numeric comparison, and an absent expiresOn compares false both ways
      // and so keeps its position.
      return a! > b! ? 1 : a! < b! ? -1 : 0;
    });
    const needle = filter.toLowerCase();
    return sorted.map((row) => ({
      row,
      hidden: !!needle && !rowText(row).toLowerCase().includes(needle),
    }));
  }, [data, filter]);

  return (
    <>
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
          <input
            id="usp-patronage-list-filter"
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
      <div id="usp-patronage-list-region">
        <Listview id="usp-patronage-list" inset>
          {rows.map(({ row, hidden }) => (
            // R46 in UserSettingsProfileView.js: the rows used to link to
            // "#profile/<id>", a route that does not exist, so every one of
            // them was dead. `#patronage/<id>` is the `a_patronage` handler
            // these were meant to open.
            <ListItem key={row.id} href={`#patronage/${row.id}`} hidden={hidden}>
              <h2>
                {row.owner
                  ? `${row.ownerId} ${row.owner.username} ${row.owner.realname} ${row.owner.email}`
                  : `${row.ownerId} User object missing`}
              </h2>
              <p>paidOn: {mmddyyyy(row.paidOn)}</p>
              <p>expiresOn: {mmddyyyy(row.expiresOn)}</p>
              <p>{status(row.expiresOn)}</p>
            </ListItem>
          ))}
        </Listview>
      </div>
    </>
  );
}

/**
 * The display fields of a patronage's owner pointer.
 *
 * templates/patronage-list-item.html asks helpers/UserWreqr for the owner and
 * prints "<objectId> User object missing" when it comes back empty. On this
 * screen the answer is always the signed-in user -- the query is
 * `equalTo("owner", Parse.User.current())` -- and UserWreqr's `"get"` handler
 * answers from `Parse.User.current()` directly for exactly that reason: a
 * `_User` find is refused now, so any other source would leave every paying
 * member looking at "User object missing" on their own profile.
 *
 * That handler's own comment is worth carrying over, because it is the reason
 * a miss must be loud rather than blank: the three CSV templates emit their
 * identity columns only inside `if (e.get("owner").get("username"))`, so an
 * owner that failed to hydrate makes them emit *no* columns and silently shift
 * every later column in the row. A missed hydrate has to be visible.
 */
function ownerOf(pointer: Parse.Object | undefined): PatronageRow['owner'] {
  if (!pointer) return null;
  const current = Parse.User.current();
  if (!current || current.id !== pointer.id) return null;
  return {
    username: str(current.get('username')),
    realname: str(current.get('realname')),
    email: str(current.get('email')),
  };
}

/** helpers/ExpirationMixin: anything not currently active reads as expired. */
function status(expiresOn: Date | undefined): string {
  return expiresOn && expiresOn.getTime() > Date.now() ? 'Active' : 'Expired';
}

/** `moment(d.iso).format('MM/DD/YYYY')`, in local time as moment does. */
function mmddyyyy(d: Date | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return 'Invalid date';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

/** What jQM's filterable matches against: everything the row prints. */
function rowText(row: PatronageRow): string {
  return [
    row.ownerId,
    row.owner?.username,
    row.owner?.realname,
    row.owner?.email,
    mmddyyyy(row.paidOn),
    mmddyyyy(row.expiresOn),
    status(row.expiresOn),
  ]
    .filter(Boolean)
    .join(' ');
}

/* ---------------------------------------------------------------- roles -- */

/**
 * The Roles section.
 *
 * `RolesView` is a CollectionView with `tagName: 'div'` whose child is an
 * ItemView rendering the literal `"The one: <name>"`, so the region holds one
 * div wrapping one div per role -- and the wrapper is real DOM, not scaffolding.
 *
 * This listed nothing at all until legacy bug R1 was fixed. The template read
 * `attributes.name` while Marionette hands it `model.toJSON()`, which under
 * parse@8 is the flat attribute bag with no `attributes` key; lodash compiles
 * the body inside `with (obj)`, so the first role threw a ReferenceError inside
 * the `q.each` callback, the rejection landed in `.fail(PromiseFailReport)`, and
 * a ReferenceError has no enumerable own properties -- so even the log said
 * `Error in promise {}`. The port reproduced the empty div rather than inventing
 * a section the legacy did not show.
 *
 * Both sides list the roles now. `useCurrentRoles` is the same `_Role` query the
 * view makes -- ask which roles contain this user, rather than asking each
 * role's `_User` relation, which is a `_User` find and refused.
 */
function RolesList() {
  const { data } = useCurrentRoles();
  return (
    <div>
      {(data ?? []).map((role) => (
        <div key={role.id}>The one: {role.get('name') as string}</div>
      ))}
    </div>
  );
}

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

registerScreen('profile', Profile);
