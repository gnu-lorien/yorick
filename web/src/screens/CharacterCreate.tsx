import { Fragment, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { Listview, ListItem, Divider } from '@/jqm/Listview';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { loadCharacter } from '@/parse/character/load';
import {
  fetchAllCreationElements,
  picksIn,
  remainingIn,
  remainingPicks,
} from '@/parse/character/creation';
import type { Character } from '@/parse/models/Character';
import type { Venue } from '@/parse/venues/types';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The character creation wizard.
 *
 * Ports views/CharacterCreateViewNew.js and the ten templates under
 * templates/create/. The legacy is a LayoutView with a region per section and
 * an ItemView per region, each listening to a different subset of the
 * character's `change` events; here it is one component, and the sections are a
 * table, because what actually differs between eight of the ten is a heading,
 * a category name, a range of ratings and the wording of the pick link.
 *
 * The Marionette wrapper divs stay. An ItemView contributes its own element
 * inside the region div, so `#ccv-next-one` holds a `<div>` which holds the
 * `<ul>` -- see docs/react-migration/porting-guide.md on why those are
 * reproduced rather than flattened.
 *
 * All three venues, because the fifth region is a different section in each
 * and backgrounds, merits and flaws are named differently in each.
 *
 * @compare #charactercreate/9cYrGGv2w3
 * @compare #charactercreate/ISZilUG8M4
 * @compare #charactercreate/SwBi1ulbfs
 */

/** One pool section: a heading with a count badge, then its rows. */
interface Section {
  heading: string;
  /**
   * The character attribute the pool fills.
   *
   * A function because three of them differ by venue -- backgrounds, merits and
   * flaws are `backgrounds`/`wta_backgrounds`/`ctdbs_backgrounds` and so on.
   * The legacy calls that `getDescriptionCategory`.
   */
  category: (venue: Venue) => string;
  /** Sub-pool indices, highest first, as `_.range(hi, lo, -1)` produces them. */
  ratings: number[];
  /** The wording of the pick link. `Pick merit` ignores the rating. */
  pickLabel: (rating: number) => string;
  /** Whether a picked row shows `name x3` or just `name`. Focuses show just the name. */
  showValue: boolean;
}

const RANGE = (from: number, to: number) => {
  const out: number[] = [];
  for (let i = from; i > to; i -= 1) out.push(i);
  return out;
};

/** Backgrounds, merits and flaws are named per venue; the rest are shared. */
const perVenue = (vampire: string, werewolf: string, changeling: string) => (venue: Venue) =>
  venue.name === 'Werewolf' ? werewolf : venue.name === 'ChangelingBetaSlice' ? changeling : vampire;

const ATTRIBUTES: Section = {
  heading: 'Attributes',
  category: () => 'attributes',
  ratings: RANGE(8, 0),
  pickLabel: (i) => `Pick attribute at rating ${i}`,
  showValue: true,
};

/**
 * The three focus lists.
 *
 * Note the pairing: the template zips `["Physical", "Social", "Mental"]` with
 * `["focus_physicals", "focus_socials", "focus_mentals"]`, so the middle list
 * is Social, not Mental. The heading order on screen is Physical, Social,
 * Mental.
 */
const FOCUSES: Section[] = (
  [
    ['Physical', 'focus_physicals'],
    ['Social', 'focus_socials'],
    ['Mental', 'focus_mentals'],
  ] as const
).map(([pretty, category]) => ({
  heading: `${pretty} Focus`,
  category: () => category,
  ratings: RANGE(2, 0),
  pickLabel: () => `Pick ${pretty} Focus`,
  showValue: false,
}));

const SKILLS: Section = {
  heading: 'Skills',
  category: () => 'skills',
  ratings: RANGE(4, 0),
  pickLabel: (i) => `Pick skill at rating ${i}`,
  showValue: true,
};

const BACKGROUNDS: Section = {
  heading: 'Backgrounds',
  category: perVenue('backgrounds', 'wta_backgrounds', 'ctdbs_backgrounds'),
  ratings: RANGE(3, 0),
  pickLabel: (i) => `Pick a background at rating ${i}`,
  showValue: true,
};

/** The fifth region is a different section entirely in each venue. */
const POWERS: Record<Venue['name'], Section> = {
  Vampire: {
    heading: 'Disciplines',
    category: () => 'disciplines',
    ratings: RANGE(2, 0),
    pickLabel: (i) => `Pick in clan discipline at rating ${i}`,
    showValue: true,
  },
  Werewolf: {
    heading: 'Gifts',
    category: () => 'wta_gifts',
    ratings: RANGE(2, 0),
    pickLabel: (i) => `Pick affinity gifts at rating ${i}`,
    showValue: true,
  },
  ChangelingBetaSlice: {
    heading: 'Arts',
    category: () => 'ctdbs_arts',
    ratings: RANGE(2, 0),
    pickLabel: (i) => `Pick Art at rating ${i}`,
    showValue: true,
  },
};

const MERITS: Section = {
  heading: 'Merits',
  category: perVenue('merits', 'wta_merits', 'ctdbs_merits'),
  // `_.range(1, -1, -1)` -- merits and flaws have no rating, so pool 0 is the
  // one that matters and pool 1 is there because the range includes it.
  ratings: RANGE(1, -2),
  pickLabel: () => 'Pick merit',
  showValue: true,
};

const FLAWS: Section = {
  heading: 'Flaws',
  category: perVenue('flaws', 'wta_flaws', 'ctdbs_flaws'),
  ratings: RANGE(1, -2),
  pickLabel: () => 'Pick flaw',
  showValue: true,
};

function PoolSection({
  section,
  character,
  venue,
  creation,
}: {
  section: Section;
  character: Character;
  venue: Venue;
  creation: Parse.Object;
}) {
  const category = section.category(venue);
  const cid = character.id!;
  // The merits template also puts a literal `category="merits"` on its `<ul>`
  // -- on all three venues, so it is wrong for two of them. Nothing reads it,
  // so it is dropped rather than reproduced.
  return (
    <Listview inset>
      <Divider className="ui-li-has-count">
        {section.heading}
        <span className="ui-li-count ui-body-inherit">{remainingPicks(creation, category)}</span>
      </Divider>
      {section.ratings.flatMap((i) => [
        ...picksIn(creation, category, i).map((trait) => (
          <ListItem
            key={`${i}-${trait.linkId()}`}
            href="javascript: void(0)"
            icon={false}
            split={{
              href: `#charactercreate/simpletraits/${category}/${cid}/unpick/${trait.linkId()}/${i}`,
              title: 'Delete',
              icon: 'delete',
            }}
          >
            {trait.name}
            {section.showValue ? ` x${trait.value}` : ''}
          </ListItem>
        )),
        ...Array.from({ length: Math.max(0, remainingIn(creation, category, i)) }, (_, n) => (
          <ListItem
            key={`${i}-slot-${n}`}
            href={`#charactercreate/simpletraits/${category}/${cid}/pick/${i}`}
          >
            {section.pickLabel(i)}
          </ListItem>
        )),
      ])}
    </Listview>
  );
}

export function CharacterCreate({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  useBackButton(`#character?${cid}`);

  const { show, hide } = useLoading();
  const { data, isFetching, error } = useQuery({
    queryKey: ['charactercreate', cid],
    enabled: !!cid,
    queryFn: async () => {
      // `get_character(cid, [])` -- no trait categories. The wizard reads the
      // picks off the creation record, not off the character.
      const loaded = await loadCharacter(cid, []);
      await fetchAllCreationElements(loaded.character, loaded.venue);
      return loaded;
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  useEffect(() => {
    if (error) showError(error, "Couldn't open character creation");
  }, [error]);

  const character = data?.character;
  const venue = data?.venue;
  const creation = character?.get('creation') as Parse.Object | undefined;

  return (
    <Page id="character-create" title="Create Character" contentClassName="force-printing-page-break">
      <div id="ccv-description">
        {character && creation ? (
          <div>
            <p>You have {creation.get('initial_xp')} initial XP to spend</p>
            <p>Remaining steps for {character.name}</p>
          </div>
        ) : null}
      </div>
      <div id="ccv-simpletext">
        {character && venue ? (
          <div>
            {venue.data.textAttributes.map(({ key, label }) => {
              const value = character.get(key) as string | undefined;
              const base = `#charactercreate/simpletext/${key}s/${key}/${character.id}`;
              return (
                <Listview inset key={key}>
                  {value ? (
                    <Divider>
                      {label}
                      <p>{value}</p>
                    </Divider>
                  ) : null}
                  <ListItem href={`${base}/pick`}>
                    {value ? 'Repick' : 'Pick'} {label}
                  </ListItem>
                  {value ? (
                    <ListItem href={`${base}/unpick`} icon="delete">
                      Unpick {label}
                    </ListItem>
                  ) : null}
                </Listview>
              );
            })}
          </div>
        ) : null}
      </div>
      {character && venue && creation ? (
        <>
          <div id="ccv-next-one">
            <div>
              <PoolSection
                section={ATTRIBUTES}
                character={character}
                venue={venue}
                creation={creation}
              />
            </div>
          </div>
          <div id="ccv-next-two">
            <div>
              {FOCUSES.map((section) => (
                <PoolSection
                  key={section.heading}
                  section={section}
                  character={character}
                  venue={venue}
                  creation={creation}
                />
              ))}
            </div>
          </div>
          <div id="ccv-next-three">
            <div>
              <PoolSection section={SKILLS} character={character} venue={venue} creation={creation} />
            </div>
          </div>
          <div id="ccv-next-four">
            <div>
              <PoolSection
                section={BACKGROUNDS}
                character={character}
                venue={venue}
                creation={creation}
              />
            </div>
          </div>
          <div id="ccv-next-five">
            <div>
              <PoolSection
                section={POWERS[venue.name]}
                character={character}
                venue={venue}
                creation={creation}
              />
            </div>
          </div>
          <div id="ccv-next-six">
            <div>
              <PoolSection section={MERITS} character={character} venue={venue} creation={creation} />
            </div>
          </div>
          <div id="ccv-next-seven">
            <div>
              <PoolSection section={FLAWS} character={character} venue={venue} creation={creation} />
            </div>
          </div>
          <div id="ccv-next-eight">
            <div>
              <a href={`#charactercreate/complete/${character.id}`} className="ui-btn">
                Complete Character Creation!
              </a>
            </div>
          </div>
        </>
      ) : (
        <Fragment>
          <div id="ccv-next-one" />
          <div id="ccv-next-two" />
          <div id="ccv-next-three" />
          <div id="ccv-next-four" />
          <div id="ccv-next-five" />
          <div id="ccv-next-six" />
          <div id="ccv-next-seven" />
          <div id="ccv-next-eight" />
        </Fragment>
      )}
    </Page>
  );
}

registerScreen('charactercreate', CharacterCreate);
