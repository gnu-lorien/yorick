import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { Parse } from '@/parse/init';
import { Troupe } from '@/parse/models/Troupe';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Upload a troupe's portrait.
 *
 * Ports the `troupe_portrait` handler (mobileRouter.js:2102),
 * views/TroupePortraitView.js and the `#troupePortraitView` template in
 * public/index.html.
 *
 * There is no client-side image work here and there never was: the file goes up
 * untouched and `crop_and_thumb` in cloud/main.js, hooked on
 * `beforeSave("TroupePortrait")`, fetches it back over `publicServerURL` and
 * writes `thumb_32/64/128/256`. That is why e2e/helpers/portraits.js opens with
 * a note about `publicServerURL`, and why the troupe *detail* page shows the
 * original in a bare `<img>` while the directory shows `thumb_128` in
 * `img.troupe-link-portrait` -- the two surfaces read different fields of the
 * same TroupePortrait row.
 *
 * Three things in the original look wrong and are kept, because a port that
 * also fixes things cannot be reviewed:
 *
 * - **The 1MB check does not stop the upload.** TroupePortraitView.js:44 writes
 *   "Picture too large. Limit is 1MB" into `.error` and then falls straight
 *   through to `parseFile.save()`. So an oversized picture is uploaded anyway,
 *   and the warning is cleared by the `.hide()` on success. Reproduced.
 * - **The Parse.File name has no dot.** `"portrait" + extension` where
 *   `extension` is already the bare `"png"`, so the stored name is
 *   `portraitpng`. Harmless -- the thumbnails are named by cloud code and the
 *   browser goes by content type -- but changing it would change what the
 *   server stores.
 * - **The label points at nothing.** `for="input-portrait"` is the input's
 *   `name`, not its `id` (`troupe-input-portrait`), so clicking the label does
 *   not open the file picker.
 *
 * The E2E flow is `#troupe-portrait #troupe-input-portrait` for the file,
 * `#troupe-portrait button.update` for the click, and `.error` inside the page
 * as the pass/fail signal (e2e/helpers/portraits.js:53 and
 * `waitForUploadOutcome`). All three are contract, so the upload failure path
 * writes to that div rather than to the global banner, exactly as the view did.
 *
 * @compare #troupe/tD352i0d4Z/portrait
 */
export function TroupePortrait({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  // mobileRouter.js:2105, inside the `enforce_logged_in().then` and ahead of
  // the fetch -- the back button is part of the screen, not part of the data.
  useBackButton(`#troupe/${id}`);

  const { track, show, hide } = useLoading();
  const fileInput = useRef<HTMLInputElement>(null);
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * The portrait as this screen currently knows it.
   *
   * The view listens for `change:portrait` on the troupe and re-renders, which
   * is how the just-uploaded picture appears without a reload. `Parse.Object`
   * mutation is invisible to React, so the new row is held in state instead and
   * the render reads state first.
   */
  const [uploaded, setUploaded] = useState<Parse.Object | null>(null);

  const { data: troupe, isFetching, error } = useQuery({
    queryKey: ['troupe', id, 'portrait'],
    enabled: !!id,
    queryFn: async () => {
      const found = await new Parse.Query(Troupe).include('portrait').get(id);
      // TroupePortraitView.register fetches the portrait before rendering. The
      // query above already `include`s it, so this is a redundant round trip in
      // the original too -- kept because a portrait row saved by an older build
      // can be a pointer stub, and the template dereferences `original`
      // unconditionally.
      const portrait = found.get('portrait') as Parse.Object | undefined;
      if (portrait) await portrait.fetch();
      return found;
    },
  });

  // The handler brackets the route in $.mobile.loading("show") / ("hide"), the
  // hide in an `.always()` so a failed load does not strand the spinner.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // The legacy chain ends in `.fail(PromiseFailReport)`, which writes to the
  // console and never transitions, so a troupe that cannot be loaded leaves you
  // on whatever page you were already on with no explanation. React has already
  // navigated by the time the fetch fails, so saying so is the one deliberate
  // addition here.
  useEffect(() => {
    if (error) showError(error, "Couldn't load the troupe");
  }, [error]);

  const portrait = uploaded ?? (troupe?.get('portrait') as Parse.Object | undefined) ?? null;
  const original = portrait?.get('original') as Parse.File | undefined;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // `undelegateEvents()` for the life of the upload (TroupePortraitView.js:47)
    // -- a second click while one is in flight does nothing at all.
    if (busy) return;

    const portraitFile = fileInput.current?.files?.[0];
    // The original reads `files[0].name` with no guard, so submitting with no
    // file chosen throws a TypeError out of the handler; `return false` is
    // never reached and the form submits for real. Returning quietly is the one
    // divergence in this file, and it is a divergence from a crash.
    if (!portraitFile || !troupe) return;

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

          // Reuse the existing TroupePortrait row when there is one, so the
          // troupe keeps a single portrait object across re-uploads. The ACL is
          // re-stamped every time: public read, no public write, and the
          // *generic* LST role -- not `LST_<troupeId>` -- read and write.
          const troupePortrait =
            (troupe.get('portrait') as Parse.Object | undefined) ??
            new Parse.Object('TroupePortrait');
          const acl = new Parse.ACL();
          acl.setPublicReadAccess(true);
          acl.setPublicWriteAccess(false);
          acl.setRoleReadAccess('LST', true);
          acl.setRoleWriteAccess('LST', true);
          troupePortrait.setACL(acl);
          troupePortrait.set('original', file);

          // This save is what runs crop_and_thumb, so it is the slow one and
          // the one that fails when the server's publicServerURL is wrong.
          const saved = await troupePortrait.save();

          // The view sets the pointer and *then* saves the troupe, so the
          // picture appears as soon as the portrait row is written rather than
          // after the second write. Same order here.
          troupe.set('portrait', saved);
          setUploaded(saved);
          await troupe.save();
        })(),
      );
      // `.done(function() { self.$(".error").hide(); })` -- the last step, so an
      // oversize warning raised above is cleared only by a complete success.
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
    <Page id="troupe-portrait" title="Profile">
      <h1>{troupe?.name ?? ''}</h1>
      {/* `<% if (troupe.get('portrait')) %>` guards the pointer but not the
          file, and the template then calls `.url()` on it -- a portrait row
          whose beforeSave failed before `original` landed would throw there.
          Rendering nothing is the closest safe equivalent. */}
      {original ? <img src={original.url()} alt="" /> : null}
      <form className="portrait-form" onSubmit={onSubmit}>
        <div className="error" style={{ display: errorText ? 'block' : 'none' }}>
          {errorText}
        </div>
        {/* `for` is the input's name, not its id. See the note above. */}
        <label htmlFor="input-portrait">Portrait</label>
        {/* jQuery Mobile's textinput widget wraps every `input` it enhances,
            file inputs included -- jquery.mobile-1.4.5.js:8390 lists
            `input[type='file']` in its initSelector and `_enhance` wraps
            anything that is an `input`. */}
        <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input type="file" name="input-portrait" id="troupe-input-portrait" ref={fileInput} />
        </div>
        {/* The template hand-writes these classes; jQM's button widget does not
            touch a `<button>` element at all (its initSelector is only
            `input[type=button|submit|reset]`, jquery.mobile-1.4.5.js:8202), so
            this markup is already the enhanced markup. */}
        <button className="ui-shadow ui-btn ui-corner-all ui-icon-action ui-btn-icon-right update">
          Upload
        </button>
      </form>
    </Page>
  );
}

registerScreen('troupe_portrait', TroupePortrait);
