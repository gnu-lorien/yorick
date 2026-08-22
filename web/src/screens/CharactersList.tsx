import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { cx } from '@/jqm/classes';
import { Parse } from '@/parse/init';
import { Character, userCharactersQuery, sortCharacters } from '@/parse/models/Character';
import { CharacterListItem } from './CharacterListItem';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The player's own characters.
 *
 * Ports the `characters` route handler, views/CharactersListView.js and the
 * `#characters-all` page in index.html.
 *
 * The list is filterable. jQuery Mobile's filterable widget owns that in the
 * legacy app: `data-filter="true" data-input="#characters-filter"` binds the
 * `<ul>` to the search box above it and hides non-matching rows on keystroke,
 * matching against each row's text. The same behaviour is written out here
 * rather than reusing the generic Listview component, because this page's
 * markup is not the generic one -- the filter input has a fixed id the E2E
 * suite types into, and the rows carry thumbnails.
 *
 * Note the route only does anything for `type === "all"`. The legacy handler is
 * a bare `if ("all" == type)` with no else, so any other value leaves the app
 * wherever it was; that is preserved.
 *
 * @compare #characters?all
 */
export function CharactersList({ route }: ScreenProps) {
  const type = route.named['type'];
  const user = Parse.User.current();
  const [filter, setFilter] = useState('');
  const { show, hide } = useLoading();

  const { data, isFetching, error } = useQuery({
    queryKey: ['characters', 'mine', user?.id],
    enabled: !!user && type === 'all',
    queryFn: async () => {
      const found: Character[] = [];
      // `each`, not `find`: it pages through every match instead of stopping at
      // the query limit, so a player with a long roster sees all of it.
      await userCharactersQuery(user!).each((character) => {
        found.push(character);
      });
      return found;
    },
  });

  // The legacy handler wraps the whole route in $.mobile.loading("show") /
  // ("hide"), so the spinner is up while the roster loads. Same here, driven by
  // the query's own in-flight flag rather than by a matched pair of calls.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  const characters = useMemo(() => sortCharacters(data ?? []), [data]);

  // jQM's filterable matches against the row's whole text content, which for
  // these rows includes the venue lines, the owner and the patronage status --
  // not just the name. Searching for "Brujah" or for an owner's email works in
  // the legacy app, and keeping the same haystack keeps that true.
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return characters;
    return characters.filter((c) => rowText(c).toLowerCase().includes(needle));
  }, [characters, filter]);

  return (
    <Page id="characters-all" title="Characters">
      <ul>
        <li>
          <a href="#characternew">Add New Character</a>
        </li>
      </ul>
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div
          className={cx(
            'ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset',
            'ui-input-has-clear',
          )}
        >
          <input
            id="characters-filter"
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
        data-role="listview"
        data-inset="true"
        data-filter="true"
        data-input="#characters-filter"
        className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        {visible.map((character, i) => (
          <CharacterListItem
            key={character.id}
            character={character}
            href={(id) => `#character?${id}`}
            index={i}
            total={visible.length}
          />
        ))}
      </ul>
      {error ? <p className="error">{String(error)}</p> : null}
    </Page>
  );
}

/** Everything a row displays, for the filter to match against. */
function rowText(character: Character): string {
  const owner = character.owner;
  return [
    character.name,
    character.get('sect'),
    character.get('archetype'),
    character.get('clan'),
    character.get('antecedence'),
    character.get('faction'),
    character.get('title'),
    character.get('wta_tribe'),
    character.get('wta_breed'),
    character.get('wta_auspice'),
    character.get('wta_faction'),
    character.get('wta_camp'),
    character.get('ctdbs_kith'),
    character.get('ctdbs_fealty_court'),
    character.get('ctdbs_kith_group_type'),
    character.get('ctdbs_noble_house'),
    owner?.get('realname'),
    owner?.get('email'),
    owner?.get('username'),
    character.status(),
  ]
    .filter(Boolean)
    .join(' ');
}

registerScreen('characters', CharactersList);
