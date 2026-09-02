import { useEffect, useMemo, useState, type AnchorHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { cx } from '@/jqm/classes';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import { Parse } from '@/parse/init';
import { Character, sortCharacters } from '@/parse/models/Character';
import type { SimpleTrait } from '@/parse/models/SimpleTrait';
import { Troupe } from '@/parse/models/Troupe';
import { hydratePointers } from '@/parse/users';
import { venueData } from '@yorick/venues';
import { useSession } from '@/parse/session';
import { Form, SelectField, CheckboxField, BACKFORM_OWN_CLASS } from '@/forms/Backform';
import { registerScreen, type ScreenProps } from './registry';

/**
 * A filterable roster that can show one trait category across many characters.
 *
 * Ports views/CharactersSummarizeListView.js and the two handlers that render
 * it: `troupesummarizecharacters` for one troupe and
 * `administration_characters_summarize` for everything.
 *
 * It is a roster with a Backform filter bar above it. The bar has five
 * controls, all of them driving one filter function:
 *
 *   category      which trait category to show under each character
 *   antecedence   NPC / PC / Primary / Secondary / All
 *   resulttype    only those with values in the category, only those without, all
 *   playable      only characters that still have an owner
 *   format        pretty, CSV, or CSV grouped by trait
 *
 * The category select is the one control Backform has no builtin for -- it is
 * grouped by venue -- so the legacy view defines an `OptGroupSelectControl` for
 * it. Its markup is Backform's select with `<optgroup>` inserted, which is what
 * `SelectField` gets here through `groups`.
 *
 * The commented-out `FiltersView` and `filterable` calls are left out. They are
 * dead in the original: a block of category buttons and jQM's filterable widget,
 * both commented out, with the search input in index.html left orphaned above a
 * list nothing binds it to.
 *
 * @compare #troupe/qvtD2RxzGG/characters/summarize/all
 */
export function TroupeSummarizeCharacters({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  useBackButton(`#troupe/${id}`);

  const { show, hide } = useLoading();
  const { data, isFetching, error } = useQuery({
    queryKey: ['troupe-summarize', id],
    enabled: !!id,
    queryFn: async () => {
      const troupe = await new Parse.Query(Troupe).include('portrait').get(id);
      return fetchSummarizable((query) => query.equalTo('troupes', troupe));
    },
  });

  useSpinner(isFetching, show, hide);
  useEffect(() => {
    if (error) showError(error, "Couldn't summarize that troupe's characters");
  }, [error]);

  return (
    <SummarizeRoster
      characters={data ?? []}
      href={(cid) => `#troupe/${id}/character/${cid}`}
    />
  );
}

/**
 * The same screen over every character in the system.
 *
 * @compare #administration/characters/summarize
 */
export function AdministrationSummarizeCharacters(_: ScreenProps) {
  const session = useSession();
  useBackButton('#administration');

  const { show, hide } = useLoading();
  const blocked = session.loggedIn && !session.admin;

  useEffect(() => {
    if (!blocked) return;
    showError('Administrator access is required for that page.', "Couldn't summarize every character");
    navigate('');
  }, [blocked]);

  const { data, isFetching, error } = useQuery({
    queryKey: ['administration-summarize'],
    enabled: !blocked,
    queryFn: () => fetchSummarizable((query) => query.exists('owner')),
  });

  useSpinner(isFetching, show, hide);
  useEffect(() => {
    if (error) showError(error, "Couldn't summarize every character");
  }, [error]);

  if (blocked) return null;
  return (
    <SummarizeRoster
      characters={data ?? []}
      href={(cid) => `#administration/character/${cid}`}
    />
  );
}

function useSpinner(active: boolean, show: () => void, hide: () => void) {
  useEffect(() => {
    if (!active) return;
    show();
    return hide;
  }, [active, show, hide]);
}

/**
 * Fetch characters with every trait category included.
 *
 * This screen shows a whole category's traits under each character, so the
 * traits have to come with them -- `include` per category, which is what makes
 * this the heaviest query in the app. The legacy runs it as two queries,
 * werewolves and then everything else, each including its own venue's
 * categories; a single class needs only the union.
 *
 * As everywhere else, `owner` is NOT included -- see parse/users.ts -- and the
 * names are filled in afterwards.
 */
export async function fetchSummarizable(
  narrow: (query: Parse.Query<Character>) => Parse.Query<Character>,
): Promise<Character[]> {
  const categories = new Set<string>();
  for (const venue of Object.values(venueData)) {
    for (const category of venue.categories) categories.add(category.key);
  }

  const query = narrow(new Parse.Query(Character).include('portrait'));
  for (const category of categories) query.include(category);

  const found: Character[] = [];
  await query.each((character) => {
    found.push(character);
  });
  await hydratePointers(found, 'owner');
  return found;
}

type Format = 'pretty' | 'csv' | 'csvtraitgrouping';

interface Filters {
  category: string;
  antecedence: string;
  resulttype: string;
  playable: boolean;
  format: Format;
}

const DEFAULT_FILTERS: Filters = {
  playable: true,
  category: 'attributes',
  antecedence: 'PC',
  resulttype: 'onlycat',
  format: 'pretty',
};

export interface SummarizeRosterProps {
  characters: Character[];
  href: (id: string) => string;
  /** The jQuery Mobile page this renders into. */
  pageId?: string;
  title?: string;
  /** The id of the div wrapping the list. Differs between the two pages. */
  listId?: string;
  /** The search input's id, which each page declares for itself. */
  filterId?: string;
  /**
   * Whether the filter form offers the format select.
   *
   * The two views declare different field lists: the summarize form has five
   * fields, the select-to-print form has the first four. Its `filterOptions`
   * still carries `format: "pretty"`, so the format is fixed rather than absent
   * -- which is why this is a field-list switch and not a change of defaults.
   */
  showFormat?: boolean;
  /** Rendered between the filter bar and the list -- the print options. */
  betweenSections?: React.ReactNode;
  /** Told the filtered set on every change, so a sibling screen can print it. */
  onFilteredChange?: (characters: Character[]) => void;
}

export function SummarizeRoster({
  characters,
  href,
  pageId = 'troupe-summarize-characters-all',
  title = 'Troupe Characters',
  listId = 'troupe-summarize-characters-list',
  filterId = 'troupes-summarize-characters-filter',
  showFormat = true,
  betweenSections,
  onFilteredChange,
}: SummarizeRosterProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const sorted = useMemo(() => sortCharacters(characters), [characters]);
  const visible = useMemo(() => sorted.filter((c) => matches(c, filters)), [sorted, filters]);

  // `get_filtered()` on the legacy view: the print screen reads it off the
  // select-to-print view, which the router memoises between the two routes.
  useEffect(() => {
    onFilteredChange?.(visible);
  }, [visible, onFilteredChange]);

  // The heading shown above each character's traits: the category's pretty
  // name, looked up across the venues in the order the legacy searches them --
  // vampire first, then werewolf.
  const categoryName = useMemo(() => prettyNameFor(filters.category), [filters.category]);

  // Every distinct trait name in the chosen category, across ALL the loaded
  // characters -- not the filtered ones. `getColumnNames` maps over
  // `self.collection.models`, which is the whole set, so the CSV column layout
  // stays put as the filters change.
  const columnNames = useMemo(() => {
    const names = new Set<string>();
    for (const character of sorted) {
      for (const trait of (character.get(filters.category) as SimpleTrait[] | undefined) ?? []) {
        if (trait?.name) names.add(trait.name);
      }
    }
    return [...names].sort();
  }, [sorted, filters.category]);

  return (
    <Page id={pageId} title={title}>
      <div id="sections">
        {/* Backform builds this form itself rather than rendering into markup
            already on the page, so it carries its own className. */}
        <Form className={BACKFORM_OWN_CLASS}>
          <SelectField
            name="category"
            label="Category"
            value={filters.category}
            onChange={(value) => set('category', value)}
            options={[]}
            groups={CATEGORY_GROUPS}
          />
          <SelectField
            name="antecedence"
            label="NPC, PC, Primary, or Secondary"
            value={filters.antecedence}
            onChange={(value) => set('antecedence', value)}
            options={[
              { label: 'All', value: 'All' },
              { label: 'NPC', value: 'NPC' },
              { label: 'PC of any type', value: 'PC' },
              { label: 'Primary PC', value: 'Primary' },
              { label: 'Secondary PC', value: 'Secondary' },
            ]}
          />
          <SelectField
            name="resulttype"
            label="Which sort of results to show?"
            value={filters.resulttype}
            onChange={(value) => set('resulttype', value)}
            options={[
              { label: 'Only those with values in the category', value: 'onlycat' },
              { label: 'Only those with no values in the category', value: 'nocat' },
              { label: 'All', value: 'all' },
            ]}
          />
          <CheckboxField
            name="playable"
            label="Only show playable characters"
            checked={filters.playable}
            onChange={(value) => set('playable', value)}
          />
          {showFormat ? (
            <SelectField
              name="format"
              label="Format"
              value={filters.format}
              onChange={(value) => set('format', value as Format)}
              options={[
                { label: 'Pretty', value: 'pretty' },
                { label: 'CSV', value: 'csv' },
                { label: 'CSV with Trait Grouping', value: 'csvtraitgrouping' },
              ]}
            />
          ) : null}
        </Form>
      </div>

      {betweenSections}

      {/* The search box is in index.html and bound to nothing: the view's
          `filterable` calls are all commented out. Kept, because it is in the
          DOM. The select-to-print page declares no such box, so it passes no
          filterId and this is skipped. */}
      {filterId ? (
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
          <input id={filterId} data-type="search" readOnly />
          <a
            href="#"
            tabIndex={-1}
            aria-hidden="true"
            title="Clear text"
            className="ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all ui-input-clear-hidden"
            onClick={(e) => e.preventDefault()}
          >
            Clear text
          </a>
        </div>
      </form>
      ) : null}

      <div id={listId}>
        <ul
          data-role="listview"
          data-inset="true"
          data-filter="true"
          data-input={`#${filterId}`}
          className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
        >
          {visible.map((character, i) => (
            // `ul-li-has-thumb` on the pretty rows only: PrettyView declares
            // that className and the two CSV views declare none.
            <li
              key={character.id}
              className={cx(
                filters.format === 'pretty' && 'ul-li-has-thumb',
                i === 0 && 'ui-first-child',
                i === visible.length - 1 && 'ui-last-child',
              )}
            >
              <SummarizeRow
                character={character}
                href={href}
                format={filters.format}
                category={filters.category}
                categoryName={categoryName}
                columnNames={columnNames}
              />
            </li>
          ))}
        </ul>
      </div>
    </Page>
  );
}

/**
 * Does this character survive the filter bar?
 *
 * Ports `newfilter`. Two details are easy to lose:
 *
 * - A character with no `antecedence` at all counts as "Primary". That default
 *   is in the filter, not on the model, so it applies here and nowhere else.
 * - "PC" means *not* NPC rather than exactly PC, so Primary and Secondary both
 *   pass it. Every other value is a prefix test.
 */
function matches(character: Character, filters: Filters): boolean {
  const antecedence = (character.get('antecedence') as string | undefined) ?? 'Primary';
  const wanted = filters.antecedence;

  if (!wanted.startsWith('All')) {
    if (wanted.startsWith('NPC')) {
      if (!antecedence.startsWith('NPC')) return false;
    } else if (wanted.startsWith('PC')) {
      if (antecedence.startsWith('NPC')) return false;
    } else if (!antecedence.startsWith(wanted)) {
      return false;
    }
  }

  const traits = character.get(filters.category) as SimpleTrait[] | undefined;
  if (filters.resulttype.startsWith('onlycat')) {
    if (!character.has(filters.category)) return false;
    if (!traits || traits.length === 0) return false;
  } else if (filters.resulttype.startsWith('nocat')) {
    // Note this tests `has`, not length: a character holding an EMPTY array for
    // the category is excluded from "only those with no values", even though it
    // has none. Reproduced.
    if (character.has(filters.category)) return false;
  }

  if (filters.playable && !character.has('owner')) return false;
  return true;
}

/** The category select's optgroups: vampire categories, then werewolf. */
const CATEGORY_GROUPS = [
  {
    label: 'Vampire',
    options: venueData.Vampire.categories.map((c) => ({ label: c.prettyName, value: c.key })),
  },
  {
    label: 'Werewolf',
    options: venueData.Werewolf.categories.map((c) => ({ label: c.prettyName, value: c.key })),
  },
];

/**
 * A category's display name.
 *
 * Searched vampire-first then werewolf, as `filterwith` does. The changeling
 * categories are not searched and are not offered in the select either -- the
 * legacy builds `category_options` from the vampire and werewolf lists only,
 * so a changeling-only category cannot be chosen and never needs a name.
 */
function prettyNameFor(category: string): string {
  const vampire = venueData.Vampire.categories.find((c) => c.key === category);
  if (vampire) return vampire.prettyName;
  const werewolf = venueData.Werewolf.categories.find((c) => c.key === category);
  return werewolf ? werewolf.prettyName : '';
}

function get(character: Character, key: string): string | undefined {
  const value = character.get(key) as unknown;
  return value === undefined || value === null ? undefined : String(value);
}

function joinFields(...values: (string | undefined)[]): string {
  return values.filter((value) => value && value.trim()).join(' ');
}

function SummarizeRow({
  character,
  href,
  format,
  category,
  categoryName,
  columnNames,
}: {
  character: Character;
  href: (id: string) => string;
  format: Format;
  category: string;
  categoryName: string;
  columnNames: string[];
}) {
  const id = character.id ?? '';
  const traits = (character.get(category) as SimpleTrait[] | undefined) ?? [];

  if (format === 'csv') return <CsvRow character={character} category={category} />;
  if (format === 'csvtraitgrouping') {
    return <CsvGroupedRow character={character} category={category} columnNames={columnNames} />;
  }

  return (
    <a
      href="#"
      {...({ backendid: id } as AnchorHTMLAttributes<HTMLAnchorElement>)}
      className="ui-btn ui-btn-icon-right ui-icon-carat-r character-list-item"
      onClick={(e) => {
        e.preventDefault();
        navigate(href(id));
      }}
    >
      <img src={character.thumbnailUrl(128)} className="character-link-portrait" alt="" />
      <h2>{character.name}</h2>
      <VenueLines character={character} />
      <OwnerLine character={character} />
      <p>Patronage: {character.status()}</p>
      {traits.length ? (
        <>
          <h2>{categoryName}</h2>
          <ul>
            {traits.map((trait, i) => (
              <li key={trait?.id ?? i}>
                {trait.name} x{trait.value}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </a>
  );
}

function VenueLines({ character }: { character: Character }) {
  if (character.venue === 'Werewolf') {
    const tribe = get(character, 'wta_tribe');
    const breed = get(character, 'wta_breed');
    const auspice = get(character, 'wta_auspice');
    return (
      <>
        {tribe || breed || auspice ? <p>{joinFields(tribe, breed, auspice)}</p> : null}
        <p>
          {joinFields(
            get(character, 'wta_faction'),
            get(character, 'archetype'),
            get(character, 'wta_camp'),
          )}
        </p>
        <p>{get(character, 'antecedence')}</p>
      </>
    );
  }
  if (character.venue === 'ChangelingBetaSlice') {
    const kith = get(character, 'ctdbs_kith');
    const court = get(character, 'ctdbs_fealty_court');
    const archetype = get(character, 'archetype');
    return (
      <>
        {kith || court || archetype ? <p>{joinFields(kith, court, archetype)}</p> : null}
        <p>
          {joinFields(get(character, 'ctdbs_kith_group_type'), get(character, 'ctdbs_noble_house'))}
        </p>
        <p>{get(character, 'antecedence')}</p>
      </>
    );
  }
  const antecedence = get(character, 'antecedence');
  const faction = get(character, 'faction');
  const title = get(character, 'title');
  return (
    <>
      <p>
        {joinFields(get(character, 'sect'), get(character, 'archetype'), get(character, 'clan'))}
      </p>
      {antecedence || faction || title ? <p>{joinFields(antecedence, faction, title)}</p> : null}
    </>
  );
}

function OwnerLine({ character }: { character: Character }) {
  const owner = character.owner;
  if (!owner) return <p>DELETED</p>;
  const username = owner.get('username') as string | undefined;
  if (!username) return null;
  return (
    <p>
      {joinFields(
        owner.get('realname') as string | undefined,
        owner.get('email') as string | undefined,
        username,
      )}
    </p>
  );
}

/** Every value quoted, as the CSV templates emit them. */
function q(value: unknown): string {
  return `"${value === undefined || value === null ? '' : String(value)}"`;
}

/**
 * The identity columns, or the right number of blanks.
 *
 * Three states, and the middle one is why parse/users.ts keeps a placeholder
 * rather than a blank: an owner that exists but did not hydrate emits NO
 * columns at all, silently shifting every later column in the row. A missing
 * owner emits the blanks instead. The two formats differ in how many columns
 * this is -- the flat one also carries `massmailauthorization`.
 */
function identityCells(character: Character, withMassMail: boolean): string[] {
  const owner = character.owner;
  if (!owner) return withMassMail ? [q(''), q(''), q(''), q('')] : [q(''), q(''), q('')];
  if (!owner.get('username')) return [];
  const cells = [q(owner.get('realname')), q(owner.get('email')), q(owner.get('username'))];
  if (withMassMail) cells.push(q(owner.get('massmailauthorization')));
  return cells;
}

/**
 * Ports templates/character-summarize-list-item-csv.html.
 *
 * Text only -- CSVView declares `tagName: "li"` and no className, and the
 * template emits no elements at all. The name is the one field the template
 * escapes for CSV, doubling any quote inside it; the others are not, which is a
 * real gap the moment a clan or a title contains one.
 */
function CsvRow({ character, category }: { character: Character; category: string }) {
  const traits = (character.get(category) as SimpleTrait[] | undefined) ?? [];
  const sortedTraits = [...traits].sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));
  const cells = [
    q(character.name.replace(/"/g, '""')),
    q(character.get('sect')),
    q(character.get('archetype')),
    q(character.get('clan')),
    q(character.get('antecedence')),
    q(character.get('faction')),
    q(character.get('title')),
    ...identityCells(character, true),
    q(character.status()),
    ...sortedTraits.flatMap((trait) => [q(trait.name), q(trait.value)]),
  ];
  return <>{cells.join(',')}</>;
}

/**
 * Ports templates/character-summarize-list-item-csv-header-grouped.html.
 *
 * The same row with the trait pairs aligned to a fixed column set, so every row
 * has the same shape: a trait the character lacks emits two blanks rather than
 * being skipped. Note the name is NOT quote-escaped here, unlike the flat
 * format -- the two templates differ on that one field, and this is the one
 * that gets it wrong.
 */
function CsvGroupedRow({
  character,
  category,
  columnNames,
}: {
  character: Character;
  category: string;
  columnNames: string[];
}) {
  const traits = (character.get(category) as SimpleTrait[] | undefined) ?? [];
  const byName = new Map(traits.map((trait) => [trait.name, trait]));
  const cells = [
    q(character.name),
    q(character.get('sect')),
    q(character.get('archetype')),
    q(character.get('clan')),
    q(character.get('antecedence')),
    q(character.get('faction')),
    q(character.get('title')),
    ...identityCells(character, false),
    q(character.status()),
    ...(traits.length
      ? columnNames.flatMap((name) => {
          const trait = byName.get(name);
          return trait ? [q(trait.name), q(trait.value)] : [q(''), q('')];
        })
      : []),
  ];
  return <>{cells.join(',')}</>;
}

registerScreen('troupesummarizecharacters', TroupeSummarizeCharacters);
registerScreen('administration_characters_summarize', AdministrationSummarizeCharacters);
