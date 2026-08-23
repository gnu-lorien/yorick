import { Fragment, useCallback, useEffect, useState } from 'react';
import { Page } from '@/jqm/Page';
import { Popup, PopupPlaceholder } from '@/jqm/Popup';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { reportError, showError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import type { Character } from '@/parse/models/Character';
import { loadCharacter } from '@/parse/character/load';
import {
  fetchExperienceNotations,
  addExperienceNotation,
  removeExperienceNotation,
  updateExperienceNotation,
  experienceAvailable,
} from '@/parse/character/experience';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The experience ledger: every entry, editable, with a running balance.
 *
 * Ports views/CharacterExperienceView.js and the `#experienceNotationsAllView`
 * template.
 *
 * The route is `character/:cid/experience/:start/:changeBy` and both parameters
 * are real: the page is taken at render time, not in the query. That is
 * deliberate and load-bearing. Unlike the log, which owns a display-only
 * collection and can page server-side, this screen renders the ledger that
 * `recomputeRunningBalances` walks to keep every row's totals correct. Skipping
 * rows in the query would quietly corrupt the balances, so the whole ledger is
 * fetched and only the slice is drawn.
 *
 * Most of the legacy view's length is not this screen's logic. It is two
 * workarounds for jQuery Mobile popups, and neither survives the port:
 *
 *   - A render arriving while a dialog is open used to tear down the markup the
 *     dialog was opened from, re-enhance fresh copies of all three popups, and
 *     leave the handlers' bare `$("#popupEditReason")` lookups pointing at a
 *     duplicate. It had to defer rendering until `popupafterclose`.
 *   - Every render emitted fresh copies of the popups, and jQM moves an opened
 *     popup's container out to the page element, so opened copies survived the
 *     replacement -- measured at seven `#popupEditReason` elements after three
 *     edits, growing without bound.
 *
 * Both are consequences of rebuilding a whole subtree of HTML on every change
 * and addressing popups by id. React renders one popup element whose open state
 * is state, so there is nothing to duplicate and nothing to tear down.
 *
 * @compare #character/9cYrGGv2w3/experience/0/10
 */
export function CharacterExperience({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  useBackButton(`#character?${cid}`);

  // Both parameters are clamped exactly as `register` clamps them: a
  // non-numeric or negative start becomes 0, and a changeBy below 1 becomes 10.
  // A hand-typed hash should page sensibly rather than render nothing.
  const start = clamp(route.named['start'], 0, 0);
  const changeBy = clamp(route.named['changeBy'], 10, 1);

  const { track } = useLoading();
  const [character, setCharacter] = useState<Character | null>(null);
  const [notations, setNotations] = useState<Parse.Object[] | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const reload = useCallback(
    async (loaded: Character) => {
      setNotations(await fetchExperienceNotations(loaded));
    },
    [],
  );

  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await track(loadCharacter(cid, 'all'));
        if (cancelled) return;
        setCharacter(loaded.character);
        await track(reload(loaded.character));
      } catch (error) {
        if (cancelled) return;
        // The legacy tail reports and then sends the user to the character
        // list, rather than leaving them on a page that will not load.
        showError(error, "Couldn't open the experience history");
        navigate('#characters?all');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, track, reload]);

  if (!character || !notations) return <Page id="experience-notations-all" title="Experience Notations" />;

  const total = notations.length;
  const page = notations.slice(start, start + changeBy);

  const goto = (nextStart: number) =>
    navigate(`#character/${character.id}/experience/${nextStart}/${changeBy}`);

  /**
   * Do something to the ledger, then re-read it -- both under the spinner.
   *
   * The re-read has to be inside the guard, not after it. The legacy holds
   * `$.mobile.loading("show")` across the whole chain, so the spinner is up
   * until the table has actually been redrawn; hiding it between the save and
   * the re-read leaves the *old* table on screen with nothing to say it is
   * stale. It is not only cosmetic -- anything that waits for the spinner to
   * clear before reading the table, the E2E suite included, reads the row it
   * just edited and sees the value it had before.
   */
  async function mutate(work: () => Promise<unknown>, context: string) {
    try {
      await track(
        (async () => {
          await work();
          await reload(character!);
        })(),
      );
    } catch (error) {
      reportError(error, context);
    }
  }

  return (
    <Page
      id="experience-notations-all"
      title="Experience Notations"
      popups={
        <EditPopups
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(changes) => {
            const target = editing?.notation;
            setEditing(null);
            if (!target) return;
            void mutate(
              () => updateExperienceNotation(character, target, changes),
              "Couldn't update that experience notation",
            );
          }}
        />
      }
    >
      <p>Earned: {String(character.get('experience_earned') ?? '')}</p>
      <p>Spent: {String(character.get('experience_spent') ?? '')}</p>
      <p>Available: {experienceAvailable(character)}</p>
      {/*
        `add ui-btn`, not `add ui-btn ui-btn-icon-plus`.

        The template writes `ui-btn-icon-plus`, which is not a jQuery Mobile
        class: the icon-position classes are `ui-btn-icon-{left,right,top,
        bottom,notext}` and the icon itself is `ui-icon-plus`. buttonMarkup
        parses the class list, finds "plus" where a position should be, and
        drops it -- so the button renders with no icon at all and the source
        class is a typo that has never done anything. Measured on the running
        app: `className` is exactly "add ui-btn".
      */}
      <button
        className="add ui-btn"
        onClick={() =>
          void mutate(
            () => addExperienceNotation(character, { reason: 'Unspecified reason' }),
            "Couldn't add that experience notation",
          )
        }
      >
        Add New Experience Notation
      </button>

      {total > changeBy ? (
        <>
          <p>
            Showing {total ? start + 1 : 0}-{Math.min(start + changeBy, total)} of {total}
          </p>
          <button
            className="previous ui-btn ui-btn-icon-left"
            disabled={start <= 0}
            onClick={() => goto(Math.max(0, start - changeBy))}
          >
            View Previous
          </button>
          <button
            className="next ui-btn ui-btn-icon-left"
            disabled={start + changeBy >= total}
            onClick={() => goto(start + changeBy)}
          >
            View Next
          </button>
        </>
      ) : null}

      <LedgerTable
        rows={page}
        onEdit={(notation, field) => setEditing({ notation, field })}
        onDelete={(notation) =>
          void mutate(
            () => removeExperienceNotation(character, notation),
            "Couldn't remove that experience notation",
          )
        }
      />

      {/*
        jQuery Mobile moves an initialised popup's container out to the page
        element and leaves a placeholder behind at the point the popup was
        declared. Four popups are declared in this template, so four
        placeholders sit here -- including `popupEditLogin`, a sign-in dialog no
        handler in this view ever opens. It is in the DOM, so it is here.
      */}
      <PopupPlaceholder id="popupEditEntered" />
      <PopupPlaceholder id="popupEditReason" />
      <PopupPlaceholder id="alterationpopupEdit" />
      <PopupPlaceholder id="popupEditLogin" />
    </Page>
  );
}

/** A route parameter that must be a number, with the legacy's fallbacks. */
function clamp(raw: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return parsed;
}

interface EditTarget {
  notation: Parse.Object;
  field: 'entered' | 'reason' | 'alteration_earned' | 'alteration_spent';
}

const HEADERS = ['entered', 'reason', 'alteration_earned', 'alteration_spent', 'available'] as const;
const PRETTY_NAMES = ['Date', 'Reason', 'Earned?', 'Spent?', 'Available'];
const EDITABLE = new Set(['entered', 'reason', 'alteration_earned', 'alteration_spent']);

/**
 * `moment(v).format("L LTS")`, which is what this screen shows and what the
 * date dialog reads back.
 *
 * In moment's en locale `L` is `MM/DD/YYYY` and `LTS` is `h:mm:ss A`, giving
 * "08/21/2026 9:11:47 PM". Written out rather than pulling moment into the
 * bundle for two calls; `Intl` is not used because its output varies with the
 * host locale and this format does not.
 */
export function formatMomentLLTS(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${pad(value.getMonth() + 1)}/${pad(value.getDate())}/${value.getFullYear()}`;
  const hours24 = value.getHours();
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const time = `${hours}:${pad(value.getMinutes())}:${pad(value.getSeconds())} ${hours24 < 12 ? 'AM' : 'PM'}`;
  return `${date} ${time}`;
}

/** Parse the same format back, for the date dialog. */
function parseMomentLLTS(text: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM))?$/i.exec(
    text.trim(),
  );
  if (!match) return null;
  const [, mm, dd, yyyy, hh, mi, ss, meridiem] = match;
  let hours = hh ? Number.parseInt(hh, 10) : 0;
  if (meridiem) {
    const upper = meridiem.toUpperCase();
    if (upper === 'PM' && hours !== 12) hours += 12;
    if (upper === 'AM' && hours === 12) hours = 0;
  }
  return new Date(
    Number.parseInt(yyyy!, 10),
    Number.parseInt(mm!, 10) - 1,
    Number.parseInt(dd!, 10),
    hours,
    mi ? Number.parseInt(mi, 10) : 0,
    ss ? Number.parseInt(ss, 10) : 0,
  );
}

function formatEntry(notation: Parse.Object, key: string): string {
  const value = notation.has(key)
    ? (notation.get(key) as unknown)
    : (notation as unknown as Record<string, unknown>)[key];
  if (value instanceof Date) return formatMomentLLTS(value);
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The ledger table.
 *
 * Two `<tr>` per notation: a delta row showing the running totals, then the
 * editable row. The empty `<td>`s and the doubled `<th>`s are the template's --
 * each column is a pair, one cell for the edit pencil and one for the value --
 * so the two rows line up.
 */
function LedgerTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: Parse.Object[];
  onEdit: (notation: Parse.Object, field: EditTarget['field']) => void;
  onDelete: (notation: Parse.Object) => void;
}) {
  return (
    <table
      data-role="table"
      id="table-column-toggle"
      className="ui-responsive table-stroke ui-table ui-table-reflow"
    >
      <thead>
        <tr>
          {PRETTY_NAMES.map((name, i) => (
            <Fragment key={name}>
              <th data-colstart={i * 2 + 1} />
              <th data-priority={i + 1} data-colstart={i * 2 + 2}>
                {name}
              </th>
            </Fragment>
          ))}
          <th data-colstart={PRETTY_NAMES.length * 2 + 1} />
        </tr>
      </thead>
      <tbody>
        {rows.map((notation, i) => {
          const earned = (notation.get('earned') as number) ?? 0;
          const spent = (notation.get('spent') as number) ?? 0;
          return (
            <Fragment key={notation.id ?? i}>
              {/*
                The delta row. Every column is a PAIR of cells -- a narrow one
                for the edit pencil and a wide one for the value -- and only the
                wide ones have a named header, so only they get jQM's
                `b.ui-table-cell-label`. The narrow cells are empty in both
                rows and carry no label.
              */}
              <tr>
                <td />
                <CellLabel name="Date" />
                <td />
                <CellLabel name="Reason" />
                <td />
                <CellLabel name="Earned?">{formatEntry(notation, 'earned')}</CellLabel>
                <td />
                <CellLabel name="Spent?">{formatEntry(notation, 'spent')}</CellLabel>
                <td />
                <CellLabel name="Available">{earned - spent}</CellLabel>
                <td />
              </tr>
              <tr>
                {HEADERS.map((header) => (
                  <Fragment key={header}>
                    <td style={{ paddingRight: '0px' }}>
                      {EDITABLE.has(header) ? (
                        <a
                          href="#"
                          className="experience-notation-edit ui-btn ui-icon-edit ui-btn-icon-notext ui-corner-all ui-btn-inline"
                          style={{ margin: '0px' }}
                          {...{ header, 'notation-id': notation.id }}
                          onClick={(e) => {
                            e.preventDefault();
                            onEdit(notation, header as EditTarget['field']);
                          }}
                        >
                          Edit
                        </a>
                      ) : null}
                    </td>
                    {/* "available" is not a stored property -- not on the
                        model and not on the view -- so asking format_entry for
                        it rendered a permanently blank cell under a column
                        headed "Available". The running balance is earned minus
                        spent. */}
                    <CellLabel name={PRETTY_NAMES[HEADERS.indexOf(header)]!}>
                      {header === 'available' ? earned - spent : formatEntry(notation, header)}
                    </CellLabel>
                  </Fragment>
                ))}
                <td>
                  <a
                    href="#"
                    className="experience-notation-delete ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all ui-btn-inline"
                    {...{ 'notation-id': notation.id }}
                    onClick={(e) => {
                      e.preventDefault();
                      onDelete(notation);
                    }}
                  >
                    Delete
                  </a>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The three edit dialogs.
 *
 * One element each, open or not according to state -- which is what removes
 * both of the legacy view's popup workarounds. See the note on the screen.
 */
function EditPopups({
  editing,
  onClose,
  onSave,
}: {
  editing: EditTarget | null;
  onClose: () => void;
  onSave: (changes: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!editing) return;
    const { notation, field } = editing;
    if (field === 'entered') setDraft(formatEntry(notation, 'entered'));
    else setDraft(String(notation.get(field) ?? ''));
  }, [editing]);

  const field = editing?.field;

  return (
    <>
      <Popup id="popupEditEntered" open={field === 'entered'} onClose={onClose} corners theme="a">
        <form
          id="edit-entered-popup-form"
          onSubmit={(e) => {
            e.preventDefault();
            const entered = parseMomentLLTS(draft);
            if (!entered) return;
            onSave({ entered });
          }}
        >
          <div style={{ padding: '10px 20px' }}>
            {/* `data-role="date"` asks for a date picker jQuery Mobile does
                not ship -- the app loads bootstrap-datepicker's stylesheet from
                a CDN but never initialises it here -- so the control is an
                ordinary text field wearing jQM's text-input wrapper, and the
                date is typed. Reproduced as it renders. */}
            <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
              <input
                type="text"
                id="date-input"
                data-inline="true"
                data-role="date"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="ui-btn ui-corner-all ui-shadow ui-btn-b ui-btn-icon-left ui-icon-check"
            >
              Update Date
            </button>
            <input type="hidden" id="date-id" value={editing?.notation.id ?? ''} readOnly />
          </div>
        </form>
      </Popup>

      <Popup id="popupEditReason" open={field === 'reason'} onClose={onClose} corners theme="a">
        <form
          id="edit-reason-popup-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ reason: draft });
          }}
        >
          <div style={{ padding: '10px 20px' }}>
            <textarea
              id="reason-input"
              className="ui-input-text ui-shadow-inset ui-body-inherit ui-corner-all ui-textinput-autogrow"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              className="ui-btn ui-corner-all ui-shadow ui-btn-b ui-btn-icon-left ui-icon-check"
            >
              Update Reason
            </button>
            <input type="hidden" id="reason-id" value={editing?.notation.id ?? ''} readOnly />
          </div>
        </form>
      </Popup>

      <Popup
        id="alterationpopupEdit"
        open={field === 'alteration_earned' || field === 'alteration_spent'}
        onClose={onClose}
        corners
        theme="a"
      >
        <form
          id="edit-alteration-popup-form"
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number.parseInt(draft, 10);
            if (!Number.isFinite(value) || !field) return;
            onSave({ [field]: value });
          }}
        >
          <div style={{ padding: '10px 20px' }}>
            <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
              <input
                type="number"
                id="alteration-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="ui-btn ui-corner-all ui-shadow ui-btn-b ui-btn-icon-left ui-icon-check"
            >
              Update Alteration Value
            </button>
            <input type="hidden" id="alteration-id" value={editing?.notation.id ?? ''} readOnly />
            <input
              type="hidden"
              id="alteration-type"
              value={field === 'alteration_spent' ? 'spent' : 'earned'}
              readOnly
            />
          </div>
        </form>
      </Popup>

      {/*
        Declared in the template, never opened. No handler in
        CharacterExperienceView references `#popupEditLogin`, and nothing else
        in the app does either -- it looks like a jQuery Mobile demo snippet
        that was pasted in and left. It is in the DOM of every experience page,
        so it is here; it is inert in both.
      */}
      <Popup id="popupEditLogin" open={false} onClose={() => {}} corners theme="a">
        <form>
          <div style={{ padding: '10px 20px' }}>
            <h3>Please sign in</h3>
            <label htmlFor="un" className="ui-hidden-accessible">
              Username:
            </label>
            <div className="ui-input-text ui-body-a ui-corner-all ui-shadow-inset">
              <input type="text" name="user" id="un" defaultValue="" placeholder="username" data-theme="a" />
            </div>
            <label htmlFor="pw" className="ui-hidden-accessible">
              Password:
            </label>
            <div className="ui-input-text ui-body-a ui-corner-all ui-shadow-inset">
              <input type="password" name="pass" id="pw" defaultValue="" placeholder="password" data-theme="a" />
            </div>
            <button
              type="submit"
              className="ui-btn ui-corner-all ui-shadow ui-btn-b ui-btn-icon-left ui-icon-check"
            >
              Sign in
            </button>
          </div>
        </form>
      </Popup>
    </>
  );
}

registerScreen('characterexperience', CharacterExperience);

/** A value cell, with the reflow label jQM gives it from its column header. */
function CellLabel({ name, children }: { name: string; children?: React.ReactNode }) {
  return (
    <td>
      <b className="ui-table-cell-label">{name}</b>
      {children}
    </td>
  );
}
