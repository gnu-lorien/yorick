import { useEffect, useMemo, useState, type AnchorHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { cx } from '@/jqm/classes';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { reportError, clearError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import type { Description } from '@/parse/models/Description';
import { fetchDescriptions } from '@/parse/descriptions';
import { loadCharacter } from '@/parse/character/load';
import { updateText, unpickText } from '@/parse/character/traits';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Choose the value of a free-text field -- a clan, an archetype, a kith.
 *
 * Ports the `simpletextpick` handler (mobileRouter.js:1774),
 * views/SimpleTextNewView.js and the `#simpletextcategoryDescriptionItems`
 * template.
 *
 * The choices are Description rows filtered by category, which is what
 * helpers/DescriptionFetcher.js fetches. The seeded database holds 1587 of
 * them, so the list is long and jQuery Mobile's filter is what makes it usable
 * -- `data-filter="true"` on the listview, with no `data-input`, so jQM builds
 * its own search box rather than binding to one already on the page.
 *
 * The creation wizard reaches the same picker by a second route,
 * `charactercreatepicksimpletext`. The legacy hands the view its return hash as
 * an argument -- `register(c, category, target, "#charactercreate/" + c.id)` --
 * and nothing else about the two calls differs, so that argument is all this
 * reproduces.
 *
 * @compare #simpletext/clans/clan/9cYrGGv2w3/pick
 * @compare #charactercreate/simpletext/clans/clan/9cYrGGv2w3/pick
 */
export function SimpleTextPick({ route }: ScreenProps) {
  const category = route.named['category'] ?? '';
  const target = route.named['target'] ?? '';
  const cid = route.named['cid'] ?? '';
  const returnTo = returnHashFor(route.entry.handler, cid);

  useBackButton(returnTo);

  const { show, hide } = useLoading();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['simpletext', cid, category],
    enabled: !!cid,
    queryFn: async () => {
      const loaded = await loadCharacter(cid, [category]);
      // Sorted, not merely fetched. The legacy reads these through
      // DescriptionCollection, whose comparator is (order, name); a raw query
      // returns them in whatever order the server chose, which the DOM
      // comparison cannot see because every row has the same shape.
      const descriptions: Description[] = await fetchDescriptions(category);
      return { ...loaded, descriptions };
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = data?.descriptions ?? [];
    if (!needle) return all;
    return all.filter((d) => String(d.get('name') ?? '').toLowerCase().includes(needle));
  }, [data, filter]);

  if (!data) return null;

  async function pick(name: string) {
    setBusy(true);
    show();
    try {
      await updateText(data!.character, data!.venue, target, name);
      clearError();
      navigate(returnTo);
    } catch (error) {
      // A refusal here is a real one -- a Kith grant running out of Art picks,
      // for instance -- and used to leave the picker sitting there with the
      // loader spinning and nothing said.
      setBusy(false);
      reportError(error, "Couldn't pick that");
    } finally {
      // `finally`, not just the catch. The spinner is a nesting counter, so a
      // success path that shows and never hides leaves it permanently up: the
      // overlay swallows clicks, and every "wait for the app to settle" answers
      // no forever. The legacy is saved from this by jQuery Mobile, whose page
      // transition hides the spinner as a side effect; React navigates without
      // touching it.
      hide();
    }
  }

  return (
    <Page id="simpletext-new" title="Simple Text">
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
          <input
            data-type="search"
            placeholder="Filter items..."
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
        data-inset="true"
        data-filter="true"
        className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        {visible.map((description, i) => {
          const name = String(description.get('name') ?? '');
          return (
            <li
              key={description.id ?? name}
              className={cx(
                i === 0 && 'ui-first-child',
                i === visible.length - 1 && 'ui-last-child',
              )}
            >
              {/* `name` on the anchor is how the legacy click handler reads back
                  which row was picked: `$(e.target).attr("name")`. Kept. */}
              <a
                {...({ name } as AnchorHTMLAttributes<HTMLAnchorElement>)}
                href="#"
                className="ui-btn ui-btn-icon-right ui-icon-carat-r simpletext"
                onClick={(e) => {
                  e.preventDefault();
                  if (!busy) void pick(name);
                }}
              >
                {name}
              </a>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

/**
 * Where the two routes that share a screen go when they are done.
 *
 * The sheet, or back into the creation wizard. The legacy encodes this by
 * passing a different hash to `register`; the handler name is the only thing
 * that distinguishes the two calls, so it is what this reads.
 */
function returnHashFor(handler: string, cid: string): string {
  return handler.startsWith('charactercreate') ? `#charactercreate/${cid}` : `#character?${cid}`;
}

/**
 * Clear a free-text field and go back to the sheet.
 *
 * Ports `simpletextunpick`, and `charactercreateunpicksimpletext`, which is the
 * same three steps with the wizard as its destination. Neither renders anything
 * -- the legacy handlers have no `changePage` at all, they unset the field and
 * move the hash -- so this is an effect and a null render.
 */
export function SimpleTextUnpick({ route }: ScreenProps) {
  const target = route.named['target'] ?? '';
  const cid = route.named['cid'] ?? '';
  const category = route.named['category'] ?? '';
  const returnTo = returnHashFor(route.entry.handler, cid);
  const { show, hide } = useLoading();

  useBackButton(returnTo);

  useEffect(() => {
    let cancelled = false;
    show();
    void (async () => {
      try {
        const { character, venue } = await loadCharacter(cid, [category]);
        await unpickText(character, venue, target);
        if (!cancelled) navigate(returnTo);
      } catch (error) {
        if (!cancelled) reportError(error, "Couldn't unpick that");
      } finally {
        hide();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, category, target, returnTo, show, hide]);

  return null;
}

registerScreen('simpletextpick', SimpleTextPick);
registerScreen('simpletextunpick', SimpleTextUnpick);
registerScreen('charactercreatepicksimpletext', SimpleTextPick);
registerScreen('charactercreateunpicksimpletext', SimpleTextUnpick);
