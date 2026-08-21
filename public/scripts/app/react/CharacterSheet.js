// The character sheet, in React
// =============================
//
// A port of views/CharacterPrintView plus the ten templates under
// templates/print/. That is 1036 lines of Marionette and 130 of underscore
// templates; this is a fraction of it, and the difference is almost entirely
// the layout table in sheetConfig.js and the disappearance of per-view
// plumbing.
//
// What is gone, and why it was there:
//
//   * Twenty-one regions and twenty-one showChildView calls. A region is how
//     an imperative view system says "this rectangle is owned by that view".
//     Composition says it instead.
//
//   * `self.listenTo(self.model, "change:skills", self.render)` on every
//     single subview - thirty-odd subscriptions, each one a chance to forget a
//     category and leave a stale panel on screen. Deriving from props means a
//     changed character re-renders all of it or none of it.
//
//   * `_.bindAll(this, "render", "template", "format_simpletext", ...)` in
//     every initialize, because the formatters are a mixin that needs `this`.
//     Module functions do not.
//
//   * `onRender: this.$el = this.$el.children(); this.$el.unwrap();` on six of
//     the views. Marionette insists on a wrapper element per view; the print
//     layout's CSS grid insists there isn't one, so those six unwrap
//     themselves after every render. React returns fragments.
//
// The DOM this produces is the same DOM, jQuery Mobile grid classes included,
// so it inherits the existing print stylesheet untouched.

define([
    "underscore",
    "react",
    "./html",
    "./format",
    "./derived",
    "./sheetConfig",
    "./snapshot"
], function (_, React, html, Format, Derived, SheetConfig, Snapshot) {

    // jQuery Mobile's three-column responsive grid names its cells a, b, c.
    function block(i) {
        return "ui-block-" + String.fromCharCode(97 + i);
    }

    function range(from, to) {
        return _.range(from, to);
    }

    /**
     * A row of empty boxes with a gap every `split` and a line break every
     * `linebreak`. Blood, Willpower, Gnosis, Rage, Harano and the rest are all
     * this, which is why the original has five near-identical templates for
     * it.
     */
    function Boxes(props) {
        var split = props.split || 5;
        return html`<${React.Fragment}>
            ${_.map(range(1, props.count + 1), function (i) {
                return html`<${React.Fragment} key=${i}>
                    <i className="fa fa-square-o"></i>
                    ${0 == i % split ? " " : null}
                    ${props.linebreak && 0 == i % props.linebreak ? html`<br/>` : null}
                <//>`;
            })}
        <//>`;
    }

    function Panel(props) {
        return html`<div>
            <h4 className="ui-bar ui-bar-a ui-corner-all">${props.title}</h4>
            ${props.children}
        </div>`;
    }

    // -- Vitals -------------------------------------------------------------

    var BLOOD_PER_TURN = {1: 10, 2: 12, 3: 15, 4: 20, 5: 30};

    function Blood(props) {
        var gen = Derived.generation(props.character);
        return html`<${Panel} title="Blood">
            <${Boxes} count=${30} split=${5} linebreak=${10}/>
            ${_.map(range(0, gen), function (i) {
                return html`<i key=${i} className="fa fa-circle"></i>`;
            })}
            ${" " + (BLOOD_PER_TURN[gen] || "") + " / " + gen}
        <//>`;
    }

    function FixedBlood(props) {
        return html`<${Panel} title="Blood">
            <${Boxes} count=${props.total} split=${props.split} linebreak=${props.linebreak}/>
            ${_.map(range(0, props.blood_per_turn), function (i) {
                return html`<i key=${i} className="fa fa-circle"></i>`;
            })}
            ${" " + props.total + " / " + props.blood_per_turn}
        <//>`;
    }

    var GLAMOUR_BY_SEEMING = {1: 14, 2: 13, 3: 12, 4: 11, 5: 10};

    function Glamour(props) {
        var seeming = Derived.seeming(props.character);
        return html`<${Panel} title="Glamour">
            ${0 != seeming ? html`<${Boxes} count=${GLAMOUR_BY_SEEMING[seeming]} split=${5} linebreak=${10}/>` : null}
            ${0 == seeming
                ? "Kinain"
                : html`<${React.Fragment}><br/>${GLAMOUR_BY_SEEMING[seeming]}<//>`}
        <//>`;
    }

    function Gnosis(props) {
        return html`<${Panel} title="Gnosis">
            <${Boxes} count=${Derived.gnosisTotal(props.character)} split=${5}/>
        <//>`;
    }

    function Willpower(props) {
        return html`<${Panel} title="Willpower">
            <${Boxes} count=${Derived.willpowerTotal(props.character)} split=${5}/>
        <//>`;
    }

    function Morality(props) {
        var path = Derived.morality(props.character);
        return html`<${Panel} title="Morality">
            ${path.name}<br/>
            <${Boxes} count=${_.parseInt(path.value) || 0} split=${5}/>
        <//>`;
    }

    function Total(props) {
        return html`<${Panel} title=${props.name}>
            <${Boxes} count=${props.total} split=${props.split}/>
        <//>`;
    }

    function HealthLevels(props) {
        return html`<${Panel} title="Health Levels">
            ${_.map(Derived.healthLevels(props.character), function (pair) {
                return html`<${React.Fragment} key=${pair[0]}>
                    ${_.map(range(0, _.parseInt(pair[1]) || 0), function (i) {
                        return html`<i key=${i} className="fa fa-square-o"></i>`;
                    })}
                    ${pair[0]}
                    <br/>
                <//>`;
            })}
        <//>`;
    }

    /**
     * Which pool goes in the left column, and what sits under Willpower in the
     * middle one. The config names them; this resolves the names.
     */
    function Pool(props) {
        var character = props.character;
        if ("gnosis" == props.kind) { return html`<${Gnosis} character=${character}/>`; }
        if ("glamour" == props.kind) { return html`<${Glamour} character=${character}/>`; }
        return html`<${Blood} character=${character}/>`;
    }

    function Secondary(props) {
        var spec = props.spec;
        if (_.isFunction(spec)) {
            spec = spec(props.character);
        }
        if (!spec) { return null; }
        if ("morality" == spec.kind) { return html`<${Morality} character=${props.character}/>`; }
        if ("fixed_blood" == spec.kind) { return html`<${FixedBlood} ...${spec}/>`; }
        if ("total" == spec.kind) { return html`<${Total} ...${spec}/>`; }
        return null;
    }

    // -- Header and text bars -----------------------------------------------

    function Header(props) {
        return html`<h1 className="ui-bar ui-bar-a">
            ${Format.formatSimpleText(props.character, "name")}
        </h1>`;
    }

    /**
     * A row of "Clan: Ventrue" style headings. Empty fields are dropped before
     * the grid cells are assigned, so three fields where one is blank lay out
     * as two full-width cells rather than leaving a hole - matching
     * TextBarView, which filters with `_.without(tmpl, undefined)`.
     */
    function TextBar(props) {
        var character = props.character;
        var present = _.filter(props.fields, function (f) {
            return !!character.text[f.name];
        });
        if (!present.length) { return null; }
        return html`<div className="ui-grid-b ui-responsive">
            ${_.map(present, function (field, i) {
                return html`<div key=${field.name} className=${block(i)}>
                    <h2 className="ui-bar ui-bar-a">
                        ${field.display}: ${Format.formatSimpleText(character, field.name)}
                    </h2>
                </div>`;
            })}
        </div>`;
    }

    function Attributes(props) {
        var character = props.character;
        return html`<div className="ui-grid-b ui-responsive">
            ${_.map(["Physical", "Social", "Mental"], function (name, i) {
                var attribute = _.find(Derived.traits(character, "attributes"), {name: name});
                return html`<div key=${name} className=${block(i)}>
                    <h4 className="ui-bar ui-bar-a ui-corner-all">${name}</h4>
                    <div className="ui-body">
                        ${attribute ? Format.formatAttributeValue(character, attribute) : null}
                        <br/>
                        ${Format.formatAttributeFocus(character, name)}
                    </div>
                </div>`;
            })}
        </div>`;
    }

    // -- Skills and sections ------------------------------------------------

    function Skills(props) {
        var character = props.character;
        var grouped = Derived.groupedSkills(character, 3);
        return html`<${React.Fragment}>
            <h4 className="ui-bar ui-bar-a">Skills</h4>
            <div className="ui-grid-b ui-responsive">
                ${_.flatten(_.map(grouped, function (column, c) {
                    return _.map(column, function (skill, i) {
                        return html`<div key=${skill.key || (c + "-" + i)} className=${block(i % 3)}>
                            <div className="ui-body" style=${{overflow: "hidden", whiteSpace: "nowrap"}}>
                                ${Format.formatSkill(character, skill, 1)}
                            </div>
                        </div>`;
                    });
                }))}
            </div>
        <//>`;
    }

    function Sections(props) {
        var character = props.character;
        return html`<div>
            ${_.map(props.sections, function (section) {
                var values = Derived.sectionValues(character, section);
                if (!values.length) { return null; }
                return html`<${React.Fragment} key=${section.name}>
                    <h4 className="ui-bar ui-bar-a ui-corner-all">${section.display}</h4>
                    ${_.map(values, function (d, i) {
                        return html`<${React.Fragment} key=${d.key || i}>
                            ${Format.formatSkill(character, d, section.format)}<br/>
                        <//>`;
                    })}
                <//>`;
            })}
        </div>`;
    }

    function SectionRow(props) {
        return html`<div className="ui-grid-b ui-responsive">
            ${_.map(props.columns, function (sections, i) {
                return html`<div key=${i} className=${block(i)}>
                    <${Sections} character=${props.character} sections=${sections}/>
                </div>`;
            })}
        </div>`;
    }

    // -- Extended print text ------------------------------------------------

    /**
     * The one place on this page that has to hand raw HTML to the browser.
     *
     * The extended print text is an underscore template written by a
     * storyteller and stored on the character, and the whole point of it is
     * that it renders as markup. There is no React tree to build from it -
     * only a string - so `dangerouslySetInnerHTML` is not a shortcut here, it
     * is the feature.
     *
     * Worth being precise about, because it is the exception that shows the
     * rule: every *other* value on this sheet reaches the DOM as a text node,
     * where the Marionette version interpolates all of them - trait names,
     * clan, title, the lot - unescaped through `<%= %>`.
     */
    function ExtendedPrintText(props) {
        if (props.exclude || !props.character.extended_print_text) {
            return null;
        }
        var rendered;
        try {
            rendered = _.template(props.character.extended_print_text)({
                character: Snapshot.asTemplateContext(props.character)
            });
        } catch (e) {
            // A template that no longer compiles must not take the sheet with
            // it. The Marionette version has no equivalent guard: the throw
            // escapes showChildView and the print layout stops half-rendered.
            rendered = "<em>This character's extended print text could not be " +
                "rendered: " + _.escape(e.message) + "</em>";
        }
        return html`<div
            className="ui-content"
            dangerouslySetInnerHTML=${{__html: rendered}}/>`;
    }

    // -- Print settings -----------------------------------------------------

    var FONT_SIZES = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

    /**
     * A port of forms/PrintSettingsForm, which is a Backform form bound to a
     * Backbone model that CharacterPrintView listens to. Two controlled inputs
     * and a callback replace all of it.
     */
    function PrintSettings(props) {
        return html`<div className="hidden-when-printing chr-print-settings">
            <label>
                ${"Font Size "}
                <select
                    value=${props.fontSize}
                    onChange=${function (e) { props.onChange({fontSize: _.parseInt(e.target.value)}); }}>
                    ${_.map(FONT_SIZES, function (size) {
                        return html`<option key=${size} value=${size}>${size + "%"}</option>`;
                    })}
                </select>
            </label>
            <label>
                <input
                    type="checkbox"
                    checked=${props.excludeExtended}
                    onChange=${function (e) { props.onChange({excludeExtended: e.target.checked}); }}/>
                ${" Exclude Extended Print Text"}
            </label>
        </div>`;
    }

    // -- The sheet ----------------------------------------------------------

    function CharacterSheet(props) {
        var character = props.character;
        var config = SheetConfig.forCharacter(character);
        var fontSize = props.fontSize || 100;

        return html`<div
            role="main"
            className="ui-content force-printing-page-break"
            style=${{fontSize: fontSize + "%"}}>

            ${props.onSettingsChange ? html`<${PrintSettings}
                fontSize=${fontSize}
                excludeExtended=${!!props.excludeExtended}
                onChange=${props.onSettingsChange}/>` : null}

            <${Header} character=${character}/>
            <${TextBar} character=${character} fields=${config.first_bar}/>
            <${TextBar} character=${character} fields=${config.second_bar}/>
            <${Attributes} character=${character}/>

            <div className="ui-grid-b ui-responsive">
                <div className="ui-block-a">
                    <${Pool} kind=${config.pool} character=${character}/>
                </div>
                <div className="ui-block-b">
                    <${Willpower} character=${character}/>
                    <${Secondary} spec=${config.secondary} character=${character}/>
                </div>
                <div className="ui-block-c">
                    <${HealthLevels} character=${character}/>
                </div>
            </div>

            ${config.totals.length ? html`<div className="ui-grid-b ui-responsive">
                ${_.map(config.totals, function (t, i) {
                    return html`<div key=${t.name} className=${block(i)}>
                        <${Total} ...${t}/>
                    </div>`;
                })}
            </div>` : null}

            <${Skills} character=${character}/>
            <${SectionRow} character=${character} columns=${config.bottom_one}/>
            <${SectionRow} character=${character} columns=${config.bottom_two}/>
            <${ExtendedPrintText} character=${character} exclude=${props.excludeExtended}/>
        </div>`;
    }

    return CharacterSheet;
});
