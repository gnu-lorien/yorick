import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { Character } from '@/parse/models/Character';
import { loadCharacter } from '@/parse/character/load';
import { getRecordedChanges } from '@/parse/character/recordedChanges';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { ChangeTable } from './CharacterLog';
import { getTransformed } from '@/parse/character/approvals';
import { PrintSheet } from '@/print/PrintSheet';
import { PrintSettings } from './CharacterPrint';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The character's timeline: a slider over every recorded change, and the two
 * rows either side of where it is parked.
 *
 * Ports views/CharacterHistoryView.js, templates/character-history-view.html
 * and templates/character-history-selected-view.html, inside the
 * `#character-history` page from public/index.html.
 *
 * The page is three regions, and the legacy LayoutView fills all three:
 *
 *   #history-main     MainView -- the slider. Ported.
 *   #history-viewing  ViewingView -- the change applied, and the one undone.
 *                     Ported.
 *   #history-sheet    CharacterPrintView -- the whole character sheet, redrawn
 *                     as it stood at the picked moment. NOT ported; see below.
 *
 * Rows come from `getRecordedChanges`, which is the timeline reading of
 * VampireChange: oldest first, with the `experience` rows excluded. Index 0 is
 * therefore the oldest change and the last index the newest, which is why the
 * slider starts at the far right -- `picked` is initialised to
 * `recorded_changes.models.length - 1`.
 *
 * The route is `character/:cid/history/:id` and `:id` is not used. The handler
 * passes it (`self.characterHistoryView.register(character, id)`,
 * mobileRouter.js:462) to a `register: function (model)` that declares one
 * parameter, so it has never selected anything; the slider always opens on the
 * newest change whatever the URL says. Kept, because a port that made `:id`
 * mean something would be a behaviour change wearing a migration's clothes.
 *
 * `#history-sheet` holds the whole character sheet, redrawn as it stood at the
 * picked moment. The changes to undo are the ones AFTER the picked index --
 * `takeRightWhile(model => model.id != selectedId)`, reversed -- replayed
 * backwards by `getTransformed`. The reconstruction is then shown with an empty
 * transform description (`c.transform_description = []`), so nothing is marked
 * red or green: this screen shows a past state, not a diff. The approval screen
 * is the one that shows a diff, and it passes a description.
 *
 * @compare #character/9cYrGGv2w3/history/0
 *
 * This used to be order-dependent, and the order was the ordinary one. Visited
 * on its own the screen matched; visited after `#character/:cid/approval` --
 * Back, then History, a normal click path -- the legacy sheet grew red and
 * green change markers that did not belong on it, because CharacterApprovalView
 * wrote its diff onto the *shared cached character* rather than onto the clone
 * it rendered, and the router memoises that character across routes. That is
 * legacy bug #14 and it is fixed; React holds no state between screens, so it
 * always drew the plain sheet and now both agree.
 */
export function CharacterHistoryScreen({ route }: ScreenProps) {
  const cid = route.named['cid'];
  const { track } = useLoading();

  const [changes, setChanges] = useState<Parse.Object[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);

  useBackButton(`#character?${cid}`);

  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    void (async () => {
      try {
        // `get_character(cid, "all")` -- every trait category hydrated, which
        // the sheet in #history-sheet needs to draw. The slider and the two
        // tables would be happy with the character alone.
        const loaded = await track(loadCharacter(cid, 'all'));
        if (cancelled) return;
        const character = loaded.character;
        setCharacter(character);
        // `get_recorded_changes()` with nothing held yet: the full fetch.
        const timeline = await track(getRecordedChanges(character));
        if (cancelled) return;
        setChanges(timeline);
        // `self.picked.set("value", self.model.recorded_changes.models.length - 1)`
        // -- the newest change. For a character with no non-XP changes at all
        // that is -1, and the -1 is load-bearing further down; see PickedRow.
        setPicked(timeline.length - 1);
      } catch (error) {
        if (cancelled) return;
        // mobileRouter.js:467 ends the chain with `.fail(PromiseFailReport)`,
        // which only writes to the console -- and its `$.mobile.loading("hide")`
        // sits in the `.then()`, not an `.always()`, so a character that will
        // not load leaves the spinner up for good with nothing said anywhere.
        // `track()` fixes the spinner because it cannot forget, and the banner
        // is the deliberate addition: it does not redirect, so the screen still
        // behaves as the original does.
        showError(error, "Couldn't open the character history");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, track]);

  const ready = changes !== null && picked !== null && character !== null;

  return (
    <Page id="character-history" title="Character History">
      {/* The three region divs are in index.html, so they exist before any
          child view renders. The extra <div> inside each is the Marionette
          ItemView's own element -- default tagName "div", no className -- and
          it is part of the DOM the stylesheet sees. */}
      <div id="history-main">
        {ready ? (
          <div>
            <TimeSlider
              value={picked}
              max={changes.length - 1}
              changes={changes}
              onChange={setPicked}
            />
          </div>
        ) : null}
      </div>
      <div id="history-viewing">
        {ready ? (
          <div>
            <ViewingTables changes={changes} picked={picked} />
          </div>
        ) : null}
      </div>
      <div id="history-sheet">
        {ready ? <HistorySheet character={character} changes={changes} picked={picked} /> : null}
      </div>
    </Page>
  );
}

/**
 * "Point in time" -- jQuery Mobile's slider, as it leaves the template's
 * `<input type="range">`.
 *
 * The enhancement is not cosmetic and cannot be skipped: jQM rewrites the
 * range input to `type="number"` with `data-type="range"`, wraps it in
 * `div.ui-slider`, and adds a track and a handle anchor beside it. The
 * stylesheet draws the control entirely from the track and the handle -- the
 * input is the readout, not the slider. Captured from the running app at
 * `#character/9cYrGGv2w3/history/0`.
 *
 * `id="slider"` is the template's own, so it survives; jQM only mints
 * `slider-<n>` ids for inputs that have none.
 *
 * React's development build logs "In HTML, <div> cannot be a descendant of
 * <p>" for the wrapper below, and the warning is correct: the template's `<p>`
 * ends up containing block elements. It is also unavoidable, because that is
 * the DOM the legacy app has -- jQM builds `div.ui-slider` in place, inside
 * whatever element held the range input. Matching it is the point; the warning
 * is dev-only and there is nothing to fix without diverging.
 *
 * The hidden `history-changes-<i>` inputs are the template's index-to-objectId
 * map, read back by `update_picked` to find where to cut the timeline. Nothing
 * needs them here -- the picked index is state and the array is in hand -- but
 * they are markup the stylesheet and any onlooking selector can see, so they
 * are rendered.
 */
function TimeSlider({
  value,
  max,
  changes,
  onChange,
}: {
  value: number;
  max: number;
  changes: Parse.Object[];
  onChange: (next: number) => void;
}) {
  const min = 0;

  // jQM's own arithmetic: `(value - min) / (max - min) * 100`, unclamped. With
  // no changes at all that is (-1 - 0) / (-1 - 0), which is 100% -- the handle
  // parks at the right-hand end, which is what the running app shows.
  const percent = useMemo(() => {
    const span = max - min;
    const raw = span === 0 ? 0 : ((value - min) / span) * 100;
    return Number.isFinite(raw) ? raw : 0;
  }, [value, max]);

  const pick = (clientX: number, track: HTMLDivElement) => {
    if (max <= min) return;
    const box = track.getBoundingClientRect();
    if (box.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    onChange(Math.round(min + fraction * (max - min)));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const track = event.currentTarget;
    track.setPointerCapture(event.pointerId);
    pick(event.clientX, track);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    pick(event.clientX, event.currentTarget);
  };

  return (
    <p>
      <label htmlFor="slider">Point in time:</label>
      <div className="ui-slider">
        <input
          type="number"
          data-type="range"
          name="historyChangePicker"
          id="slider"
          value={value}
          min={min}
          max={max}
          className="ui-shadow-inset ui-body-inherit ui-corner-all ui-slider-input"
          // `events: {"change": "update_picked"}` on MainView. jQM keeps the
          // number input editable and in step with the handle, so typing an
          // index moves the slider.
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            if (!Number.isNaN(next)) onChange(next);
          }}
        />
        <div
          role="application"
          className="ui-slider-track ui-shadow-inset ui-bar-inherit ui-corner-all"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <a
            href="#"
            className="ui-slider-handle ui-btn ui-shadow"
            role="slider"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={String(value)}
            title={String(value)}
            aria-labelledby="slider-label"
            style={{ left: `${percent}%` }}
            onClick={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault();
                onChange(Math.max(min, value - 1));
              } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault();
                onChange(Math.min(max, value + 1));
              }
            }}
          />
        </div>
      </div>
      {changes.map((change, i) => (
        <input key={change.id ?? i} type="hidden" value={change.id ?? ''} id={`history-changes-${i}`} readOnly />
      ))}
    </p>
  );
}

/**
 * The two tables under the slider.
 *
 * templates/character-history-selected-view.html. The "Reversed Change" block
 * is rendered only when the slider is off its right-hand end -- when the newest
 * change is showing there is nothing after it to have undone -- and the row it
 * shows is `logs[min(picked + 1, logs.length - 1)]`, one step *newer* than the
 * picked one, the list being oldest-first.
 *
 * `logs[idForPickedIndex]` is indexed directly with no bounds check, and for a
 * character with no non-XP changes `picked` is -1, so the lookup is `logs[-1]`
 * -- undefined. `formatChangeEntry` prints "Undefined log" in all twelve cells
 * rather than throwing, which is why its `undefined` branch exists and why the
 * table still has exactly one row here. Reproduced, undefined row and all.
 */
function ViewingTables({ changes, picked }: { changes: Parse.Object[]; picked: number }) {
  const newest = changes.length - 1;
  const undone = Math.min(picked + 1, newest);
  return (
    <>
      {picked !== newest ? (
        <>
          <span>Reversed Change</span>
          <ChangeTable rows={[changes[undone]]} />
        </>
      ) : null}
      <span>Most Recent Change Applied</span>
      <ChangeTable rows={[changes[picked]]} />
    </>
  );
}

registerScreen('characterhistory', CharacterHistoryScreen);

/**
 * The character as it stood at the picked change.
 *
 * `getTransformed` undoes everything newer than the picked row, so the further
 * left the slider goes the further back the sheet reads. The description it
 * returns is deliberately dropped: MainView sets
 * `c.transform_description = []` before handing the clone to the print view, so
 * this screen shows a state rather than a diff.
 */
function HistorySheet({
  character,
  changes,
  picked,
}: {
  character: Character;
  changes: Parse.Object[];
  picked: number;
}) {
  const transformed = useMemo(() => {
    // Everything after the picked index, newest first -- the order
    // `getTransformed` replays them in to walk backwards.
    const toUndo = changes.slice(picked + 1).reverse();
    return getTransformed(character, toUndo);
  }, [character, changes, picked]);

  // Embedded in a region, and with the print settings form: the history view
  // passes no `no_print_settings_form`, so the font-size control shows here too.
  const [fontSize, setFontSize] = useState(100);
  const [excludeExtended, setExcludeExtended] = useState(false);
  return (
    <PrintSheet
      standalone={false}
      character={transformed.character}
      excludeExtended={excludeExtended}
      settings={
        <PrintSettings
          fontSize={fontSize}
          onFontSize={setFontSize}
          excludeExtended={excludeExtended}
          onExcludeExtended={setExcludeExtended}
        />
      }
    />
  );
}
