import { Fragment } from 'react';
import type { Character } from '@/parse/models/Character';
import type { SimpleTrait } from '@/parse/models/SimpleTrait';
import {
  groupedSkills,
  sortedSkills,
  healthLevels,
  willpowerBoxCount,
} from '@/parse/character/approvals';
import { getFetchedLongText } from '@/parse/character/longTexts';
import { generation, morality } from '@/parse/venues/vampire';
import { seeming } from '@/parse/venues/changeling';
import {
  attributeValueParts,
  focusParts,
  simpleTextParts,
  traitParts,
  type DiffPart,
  type PrintContext,
  type SkillStyle,
} from './format';
import { layoutFor, type Panel, type Section, type BarField } from './layout';

/**
 * The printable character sheet.
 *
 * Ports views/CharacterPrintView.js (1037 lines), templates/print/*.html and
 * templates/character-print-parent.html.
 *
 * Almost all of the original's length is three near-identical branches of
 * `setup_regions` configuring the same handful of views differently per
 * creature type. That configuration is now data in ./layout.ts, so this file is
 * one pass over it.
 *
 * The sheet is drawn almost entirely out of Font Awesome squares and circles --
 * `<i class="fa fa-square-o">` for an empty box, `fa-circle` for a filled one.
 * The gaps between groups of boxes are literal `&nbsp;` and `<br/>`, emitted at
 * intervals the templates hard-code. Those intervals differ per track and are
 * kept exactly, because they are what makes a 30-box blood pool countable.
 */

export interface PrintSheetProps {
  character: Character;
  /** Set when the sheet is showing a range of changes, as on the approval screen. */
  context?: PrintContext;
  /** Hides the extended print text, as the print settings form can. */
  excludeExtended?: boolean;
  /**
   * The print settings form, rendered into `#cpp-settings`.
   *
   * Passed in rather than built here because the approval screen suppresses it
   * -- `options.no_print_settings_form` -- while the print screen supplies it.
   */
  settings?: React.ReactNode;
  /**
   * True when the sheet IS the page, false when it is embedded in one.
   *
   * The print screen is the standalone case: Marionette renders the layout
   * view in place of the page's content div, so the sheet's own
   * `div[role="main"].ui-content.force-printing-page-break` and the page's are
   * the same element, and `<Page contentClassName>` supplies it.
   *
   * The history and approval screens embed the same view inside a region, where
   * it keeps both its Marionette element and its template's opening div -- so
   * `#history-sheet > div > div.ui-content.force-printing-page-break`.
   */
  standalone?: boolean;
}

/** An empty box. */
function Box() {
  return <i className="fa fa-square-o" />;
}

/** A filled circle -- blood per turn, and the gnosis/rage pips. */
function Pip() {
  return <i className="fa fa-circle" />;
}

/**
 * A row of boxes with the separators the print templates emit.
 *
 * `split` inserts a non-breaking space after every nth box and `linebreak` a
 * `<br/>`; either may be absent. The templates count from 1 for the blood and
 * morality tracks and from 0 for willpower and gnosis -- `0 == i % 5` against
 * `_.range(1, 31)` versus `0 == (i + 1) % 5` against `_.range(0, total)` -- so
 * both end up breaking after the 5th box. Written once, counting from 1.
 */
function Boxes({ total, split, linebreak }: { total: number; split?: number; linebreak?: number }) {
  const count = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  return (
    <>
      {Array.from({ length: count }, (_, index) => {
        const i = index + 1;
        return (
          <Fragment key={i}>
            <Box />
            {split && i % split === 0 ? <>&nbsp;</> : null}
            {linebreak && i % linebreak === 0 ? <br /> : null}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * The element a Marionette ItemView contributes just by existing.
 *
 * Every child view on this sheet renders its template *inside* its own element,
 * whose default tagName is `div`. So `#cpp-header` holds a `div` holding the
 * `h1`, not the `h1` directly, and each box panel is a `div` inside a `div` --
 * the outer one the view's, the inner one its template's opening tag.
 *
 * Two of the views set their own element's class instead of wrapping again --
 * TextBarView declares `className: "ui-grid-b ui-responsive"` and AttributesView
 * adds the same two in `initialize` -- which is why those two render their grid
 * div directly and are not wrapped here.
 *
 * And six of them throw the wrapper away again on render:
 *
 *     onRender: function () {
 *         this.$el = this.$el.children();
 *         this.$el.unwrap();
 *         this.setElement(this.$el);
 *     }
 *
 * -- BloodView, FixedBloodView, GlamourView, HealthLevelsView, TotalView and
 * SectionsView. So whether a wrapper survives is a per-view fact with no rule
 * behind it, and `PANEL_KEEPS_WRAPPER` below records which is which. Getting it
 * wrong shifts everything below by one level of nesting, which is what the DOM
 * comparison catches.
 */
function ItemView({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

/** A panel heading. Every box track carries one. */
function PanelHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="ui-bar ui-bar-a ui-corner-all">{children}</h4>;
}

/** Render one formatted value, with its additions and removals marked. */
function Parts({ parts }: { parts: DiffPart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'plain') return <Fragment key={i}>{part.text}</Fragment>;
        const removed = part.kind === 'removed';
        return (
          <Fragment key={i}>
            {i > 0 ? ' ' : null}
            <span style={{ color: removed ? 'indianred' : 'darkseagreen' }}>
              <i className={removed ? 'fa fa-minus' : 'fa fa-plus'} />
              {part.text}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * Blood per turn, by generation.
 *
 * The lookup is inline in templates/print/blood.html and covers generations 1
 * to 5 only. A generation outside that prints an empty cell, which the original
 * does too -- `bptLookup[6]` is undefined and interpolates as "".
 */
const BLOOD_PER_TURN: Record<number, number> = { 1: 10, 2: 12, 3: 15, 4: 20, 5: 30 };

/** Glamour box count, by seeming. Also 1..5 only. */
const GLAMOUR_BY_SEEMING: Record<number, number> = { 1: 14, 2: 13, 3: 12, 4: 11, 5: 10 };

/**
 * Whether the view behind a panel keeps its Marionette wrapper element.
 *
 * See ItemView. Blood, fixed blood, glamour and the plain totals unwrap
 * themselves; gnosis, willpower and morality do not.
 */
const PANEL_KEEPS_WRAPPER: Record<Panel['kind'], boolean> = {
  blood: false,
  fixedBlood: false,
  glamour: false,
  total: false,
  gnosis: true,
  willpower: true,
  morality: true,
};

/** A panel, wrapped or not according to what its legacy view did. */
function Panel({ panel, context }: { panel: Panel; context: PrintContext }) {
  const view = <PanelView panel={panel} context={context} />;
  return PANEL_KEEPS_WRAPPER[panel.kind] ? <ItemView>{view}</ItemView> : view;
}

function PanelView({ panel, context }: { panel: Panel; context: PrintContext }) {
  const character = context.character;

  switch (panel.kind) {
    case 'blood': {
      const gen = generation(character);
      return (
        <div>
          <PanelHeading>Blood</PanelHeading>
          <Boxes total={30} split={5} linebreak={10} />
          {Array.from({ length: Math.max(0, gen) }, (_, i) => (
            <Pip key={i} />
          ))}
          {BLOOD_PER_TURN[gen] ?? ''} / {gen}
        </div>
      );
    }

    case 'fixedBlood':
      return (
        <div>
          <PanelHeading>Blood</PanelHeading>
          <Boxes total={panel.total} split={panel.split} linebreak={panel.linebreak} />
          {Array.from({ length: Math.max(0, panel.bloodPerTurn) }, (_, i) => (
            <Pip key={i} />
          ))}
          {panel.total} / {panel.bloodPerTurn}
        </div>
      );

    case 'glamour': {
      const s = seeming(character);
      return (
        <div>
          <PanelHeading>Glamour</PanelHeading>
          {s !== 0 ? <Boxes total={GLAMOUR_BY_SEEMING[s] ?? 0} split={5} linebreak={10} /> : null}
          {s === 0 ? (
            'Kinain'
          ) : (
            <>
              <br />
              {GLAMOUR_BY_SEEMING[s] ?? ''}
            </>
          )}
        </div>
      );
    }

    case 'gnosis':
      return (
        <div>
          <PanelHeading>Gnosis</PanelHeading>
          <Boxes total={gnosisTotal(character)} split={5} />
        </div>
      );

    case 'willpower':
      return (
        <div>
          <PanelHeading>Willpower</PanelHeading>
          <Boxes total={willpowerBoxCount(character)} split={5} />
        </div>
      );

    case 'morality': {
      const path = morality(character);
      return (
        <div>
          <PanelHeading>Morality</PanelHeading>
          {path.name}
          <br />
          <Boxes total={Number.parseInt(String(path.value), 10) || 0} split={5} />
        </div>
      );
    }

    case 'total':
      return (
        <div>
          <PanelHeading>{panel.name}</PanelHeading>
          <Boxes total={panel.total} split={panel.split} />
        </div>
      );
  }
}

/**
 * The werewolf's gnosis pool.
 *
 * Ports `get_gnosis_total` -- the sum of `wta_gnosis_sources` values. Lives here
 * rather than in the werewolf venue because it is only ever drawn, never priced.
 */
function gnosisTotal(character: Character): number {
  const sources = (character.get('wta_gnosis_sources') as SimpleTrait[] | undefined) ?? [];
  return sources.reduce((total, source) => total + (source?.value ?? 0), 0);
}

/**
 * One of the two heading bars under the name.
 *
 * A field with no value is omitted entirely -- not rendered blank -- and the
 * `ui-block-*` letters are assigned by position among the fields that *were*
 * declared, not among those that survive. So a werewolf with no tribe still
 * puts its breed in `ui-block-b`, leaving the first column empty.
 */
function TextBar({ fields, context }: { fields: BarField[]; context: PrintContext }) {
  return (
    <div className="ui-grid-b ui-responsive">
      {fields.map((field, i) => {
        if (!context.character.get(field.name)) return null;
        return (
          <div className={`ui-block-${String.fromCharCode(97 + i)}`} key={field.name}>
            <h2 className="ui-bar ui-bar-a">
              {field.display}: <Parts parts={simpleTextParts(context, field.name)} />
            </h2>
          </div>
        );
      })}
    </div>
  );
}

/** The three attributes, each with its focuses underneath. */
function Attributes({ context }: { context: PrintContext }) {
  const attributes = (context.character.get('attributes') as SimpleTrait[] | undefined) ?? [];
  return (
    <div className="ui-grid-b ui-responsive">
      {['Physical', 'Social', 'Mental'].map((name, i) => {
        const attribute = attributes.find((candidate) => candidate?.name === name);
        const focuses = focusParts(context, name);
        return (
          <div className={`ui-block-${String.fromCharCode(97 + i)}`} key={name}>
            <h4 className="ui-bar ui-bar-a ui-corner-all">{name}</h4>
            <div className="ui-body">
              {attribute ? <Parts parts={attributeValueParts(context, attribute)} /> : null}
              <br />
              {focuses.map((parts, index) => (
                <Fragment key={index}>
                  {index > 0 ? ' ' : null}
                  <Parts parts={parts} />
                </Fragment>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The skills block: every skill, in three columns.
 *
 * `groupedSkills` returns rows of three, and the column letter comes from the
 * position within the row -- so the grid reads across, not down.
 */
function Skills({ context }: { context: PrintContext }) {
  const skills = sortedSkills(context.character);
  const rows = groupedSkills(skills);
  return (
    <>
      <h4 className="ui-bar ui-bar-a">Skills</h4>
      <div className="ui-grid-b ui-responsive">
        {rows.map((row, rowIndex) =>
          row.map((skill, i) =>
            skill ? (
              <div className={`ui-block-${String.fromCharCode(97 + (i % 3))}`} key={`${rowIndex}-${i}`}>
                <div className="ui-body" style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  <Parts parts={traitParts(context, skill, 1)} />
                </div>
              </div>
            ) : null,
          ),
        )}
      </div>
    </>
  );
}

/**
 * One of the six bottom cells.
 *
 * A section with no traits is omitted heading and all -- the template's guard is
 * `character.has(name) && 0 != character.get(name).length`, so an empty
 * category leaves no trace rather than an empty heading.
 */
function Sections({ sections, context }: { sections: Section[]; context: PrintContext }) {
  // An empty list means the venue never fills this region at all -- the
  // changeling sheet declares no Rituals block, so `showChildView` is never
  // called for `bottom_two_b` and the cell stays empty. That is different from a
  // region whose sections all happen to hold no traits, which still renders the
  // view's own (empty) div.
  if (!sections.length) return null;
  return (
    <div>
      {sections.map((section) => {
        const traits = (context.character.get(section.name) as SimpleTrait[] | undefined) ?? [];
        if (!traits.length) return null;
        const ordered = orderSection(traits, section);
        return (
          <Fragment key={section.name}>
            <h4 className="ui-bar ui-bar-a ui-corner-all">{section.display}</h4>
            {ordered.map((trait, i) => (
              <Fragment key={trait?.id ?? i}>
                <Parts parts={traitParts(context, trait, section.format as SkillStyle)} />
                <br />
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Apply a section's sort, when it declares one. Only the gift list does. */
function orderSection(traits: SimpleTrait[], section: Section): SimpleTrait[] {
  if (!section.sort) return traits;
  const direction = section.direction === 'desc' ? -1 : 1;
  return [...traits].sort((left, right) => {
    const l = left?.get(section.sort!) as number | string;
    const r = right?.get(section.sort!) as number | string;
    if (l === r) return 0;
    return (l > r ? 1 : -1) * direction;
  });
}

export function PrintSheet({
  character,
  context,
  excludeExtended,
  settings,
  standalone = true,
}: PrintSheetProps) {
  const ctx: PrintContext = context ?? { character };
  // The sheet renders the OVERRIDE character when there is one -- the approval
  // screen builds a transformed copy showing the state at a chosen change.
  const shown = ctx.character;
  const layout = layoutFor(shown.venue, shown.get('wta_tribe') as string | undefined);
  // `self.model.get_fetched_long_text("extended_print_text")`, then `.get("text")`.
  //
  // NOT a character attribute. Long texts are rows of their own class, cached on
  // the character by `fetchLongText`; reading `character.get(...)` returns
  // undefined forever, so the extended text simply never appeared on a printed
  // sheet. Read off `shown` rather than the sheet's own character, because that
  // is what the original does -- on the approval screen the model IS the
  // transformed copy, and a copy with nothing cached renders nothing.
  const extendedRow = getFetchedLongText(shown, 'extended_print_text');
  const extended = extendedRow?.get('text') as string | undefined;

  const body: React.ReactNode = (
    <>
      <div id="cpp-settings" className="hidden-when-printing">
        {settings}
      </div>
      <div id="cpp-header">
        <ItemView>
          <h1 className="ui-bar ui-bar-a">
            <Parts parts={simpleTextParts(ctx, 'name')} />
          </h1>
        </ItemView>
      </div>
      <div id="cpp-firstbar">
        <TextBar fields={layout.firstBar} context={ctx} />
      </div>
      <div id="cpp-secondbar">
        <TextBar fields={layout.secondBar} context={ctx} />
      </div>
      <div id="cpp-attributes">
        <Attributes context={ctx} />
      </div>

      <div className="ui-grid-b ui-responsive">
        <div id="cpp-blood" className="ui-block-a">
          <Panel panel={layout.blood} context={ctx} />
        </div>
        <div className="ui-block-b">
          <div id="cpp-willpower">
            <Panel panel={layout.willpower} context={ctx} />
          </div>
          <div id="cpp-morality">
            {layout.morality ? <Panel panel={layout.morality} context={ctx} /> : null}
          </div>
        </div>
        <div className="ui-block-c" id="cpp-health-levels">
          <div>
            <PanelHeading>Health Levels</PanelHeading>
            {healthLevels(shown).map(([label, count]) => (
              <Fragment key={label}>
                <Boxes total={count ?? 0} />
                {label}
                <br />
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-grid-b ui-responsive">
        {(['a', 'b', 'c'] as const).map((letter, i) => (
          <div id={`cpp-total-${letter}`} className={`ui-block-${letter}`} key={letter}>
            {layout.totals?.[i] ? <Panel panel={layout.totals[i]!} context={ctx} /> : null}
          </div>
        ))}
      </div>

      <div id="cpp-skills">
        <ItemView>
          <Skills context={ctx} />
        </ItemView>
      </div>

      <div className="ui-grid-b ui-responsive">
        {(['a', 'b', 'c'] as const).map((letter, i) => (
          <div id={`cpp-bottom-one-${letter}`} className={`ui-block-${letter}`} key={letter}>
            <Sections sections={layout.bottom[i]!} context={ctx} />
          </div>
        ))}
      </div>

      <div className="ui-grid-b ui-responsive">
        {(['a', 'b', 'c'] as const).map((letter, i) => (
          <div id={`cpp-bottom-two-${letter}`} className={`ui-block-${letter}`} key={letter}>
            <Sections sections={layout.bottom[i + 3]!} context={ctx} />
          </div>
        ))}
      </div>

      {/* The extended text is interpolated raw by the original --
          `_.template("<%= inputtext %>")` -- so it is markup the player wrote,
          rendered as markup. Kept, because dropping it would render their HTML
          as visible tags. */}
      <div id="cpp-extended-print-text" className="ui-content">
        {/*
          `ui-block-a` on the view's own element, from
          `this.$el.addClass("ui-block-a")` in ExtendedPrintTextView's
          initialize.

          The text is interpolated raw -- `_.template("<%= inputtext %>")` --
          so it is markup the player wrote, rendered as markup. Kept, because
          dropping it would show their HTML as visible tags.

          NOT PORTED: the legacy also runs the player's text through
          `_.template(inputtext)({character: self.model})` first, so an extended
          print text containing `<%= character.get("name") %>` interpolates. That
          needs an underscore-compatible template engine in the bundle, and no
          character in the dev database uses it. A sheet that does will render
          the `<%= %>` literally here instead of substituting. Recorded rather
          than guessed at.
        */}
        <div className="ui-block-a">
          {!excludeExtended && extended ? (
            <span dangerouslySetInnerHTML={{ __html: extended }} />
          ) : null}
        </div>
      </div>
    </>
  );

  // Standalone: the page's content div is the sheet's, so emit the contents
  // bare. Embedded: both wrappers survive. See `standalone`.
  if (standalone) return body;
  return (
    <div>
      <div role="main" className="ui-content force-printing-page-break">
        {body}
      </div>
    </div>
  );
}
