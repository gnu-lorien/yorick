import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { loadCharacter } from '@/parse/character/load';
import { traitsIn } from '@/parse/character/traits';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Every trait a character holds in one category.
 *
 * Ports the `"all"` branch of the `simpletraits` handler (mobileRouter.js:1803),
 * views/SimpleTraitCategoryView.js and the `#simpleTraitCategoryView` template.
 *
 * The route is `simpletraits/:category/:cid/:type` and the handler is two
 * independent `if` blocks -- `"all"` renders this listing, `"new"` renders the
 * add-trait screen. There is no `else`, so any other `type` leaves the app
 * exactly where it was. That is preserved: an unrecognised type renders nothing.
 *
 * Both lists are bare `<ul>`s with no `data-role`, so jQuery Mobile leaves them
 * alone -- the rows are plain list items, and only the anchors in the second
 * list carry button classes, which the template writes out by hand.
 *
 * @compare #simpletraits/backgrounds/9cYrGGv2w3/all
 */
export function SimpleTraitCategory({ route }: ScreenProps) {
  const category = route.named['category'] ?? '';
  const cid = route.named['cid'] ?? '';
  const type = route.named['type'];

  // mobileRouter.js:1807 -- set before the fetch, so Back works even while the
  // character is still loading.
  useBackButton(`#character?${cid}`);

  const { show, hide } = useLoading();
  const { data, isFetching } = useQuery({
    queryKey: ['character', cid, category],
    enabled: !!cid && type === 'all',
    // The category's traits are fetched with the character, since the listing
    // needs each trait's name and value.
    queryFn: () => loadCharacter(cid, [category]),
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  if (type !== 'all' || !data) return null;
  const character = data.character;
  const traits = traitsIn(character, category);

  return (
    <Page id="simpletraitcategory-all" title="Traits">
      <ul>
        <li>
          <a href={`#simpletraits/${category}/${cid}/new`}>Add New {category}</a>
        </li>
      </ul>
      <ul>
        {traits.map((trait) => (
          <li key={trait.id ?? trait.linkId()}>
            <a
              href={`#simpletrait/${category}/${cid}/${trait.id}`}
              className="ui-btn ui-btn-icon-right ui-icon-carat-r"
            >
              {trait.name} x{trait.value}
            </a>
          </li>
        ))}
      </ul>
    </Page>
  );
}

registerScreen('simpletraits', SimpleTraitCategory);
