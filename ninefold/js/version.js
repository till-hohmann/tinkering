// version.js — the running build's version, in one place.
//
// It was declared twice: once in views/settings.js to show in the footer, and
// implicitly again as the CACHE name in sw.js. Now anything that needs to know
// what build it is imports it from here.
//
// It also cache-busts fetches of unhashed static files. The exercise manifest is
// the case that forced this: `img/exercises/manifest.json` keeps its name across
// releases, so Cloudflare's edge happily served the previous build's copy — an
// empty `{"ids": []}` — for a build that shipped 72 renders, and every anatomy
// card silently fell back to its SVG figure. A version in the query string makes
// each release a different URL, which is the only reliable way to retire a cached
// unhashed asset.
//
// BUMP THIS with CACHE in sw.js on every deploy.
export const APP_VERSION = "v156";
