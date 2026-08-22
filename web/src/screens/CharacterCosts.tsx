import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { Parse } from '@/parse/init';
import type { Character } from '@/parse/models/Character';
import type { SimpleTrait } from '@/parse/models/SimpleTrait';
import type { Venue } from '@/parse/venues/types';
import { loadCharacter } from '@/parse/character/load';
import { hasGeneration } from '@/parse/venues/vampire';
import { traitsIn } from '@/parse/character/traits';
import { registerScreen, type ScreenProps } from './registry';

/**
 * What every trait on a sheet costs, itemised.
 *
 * Ports the `charactercosts` handler (mobileRouter.js:411),
 * views/CharacterCostsView.js and the `#characterCostsView` template.
 *
 * The route fetches only three categories -- `["skills", "disciplines",
 * "backgrounds"]` -- while `calculate_total_cost` walks nine. The other six are
 * pointers the totalling then fetches itself with `fetchAllIfNeeded`. Kept as
 * it is: the three named ones cover most sheets, and pre-fetching all nine
 * would change the request pattern rather than the answer.
 *
 * @compare #character/9cYrGGv2w3/costs
 */
export function CharacterCosts({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  useBackButton(`#character?${cid}`);

  const { show, hide } = useLoading();
  const { data, isFetching } = useQuery({
    queryKey: ['character-costs', cid],
    enabled: !!cid,
    queryFn: async () => {
      const loaded = await loadCharacter(cid, ['skills', 'disciplines', 'backgrounds']);
      const costs = await totalCost(loaded.character, loaded.venue);
      return { ...loaded, costs };
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  if (!data) return null;
  const { character, costs } = data;

  return (
    <Page id="character-costs" title="Character Costs">
      <h1>{character.name}</h1>
      {/* Only the vampire engine prices by generation, and only the vampire
          model defines has_generation -- so on a werewolf or changeling this
          call is against a field that is never set and the warning always
          shows. That is what the legacy template does too: it calls
          `character.has_generation()` unconditionally, and the werewolf and
          changeling models inherit the vampire's definition through
          `_.extend(instance_methods, Character)`. */}
      {!hasGeneration(character) ? (
        <p>Warning: Values are just a guess without a generation set</p>
      ) : null}
      <ul>
        {costs.map((entry) => (
          <li key={entry.key}>
            {entry.name}: {entry.cost}
          </li>
        ))}
      </ul>
    </Page>
  );
}

interface CostEntry {
  key: string;
  name: string;
  cost: number | undefined;
}

/**
 * Price every trait in the venue's costed categories.
 *
 * Ports `calculate_total_cost`. The legacy version builds an object keyed by
 * `"<category>-<name>"` and the template then walks `_.values(...)`, so the
 * order shown is object insertion order -- which is the order
 * `fetchAllIfNeeded` returned the traits in, not the order of the categories.
 * An array keyed the same way preserves both the de-duplication and the order.
 */
async function totalCost(character: Character, venue: Venue): Promise<CostEntry[]> {
  const pending: SimpleTrait[] = [];
  for (const category of venue.totalCostCategories) {
    for (const trait of traitsIn(character, category)) {
      if (trait) pending.push(trait);
    }
  }

  const fetched = (await Parse.Object.fetchAllIfNeeded(pending)) as SimpleTrait[];

  const seen = new Map<string, CostEntry>();
  for (const trait of fetched) {
    const key = `${trait.category}-${trait.name}`;
    seen.set(key, {
      key,
      name: trait.name,
      cost: venue.costs.calculateTraitCost(character, trait),
    });
  }
  return [...seen.values()];
}

registerScreen('charactercosts', CharacterCosts);
