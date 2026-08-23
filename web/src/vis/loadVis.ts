import visUrl from '@legacy-lib/vis.js?url';

/**
 * The vendored vis.js 4.11 graph library, loaded on demand.
 *
 * Two reasons this is a script tag and not an import. It is a UMD bundle whose
 * exports go through `module.exports`, which Vite would not give it for a file
 * outside node_modules; and it is 1.5MB, which is more than the whole rest of
 * the app and is wanted by exactly one screen. The legacy app defers it the
 * same way, with a `require(["vis"])` inside the handler rather than in the
 * module's dependency list.
 */

export interface VisNode {
  id: string;
  shape: string;
  image: string;
  label: string;
}

export interface VisEdge {
  from: string;
  to: string;
  color?: string;
}

export interface VisNetwork {
  destroy(): void;
  on(event: string, handler: (params: { nodes: string[] }) => void): void;
}

interface VisModule {
  Network: new (
    container: HTMLElement,
    data: { nodes: VisNode[]; edges: VisEdge[] },
    options: unknown,
  ) => VisNetwork;
}

declare global {
  interface Window {
    vis?: VisModule;
  }
}

let pending: Promise<VisModule> | null = null;

export function loadVis(): Promise<VisModule> {
  if (window.vis) return Promise.resolve(window.vis);
  // Memoised, so a remount mid-load waits on the same tag rather than adding a
  // second one. The legacy gets this from RequireJS's module cache.
  if (pending) return pending;

  pending = new Promise<VisModule>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = visUrl;
    script.onload = () => {
      if (window.vis) resolve(window.vis);
      else reject(new Error('vis.js loaded but exported nothing'));
    };
    script.onerror = () => {
      pending = null;
      reject(new Error('Failed to load vis.js'));
    };
    document.head.appendChild(script);
  });
  return pending;
}

/**
 * The network options, copied field for field from the legacy view.
 *
 * `randomSeed` is the reason this is a constant rather than a default: vis
 * lays nodes out randomly, and a fixed seed is what makes the same troupe draw
 * the same picture twice.
 */
export const NETWORK_OPTIONS = {
  layout: {
    randomSeed: 24993,
  },
  nodes: {
    borderWidth: 4,
    size: 30,
    color: {
      border: '#406897',
      background: '#6AAFFF',
    },
    font: { color: '#eeeeee' },
    shapeProperties: {
      useBorderWithImage: true,
    },
  },
  edges: {
    color: 'lightgray',
  },
  interaction: {
    multiselect: true,
  },
};
