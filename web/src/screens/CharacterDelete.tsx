import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import { Parse } from '@/parse/init';
import { Character } from '@/parse/models/Character';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Confirm deleting a character.
 *
 * Ports the `characterdelete` handler (mobileRouter.js:1234),
 * views/CharacterDeleteView.js and the `#characterDeleteView` template in
 * public/index.html.
 *
 * "Delete" is not a delete. `Character.archive` (models/Character.js:930) is
 * `unset("owner")` followed by `save()` -- the row, its traits, its experience
 * notations and its change log all stay exactly where they are, and only the
 * ownership pointer goes. That is why the character vanishes from the player's
 * roster (`get_user_characters` filters on `owner`) while a storyteller's
 * troupe listing, which walks the troupe relation instead, can still reach it.
 * Nothing is destroyed, so nothing here asks twice.
 *
 * The ACL is deliberately not rewritten by `archive`. It still names the
 * former owner, so an archived character remains readable and writable by the
 * person who "deleted" it -- they simply have no listing that shows it.
 *
 * @compare #character/9cYrGGv2w3/delete
 */
export function CharacterDelete({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  // mobileRouter.js:1237, before the fetch.
  useBackButton(`#character?${cid}`);

  const { track, show, hide } = useLoading();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const {
    data: character,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['character', cid, 'delete'],
    enabled: !!cid,
    queryFn: () => new Parse.Query(Character).get(cid),
  });

  // The handler opens with $.mobile.loading("show") and never hides it: the
  // spinner is taken down by the page transition itself, because jQuery
  // Mobile's `_cssTransition` calls `_hideLoading()` on the way in
  // (jquery.mobile-1.4.5.js:5337). There is no transition here, so the hide is
  // paired explicitly -- and by `track`/`useEffect`, which cannot forget it on
  // the failure path the original never reaches.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // `get_character(cid).done(...)` with no `.fail` at all: a character that
  // cannot be loaded leaves the app on the previous page in silence, and the
  // `changePage` inside the `.done` never runs. React has already navigated by
  // then, so the failure is stated rather than swallowed.
  useEffect(() => {
    if (error) showError(error, "Couldn't load the character");
  }, [error]);

  const name = character?.name ?? '';

  async function onDelete() {
    if (!character || busy) return;
    setBusy(true);
    try {
      await track(
        (async () => {
          try {
            character.unset('owner');
            await character.save();
            // The router passes `success_cb` as
            // `self.characters.collection.fetch({reset: true})`, awaited before
            // the redirect so the roster is already correct when it paints.
            // The React equivalent is to invalidate the roster query --
            // `['characters', 'mine', <userId>]` in CharactersList -- by
            // prefix, so this does not have to know whose roster it is.
            await queryClient.invalidateQueries({ queryKey: ['characters', 'mine'] });
          } finally {
            // The redirect is in an `.always()`, so it happens whether or not
            // the archive succeeded: a failed delete sends you to the roster
            // with the character still on it and no message. Kept, because a
            // port that also fixes things cannot be reviewed.
            navigate('#characters?all');
          }
        })(),
      );
    } catch {
      // Swallowed for the same reason the original swallows it -- there is no
      // failure branch, only the redirect above.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page id="character-delete" title="Delete Character">
      <h1>Are you sure you want to delete {name}?</h1>
      {/* The template writes a bare `<button class="delete-character">` and
          `enhanceWithin()` runs `$.fn.buttonMarkup` over it -- `button` is in
          that function's initSelector (jquery.mobile-1.4.5.js:12188), which is
          the one route by which a real `<button>` is enhanced at all. With no
          `ui-` class already present it is treated as unenhanced, so the
          defaults apply and it gains `ui-btn ui-shadow ui-corner-all` after
          the classes it already had. */}
      <button
        className="delete-character ui-btn ui-shadow ui-corner-all"
        onClick={() => void onDelete()}
      >
        Delete {name}
      </button>
    </Page>
  );
}

registerScreen('characterdelete', CharacterDelete);
