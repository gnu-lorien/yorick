import { useId, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { buttonClasses, cx, positionClass, type IconPos, type Theme } from './classes';

/**
 * jQuery Mobile's form controls and buttons.
 *
 * Each one emits the markup jQM's enhancer produced; see
 * docs/react-migration/jqm-enhanced-markup.md. The wrappers look redundant
 * until you notice the stylesheet targets them: `.ui-input-text` carries the
 * border and the inset shadow, and the bare `<input>` inside it is transparent
 * and borderless. Dropping a wrapper does not simplify the markup, it deletes
 * the field's appearance.
 */

/* -------------------------------------------------------------- buttons -- */

export interface ButtonProps {
  children?: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  icon?: string | false;
  iconpos?: IconPos;
  inline?: boolean;
  theme?: Theme;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Button({
  children,
  onClick,
  icon,
  iconpos,
  inline,
  theme,
  type = 'button',
  disabled,
  id,
  className,
}: ButtonProps) {
  return (
    <button
      id={id}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        buttonClasses({ icon, iconpos, inline, theme }),
        // jQM's disabled styling is a class, not the attribute -- the CSS has
        // no :disabled rules at all.
        disabled && 'ui-state-disabled',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface LinkButtonProps extends Omit<ButtonProps, 'onClick' | 'type'> {
  href: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** jQM's `data-rel="back"`, kept because the E2E suite looks for it. */
  rel?: string;
}

export function LinkButton({
  children,
  href,
  onClick,
  icon,
  iconpos,
  inline,
  theme,
  disabled,
  id,
  className,
  rel,
}: LinkButtonProps) {
  return (
    <a
      id={id}
      href={href}
      role="button"
      data-rel={rel}
      onClick={onClick}
      className={cx(
        'ui-link',
        buttonClasses({ icon, iconpos, inline, theme }),
        disabled && 'ui-state-disabled',
        className,
      )}
    >
      {children}
    </a>
  );
}

/** A plain in-content anchor. jQM gave every one of these `ui-link`. */
export function Link({
  href,
  children,
  onClick,
  className,
  id,
}: {
  href: string;
  children?: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  id?: string;
}) {
  return (
    <a id={id} href={href} onClick={onClick} className={cx('ui-link', className)}>
      {children}
    </a>
  );
}

/* --------------------------------------------------------------- inputs -- */

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>;

export interface TextInputProps extends NativeInput {
  /** Rendered above the field, as the legacy templates' `<label>` did. */
  label?: ReactNode;
  type?: 'text' | 'password' | 'number' | 'email' | 'date' | 'file' | 'url' | 'tel';
  wrapperClassName?: string;
}

export function TextInput({ label, type = 'text', wrapperClassName, id, ...rest }: TextInputProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <>
      {label !== undefined && <label htmlFor={inputId}>{label}</label>}
      <div className={cx('ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset', wrapperClassName)}>
        <input id={inputId} type={type} {...rest} />
      </div>
    </>
  );
}

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label?: ReactNode;
  /** jQM's autogrow. On by default, as `data-autogrow` defaulted to true. */
  autogrow?: boolean;
  className?: string;
}

export function Textarea({ label, autogrow = true, id, className, ...rest }: TextareaProps) {
  const generated = useId();
  const areaId = id ?? generated;
  return (
    <>
      {label !== undefined && <label htmlFor={areaId}>{label}</label>}
      {/* No wrapper: jQM put the classes on the textarea itself. */}
      <textarea
        id={areaId}
        className={cx(
          'ui-input-text ui-shadow-inset ui-body-inherit ui-corner-all',
          autogrow && 'ui-textinput-autogrow',
          className,
        )}
        {...rest}
      />
    </>
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label?: ReactNode;
  /** The text shown in the button face. Defaults to the selected option's label. */
  buttonText?: string;
  className?: string;
}

/**
 * jQM's select.
 *
 * The visible control is the `<div>` and the `<span>` inside it; the real
 * `<select>` sits on top, transparent, and supplies the native dropdown. So the
 * span has to mirror the selected option's label or the control renders blank.
 * `buttonText` exists for the cases where the legacy code set that label to
 * something other than the option text.
 */
export function Select({ label, buttonText, id, children, className, ...rest }: SelectProps) {
  const generated = useId();
  const selectId = id ?? generated;

  let face = buttonText;
  if (face === undefined) {
    const value = rest.value ?? rest.defaultValue;
    const options = Array.isArray(children) ? children.flat() : [children];
    for (const opt of options) {
      if (opt && typeof opt === 'object' && 'props' in opt) {
        const p = opt.props as { value?: string | number; children?: ReactNode };
        if (String(p.value) === String(value)) {
          face = typeof p.children === 'string' ? p.children : String(p.children ?? '');
          break;
        }
      }
    }
  }

  return (
    <>
      {label !== undefined && <label htmlFor={selectId}>{label}</label>}
      <div className={cx('ui-select', className)}>
        <div
          id={`${selectId}-button`}
          className="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow"
        >
          <span>{face}</span>
          <select id={selectId} {...rest}>
            {children}
          </select>
        </div>
      </div>
    </>
  );
}

export interface CheckableProps extends Omit<NativeInput, 'checked'> {
  label: ReactNode;
  checked?: boolean;
  /**
   * Extra classes for the wrapper div, not the input.
   *
   * The position classes belong on the wrapper, and a controlgroup written out
   * by hand -- the relationship network's fieldset -- has to put them there
   * itself, since `Controlgroup` is what normally injects them.
   */
  wrapperClassName?: string;
}

function Checkable({
  kind,
  label,
  checked,
  id,
  wrapperClassName,
  ...rest
}: CheckableProps & { kind: 'checkbox' | 'radio' }) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={cx(`ui-${kind}`, wrapperClassName)}>
      <label
        htmlFor={inputId}
        className={cx(
          'ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left',
          `ui-${kind}-${checked ? 'on' : 'off'}`,
        )}
      >
        {label}
      </label>
      <input id={inputId} type={kind} checked={checked} {...rest} />
    </div>
  );
}

export function Checkbox(props: CheckableProps) {
  return <Checkable kind="checkbox" {...props} />;
}

export function Radio(props: CheckableProps) {
  return <Checkable kind="radio" {...props} />;
}

/* --------------------------------------------------------- controlgroup -- */

export function Controlgroup({
  children,
  horizontal,
  className,
  id,
}: {
  children?: ReactNode;
  horizontal?: boolean;
  className?: string;
  id?: string;
}) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : [children].filter(Boolean);
  return (
    <div
      id={id}
      data-role="controlgroup"
      className={cx(
        'ui-controlgroup',
        horizontal ? 'ui-controlgroup-horizontal' : 'ui-controlgroup-vertical',
        'ui-corner-all',
        className,
      )}
    >
      <div className="ui-controlgroup-controls">
        {items.map((child, i) =>
          child && typeof child === 'object' && 'props' in child
            ? {
                ...child,
                props: {
                  ...(child.props as { className?: string }),
                  className: cx(
                    (child.props as { className?: string }).className,
                    positionClass(i, items.length),
                  ),
                },
              }
            : child,
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- slider -- */

export interface SliderProps {
  id: string;
  name?: string;
  label?: ReactNode;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * jQuery Mobile's slider.
 *
 * Markup harvested from the running legacy app on the trait-change screen. jQM
 * does a lot to an `<input type="range">` here, and every part of it matters:
 *
 * - The input's type becomes `number`, with the original recorded as
 *   `data-type="range"`. The visible track is the sibling `<div>`; the number
 *   input beside it is the editable half of the control, not a leftover.
 * - The label gains `id="<inputId>-label"`, which the handle then points at
 *   with `aria-labelledby`. Without the label there is no id to point at, and
 *   jQM omits the attribute -- so the two travel together.
 * - The handle's `left` is the value's position along the range, as a
 *   percentage. It is inline style rather than a class because it is
 *   continuous, and it is what actually moves the handle.
 *
 * The handle is an anchor with `role="slider"`; dragging it is jQM behaviour
 * this does not reproduce, because the number input is what every caller in
 * this app reads and writes. Clicking the track is likewise not wired up.
 */
export function Slider({
  id,
  name,
  label,
  value,
  min,
  max,
  onChange,
  className,
  disabled,
}: SliderProps) {
  // Guard the degenerate range: min === max would divide by zero, and jQM pins
  // the handle to the left in that case.
  const fraction = max > min ? (value - min) / (max - min) : 0;
  const percent = `${(fraction * 100).toFixed(4).replace(/\.?0+$/, '')}%`;

  return (
    <>
      {label !== undefined && (
        <label htmlFor={id} id={`${id}-label`}>
          {label}
        </label>
      )}
      <div className="ui-slider">
        <input
          type="number"
          data-type="range"
          name={name}
          id={id}
          className={cx(className, 'ui-shadow-inset ui-body-inherit ui-corner-all ui-slider-input')}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        <div
          role="application"
          className="ui-slider-track ui-shadow-inset ui-bar-inherit ui-corner-all"
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
            aria-labelledby={label !== undefined ? `${id}-label` : undefined}
            style={{ left: percent }}
            onClick={(e) => e.preventDefault()}
          />
        </div>
      </div>
    </>
  );
}
