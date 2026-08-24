/**
 * Assets the app names at runtime rather than importing.
 *
 * There is exactly one, and it is the portrait every listing falls back to
 * when a character, troupe or referendum has no picture. A bare string is not
 * an import, so the bundler cannot see it -- `web/vite.config.ts` copies it
 * into the build explicitly, and this is where its URL is built.
 *
 * It has to be built, not written. A client deployed under `/react/` that asks
 * for `head_skull.png` gets a URL relative to the CURRENT page, which is right
 * only while the address ends in a slash: from `/react/` it resolves to
 * `/react/head_skull.png`, and from `/react` -- no trailing slash, which is a
 * perfectly ordinary thing to type -- to `/head_skull.png`, the root client's
 * copy or a 404. `BASE_URL` is the mount the build was given and always ends
 * in a slash, so this is the same URL from every page in the client.
 */
export const PORTRAIT_FALLBACK = `${import.meta.env.BASE_URL}head_skull.png`;
