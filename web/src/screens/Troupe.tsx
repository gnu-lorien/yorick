import { useEffect, useState } from 'react';
import { Page } from '@/jqm/Page';
import { InputField, TextareaField, ButtonField, SpacerField } from '@/forms/Backform';
import { useLoading } from '@/jqm/Loader';
import { Parse } from '@/parse/init';
import { useSession } from '@/parse/session';
import { Troupe } from '@/parse/models/Troupe';
import { loadCharacter } from '@/parse/character/load';
import { joinTroupe } from '@/parse/character/troupeMembership';
import { navigate } from '@/router/router';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { registerScreen, type ScreenProps } from './registry';

/**
 * One troupe: its details, its staff roster and its portrait.
 *
 * Ports views/TroupeView.js, templates/troupe.html,
 * templates/troupe-staff-list.html, templates/troupe-portrait-display.html and
 * forms/TroupeForm.js, inside the bare `#troupe` page from public/index.html.
 *
 * Three handlers land here and they differ only in two things -- where Back
 * goes, and whether the form is writable:
 *
 * - `troupe` (#troupe/:id) sets Back to #troupes and passes
 *   `storytellerinterface || admininterface` as `writable`
 *   (mobileRouter.js:2189-2196).
 * - `character_show_troupe` and `character_join_troupe` set Back to
 *   #character?<cid> and call `register(troupe)` with no second argument, so
 *   `writable` is false however privileged the viewer is. That is deliberate in
 *   the original: these two are a player looking at a troupe from their own
 *   character, not a storyteller administering it.
 *
 * `TroupeView.register` re-renders only when the troupe object identity or the
 * writable flag changed. That comparison is a Backbone artefact -- the view is
 * a long-lived singleton reused across routes -- and does not port, because
 * React mounts this component per navigation and re-renders from props.
 *
 * `character_join_troupe` does the join before it renders, which is what makes
 * it a different route from `character_show_troupe` rather than a synonym. The
 * work is `Character.join_troupe` (models/Character.js:1064) --
 * `initialize_troupe_membership` plus `update_troupe_acls`, a relation walk
 * followed by a rewrite of the character's ACL and of every SimpleTrait and
 * ExperienceNotation it owns -- and it lives in
 * parse/character/troupeMembership.ts, not here.
 *
 * `character_show_troupe` skips the `get_character(cid)` its handler opens
 * with, because the fetched character is assigned and never used
 * (mobileRouter.js:1939-1943); the only thing lost is that a character which
 * fails to load no longer redirects. `join` genuinely needs it and does it.
 *
 * Only the writable URL is declared below. The read-only one was checked by
 * hand -- `#character/9cYrGGv2w3/troupe/qvtD2RxzGG/show` matches -- and is left
 * undeclared because it pins a character id belonging to another screen's
 * fixtures as well as a troupe id.
 *
 * @compare #troupe/qvtD2RxzGG
 */
export function TroupeScreen({ route }: ScreenProps) {
  const handler = route.entry.handler;
  // `troupe/:id` names it `id`; the two character routes name it `tid`.
  const troupeId = route.named['id'] ?? route.named['tid'];
  const characterId = route.named['cid'];
  const session = useSession();
  const { track } = useLoading();

  // Only the `troupe` handler passes a writable flag; see the class comment.
  const writable = handler === 'troupe' && (session.storyteller || session.admin);

  const [troupe, setTroupe] = useState<Troupe | null>(null);
  const [fields, setFields] = useState<TroupeFields>(EMPTY);
  const [staff, setStaff] = useState<Parse.User[] | null>(null);
  // `undefined` while the portrait pointer is still being fetched, `null` for a
  // troupe with no portrait at all. The two render differently.
  const [portraitUrl, setPortraitUrl] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // set_back_button runs before the fetch in all three handlers, so Back works
  // even while the troupe is still loading.
  useBackButton(handler === 'troupe' ? '#troupes' : `#character?${characterId}`);

  useEffect(() => {
    if (!troupeId) return;
    let cancelled = false;
    void (async () => {
      try {
        // `new Parse.Query("Troupe").get(id)` with no `include("portrait")` --
        // the portrait comes back as a bare pointer and TroupeView.render
        // fetches it separately. Kept, because including it here would make
        // this one request where the original makes two and the second one is
        // what the page waits on.
        const loaded = await track(new Parse.Query(Troupe).get(troupeId));
        if (cancelled) return;

        // The join, before the render. The handler's order is
        // `get_character` -> fetch the troupe -> `join_troupe` -> show the
        // page, and it matters: the page is the confirmation that the join
        // happened, so it must not appear first.
        if (handler === 'character_join_troupe' && characterId) {
          const { character } = await track(loadCharacter(characterId));
          if (cancelled) return;
          await track(joinTroupe(character, loaded));
          if (cancelled) return;
        }

        setTroupe(loaded);
        setFields(fieldsOf(loaded));
      } catch (error) {
        if (cancelled) return;
        if (handler === 'troupe') {
          // mobileRouter.js:2197 has only an `.always()` that hides the
          // spinner: a troupe that will not load leaves you on whatever page
          // you were on, with nothing said anywhere. The banner is the one
          // deliberate addition, and it does not redirect, so the screen still
          // behaves as the original does.
          // `ReportError.on("Couldn't open that troupe")` (mobileRouter.js:2299),
          // which legacy bug #7 added and the regression spec pins.
          showError(error, "Couldn't open that troupe");
          return;
        }
        // The character routes do redirect: `.fail(function () {
        // window.location.hash = "#character?" + cid; })` followed by
        // `.fail(PromiseFailReport)` -- report, then leave. A join that is
        // refused lands here too, which is the behaviour: no page, and back to
        // the character.
        showError(
          error,
          handler === 'character_join_troupe'
            ? "Couldn't join that troupe"
            : "Couldn't open that troupe",
        );
        navigate(`#character?${characterId}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [troupeId, handler, characterId, track]);

  // The two asynchronous regions of TroupeView.render. Neither blocks the
  // other and a failure in either must not take the page down -- the original
  // wraps both in `.always()` for exactly that, so `rendered` settles either
  // way and the rest of the page stays usable.
  useEffect(() => {
    if (!troupe) return;
    let cancelled = false;
    void (async () => {
      try {
        const roster = await troupe.getStaff();
        if (!cancelled) setStaff(roster);
      } catch (error) {
        if (!cancelled) showError(error, "Couldn't load the troupe's staff");
      }
    })();
    void (async () => {
      try {
        const url = await troupe.fetchPortraitOriginalUrl();
        if (!cancelled) setPortraitUrl(url);
      } catch (error) {
        if (!cancelled) showError(error, "Couldn't load the troupe's portrait");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [troupe]);

  const bind = (key: keyof TroupeFields) => (value: string) =>
    setFields((previous) => ({ ...previous, [key]: value }));

  async function onSubmit() {
    if (!troupe || busy) return;
    setBusy(true);
    try {
      for (const [key, value] of Object.entries(fields)) troupe.set(key, value);
      await track(troupe.save());
    } catch (error) {
      // TroupeView.js:29-32. A failed save sends you to #administration and
      // logs the message; nothing is shown on the page itself.
      console.log('Failed to save troupe ' + (error instanceof Error ? error.message : error));
      navigate('#administration');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page id="troupe" title="Troupe">
      {/* templates/troupe-portrait-display.html. The anchor is rendered even
          before the portrait pointer resolves -- `#troupe-portrait-display` is
          filled asynchronously in the original too, and TroupeView.render goes
          out of its way to keep the *previous* contents rather than blank the
          region while the fetch is in flight. */}
      <div id="troupe-portrait-display">
        {portraitUrl === undefined ? null : (
          <a href={`#troupe/${troupeId}/portrait`}>
            {portraitUrl === null ? 'Add Portrait' : <img src={portraitUrl} />}
          </a>
        )}
      </div>
      {/* `<% if (!readonly) { %>` in templates/troupe.html. All four are plain
          buttons whose click handlers assign window.location.hash, so they are
          not links and cannot be middle-clicked -- kept as buttons because the
          class names are what TroupeView's event map and the E2E suite select
          on.

          `ui-btn` and nothing else, hand-written rather than taken from
          jqm/Controls' Button, which cannot emit this. Writing `ui-btn` into
          the source markup is not a shortcut, it is an instruction:
          `$.fn.buttonMarkup` reads the existing class list first
          (`classNameToOptions`, jquery.mobile-1.4.5.js:12127) and treats an
          element that already has `ui-btn` as one it has enhanced before, so
          the absent `ui-shadow` and `ui-corner-all` are read back as
          `shadow: false, corners: false` and are never added. These five
          buttons are therefore square and flat in the legacy app, while the
          Backform buttons in the form below -- whose source class is just
          `btn` -- get the full default treatment. */}
      {writable ? (
        <>
          <button
            className="troupe-view-characters ui-btn"
            onClick={() => navigate(`#troupe/${troupeId}/characters/all`)}
          >
            View Characters
          </button>
          <button
            className="troupe-view-character-relationships ui-btn"
            onClick={() => navigate(`#troupe/${troupeId}/characters/relationships/network`)}
          >
            View Character Relationships
          </button>
          <button
            className="troupe-view-summarize-characters ui-btn"
            onClick={() => navigate(`#troupe/${troupeId}/characters/summarize/all`)}
          >
            Summarize Characters
          </button>
          <button
            className="troupe-view-print-characters ui-btn"
            onClick={() => navigate(`#troupe/${troupeId}/characters/selecttoprint/all`)}
          >
            Print Characters
          </button>
        </>
      ) : null}
      <div className="ui-grid-a ui-responsive">
        <div className="ui-block-a">
          <h1>Troupe</h1>
          {/* No `profile-form` class: Backbone applies a view's `className`
              only when it creates the element, and TroupeView hands the form
              an el that templates/troupe.html already wrote out as a bare
              `<form id="troupe-data">`. So the form element is written here
              rather than taken from forms/Backform, whose `Form` carries the
              class that only a self-creating view gets. */}
          <form
            id="troupe-data"
            onSubmit={(e) => {
              e.preventDefault();
              void onSubmit();
            }}
          >
            <InputField name="name" label="Name" value={fields.name} onChange={bind('name')} />
            <InputField
              name="shortname"
              label="Short Name"
              value={fields.shortname}
              onChange={bind('shortname')}
            />
            <InputField
              name="shortdescription"
              label="Short Public Description"
              value={fields.shortdescription}
              onChange={bind('shortdescription')}
            />
            <InputField
              name="location"
              label="Location"
              value={fields.location}
              onChange={bind('location')}
            />
            <InputField
              name="boundaries"
              label="Troupe Boundaries"
              value={fields.boundaries}
              onChange={bind('boundaries')}
            />
            <InputField
              name="staffemail"
              label="Staff Email Address"
              value={fields.staffemail}
              onChange={bind('staffemail')}
            />
            {/* `{control: "spacer"}` in TroupeForm.js. Backform's Field
                defaults `name` to "", so the group carries no name class. */}
            <SpacerField name="" />
            <TextareaField
              name="description"
              label="Long Public Description"
              value={fields.description}
              onChange={bind('description')}
            />
            <TextareaField
              name="proxypolicy"
              label="Policies for Proxied Characters"
              value={fields.proxypolicy}
              onChange={bind('proxypolicy')}
            />
            {/* Appended by TroupeView.register only when writable, so the same
                TroupeForm renders read-only for a player. The form's submit
                handler is bound either way in the original -- pressing Enter in
                a field still saves -- and that is kept. */}
            {writable ? <ButtonField name="" label="Update" disabled={busy} /> : null}
          </form>
        </div>
        <div className="ui-block-b">
          <h1>Staff</h1>
          {/* templates/troupe-staff-list.html. The `<ul>` is inside the
              template, so it does not exist at all until the Cloud call
              returns -- which is the window TroupeView.render's comment is
              about. It is a plain `<ul>` with no data-role, so jQuery Mobile
              leaves it alone; it is not a listview. */}
          <div id="troupe-staff">
            {staff === null ? null : (
              <ul>
                {staff.map((user) => (
                  <li key={user.id}>
                    {/* Three fields, not four. `role` is smuggled onto the user
                        by the get_troupe_staff Cloud function; `email` used to
                        be printed between the username and the real name and
                        was blank on every row without exception, because
                        `identity_of` copies an allowlist and cloud/main.js sets
                        `IDENTITY_INCLUDES_EMAIL = false` -- and parse-server
                        withholds another user's address from any non-master
                        read anyway. So it could only ever render as a double
                        space. That is legacy bug #10, now fixed on both sides.

                        Do not bring it back by flipping
                        `IDENTITY_INCLUDES_EMAIL`: that publishes staff email
                        addresses to anyone who can read the troupe. */}
                    {`${user.get('role') ?? ''}: ${user.get('username') ?? ''} ${user.get('realname') ?? ''}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {writable ? (
            <button
              className="troupe-add-staff ui-btn"
              onClick={() => navigate(`#troupe/${troupeId}/staff/add`)}
            >
              Add New Staff Member
            </button>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

/** The eight editable attributes, in the order TroupeForm.js lists them. */
interface TroupeFields {
  name: string;
  shortname: string;
  shortdescription: string;
  location: string;
  boundaries: string;
  staffemail: string;
  description: string;
  proxypolicy: string;
}

const EMPTY: TroupeFields = {
  name: '',
  shortname: '',
  shortdescription: '',
  location: '',
  boundaries: '',
  staffemail: '',
  description: '',
  proxypolicy: '',
};

function fieldsOf(troupe: Troupe): TroupeFields {
  const read = (key: keyof TroupeFields) => (troupe.get(key) as string | undefined) ?? '';
  return {
    name: read('name'),
    shortname: read('shortname'),
    shortdescription: read('shortdescription'),
    location: read('location'),
    boundaries: read('boundaries'),
    staffemail: read('staffemail'),
    description: read('description'),
    proxypolicy: read('proxypolicy'),
  };
}

registerScreen('troupe', TroupeScreen);
registerScreen('character_show_troupe', TroupeScreen);
registerScreen('character_join_troupe', TroupeScreen);
