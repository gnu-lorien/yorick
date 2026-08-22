import type { AnchorHTMLAttributes } from 'react';
import { cx, positionClass } from '@/jqm/classes';
import type { Character } from '@/parse/models/Character';

/**
 * One row of a character listing.
 *
 * Ports templates/character-list-item.html. The interesting part is the middle
 * block, which prints a different set of fields per creature type -- and prints
 * some of them only when at least one is set, so an unfinished character does
 * not show a row of blank lines.
 *
 * `click_url` in the original is an underscore template string that the list's
 * owner supplies, e.g. `"#character?<%= character_id %>"`, rendered per row.
 * Here it is a function, which is the same idea with the string interpolation
 * done by the caller.
 */

export interface CharacterListItemProps {
  character: Character;
  /** Where clicking the row goes. */
  href: (characterId: string) => string;
  index: number;
  total: number;
}

/**
 * Join fields the way the template's `<%= a %> <%= b %>` does.
 *
 * The template emits a single space between every pair whether or not the
 * fields are set, so a character with a tribe but no breed renders "Glass
 * Walkers  Homid" with a double space. Reproducing that exactly is not worth
 * it -- but dropping the blanks changes what is on screen, so this collapses
 * them deliberately rather than by accident.
 */
function joinFields(...values: (string | undefined)[]): string {
  return values.filter((v) => v && String(v).trim()).join(' ');
}

function get(character: Character, key: string): string | undefined {
  const value = character.get(key) as unknown;
  return value === undefined || value === null ? undefined : String(value);
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
        <p>{joinFields(get(character, 'ctdbs_kith_group_type'), get(character, 'ctdbs_noble_house'))}</p>
        <p>{get(character, 'antecedence')}</p>
      </>
    );
  }

  const antecedence = get(character, 'antecedence');
  const faction = get(character, 'faction');
  const title = get(character, 'title');
  return (
    <>
      <p>{joinFields(get(character, 'sect'), get(character, 'archetype'), get(character, 'clan'))}</p>
      {antecedence || faction || title ? <p>{joinFields(antecedence, faction, title)}</p> : null}
    </>
  );
}

/**
 * The owner line.
 *
 * Three states, all from the template: no owner at all prints "DELETED"; an
 * owner whose username did not resolve prints nothing; otherwise the real name,
 * email and username. The middle case is not an oversight -- UserWreqr returns
 * a placeholder for an unreadable user, and the CSV templates depend on this
 * exact branch emitting no columns.
 */
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

export function CharacterListItem({ character, href, index, total }: CharacterListItemProps) {
  // Parse types `id` as optional because an unsaved object has none. Every
  // character in a listing came from a query, so it always has one; the
  // fallback keeps the row rendering rather than crashing the whole list if
  // that ever stops being true.
  const id = character.id ?? '';

  return (
    <li className={cx('ui-li-has-thumb', positionClass(index, total))}>
      <a
        href={href(id)}
        // Not a standard attribute, but the legacy click handler reads the id
        // back off the element with `targete.attr("backendId")` and the E2E
        // suite selects rows by it.
        //
        // Spelled lowercase because HTML attribute names are case-insensitive:
        // the browser parses the legacy template's `backendId="..."` into
        // `backendid` too, so this produces the identical DOM. Written
        // camelCase, React warns and asks for exactly this.
        {...({ backendid: id } as AnchorHTMLAttributes<HTMLAnchorElement>)}
        className="ui-btn ui-btn-icon-right ui-icon-carat-r character-list-item"
      >
        <img src={character.thumbnailUrl(128)} className="character-link-portrait" alt="" />
        <h2>{character.name}</h2>
        <VenueLines character={character} />
        <OwnerLine character={character} />
        <p>Patronage: {character.status()}</p>
      </a>
    </li>
  );
}
