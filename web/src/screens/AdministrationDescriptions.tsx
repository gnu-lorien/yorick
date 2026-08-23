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
  type FieldType,
} from '@/parse/models/Description';
import { parseCsv, unparseCsv } from '@/csv/papa';
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

registerScreen('administration_descriptions', AdministrationDescriptions);
registerScreen('administration_bnsctdbs_kith_rules', AdministrationDescriptions);
registerScreen('administration_bnsmetv1_clan_rules', AdministrationDescriptions);
registerScreen('administration_bnsmetv1_elder_discipline_rules', AdministrationDescriptions);
registerScreen('administration_bnsmetv1_technique_rules', AdministrationDescriptions);
registerScreen('administration_bnsmetv1_ritual_rules', AdministrationDescriptions);
