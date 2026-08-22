import { Children, isValidElement, useMemo, useState, type ReactNode } from 'react';
import { cx, positionClass } from './classes';

/**
 * jQuery Mobile's listview -- 65 of the app's screens are built out of it.
 *
 * jQM enhanced a plain `<ul>` by inspecting each `<li>`'s contents and stamping
 * classes on. This does the same classification up front, from props, which is
 * why the item types are explicit here rather than inferred from children: an
 * `<li>` with one anchor, two anchors, or none produced three quite different
 * results, and guessing from a React element tree is exactly the kind of magic
 * that goes wrong quietly.
 *
 * See docs/react-migration/jqm-enhanced-markup.md for the captured output this
 * reproduces.
 */

export interface ListItemProps {
  children?: ReactNode;
  /**
   * Makes the row a link. jQM gave a linked row a right-hand carat unless the
   * `li` named another icon; pass `icon={false}` for no icon at all.
   */
  href?: string;
  onClick?: (event: React.MouseEvent) => void;
  icon?: string | false;
  /**
   * The second, icon-only action of a split row. jQM moved its text into the
   * `title` attribute and defaulted its icon to `gear`.
   */
  split?: { href?: string; onClick?: (event: React.MouseEvent) => void; title: string; icon?: string };
  className?: string;
  /** Hidden by the list filter. Kept in the DOM, as jQM's filter did. */
  hidden?: boolean;
  id?: string;
  /** The text the filter matches against. Defaults to the row's text content. */
  filterText?: string;
}

/** A divider row: `<li data-role="list-divider">` in the old markup. */
export interface DividerProps {
  children?: ReactNode;
  className?: string;
}

export function Divider(_: DividerProps): null {
  // Rendered by Listview, which needs to know a child is a divider in order to
  // classify it. Never rendered directly.
  return null;
}
Divider.__jqmDivider = true;

export function ListItem(_: ListItemProps): null {
  return null;
}
ListItem.__jqmListItem = true;

export interface ListviewProps {
  children?: ReactNode;
  /** `data-inset="true"`: rounded, shadowed, inset from the page edges. */
  inset?: boolean;
  /** Renders jQM's search box above the list and filters rows as you type. */
  filter?: boolean;
  filterPlaceholder?: string;
  /** The filter input's id. The legacy markup gave several of them fixed ids. */
  filterId?: string;
  id?: string;
  className?: string;
}

interface ClassifiedChild {
  kind: 'divider' | 'item';
  props: ListItemProps & DividerProps;
  key: string | number;
}

function classify(children: ReactNode): ClassifiedChild[] {
  const out: ClassifiedChild[] = [];
  Children.forEach(children, (child, i) => {
    if (!isValidElement(child)) return;
    const type = child.type as { __jqmDivider?: boolean; __jqmListItem?: boolean };
    const kind = type?.__jqmDivider ? 'divider' : 'item';
    out.push({ kind, props: child.props as ListItemProps & DividerProps, key: child.key ?? i });
  });
  return out;
}

/** The text a row is filtered on: an explicit `filterText`, else its content. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

export function Listview({
  children,
  inset,
  filter,
  filterPlaceholder = 'Filter items...',
  filterId,
  id,
  className,
}: ListviewProps) {
  const [query, setQuery] = useState('');
  const all = useMemo(() => classify(children), [children]);

  // Filtering hides rows rather than removing them, matching jQM's filterable,
  // but the first/last-child classes are computed over the *visible* rows --
  // otherwise an inset list loses its rounded corners as soon as you type.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (c.props.hidden) return false;
      if (!q) return true;
      const text = c.props.filterText ?? textOf(c.props.children);
      return text.toLowerCase().includes(q);
    });
  }, [all, query]);

  const visibleKeys = useMemo(() => new Map(visible.map((c, i) => [c.key, i])), [visible]);

  const list = (
    <ul
      id={id}
      data-role="listview"
      data-inset={inset ? 'true' : undefined}
      className={cx('ui-listview', inset && 'ui-listview-inset ui-corner-all ui-shadow', className)}
    >
      {all.map((child) => {
        const index = visibleKeys.get(child.key);
        const isVisible = index !== undefined;
        const pos = isVisible ? positionClass(index, visible.length) : '';
        const style = isVisible ? undefined : { display: 'none' };

        if (child.kind === 'divider') {
          return (
            <li
              key={child.key}
              data-role="list-divider"
              role="heading"
              style={style}
              className={cx('ui-li-divider ui-bar-inherit', pos, child.props.className)}
            >
              {child.props.children}
            </li>
          );
        }

        const { href, onClick, icon, split, children: content, className: liClass, id: liId } = child.props;

        // Split row: a main action plus an icon-only alternate action.
        if (split) {
          return (
            <li key={child.key} id={liId} style={style} className={cx('ui-li-has-alt', pos, liClass)}>
              <a href={href ?? '#'} onClick={onClick} className="ui-btn">
                {content}
              </a>
              <a
                href={split.href ?? '#'}
                onClick={split.onClick}
                title={split.title}
                className={cx('ui-btn ui-btn-icon-notext', `ui-icon-${split.icon ?? 'gear'}`)}
              />
            </li>
          );
        }

        // Linked row: the anchor becomes the button and carries the icon.
        if (href !== undefined || onClick) {
          const iconName = icon === false ? null : (icon ?? 'carat-r');
          return (
            <li key={child.key} id={liId} style={style} className={cx(pos, liClass)}>
              <a
                href={href ?? '#'}
                onClick={onClick}
                className={cx('ui-btn', iconName && `ui-btn-icon-right ui-icon-${iconName}`)}
              >
                {content}
              </a>
            </li>
          );
        }

        // Static row: no anchor at all.
        return (
          <li
            key={child.key}
            id={liId}
            style={style}
            className={cx('ui-li-static ui-body-inherit', pos, liClass)}
          >
            {content}
          </li>
        );
      })}
    </ul>
  );

  if (!filter) return list;

  return (
    <>
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div
          className={cx(
            'ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset',
            'ui-input-has-clear',
          )}
        >
          <input
            id={filterId}
            data-type="search"
            placeholder={filterPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <a
            href="#"
            tabIndex={-1}
            aria-hidden="true"
            title="Clear text"
            className={cx(
              'ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all',
              !query && 'ui-input-clear-hidden',
            )}
            onClick={(e) => {
              e.preventDefault();
              setQuery('');
            }}
          >
            Clear text
          </a>
        </div>
      </form>
      {list}
    </>
  );
}
