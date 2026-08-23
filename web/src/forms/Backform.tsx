import type { ReactNode } from 'react';
import { cx } from '@/jqm/classes';

/**
 * Backform's controls, as React components.
 *
 * 21 of the app's view files build their forms with Backform -- a small
 * Backbone form library vendored at public/scripts/lib/backform.js -- and its
 * output is Bootstrap horizontal-form markup that jQuery Mobile then enhances
 * on top of. So a field ends up wearing both vocabularies at once:
 *
 *   <div class="email form-group">
 *     <label class="control-label col-sm-4">Email</label>
 *     <div class="col-sm-8">
 *       <div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
 *         <input class="form-control" type="email" name="email">
 *       </div>
 *     </div>
 *   </div>
 *
 * Both halves matter. `col-sm-4` / `col-sm-8` come from css/bootstrap-forms.css
 * and are what put the label beside the field instead of above it; the `ui-`
 * classes are what make the field look like the rest of the app. Reproducing
 * only one of them changes the layout.
 *
 * Templates transcribed from backform.js: Control (the base), InputControl,
 * TextareaControl, SelectControl, BooleanControl, ButtonControl, SpacerControl.
 * The group's extra class is the field name -- `this.$el.addClass(field.name)`
 * at backform.js:247.
 */

const GROUP = 'form-group';
const CONTROL_LABEL = 'control-label col-sm-4';
const CONTROLS = 'col-sm-8';
const CONTROL = 'form-control';
const HELP = 'help-block';

/**
 * The `<form>` the legacy views render their fields into.
 *
 * No class by default. `profile-form` looks like it belongs on every Backform
 * form and does not: it appears exactly once in the whole app, written into
 * index.html's `#user-reset-password` block, and PasswordReset.js uses it as a
 * selector to find the element it should render into. Every other Backform form
 * -- the print settings, the troupe form, the profile form -- renders into a
 * bare `<form>`. Callers that need it pass it.
 */
export function Form({
  children,
  onSubmit,
  className,
  id,
}: {
  children?: ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
  className?: string;
  /**
   * For the forms whose element is written into index.html and found by
   * selector -- `#character-new-form`, which CharacterNewView renders into.
   */
  id?: string;
}) {
  return (
    <form
      id={id}
      className={className}
      onSubmit={(e) => {
        // Backform's buttons are type="submit" and their handlers all begin
        // with preventDefault(); doing it once here means a field's handler
        // cannot forget and reload the page.
        e.preventDefault();
        onSubmit?.(e);
      }}
    >
      {children}
    </form>
  );
}

interface GroupProps {
  /**
   * The field name. Backform adds it to the group as a class, and a field with
   * no name adds nothing -- `addClass(undefined)` is a no-op.
   */
  name?: string;
  label?: ReactNode;
  children: ReactNode;
  helpMessage?: string;
  /** Extra classes on the `col-sm-8` wrapper, for the radio group's variant. */
  controlsClassName?: string;
}

function Group({ name, label, children, helpMessage, controlsClassName }: GroupProps) {
  return (
    <div className={cx(GROUP, name)}>
      {/* A label is always emitted, even when there is nothing to say: the
          grid reserves its four columns either way, and omitting it shifts the
          control left. Backform writes &nbsp; for the empty case. */}
      <label className={CONTROL_LABEL}>{label ?? ' '}</label>
      <div className={cx(CONTROLS, controlsClassName)}>
        {children}
        {helpMessage ? <span className={HELP}>{helpMessage}</span> : null}
      </div>
    </div>
  );
}

export interface InputFieldProps {
  name: string;
  label?: ReactNode;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
  helpMessage?: string;
  extraClasses?: string[];
  id?: string;
}

export function InputField({
  name,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  maxLength = 255,
  disabled,
  required,
  helpMessage,
  extraClasses = [],
  id,
}: InputFieldProps) {
  return (
    <Group name={name} label={label} helpMessage={helpMessage}>
      {/* jQuery Mobile's wrapper, added by enhanceWithin() over Backform's output. */}
      <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
        <input
          id={id}
          type={type}
          className={cx(CONTROL, ...extraClasses)}
          name={name}
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </Group>
  );
}

export interface TextareaFieldProps {
  name: string;
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
  helpMessage?: string;
  extraClasses?: string[];
  id?: string;
}

export function TextareaField({
  name,
  label,
  value,
  onChange,
  placeholder,
  maxLength = 4000,
  disabled,
  required,
  helpMessage,
  extraClasses = [],
  id,
}: TextareaFieldProps) {
  return (
    <Group name={name} label={label} helpMessage={helpMessage}>
      {/* No wrapper for a textarea -- jQM puts its classes on the element. */}
      <textarea
        id={id}
        className={cx(
          CONTROL,
          ...extraClasses,
          'ui-input-text ui-shadow-inset ui-body-inherit ui-corner-all ui-textinput-autogrow',
        )}
        name={name}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Group>
  );
}

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  name: string;
  label?: ReactNode;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  extraClasses?: string[];
  id?: string;
}

export function SelectField({
  name,
  label,
  options,
  value,
  onChange,
  disabled,
  required,
  extraClasses = [],
  id,
}: SelectFieldProps) {
  const selected = options.find((o) => o.value === value);
  return (
    <Group name={name} label={label}>
      {/* jQM's select: the div and span are the visible control, the real
          <select> sits transparently on top. See jqm/Controls.tsx. */}
      <div className="ui-select">
        {/*
          The button carries an id only when the select was given one.

          jQuery Mobile derives it -- `this.selectId = this.select.attr("id") ||
          ("select-" + this.uuid)` (jquery.mobile-1.4.5.js:10096) -- so with an
          id on the select it is predictable, and without one it is a
          per-enhancement counter that no second run can reproduce. Backform's
          own select template emits no id at all, so the legacy DOM always
          carries the counter form. Inventing a React id here would put a
          *different* unreproducible id in its place, which is worse: nothing
          keys off it, in the stylesheet or in the E2E suite, and
          compare-dom.mjs normalises the counter form away on the legacy side.
        */}
        <div
          id={id ? `${id}-button` : undefined}
          className="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow"
        >
          {/* The span carries the select's own classes, not just its text.
              jQM's selectmenu copies them across when it builds the button
              face, so `form-control` ends up on both. */}
          <span className={cx(CONTROL, ...extraClasses)}>{selected?.label ?? ''}</span>
          <select
            id={id}
            className={cx(CONTROL, ...extraClasses)}
            name={name}
            value={value}
            disabled={disabled}
            required={required}
            onChange={(e) => onChange(e.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Group>
  );
}

export interface CheckboxFieldProps {
  name: string;
  /** The text beside the box. Backform's BooleanControl puts it there, not in
   *  the left-hand column, which stays blank. */
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  extraClasses?: string[];
  id?: string;
}

export function CheckboxField({
  name,
  label,
  checked,
  onChange,
  disabled,
  required,
  extraClasses = [],
  id,
}: CheckboxFieldProps) {
  return (
    <Group name={name}>
      {/*
        Two vocabularies stacked, and both are load-bearing. Backform emits
        `div.checkbox > label > input`; jQuery Mobile's checkboxradio widget
        then rewrites the inside of that into
        `div.ui-checkbox > (label.ui-btn…, input)` -- label first, input after
        it, not nested. Harvested from the running legacy #profile and
        #printable-sheet.

        `ui-checkbox-on` / `-off` is the whole of the widget's look, and the
        label's click handler is the whole of its behaviour: the stylesheet
        positions the real input off the control, so without the label being
        clickable the box cannot be ticked.

        No `id` and no `htmlFor` unless a caller asks: the legacy markup has
        neither, because jQM binds the label's click in JavaScript rather than
        relying on the label-for association.
      */}
      <div className="checkbox">
        <div className="ui-checkbox">
          <label
            htmlFor={id}
            className={cx(
              'ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left',
              checked ? 'ui-checkbox-on' : 'ui-checkbox-off',
            )}
            onClick={
              id
                ? undefined
                : (e) => {
                    // With no `for` link, clicking the label does nothing on its
                    // own. jQM wires this up; so does this.
                    e.preventDefault();
                    if (!disabled) onChange(!checked);
                  }
            }
          >
            {label}
          </label>
          <input
            id={id}
            type="checkbox"
            className={cx(...extraClasses)}
            name={name}
            checked={checked}
            disabled={disabled}
            required={required}
            onChange={(e) => onChange(e.target.checked)}
          />
        </div>
      </div>
    </Group>
  );
}

export interface ButtonFieldProps {
  /**
   * Optional, because Backform adds the field's name to the group as a class
   * (`this.$el.addClass(field.name)`) and some button fields declare none --
   * the new-character form's is `{control: "Button", label: "..."}` with no
   * name at all, so its group is a bare `form-group`.
   */
  name?: string;
  label: string;
  type?: 'submit' | 'button' | 'reset';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  extraClasses?: string[];
  /** Backform's inline result: colours the message beside the button. */
  status?: 'error' | 'success';
  message?: string;
  id?: string;
}

export function ButtonField({
  name,
  label,
  type = 'submit',
  onClick,
  disabled,
  extraClasses = [],
  status,
  message,
  id,
}: ButtonFieldProps) {
  const statusClass =
    status === 'error' ? 'text-danger' : status === 'success' ? 'text-success' : '';
  return (
    <Group name={name}>
      <button
        id={id}
        type={type}
        name={name}
        className={cx('btn', ...extraClasses, 'ui-btn ui-shadow ui-corner-all')}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
      {/* Always rendered, even when empty: Backform's template emits it
          unconditionally, and it is what several views later write into. */}
      <span className={cx('status', statusClass)}>{message}</span>
    </Group>
  );
}

/** Backform's SpacerControl: an empty row that keeps the grid aligned. */
export function SpacerField({ name }: { name: string }) {
  return (
    <div className={cx(GROUP, name)}>
      <label className={CONTROL_LABEL}>{' '}</label>
      <div className={CONTROLS} />
    </div>
  );
}
