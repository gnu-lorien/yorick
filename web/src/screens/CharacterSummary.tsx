import type { Character } from '@/parse/models/Character';

/**
 * The character's identity block, at the top of their sheet.
 *
 * Ports templates/single-character-list-item.html and views/CharacterListItem.js.
 *
 * Almost the same content as a row of the character list, with two differences
 * that matter: there is no wrapping `<li>` or row anchor -- this is not a list
 * row -- and the portrait is itself a link to the portrait page rather than
 * decoration inside a link to the sheet.
 *
 * The per-creature field blocks are the same rules as
 * screens/CharacterListItem.tsx, including the conditional lines that keep an
 * unfinished character from showing a run of blank paragraphs.
 */

function get(character: Character, key: string): string | undefined {
  const value = character.get(key) as unknown;
  return value === undefined || value === null ? undefined : String(value);
}

/** Join fields with single spaces, dropping the ones that are not set. */
function joinFields(...values: (string | undefined)[]): string {
  return values.filter((value) => value && value.trim()).join(' ');
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
          {joinFields(
            get(character, 'ctdbs_kith_group_type'),
            get(character, 'ctdbs_noble_house'),
          )}
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

/**
 * The owner line.
 *
 * No owner at all prints "DELETED"; an owner whose username did not resolve
 * prints nothing. That middle case is not an oversight -- the character fetch
 * deliberately does not `include("owner")` (see parse/character/load.ts for
 * why), so on a player's own sheet the pointer is a stub and this renders
 * nothing at all.
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

export function CharacterSummary({ character }: { character: Character }) {
  const id = character.id ?? '';
  return (
    // The wrapper carries the character's objectId as its id and "Vampire" as
    // its class, and neither was intended. `new CharacterListItem(this.model)`
    // passes the *model* where Backbone.View expects an options bag, and the
    // View constructor picks `id` and `className` off whatever it is given --
    // so a Parse.Object hands over its objectId and its className. It is in the
    // DOM today, so it is here too.
    //
    // `className` is "Vampire" for all three creature types, since they share
    // one Parse class. See models/Character.ts.
    //
    // The id here is CORRECT, and the legacy one often is not. CharacterView
    // memoises the sub-view -- `this.subview = this.subview || new
    // CharacterListItem(this.model)` (CharacterView.js:37) -- so the element is
    // built once per page load and keeps whichever character was opened first.
    // Open character A and then character B and the legacy sheet shows B's
    // content inside a div carrying A's objectId. Verified against the running
    // app: opening a werewolf after a vampire leaves the wrapper reading
    // #9cYrGGv2w3.Vampire. Everything else on all three sheets matches line for
    // line, so this is the only difference and it is not one worth copying.
    <div id={id} className={character.className}>
      <a href={`#character/${id}/portrait`}>
        <img src={character.thumbnailUrl(128)} className="character-link-portrait" alt="" />
      </a>
      <h2>{character.name}</h2>
      <VenueLines character={character} />
      <OwnerLine character={character} />
    </div>
  );
}
