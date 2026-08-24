import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { Parse } from '@/parse/init';
import { Character } from '@/parse/models/Character';
import { characterAcl, setTroupeIds } from '@/parse/character/acl';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Upload a character's portrait.
 *
 * Ports the `characterportrait` handler (mobileRouter.js:770),
 * views/CharacterPortraitView.js and the `#characterPortraitView` template in
 * public/index.html.
 *
 * This is the same upload as web/src/screens/TroupePortrait.tsx, and the two
 * files share every one of that one's findings, which are not repeated at
 * length here: no client-side image work happens at all -- the file goes up
 * untouched and `crop_and_thumb` in cloud/main.js, hooked on
 * `beforeSave("CharacterPortrait")`, fetches it back over `publicServerURL`
 * and writes `thumb_32/64/128/256`; the 1MB check writes a warning and then
 * falls straight through to the upload rather than stopping it
 * (CharacterPortraitView.js:41); and the `Parse.File` name is
 * `"portrait" + extension` where `extension` is already the bare `"png"`, so
 * the stored name is `portraitpng`.
 *
 * That is why this page's `<img>` is the one surface in the app showing the
 * true unscaled original -- the character sheet header and all four listings
 * read `thumb_128` instead (e2e/assets-rename-portrait.spec.js tests 115-121).
 *
 * The one thing that differs from the troupe version is the ACL, and it is the
 * interesting part: the row is stamped with the *character's* ACL plus public
 * read, so the owner, administrators and the head and assistant storytellers
 * of every troupe the character belongs to can rewrite the portrait. Getting
 * the troupe half of that right needs the troupe relation walked first; see
 * `loadCharacter` below.
 *
 * The E2E flow is `#character-portrait #input-portrait` for the file,
 * `#character-portrait button.update` for the click, and `.error` inside the
 * page as the pass/fail signal (e2e/helpers/portraits.js:45). All three are
 * contract, so the upload failure path writes to that div rather than to the
 * global banner, exactly as the view did.
 *
 * @compare #character/9cYrGGv2w3/portrait
 */
export function CharacterPortrait({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  // mobileRouter.js:773, ahead of the fetch -- the back button is part of the
  // screen, not part of the data.
  useBackButton(`#character?${cid}`);

  const { track, show, hide } = useLoading();
  const fileInput = useRef<HTMLInputElement>(null);
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * The portrait as this screen currently knows it.
   *
   * The view does `listenTo(character, "change:portrait", render)`, which is
   * how the just-uploaded picture appears without a reload. `Parse.Object`
   * mutation is invisible to React, so the new row is held in state instead
   * and the render reads state first.
   */
  const [uploaded, setUploaded] = useState<Parse.Object | null>(null);

  const {
    data: character,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['character', cid, 'portrait'],
    enabled: !!cid,
    queryFn: () => loadCharacter(cid),
  });

  // The handler opens with $.mobile.loading("show") and never hides it: the
  // spinner is taken down by the page transition, because jQuery Mobile's
  // `_cssTransition` calls `_hideLoading()` on the way in
  // (jquery.mobile-1.4.5.js:5337). There is no transition here, so the hide is
  // paired explicitly.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // The handler's `.always()` runs `changePage` whether the character loaded or
  // not, so the legacy app lands on this page and shows the previous
  // character's portrait, or a blank one, with no explanation. React has
  // already navigated by then; saying so is the one deliberate addition here.
  useEffect(() => {
    if (error) showError(error, "Couldn't load the character");
  }, [error]);

  const portrait = uploaded ?? (character?.get('portrait') as Parse.Object | undefined) ?? null;
  const original = portrait?.get('original') as Parse.File | undefined;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // `undelegateEvents()` for the life of the upload
    // (CharacterPortraitView.js:45) -- a second click while one is in flight
    // does nothing at all.
    if (busy) return;

    const portraitFile = fileInput.current?.files?.[0];
    // The original reads `files[0].name` with no guard, so submitting with no
    // file chosen throws a TypeError out of the handler; `return false` is
    // never reached and the form submits for real. Returning quietly is the
    // one divergence in this file, and it is a divergence from a crash.
    if (!portraitFile || !character) return;

    const extension = portraitFile.name.split('.').pop();
    if (portraitFile.size > 1000000) {
      setErrorText('Picture too large. Limit is 1MB');
      // No early return: see the note at the top of the file.
    }

    const parseFile = new Parse.File('portrait' + extension, portraitFile);
    setBusy(true);
    try {
      await track(
        (async () => {
          const file = await parseFile.save();

          // Reuse the existing CharacterPortrait row when there is one, so the
          // character keeps a single portrait object across re-uploads. Both
          // branches of the original build the identical ACL; only the row
          // differs.
          const characterPortrait =
            (character.get('portrait') as Parse.Object | undefined) ??
            new Parse.Object('CharacterPortrait');
          const acl = characterAcl(character);
          // Public read on top of the character's own ACL, which sets it
          // false. Without this the thumbnails would 403 for everyone the
          // character is not shared with, and the troupe listings render them.
          acl.setPublicReadAccess(true);
          characterPortrait.setACL(acl);
          characterPortrait.set('original', file);

          // This save is what runs crop_and_thumb, so it is the slow one and
          // the one that fails when the server's publicServerURL is wrong.
          const saved = await characterPortrait.save();

          // The view sets the pointer and *then* saves the character, so the
          // picture appears as soon as the portrait row is written rather than
          // after the second write. Same order here.
          character.set('portrait', saved);
          setUploaded(saved);
          await character.save();
        })(),
      );
      // `.done(function() { self.$(".error").hide(); })` -- the last step, so
      // an oversize warning raised above is cleared only by a complete success.
      setErrorText('');
    } catch (err) {
      const message = (err as { message?: unknown } | null)?.message;
      setErrorText(typeof message === 'string' ? message : String(err));
      console.log(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page id="character-portrait" title="Profile">
      <h1>{character?.name ?? ''}</h1>
      {/* `<% if (character.get('portrait')) %>` guards the pointer but not the
          file, and the template then calls `.url()` on it -- a portrait row
          whose beforeSave failed before `original` landed would throw there.
          Rendering nothing is the closest safe equivalent. */}
      {original ? <img src={original.url()} alt="" /> : null}
      <form className="portrait-form" onSubmit={onSubmit}>
        <div className="error" style={{ display: errorText ? 'block' : 'none' }}>
          {errorText}
        </div>
        {/* Unlike the troupe version, whose `for` names the input's *name* and
            therefore points at nothing, this one matches the input's id and
            works. The two templates are otherwise the same markup. */}
        <label htmlFor="input-portrait">Portrait</label>
        {/* jQuery Mobile's textinput widget wraps every `input` it enhances,
            file inputs included -- jquery.mobile-1.4.5.js:8390 lists
            `input[type='file']` in its initSelector and `_enhance` wraps
            anything that is an `input`. */}
        <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input type="file" name="input-portrait" id="input-portrait" ref={fileInput} />
        </div>
        {/* The template hand-writes these classes, so `$.fn.buttonMarkup` reads
            the element back as already enhanced and re-emits the same set. This
            markup is therefore already the enhanced markup. */}
        <button className="ui-shadow ui-btn ui-corner-all ui-icon-action ui-btn-icon-right update">
          Upload
        </button>
      </form>
    </Page>
  );
}

/**
 * Load the character this page uploads for, the way `Vampire.get_character`
 * does -- including the two steps that look optional and are not.
 *
 * **No `include("owner")`.** That is deliberate upstream and the comment there
 * (models/Vampire.js:326) is worth repeating, because this is one of the two
 * screens that writes an ACL: including the owner made parse-server DELETE the
 * pointer for a private owner, and `characterAcl` reads a missing owner as "no
 * owner" and grants the CURRENT user read and write instead -- so opening
 * someone else's sheet rewrote its permissions to the viewer. Without the
 * include the bare pointer survives and `characterAcl` takes its correct
 * branch. Nothing on this page needs the owner's name.
 *
 * **The troupe relation is walked.** `get_character` ends in
 * `initialize_troupe_membership(true)` (models/Vampire.js:368), which is what
 * fills the `troupe_ids` that `characterAcl` grants `LST_<id>` and `AST_<id>`
 * access from. It reads as a fetch nobody uses; it is not. Skip it and
 * `troupeIdsOf` returns an empty list, `characterAcl` silently grants no staff
 * access, and the storytellers of the character's own troupes lose write on
 * its portrait. That is the failure mode acl.ts documents, reproduced here on
 * purpose so it cannot happen.
 */
async function loadCharacter(cid: string): Promise<Character> {
  const character = await new Parse.Query(Character).include('portrait').get(cid);

  const troupeIds: string[] = [];
  // `each`, not `find`: a character in more troupes than the query limit would
  // otherwise lose the tail of its staff access.
  await character.relation('troupes').query().each((troupe) => {
    // The id is typed optional because an unsaved Parse.Object has none; a row
    // that came back from a query always does.
    if (troupe.id) troupeIds.push(troupe.id);
  });
  setTroupeIds(character, troupeIds);

  // `register()` fetches the portrait before rendering. The query above already
  // `include`s it, so this is a redundant round trip in the original too --
  // kept because a portrait row saved by an older build can be a pointer stub,
  // and the template dereferences `original` unconditionally.
  const portrait = character.get('portrait') as Parse.Object | undefined;
  if (portrait) await portrait.fetch();

  return character;
}

registerScreen('characterportrait', CharacterPortrait);
