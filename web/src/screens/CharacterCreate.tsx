import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { Listview, ListItem, Divider } from '@/jqm/Listview';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { navigate } from '@/router/router';
import { reportError, showError } from '@/shell/reportError';
import { loadCharacter } from '@/parse/character/load';
import {
  completeCharacterCreation,
  fetchAllCreationElements,
  picksIn,
  remainingIn,
  remainingPicks,
  unpickFromCreation,
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

/**
 * Where the wizard was scrolled to when the player last left it.
 *
 * Ports `scroll_back_after_page_change` and the `backToTop` the picker routes
 * set before they navigate. The wizard is a long page and every pick is a round
 * trip off it, so without this a player who picks their rating-4 skill halfway
 * down is returned to the top and has to find their place again on every pick.
 *
 * The legacy records the offset in the *picker's* route handler, reading the
 * scroll position before `changePage` moves off the wizard. React has no such
 * moment -- the picker mounts after the navigation -- so the wizard records its
 * own position on the way out instead, which is the same number taken from the
 * only side that reliably knows it.
 *
 * Module-level, and deliberately not reset: `backToTop` lives on the router's
 * memoised view for the life of the page, so the legacy restores the last
 * recorded position on *any* return to the wizard, not only on a return from a
 * pick. Reproduced.
 */
let rememberedScrollTop: number | null = null;

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
  const ready = !!(character && venue && creation);

  // Record on the way out.
  //
  // `useLayoutEffect`, because its cleanup runs while the wizard's DOM is still
  // in the document. A passive effect's cleanup runs after the page has been
  // torn down and replaced, by which point the browser has already clamped the
  // scroll offset to the height of whatever came next -- usually zero, since a
  // picker for three attributes is a very short page.
  useLayoutEffect(() => {
    return () => {
      rememberedScrollTop = window.scrollY;
    };
  }, []);

  // Restore once there is a page tall enough to scroll.
  //
  // Keyed on `ready` rather than on mount: the wizard renders an empty page
  // until the character loads, and scrolling a page with no content in it
  // clamps to zero and loses the offset for good. A layout effect puts this
  // before the browser paints, so the player never sees the top of the page
  // first.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!ready || restored.current || rememberedScrollTop === null) return;
    restored.current = true;
    window.scrollTo(0, rememberedScrollTop);
  }, [ready]);

  // Nothing at all until the character is loaded, which is what the legacy page
  // holds too: `#character-create` is an empty `div[role="main"]` until
  // `setup()` renders into it. Emitting the empty region divs in the meantime
  // looks harmless and is not -- anything watching for the page to stop being
  // empty, the E2E suite included, sees ten divs and calls it rendered.
  if (!character || !venue || !creation) {
    return (
      <Page id="character-create" title="Create Character" contentClassName="force-printing-page-break" />
    );
  }

  return (
    <Page id="character-create" title="Create Character" contentClassName="force-printing-page-break">
      <div id="ccv-description">
        <div>
          <p>You have {creation.get('initial_xp')} initial XP to spend</p>
          <p>Remaining steps for {character.name}</p>
        </div>
      </div>
      <div id="ccv-simpletext">
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
      </div>
      <div id="ccv-next-one">
        <div>
          <PoolSection section={ATTRIBUTES} character={character} venue={venue} creation={creation} />
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
          <PoolSection section={BACKGROUNDS} character={character} venue={venue} creation={creation} />
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
    </Page>
  );
}

/**
 * Hand a creation pick back, then return to the wizard.
 *
 * Ports `charactercreateunpicksimpletrait`. Like the two text-unpick routes it
 * renders nothing: the legacy handler shows the spinner, does the work and
 * moves the hash, with no `changePage` anywhere in it.
 *
 * The ref is what keeps the work from happening twice. React runs an effect
 * twice under StrictMode, and this one destroys a trait and credits a pool
 * counter -- running it again would credit the counter a second time for a
 * trait that is already gone.
 */
export function CharacterCreateUnpickSimpleTrait({ route }: ScreenProps) {
  const category = route.named['category'] ?? '';
  const cid = route.named['cid'] ?? '';
  const stid = route.named['stid'] ?? '';
  const pickIndex = parseInt(route.named['i'] ?? '', 10) || 0;
  const { show, hide } = useLoading();
  const started = useRef(false);

  useBackButton(`#charactercreate/${cid}`);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    show();
    void (async () => {
      try {
        const { character, venue } = await loadCharacter(cid, [category]);
        await unpickFromCreation(character, venue, category, stid, pickIndex);
        navigate(`#charactercreate/${cid}`);
      } catch (error) {
        reportError(error, "Couldn't unpick that");
      } finally {
        hide();
      }
    })();
  }, [cid, category, stid, pickIndex, show, hide]);

  return null;
}

/**
 * Mark creation finished and go to the sheet.
 *
 * Ports `charactercreatecomplete`. The legacy wraps both the work and the
 * navigation in `ifCurrent`, because doing otherwise let a superseded
 * invocation navigate as though creation had completed -- which dispatched
 * another route and superseded whichever invocation was actually going to do
 * the work, so two overlapping completions cancelled each other and the record
 * was never marked. The ref here is the same guard for the same reason: run
 * once, and let the navigation be part of what runs once.
 *
 * A failure `alert`s in the legacy and returns to the wizard. The alert is the
 * error banner here, which is what every other screen uses.
 */
export function CharacterCreateComplete({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  const { show, hide } = useLoading();
  const started = useRef(false);

  useBackButton(`#charactercreate/${cid}`);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    show();
    void (async () => {
      try {
        const { character } = await loadCharacter(cid, []);
        await completeCharacterCreation(character);
        navigate(`#character?${cid}`);
      } catch (error) {
        reportError(error, "Couldn't complete character creation");
        navigate(`#charactercreate/${cid}`);
      } finally {
        hide();
      }
    })();
  }, [cid, show, hide]);

  return null;
}

registerScreen('charactercreate', CharacterCreate);
registerScreen('charactercreateunpicksimpletrait', CharacterCreateUnpickSimpleTrait);
registerScreen('charactercreatecomplete', CharacterCreateComplete);
