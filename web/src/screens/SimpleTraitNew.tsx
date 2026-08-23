import { useEffect, useMemo, useState, type AnchorHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { cx } from '@/jqm/classes';
import { useLoading } from '@/jqm/Loader';
import { Form, SelectField, CheckboxField, BACKFORM_OWN_CLASS } from '@/forms/Backform';
import { useBackButton } from '@/shell/backButton';
import { reportError, showError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import type { Description } from '@/parse/models/Description';
import type { Character } from '@/parse/models/Character';
import type { SimpleTrait } from '@/parse/models/SimpleTrait';
import { fetchDescriptions, requireSpecialization } from '@/parse/descriptions';
import { loadCharacter } from '@/parse/character/load';
import { traitsIn, updateTrait } from '@/parse/character/traits';
import { fetchAllCreationElements } from '@/parse/character/creation';
import { inClanDisciplines } from '@/parse/venues/vampire';
import { affinitiesOf } from '@/parse/venues/werewolf';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Picking a new trait out of the Description table.
 *
 * Two screens share almost all of this, and the legacy has two views for them:
 *
 *   simpletraits/:category/:cid/new                    SimpleTraitNewView
 *   charactercreate/simpletraits/:cat/:cid/pick/:i     CharacterCreateSimpleTraitNewView
 *
 * They differ in three ways and no others. The `/new` picker wraps its list in
 * a LayoutView that also carries the gift filter form; the wizard's picker
 * renders the list straight into the page. The `/new` picker navigates to the
 * trait *editor* so the player can choose a value; the wizard's calls
 * `update_trait` itself, because the creation pool has already decided the
 * value. And the wizard's applies a filter rule -- in-clan disciplines for a
 * vampire, affinity gifts for a werewolf -- that the `/new` picker does not.
 *
 * The row filtering itself is shared, and is the part worth stating plainly: a
 * trait the character already holds is not offered again, EXCEPT when it
 * requires a specialization, since those can be taken more than once.
 */

/* --------------------------------------------------------------- filters -- */

/** What the wizard's route asks for, from `charactercreatepicksimpletrait`. */
type FilterRule = 'in clan disciplines' | 'affinity' | 'show_only_value_1';

function filterRulesFor(category: string): FilterRule[] {
  if (category === 'disciplines') return ['in clan disciplines'];
  if (category === 'wta_gifts') return ['affinity', 'show_only_value_1'];
  return [];
}

/** Whether a gift names one of the character's affinities in `affinity_1..3`. */
function isAffinityOf(description: Description, affinities: string[]): boolean {
  return [1, 2, 3].some((i) => affinities.includes(description.get(`affinity_${i}`)));
}

interface FilterInput {
  descriptions: Description[];
  character: Character;
  category: string;
  rules: FilterRule[];
}

/**
 * The rows a player may pick, in the order the list shows them.
 *
 * Note what the two special rules do when the character has *no* in-clan
 * disciplines and no affinities: the legacy guards each branch with
 * `if (0 != icd.length)`, so an empty list means no filtering at all and every
 * row is offered. That reads like a bug and is preserved, because narrowing it
 * would silently stop a clanless character picking anything.
 */
function pickableRows({ descriptions, character, category, rules }: FilterInput): Description[] {
  const specializable = requireSpecialization(descriptions);
  // Traits already held, minus the ones that can be taken again.
  const held = traitsIn(character, category)
    .map((trait) => trait.name)
    .filter((name) => !specializable.includes(name));

  let rows: Description[];
  if (rules.includes('in clan disciplines')) {
    const inClan = inClanDisciplines(character);
    rows =
      inClan.length === 0
        ? descriptions
        : descriptions.filter(
            (row) => !held.includes(row.get('name')) && inClan.includes(row.get('name')),
          );
  } else if (rules.includes('affinity')) {
    const affinities = affinitiesOf(character);
    rows =
      affinities.length === 0
        ? descriptions
        : descriptions.filter(
            (row) => !held.includes(row.get('name')) && isAffinityOf(row, affinities),
          );
  } else {
    rows = descriptions.filter((row) => !held.includes(row.get('name')));
  }

  if (rules.includes('show_only_value_1')) {
    rows = rows.filter((row) => row.get('value') === 1);
  }
  return rows;
}

/* ------------------------------------------------------------ the shared list -- */

function PickList({
  rows,
  onPick,
  busy,
  filterable,
}: {
  rows: Description[];
  onPick: (row: Description) => void;
  busy: boolean;
  /**
   * `class="ui-filterable"` on the `<ul>` itself.
   *
   * The two templates differ here and nowhere else in this element:
   * simpletrait-new-list.html writes the class out, the wizard's inline
   * template does not. jQuery Mobile adds `ui-listview` to both.
   */
  filterable?: boolean;
}) {
  return (
    <ul
      data-role="listview"
      data-filter="true"
      data-input="#filterBasic-input"
      className={cx('ui-listview', filterable && 'ui-filterable')}
    >
      {rows.map((row, i) => {
        const name = String(row.get('name') ?? '');
        const value = row.get('value');
        return (
          <li
            key={row.id ?? name}
            className={cx(i === 0 && 'ui-first-child', i === rows.length - 1 && 'ui-last-child')}
          >
            {/* `name` and `backendid` are how the legacy click handler reads
                back which row was clicked. `backendid` is lowercase because
                React would warn about a camelCased unknown attribute, and HTML
                attribute names are case-insensitive. */}
            <a
              {...({ name, backendid: row.id } as AnchorHTMLAttributes<HTMLAnchorElement>)}
              href="#"
              className="ui-btn ui-btn-icon-right ui-icon-carat-r simpletrait"
              onClick={(e) => {
                e.preventDefault();
                if (!busy) onPick(row);
              }}
            >
              {value !== undefined ? `${name} x${value}` : name}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** jQuery Mobile's search box, bound to the list by `data-input`. */
function FilterBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
      <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
        <input
          id="filterBasic-input"
          data-type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <a
          href="#"
          tabIndex={-1}
          aria-hidden="true"
          title="Clear text"
          className={cx(
            'ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all',
            !value && 'ui-input-clear-hidden',
          )}
          onClick={(e) => {
            e.preventDefault();
            onChange('');
          }}
        >
          Clear text
        </a>
      </div>
    </form>
  );
}

/* --------------------------------------------------------- the gift filters -- */

interface GiftFilters {
  affinities: 'mine' | 'any';
  ladder: boolean;
  sort: 'alpha' | 'level';
  direction: 'asc' | 'desc';
}

const DEFAULT_GIFT_FILTERS: GiftFilters = {
  affinities: 'mine',
  ladder: true,
  sort: 'level',
  direction: 'asc',
};

/**
 * The gift ladder: level N is available only while fewer gifts are held at N
 * than at N-1.
 *
 * Ports the `ladder` branch of SimpleTraitNewView's templateHelpers. Level 1 is
 * always available; a level with no rung below it is not.
 */
function availableGiftLevels(character: Character): number[] {
  const held = traitsIn(character, 'wta_gifts');
  const rungs = new Map<number, number>();
  for (const gift of held) {
    const level = gift.value ?? 0;
    rungs.set(level, (rungs.get(level) ?? 0) + 1);
  }
  const levels = [1];
  for (let level = 2; level < 6; level += 1) {
    const available = (rungs.get(level - 1) ?? 0) - (rungs.get(level) ?? 0);
    if (available > 0) levels.push(level);
  }
  return levels;
}

function applyGiftFilters(
  rows: Description[],
  character: Character,
  filters: GiftFilters,
): Description[] {
  let out = rows;
  if (filters.affinities === 'mine') {
    const affinities = affinitiesOf(character);
    // Same empty-list escape hatch as the wizard's rule: no affinities means
    // no narrowing rather than an empty list.
    if (affinities.length !== 0) out = out.filter((row) => isAffinityOf(row, affinities));
  }
  if (filters.ladder) {
    const levels = availableGiftLevels(character);
    out = out.filter((row) => levels.includes(Number(row.get('value'))));
  }
  const compare = (left: unknown, right: unknown) =>
    left === right ? 0 : (left as number) > (right as number) ? 1 : -1;
  if (filters.sort === 'alpha') {
    out = [...out].sort((l, r) => compare(l.get('name'), r.get('name')));
  } else if (filters.sort === 'level') {
    out = [...out].sort(
      (l, r) => compare(l.get('value'), r.get('value')) || compare(l.get('name'), r.get('name')),
    );
  }
  if (filters.direction === 'desc') out = [...out].reverse();
  return out;
}

function GiftFilterForm({
  filters,
  onChange,
}: {
  filters: GiftFilters;
  onChange: (filters: GiftFilters) => void;
}) {
  const set = <K extends keyof GiftFilters>(key: K, value: GiftFilters[K]) =>
    onChange({ ...filters, [key]: value });
  return (
    <Form className={BACKFORM_OWN_CLASS}>
      <SelectField
        name="affinities"
        label="Show by Affinity"
        value={filters.affinities}
        onChange={(value) => set('affinities', value as GiftFilters['affinities'])}
        options={[
          { label: 'Mine', value: 'mine' },
          { label: 'Any', value: 'any' },
        ]}
      />
      <CheckboxField
        name="ladder"
        label="Show only available on the gift level ladder"
        checked={filters.ladder}
        onChange={(value) => set('ladder', value)}
      />
      <SelectField
        name="sort"
        label="Sort By"
        value={filters.sort}
        onChange={(value) => set('sort', value as GiftFilters['sort'])}
        options={[
          { label: 'Alphabetical', value: 'alpha' },
          { label: 'Level', value: 'level' },
        ]}
      />
      <SelectField
        name="direction"
        label="Direction"
        value={filters.direction}
        onChange={(value) => set('direction', value as GiftFilters['direction'])}
        options={[
          { label: 'Ascending', value: 'asc' },
          { label: 'Descending', value: 'desc' },
        ]}
      />
    </Form>
  );
}

/* ------------------------------------------------------------------ screens -- */

function usePicker(cid: string, category: string, withCreation: boolean) {
  const { show, hide } = useLoading();
  const query = useQuery({
    queryKey: ['simpletrait-new', cid, category, withCreation],
    enabled: !!cid,
    queryFn: async () => {
      const loaded = await loadCharacter(cid, [category]);
      if (withCreation) await fetchAllCreationElements(loaded.character, loaded.venue);
      const descriptions = await fetchDescriptions(category);
      return { ...loaded, descriptions };
    },
  });

  useEffect(() => {
    if (!query.isFetching) return;
    show();
    return hide;
  }, [query.isFetching, show, hide]);

  return query;
}

/**
 * Add a trait to a category, outside creation.
 *
 * Ports the `"new"` branch of the `simpletraits` handler (mobileRouter.js:1819)
 * and views/SimpleTraitNewView.js. Picking a row does not save anything: it
 * navigates to the trait editor with the name and value in the hash, and the
 * player sets the value there. A row that requires a specialization goes to the
 * specialization screen first.
 *
 * @compare #simpletraits/backgrounds/9cYrGGv2w3/new
 * @compare #simpletraits/wta_gifts/ISZilUG8M4/new
 */
export function SimpleTraitNew({ route }: ScreenProps) {
  const category = route.named['category'] ?? '';
  const cid = route.named['cid'] ?? '';

  useBackButton(`#simpletraits/${category}/${cid}/all`);

  const [filter, setFilter] = useState('');
  const [giftFilters, setGiftFilters] = useState(DEFAULT_GIFT_FILTERS);
  const { data } = usePicker(cid, category, false);

  const rows = useMemo(() => {
    if (!data) return [];
    let out = pickableRows({
      descriptions: data.descriptions,
      character: data.character,
      category,
      rules: [],
    });
    // The gift filter form applies only to `wta_gifts`, which is also the only
    // category whose form is rendered at all.
    if (category === 'wta_gifts') out = applyGiftFilters(out, data.character, giftFilters);
    return out;
  }, [data, category, giftFilters]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => String(row.get('name') ?? '').toLowerCase().includes(needle));
  }, [rows, filter]);

  const specializable = data ? requireSpecialization(data.descriptions) : [];

  function pick(row: Description) {
    const name = String(row.get('name') ?? '');
    // `var cost = 1; if (valueField) cost = valueField;` -- a row with no
    // `value`, or a value of 0, is picked at 1.
    const cost = Number(row.get('value')) || 1;
    // `free_value` is always 0 here: the `/new` route calls `register(c,
    // category)` with no pool, so the legacy's `self.free_value` is undefined
    // and the redirect writes `|| 0`.
    const tail = `${category}/${cid}/${encodeURIComponent(name)}/${cost}/0/new`;
    navigate(specializable.includes(name) ? `#simpletrait/specialize/${tail}` : `#simpletrait/spacer/${tail}`);
  }

  return (
    <Page id="simpletrait-new" title="New Simple Trait">
      {/* The LayoutView's own template contributes this div, and the list view
          unwraps itself into `#category-list` -- so the `<ul>` sits inside one
          div of its own rather than two. */}
      <div>
        <div id="category-filter-rules">
          {category === 'wta_gifts' ? (
            <GiftFilterForm filters={giftFilters} onChange={setGiftFilters} />
          ) : null}
        </div>
        <FilterBox value={filter} onChange={setFilter} />
        <div id="category-list">
          <div>
            <PickList rows={visible} onPick={pick} busy={false} filterable />
          </div>
        </div>
      </div>
    </Page>
  );
}

/**
 * Spend a creation pool slot on a trait.
 *
 * Ports `charactercreatepicksimpletrait` (mobileRouter.js:600) and
 * views/CharacterCreateSimpleTraitNewView.js. Unlike the screen above, picking
 * here writes the trait immediately -- the rating came from the route, so there
 * is nothing left to ask -- and then returns to the wizard.
 *
 * The guard on the way in matters and is not presentational. The wizard stops
 * drawing a pick link once a pool is exhausted, but the route checked nothing,
 * so a hand-typed URL walked the counter past zero and corrupted the character.
 * The check is here, where the decision is made.
 *
 * @compare #charactercreate/simpletraits/attributes/9cYrGGv2w3/pick/4
 * @compare #charactercreate/simpletraits/disciplines/9cYrGGv2w3/pick/2
 * @compare #charactercreate/simpletraits/wta_gifts/ISZilUG8M4/pick/2
 */
export function CharacterCreatePickSimpleTrait({ route }: ScreenProps) {
  const category = route.named['category'] ?? '';
  const cid = route.named['cid'] ?? '';
  const freeValue = parseInt(route.named['i'] ?? '', 10) || 0;

  useBackButton(`#charactercreate/${cid}`);

  const { show, hide } = useLoading();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const { data, error, isFetching } = usePicker(cid, category, true);

  // The pool check. It runs once the creation record is in hand, and a refusal
  // reports and returns to the wizard rather than rendering a picker that
  // cannot be used.
  // `if (_.isNumber(remaining) && remaining <= 0)`. The `isNumber` is not
  // decoration: a pool the venue never seeded has no counter at all, and a
  // missing counter must not read as an exhausted one -- that would refuse
  // every pick in a category the wizard offers freely.
  //
  // `!isFetching` is the other half, and it is not a nicety. A query with
  // cached data hands it back immediately and refetches behind it, so on the
  // first render of a return visit `remaining` is whatever it was last time --
  // zero, if the slot was spent and has since been unpicked. Deciding on that
  // value refuses a pick the player is entitled to and bounces them back to the
  // wizard. The legacy has no equivalent because it fetches before it decides,
  // every time.
  const creation = data?.character.get('creation') as Parse.Object | undefined;
  const remaining = creation?.get(`${category}_${freeValue}_remaining`);
  const exhausted = !isFetching && typeof remaining === 'number' && remaining <= 0;

  useEffect(() => {
    if (error) showError(error, "Couldn't open that pick");
  }, [error]);

  useEffect(() => {
    if (!exhausted) return;
    showError(
      new Error(`No creation picks left for ${category} at rating ${freeValue}.`),
      "Couldn't open that pick",
    );
    navigate(`#charactercreate/${cid}`);
  }, [exhausted, category, freeValue, cid]);

  const rows = useMemo(() => {
    if (!data) return [];
    return pickableRows({
      descriptions: data.descriptions,
      character: data.character,
      category,
      rules: filterRulesFor(category),
    });
  }, [data, category]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => String(row.get('name') ?? '').toLowerCase().includes(needle));
  }, [rows, filter]);

  async function pick(row: Description) {
    if (!data) return;
    setBusy(true);
    show();
    const name = String(row.get('name') ?? '');
    // Here the fallback is the pool's rating rather than 1: a discipline picked
    // out of the rating-2 pool costs 2 unless its own row names a value.
    const cost = Number(row.get('value')) || freeValue;
    try {
      const trait: SimpleTrait = await updateTrait(data.character, data.venue, {
        nameOrTrait: name,
        value: cost,
        category,
        freeValue,
      });
      const specializable = requireSpecialization(data.descriptions);
      navigate(
        specializable.includes(trait.name)
          ? `#charactercreate/simpletraits/${category}/${cid}/specialize/${trait.linkId()}/${freeValue}`
          : `#charactercreate/${cid}`,
      );
    } catch (e) {
      setBusy(false);
      reportError(e, "Couldn't pick that");
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

  if (!data || exhausted) return null;

  return (
    <Page id="character-create-simpletrait-new" title="New Simple Trait">
      {/* `Pick one for value N` -- shown because this picker always has a pool.
          The `/new` screen never does, so its template skips it. */}
      {freeValue ? <p>Pick one for value {freeValue}</p> : null}
      <FilterBox value={filter} onChange={setFilter} />
      <PickList rows={visible} onPick={(row) => void pick(row)} busy={busy} />
    </Page>
  );
}

registerScreen('charactercreatepicksimpletrait', CharacterCreatePickSimpleTrait);
