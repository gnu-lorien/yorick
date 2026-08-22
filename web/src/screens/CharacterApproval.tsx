import { useEffect, useMemo, useState } from 'react';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { reportError, clearError, showError } from '@/shell/reportError';
import type { Character } from '@/parse/models/Character';
import { loadCharacter } from '@/parse/character/load';
import { getRecordedChanges } from '@/parse/character/recordedChanges';
import {
  fetchApprovals,
  approveChange,
  transformedForRange,
  formatApproval,
  APPROVAL_HEADERS,
} from '@/parse/character/approvals';
import { fetchLongText } from '@/parse/character/longTexts';
import { PrintSheet } from '@/print/PrintSheet';
import { PrintSettings } from './CharacterPrint';
import { CHANGE_HEADERS, formatChangeEntry, type ChangeHeader } from '@/parse/character/recordedChanges';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Approve a character's changes, and see what is being approved.
 *
 * Ports views/CharacterApprovalView.js and its four templates. The page has
 * five regions, all declared in index.html:
 *
 *   #approval-changes    two sliders picking a range of changes
 *   #approval-approvals  a slider over past approvals
 *   #approval-edit       the Approve button, or the picked approval's row
 *   #approval-sheet      the character sheet as at the right-hand change,
 *                        with everything in the range marked up
 *   #approval-viewing    a table of the changes in the range
 *
 * Three numbers drive all of it -- `left`, `right` and `approval` -- and the
 * work of turning them into a sheet is `transformedForRange`, which replays the
 * change timeline twice. See its comment; it is the only genuinely intricate
 * part and it lives in the model rather than here.
 *
 * Moving the approvals slider re-derives left and right from that approval's
 * position in the timeline, so the three stay consistent. Moving either change
 * slider leaves the approval index alone.
 *
 * @compare #character/9cYrGGv2w3/approval
 */
export function CharacterApproval({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  useBackButton(`#character?${cid}`);

  const { track } = useLoading();
  const [character, setCharacter] = useState<Character | null>(null);
  const [changes, setChanges] = useState<Parse.Object[] | null>(null);
  const [approvals, setApprovals] = useState<Parse.Object[]>([]);
  const [picked, setPicked] = useState<{ left: number; right: number; approval: number } | null>(
    null,
  );

  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    void (async () => {
      try {
        // `get_character(cid, "all")` then the extended print text, because the
        // sheet in #approval-sheet draws both.
        const loaded = await track(loadCharacter(cid, 'all'));
        if (cancelled) return;
        await track(fetchLongText(loaded.character, 'extended_print_text'));
        const timeline = await track(getRecordedChanges(loaded.character));
        const priorApprovals = await track(fetchApprovals(loaded.character));
        if (cancelled) return;

        setCharacter(loaded.character);
        setChanges(timeline);
        setApprovals(priorApprovals);
        // The approval index starts one past the last approval, which is what
        // puts the Approve button on screen rather than a past approval's row.
        //
        // left and right are then DERIVED from it rather than set to the whole
        // timeline. `ApprovalsView.initialize` calls
        // `update_picks_for_approval(picked.approval)` on the way up, so the
        // range the screen opens on already excludes everything covered by the
        // most recent approval. Skipping that derivation makes no difference
        // until a character actually has an approval, and then it shows the
        // whole timeline as unapproved.
        setPicked(picksForApproval(timeline, priorApprovals, priorApprovals.length));
      } catch (error) {
        if (cancelled) return;
        showError(error, "Couldn't open that character's approvals");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, track]);

  const ready = character !== null && changes !== null && picked !== null;

  const transformed = useMemo(() => {
    if (!ready) return null;
    return transformedForRange(character, changes, picked.left, picked.right);
  }, [ready, character, changes, picked]);

  function pickApproval(index: number) {
    if (!changes) return;
    setPicked(picksForApproval(changes, approvals, index));
  }

  async function approve() {
    if (!character || !changes || !picked) return;
    const change = changes[picked.right];
    if (!change) return;
    try {
      const approval = await track(approveChange(character, change));
      clearError();
      const next = [...approvals, approval];
      setApprovals(next);
      // The original moves the range forward: everything from the change just
      // approved to the newest one is now the un-approved remainder.
      setPicked({ approval: next.length, left: picked.right, right: changes.length - 1 });
    } catch (error) {
      // `beforeSave("VampireApproval")` genuinely refuses some approvals -- a
      // player approving their own character, an approver with no Storyteller
      // role for the troupe. Without a handler the refusal had nowhere to go:
      // the button simply did nothing and said nothing.
      reportError(error, "Couldn't approve this change");
    }
  }

  return (
    <Page id="character-approval" title="Character Approval">
      <div id="approval-changes">
        {ready ? (
          <div>
            <ChangeRangeSliders
              changes={changes}
              left={picked.left}
              right={picked.right}
              onLeft={(value) => setPicked({ ...picked, left: value })}
              onRight={(value) => setPicked({ ...picked, right: value })}
            />
          </div>
        ) : null}
      </div>

      <div id="approval-approvals">
        {ready ? (
          <div>
            <ApprovalSlider
              approvals={approvals}
              value={picked.approval}
              onChange={pickApproval}
            />
          </div>
        ) : null}
      </div>

      <div id="approval-edit">
        {ready ? (
          <div>
            <ApprovalEdit
              approvals={approvals}
              changes={changes}
              picked={picked}
              onApprove={() => void approve()}
            />
          </div>
        ) : null}
      </div>

      <div id="approval-sheet">
        {ready && transformed ? <ApprovalSheet transformed={transformed} /> : null}
      </div>

      <div id="approval-viewing">
        {ready ? (
          <div>
            <SelectedChanges changes={changes} left={picked.left} right={picked.right} />
          </div>
        ) : null}
      </div>
    </Page>
  );
}

/** The sheet, embedded and with the range's changes marked up. */
function ApprovalSheet({
  transformed,
}: {
  transformed: ReturnType<typeof transformedForRange>;
}) {
  const [fontSize, setFontSize] = useState(100);
  const [excludeExtended, setExcludeExtended] = useState(false);
  return (
    <PrintSheet
      standalone={false}
      character={transformed.character}
      excludeExtended={excludeExtended}
      // The description is what turns the sheet into a diff: every value that
      // changed inside the range is drawn as the old one struck through in red
      // followed by the new one in green.
      context={{ character: transformed.character, transformDescription: transformed.description }}
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

/**
 * The two-handled range slider over the change timeline.
 *
 * `data-role="rangeslider"` wrapping two `<input type="range">`; jQuery Mobile
 * builds a `ui-rangeslider` from them, each half being an ordinary slider. The
 * hidden inputs after it carry each change's id -- the legacy handlers read
 * them back with `$("#history-changes-" + v).val()` -- and are kept because the
 * E2E suite selects on them.
 */
function ChangeRangeSliders({
  changes,
  left,
  right,
  onLeft,
  onRight,
}: {
  changes: Parse.Object[];
  left: number;
  right: number;
  onLeft: (value: number) => void;
  onRight: (value: number) => void;
}) {
  const max = Math.max(0, changes.length - 1);
  const pct = (value: number) => (max > 0 ? (value / max) * 100 : 0);
  return (
    <div>
      {/* jQM's slider gives the label it finds an id, so the handle can point
          at it with aria-labelledby: `$("label[for='" + inputId + "']")` then
          `.attr("id", inputId + "-label")`. */}
      <label htmlFor="slider" id="slider-label">
        Changes to Character:
      </label>
      {/*
        jQM's rangeslider is NOT two sliders stacked. The two number inputs are
        direct children of `.ui-rangeslider`, marked `-first` and `-last`, and
        the visible control is a single `.ui-rangeslider-sliders` holding two
        tracks -- one per handle -- whose `.ui-slider-bg` widths and margins
        together draw the selected span. Only the second track carries a handle
        in the harvested markup for a full-width range; both do in general, so
        both are emitted.
      */}
      <div data-role="rangeslider" className="ui-rangeslider">
        <input
          type="number"
          data-type="range"
          name="historyBaseRange"
          id="sliderbaserange"
          className="ui-shadow-inset ui-corner-all ui-slider-input ui-rangeslider-first ui-body-inherit"
          value={left}
          min={0}
          max={max}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(next)) onLeft(next);
          }}
        />
        <input
          type="number"
          data-type="range"
          name="historyChangePicker"
          id="slider"
          className="ui-shadow-inset ui-corner-all ui-slider-input ui-rangeslider-last ui-body-inherit"
          value={right}
          min={0}
          max={max}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(next)) onRight(next);
          }}
        />
        {/*
          Both handles live in the SECOND track. jQM builds a track per input
          and then moves every handle into the last one, so the first track is
          nothing but its selected-span div. Harvested from the running app --
          splitting one handle per track looks more sensible and does not match.
        */}
        <div className="ui-rangeslider-sliders">
          <RangeTrack spanFrom={left} spanTo={right} pct={pct} />
          <RangeTrack spanFrom={left} spanTo={right} pct={pct}>
            <RangeHandle value={left} max={max} pct={pct} />
            <RangeHandle value={right} max={max} pct={pct} />
          </RangeTrack>
        </div>
      </div>
      {changes.map((change, i) => (
        <input type="hidden" value={change.id ?? ''} id={`history-changes-${i}`} key={i} readOnly />
      ))}
    </div>
  );
}

/** One of the rangeslider's two tracks: the selected span, plus any handles. */
function RangeTrack({
  spanFrom,
  spanTo,
  pct,
  children,
}: {
  spanFrom: number;
  spanTo: number;
  pct: (value: number) => number;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="application"
      className="ui-slider-track ui-shadow-inset ui-bar-inherit ui-corner-all"
      aria-disabled="false"
    >
      <div
        className="ui-slider-bg ui-btn-active"
        style={{ width: `${pct(spanTo) - pct(spanFrom)}%`, marginLeft: `${pct(spanFrom)}%` }}
      />
      {children}
    </div>
  );
}

/** A rangeslider handle. `ui-btn-null` is jQM's "no label" button variant. */
function RangeHandle({
  value,
  max,
  pct,
}: {
  value: number;
  max: number;
  pct: (value: number) => number;
}) {
  return (
    <a
      href="#"
      className="ui-slider-handle ui-btn ui-shadow ui-btn-null"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={String(value)}
      title={String(value)}
      style={{ left: `${pct(value)}%` }}
      onClick={(e) => e.preventDefault()}
    />
  );
}

/** One half of the range slider: jQM's ordinary slider markup. */
function RangeHalf({
  id,
  name,
  value,
  max,
  onChange,
}: {
  id: string;
  name: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const fraction = max > 0 ? value / max : 0;
  return (
    <div className="ui-slider">
      <input
        type="number"
        data-type="range"
        name={name}
        id={id}
        className="ui-shadow-inset ui-body-inherit ui-corner-all ui-slider-input"
        value={value}
        min={0}
        max={max}
        onChange={(e) => {
          const next = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      <div role="application" className="ui-slider-track ui-shadow-inset ui-bar-inherit ui-corner-all">
        <a
          href="#"
          className="ui-slider-handle ui-btn ui-shadow"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={String(value)}
          title={String(value)}
          style={{ left: `${(fraction * 100).toFixed(4).replace(/\.?0+$/, '')}%` }}
          onClick={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}

/** The slider over past approvals. Its max is one PAST the last, deliberately. */
function ApprovalSlider({
  approvals,
  value,
  onChange,
}: {
  approvals: Parse.Object[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      {/* No id here, unlike the changes slider's label above. Measured: jQM
          gives the rangeslider's label an id and this plain slider's label
          none, on the same page and in the same render. Matched rather than
          made consistent. */}
      <label htmlFor="approval-slider">Previous Approvals:</label>
      <RangeHalf
        id="approval-slider"
        name="approvalChangePicker"
        value={value}
        // `max="<%= approvals.length %>"` -- one past the last index, which is
        // the "nothing approved yet" position the Approve button lives at.
        max={approvals.length}
        onChange={onChange}
      />
      {approvals.map((approval, i) => (
        <input type="hidden" value={approval.id ?? ''} id={`approval-changes-${i}`} key={i} readOnly />
      ))}
    </div>
  );
}

/**
 * Either the Approve button or the picked approval's row.
 *
 * Past the end of the approvals list the screen offers to approve; on a past
 * approval it shows that approval as a one-row table. "No unapproved changes"
 * replaces the button when there is nothing left -- either because the picked
 * left-hand end has caught up with the timeline, or because the newest approval
 * already covers the newest change.
 */
function ApprovalEdit({
  approvals,
  changes,
  picked,
  onApprove,
}: {
  approvals: Parse.Object[];
  changes: Parse.Object[];
  picked: { left: number; right: number; approval: number };
  onApprove: () => void;
}) {
  if (picked.approval <= approvals.length - 1) {
    const approval = approvals[picked.approval];
    return (
      <table data-role="table" id="table-column-toggle" className="ui-responsive table-stroke">
        <thead>
          <tr>
            {APPROVAL_HEADERS.map((header, i) => (
              <th data-priority={i + 1} key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {approval ? (
            <tr>
              {APPROVAL_HEADERS.map((header) => (
                <td key={header}>{formatApproval(approval, header)}</td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    );
  }

  let noneRemaining = picked.left >= changes.length;
  const lastApproval = approvals[approvals.length - 1];
  if (lastApproval) {
    const approvedId = (lastApproval.get('change') as Parse.Object | undefined)?.id;
    const newestId = changes[changes.length - 1]?.id;
    if (approvedId && approvedId === newestId) noneRemaining = true;
  }

  if (noneRemaining) return <span>No unapproved changes</span>;
  return (
    // jQM's buttonMarkup enhances this <button> from clean, so it gains the
    // shadow and corners -- unlike the template-authored `ui-btn` buttons
    // elsewhere, which suppress them. See docs/react-migration/README.md.
    <button className="approve-change ui-btn ui-corner-all ui-shadow" onClick={onApprove}>
      Approve changes up to {picked.right}
    </button>
  );
}

registerScreen('characterapproval', CharacterApproval);

/**
 * The range of changes an approval index selects.
 *
 * Ports `update_picks_for_approval`. The chosen approval's change fixes the
 * right-hand end; the one before it fixes the left, one past where it stopped.
 * Past the end of the list -- the "not yet approved" position -- the right-hand
 * end is the newest change and the left is just after the last approved one.
 */
function picksForApproval(
  changes: Parse.Object[],
  approvals: Parse.Object[],
  index: number,
): { left: number; right: number; approval: number } {
  let left = 0;
  let right = changes.length - 1;

  const approval = approvals[index];
  if (approval) {
    const changeId = (approval.get('change') as Parse.Object | undefined)?.id;
    const found = lastIndexOfChange(changes, changeId);
    if (found !== -1) right = found;
  }
  if (index > 0) {
    const previous = approvals[index - 1];
    const previousId = (previous?.get('change') as Parse.Object | undefined)?.id;
    const found = lastIndexOfChange(changes, previousId);
    if (found !== -1) left = found + 1;
  }

  // Clamped to the slider's own range, because in the legacy app the slider
  // does the clamping and then writes the clamped value back.
  //
  // `left = found + 1` runs off the end whenever the last approval covers the
  // newest change: with four changes and the newest approved, it computes 4
  // against a max of 3. jQuery Mobile's rangeslider pins the input to its max
  // and fires `change`, which `ChangesView.update_left` writes straight into
  // `picked` -- so the state the screen settles on is left = 3, not 4.
  // Measured on the running app: `picked` reads {approval: 1, left: 3,
  // right: 3} in exactly that situation, and the range shows one row rather
  // than none.
  const top = Math.max(0, changes.length - 1);
  return {
    approval: index,
    left: Math.min(Math.max(0, left), top),
    right: Math.min(Math.max(0, right), top),
  };
}

/**
 * The index of the last change with this id.
 *
 * `_.findLast(models, m => m.id == approval.get("change").id)` in
 * `update_picks_for_approval`. A reverse scan rather than `findLastIndex`,
 * which needs a newer lib target than this project sets.
 */
function lastIndexOfChange(changes: Parse.Object[], id: string | undefined): number {
  if (!id) return -1;
  for (let i = changes.length - 1; i >= 0; i--) {
    if (changes[i]?.id === id) return i;
  }
  return -1;
}

/**
 * The changes inside the picked range.
 *
 * Ports templates/character-approval-selected-view.html. Close to the log's
 * table but not the same one, in two ways that matter: it opens with an extra
 * unlabelled "i" column carrying each row's absolute position in the timeline
 * (`i + left_rc_index`, so the numbers keep meaning something when the range
 * does not start at zero), and its `headers` list begins with "id", which the
 * log's does not. The table also carries no `id` attribute, where the log's
 * has `table-column-toggle`.
 */
const SELECTED_HEADERS = ['id', ...CHANGE_HEADERS] as const;

function SelectedChanges({
  changes,
  left,
  right,
}: {
  changes: Parse.Object[];
  left: number;
  right: number;
}) {
  const rows = changes.slice(left, right + 1);
  return (
    // jQM's reflow table: `ui-table ui-table-reflow` on the element,
    // `data-colstart` on every header, and a `b.ui-table-cell-label` inside
    // every cell carrying that column's name. Below the breakpoint the
    // stylesheet stacks each row and those labels are what identifies the
    // values, so they are the whole point of the widget rather than decoration.
    //
    // The "i" header has a `data-colstart` but no `data-priority`: jQM numbers
    // every column, while `data-priority` comes from the template, and the
    // template writes a bare `<th>i</th>`.
    <table data-role="table" className="ui-responsive table-stroke ui-table ui-table-reflow">
      <thead>
        <tr>
          <th data-colstart={1}>i</th>
          {SELECTED_HEADERS.map((header, i) => (
            <th data-priority={i + 1} data-colstart={i + 2} key={header}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row?.id ?? i}>
            <td>
              <b className="ui-table-cell-label">i</b>
              {i + left}
            </td>
            {SELECTED_HEADERS.map((header) => (
              <td key={header}>
                <b className="ui-table-cell-label">{header}</b>
                {formatChangeEntry(row, header as ChangeHeader)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
