import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { ButtonField, TextareaField } from '@/forms/Backform';
import { useBackButton } from '@/shell/backButton';
import { clearError, showError } from '@/shell/reportError';
import { useSession } from '@/parse/session';
import {
  CLASS_FOR_HANDLER,
  columnsOf,
  learnFieldTypes,
  loadCategories,
  loadRows,
  saveDescriptionRow,
  saveRuleRow,
  type CsvRow,
  type FieldType,
  type LoadedRow,
} from '@/parse/models/Description';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The bulk CSV editor behind all six description and game-rule admin routes.
 *
 * Ports views/DescriptionsView.js and views/EditRules.js, the six
 * `administration_*` handlers in mobileRouter.js:1106-1233, and the
 * `#administration-descriptions` block in public/index.html -- two empty divs,
 * `#descriptions-sections` and `#administration-descriptions-list`, that the
 * two Backform forms are rendered into.
 *
 * One page, six tables. The handlers are identical apart from which Parse
 * class they point the editor at: `administration_descriptions` goes through
 * DescriptionsView, hard-wired to `Description`, and the other five go through
 * EditRules with `update_rule_name("bnsmetv1_ClanRule")` and friends.
 * `web/src/parse/models/Description.ts` holds that mapping and the data half.
 *
 * The screen is two forms:
 *
 * - a category `<select>`, whose options are the distinct `category` values in
 *   the class plus "All". Changing it loads every matching row and writes them
 *   into the textarea as CSV.
 * - a textarea holding that CSV, and a button that reads it back and saves
 *   every row.
 *
 * Nothing loads until a category is picked: the filter model starts at
 * `category: "attributes"` (DescriptionsView.js:170) and the textarea starts at
 * the literal string "Nothing here yet", and `update_categories` replaces the
 * select's options without firing a change. So the page you first see always
 * says "Nothing here yet", even on the Descriptions route where "attributes" is
 * a real category and is the option showing.
 *
 * Only one `@compare` for six routes, and it is the harness that decides that
 * rather than laziness. `compare:dom` walks its hashes in one browser page, and
 * moving between two hashes of the same document does not reload it -- which is
 * the same thing a user does by clicking from one rule editor to another. On
 * that second visit the legacy page is *un-enhanced*: jQuery Mobile enhances
 * `#administration-descriptions` once, at its first `pagecreate`, and both
 * views re-render their forms as raw Backform HTML every time they are opened,
 * with nothing to enhance them again. So the legacy screen genuinely shows a
 * bare browser dropdown and an unstyled button from the second visit onwards,
 * and comparing against that would mean reproducing a defect that only exists
 * for part of the time. Check the other five routes one at a time:
 * `npm run compare:dom -- "#administration/bnsmetv1_clan_rules"`.
 *
 * @compare #administration/descriptions
 */
export function AdministrationDescriptions({ route }: ScreenProps) {
  const handler = route.entry.handler;
  const className = CLASS_FOR_HANDLER[handler] ?? 'Description';
  // DescriptionsView and EditRules diverged: EditRules learned column types,
  // learned which columns identify a row, and surfaces its failures, while the
  // Descriptions route still runs the older handler. Which one you get is
  // decided by the route, so it is carried as a flag rather than duplicated.
  const legacyDescriptionsView = className === 'Description';

  const session = useSession();
  const { track, show, hide } = useLoading();
  const [category, setCategory] = useState(INITIAL_CATEGORY);
  const [csv, setCsv] = useState(INITIAL_CSV);
  const [busy, setBusy] = useState(false);

  // `self.set_back_button("#administration")`, first line of all six handlers.
  useBackButton('#administration');

  // `enforce_admin()`, ported. Unlike the administration menu, these six
  // handlers end in `.fail(PromiseFailReport)` rather than
  // `admin_route_failed`, so a refused non-admin gets a console line and no
  // redirect and no banner -- `changePage` is simply never called and they stay
  // on the page they were already looking at.
  //
  // React cannot stay on the previous page: the route has already changed and
  // this component is what the shell renders for it. Rendering nothing is the
  // closest equivalent, and it keeps the assertion in
  // e2e/admin-rules.spec.js:750 true -- the active page is not
  // `administration-descriptions` for sampmem.
  const blocked = session.loggedIn && !session.admin;
  useEffect(() => {
    if (blocked) {
      console.info(
        'Error in promise ' +
          JSON.stringify({ code: 119, message: 'Administrator access is required for that page.' }),
      );
    }
  }, [blocked]);

  // `update_categories`, plus `learn_field_types` ahead of it on the five rule
  // routes. The legacy chain brackets the whole route in
  // `$.mobile.loading("show")` and lets `changePage` take it down, so the
  // spinner is up for exactly this load.
  const { data, isFetching, error } = useQuery({
    queryKey: ['descriptions', 'categories', className],
    enabled: !blocked && session.loggedIn,
    queryFn: async () => {
      const types = legacyDescriptionsView ? {} : await learnFieldTypes(className);
      const categories = await loadCategories(className);
      return { types, categories };
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  const categories = useMemo(() => data?.categories ?? [], [data]);
  const types = data?.types ?? EMPTY_TYPES;

  // Backform renders the option matching the model's value as `selected`, and
  // when none matches the browser falls back to the first option. That is not
  // cosmetic on the five rule routes: their only real option is the string
  // "undefined" (see loadCategories), so the select shows "undefined" while the
  // model still says "attributes", and picking "undefined" is a no-op change.
  const shown = categories.includes(category) ? category : categories[0];

  async function pick(next: string) {
    setCategory(next);
    // `filterwith`. Note there is no spinner here: the legacy handler brackets
    // the *route* in $.mobile.loading, not this fetch, so selecting a category
    // that matches a thousand rows shows nothing at all while it loads.
    try {
      const rows = await loadRows(className, next);
      setCsv(unparseCsv(columnsOf(rows), rows));
    } catch (err) {
      if (legacyDescriptionsView) {
        // PromiseFailReport: console only. EditRules was given a banner here
        // and DescriptionsView was not.
        console.info('Error in promise ' + JSON.stringify(err));
      } else {
        showError(err, "Couldn't load the rules for that category");
      }
    }
  }

  async function submit() {
    const parsed = parseCsv(csv);
    if (parsed.errors.length) {
      if (legacyDescriptionsView) {
        // DescriptionsView.js:36 logs the errors and returns. Nothing on the
        // page changes, so a malformed paste looks exactly like a successful
        // save that had no work to do.
        console.log(JSON.stringify(parsed.errors));
        for (const e of parsed.errors) {
          if (e.row) console.log('Row ' + e.row + ' has bad data ' + e.message);
        }
      } else {
        showError(
          parsed.errors
            .map((e) => e.message + (e.row === undefined ? '' : ' (row ' + e.row + ')'))
            .join('\n'),
          "Couldn't read the edited rules",
        );
      }
      return;
    }

    setBusy(true);
    try {
      // Every row is started before any is awaited, as `_.map(...)` into
      // `Parse.Promise.when` did. The rows are independent and there are
      // hundreds of them in a full-category submission.
      const saves = parsed.rows.map((row) =>
        legacyDescriptionsView ? saveDescriptionRow(row) : saveRuleRow(className, row, types),
      );
      await track(Promise.all(saves));
      console.log('Saved all of that');
      // ReportError.clear() on success, so the banner from a previous failed
      // submission does not outlive the fix. DescriptionsView has no banner to
      // clear.
      if (!legacyDescriptionsView) clearError();
    } catch (err) {
      if (legacyDescriptionsView) {
        console.info('Error in promise ' + JSON.stringify(err));
      } else {
        showError(err, "Couldn't save the rule changes");
      }
    } finally {
      setBusy(false);
    }
  }

  if (blocked) return null;

  return (
    <Page id="administration-descriptions" title="Descriptions">
      <div id="descriptions-sections">
        {/* Written out rather than taken from forms/Backform's `Form`, which
            always carries `profile-form`: that class belongs to the one form
            in index.html that Backform adopts with `setElement`. These two are
            created by Backbone, so they wear `className`, which is
            `Backform.formClassName` -- "backform form-horizontal". */}
        <form className="backform form-horizontal" onSubmit={(e) => e.preventDefault()}>
          <div className="form-group category">
            <label className="control-label col-sm-4">Category</label>
            <div className="col-sm-8">
              {/* jQuery Mobile's selectmenu, written out rather than taken
                  from forms/Backform's `SelectField`, which differs from what
                  jQM actually produces here in two ways: it puts an id on the
                  `<select>`, where Backform's SelectControl template emits
                  none, and it leaves the mirroring `<span>` unclassed, where
                  jQM copies the select's own class onto it. Both are visible
                  to `compare:dom`, and fixing a shared file mid-migration is
                  not this screen's call.

                  The button carries no id. jQM's is
                  `<select id>-button`, and with no id on the select it falls
                  back to `select-<n>-button` where `n` is jQuery UI's global
                  widget counter (jquery.mobile-1.4.5.js:10096) -- so it counts
                  every widget built since the page was loaded and comes out
                  different depending on how you got here: 16 arriving straight
                  from a reload, 19 under compare:dom, higher again after
                  clicking around. There is no value React could write that
                  would be right, nothing in the stylesheet or the E2E suite
                  reads it, and inventing a fixed number would only make the
                  comparison pass by accident. */}
              <div className="ui-select">
                <div className="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
                  <span className="form-control">{shown ?? ''}</span>
                  <select
                    className="form-control"
                    name="category"
                    value={JSON.stringify(shown ?? '')}
                    onChange={(e) => void pick(JSON.parse(e.target.value) as string)}
                  >
                    {categories.map((option) => (
                      // Backform's SelectControl runs option values through
                      // JSONFormatter, so the DOM value of "attributes" is
                      // `"attributes"`, quotes included.
                      <option key={option} value={JSON.stringify(option)}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
      <div id="administration-descriptions-list">
        <form
          className="backform form-horizontal"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/* The button is the *first* field in both views, above the textarea
              it submits. */}
          <ButtonField name="" label="Update Changes to Server" disabled={busy} />
          <TextareaField
            name="descriptiondata"
            label="Descriptions"
            value={csv}
            onChange={setCsv}
            // DescriptionsView raises the limit to 100000; EditRules never did,
            // so the five rule editors silently truncate a paste at Backform's
            // default 4000 characters.
            maxLength={legacyDescriptionsView ? 100000 : 4000}
          />
        </form>
      </div>
      {/* The legacy chain ends in PromiseFailReport, which writes to the
          console and lets the page appear regardless, so a class that cannot
          be read renders as an editor with one option and no explanation.
          Saying so is the one deliberate addition. */}
      {error ? <p className="error">{String(error)}</p> : null}
    </Page>
  );
}

/** DescriptionsView.js:170 / EditRules.js:279. */
const INITIAL_CATEGORY = 'attributes';
const INITIAL_CSV = 'Nothing here yet';
const EMPTY_TYPES: Record<string, FieldType> = {};

/**
 * Papa Parse, the two calls this screen makes of it.
 *
 * papaparse is vendored under public/scripts/lib/ as a UMD bundle for
 * RequireJS and is not an npm dependency, so it is not importable here. These
 * two functions reproduce the behaviour the screen depends on -- including the
 * parts the E2E suite has pinned down, which are the interesting ones.
 */

interface CsvError {
  type: string;
  code: string;
  message: string;
  row?: number;
}

/**
 * `Papa.unparse({fields, data})`.
 *
 * Fields are quoted only when they have to be: when they contain a quote, a
 * comma, a newline, or lead or trail with a space. Quotes inside are doubled.
 * Rows are joined with CRLF and there is no trailing newline -- which matters,
 * because `parseCsv` treats a trailing blank line as a malformed row.
 */
function unparseCsv(fields: string[], rows: LoadedRow[]): string {
  const line = (cells: unknown[]) => cells.map(csvCell).join(',');
  return [line(fields), ...rows.map((row) => line(fields.map((f) => row[f])))].join('\r\n');
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  // Papa's own Date branch: `JSON.stringify(date).slice(1, 25)`, which is the
  // ISO string without its quotes. It matters here because `attributes` on a
  // Parse object includes `createdAt` and `updatedAt`, so every export carries
  // two Date columns and `String(date)` would write "Mon Jul 27 2015 ..."
  // instead.
  if (value instanceof Date) return JSON.stringify(value).slice(1, 25);
  const text = String(value).replace(/"/g, '""');
  const needsQuotes =
    /["\r\n,]/.test(text) || text.startsWith(' ') || text.endsWith(' ');
  return needsQuotes ? '"' + text + '"' : text;
}

/**
 * `Papa.parse(text, {header: true})`.
 *
 * The first record is the header; every later record becomes an object keyed by
 * it. A record with the wrong number of cells is a `FieldMismatch` error, and
 * the submit handlers abort the whole submission on any error at all -- so a
 * textarea ending in a newline saves nothing, because the empty final line
 * parses as a one-cell record and is "Too few fields". Confirmed live in
 * e2e/helpers/descriptions.js:270.
 */
function parseCsv(text: string): { fields: string[]; rows: CsvRow[]; errors: CsvError[] } {
  const records = csvRecords(text);
  const errors: CsvError[] = [];
  if (!records.length) return { fields: [], rows: [], errors };

  const fields = records[0] ?? [];
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i] ?? [];
    if (cells.length < fields.length) {
      errors.push({
        type: 'FieldMismatch',
        code: 'TooFewFields',
        message: `Too few fields: expected ${fields.length} fields but parsed ${cells.length}`,
        row: i - 1,
      });
    } else if (cells.length > fields.length) {
      errors.push({
        type: 'FieldMismatch',
        code: 'TooManyFields',
        message: `Too many fields: expected ${fields.length} fields but parsed ${cells.length}`,
        row: i - 1,
      });
    }
    const row: CsvRow = {};
    fields.forEach((field, c) => {
      if (c < cells.length) row[field] = cells[c] ?? '';
    });
    rows.push(row);
  }
  return { fields, rows, errors };
}

/** Split CSV text into records of cells, honouring RFC 4180 quoting. */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      records.push(cells);
      cells = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length) {
    cells.push(cell);
    records.push(cells);
  }
  return records;
}

registerScreen('administration_descriptions', AdministrationDescriptions);
registerScreen('administration_bnsctdbs_kith_rules', AdministrationDescriptions);
registerScreen('administration_bnsmetv1_clan_rules', AdministrationDescriptions);
registerScreen('administration_bnsmetv1_elder_discipline_rules', AdministrationDescriptions);
registerScreen('administration_bnsmetv1_technique_rules', AdministrationDescriptions);
registerScreen('administration_bnsmetv1_ritual_rules', AdministrationDescriptions);
