// Shared between RaceView (an interactive article, one click away from the
// next page) and FinishView (a read-only preview of the target article) —
// both render Wikipedia's parsed HTML inside a sandboxed iframe built from
// this same srcdoc template, so they need to agree on layout/dark-mode CSS
// rather than drift into two slightly different renderers.

export const DEFAULT_TOC_WIDTH = 220;
export const DEFAULT_DETAILS_WIDTH = 300;

// Layered on top of Wikipedia's own stylesheet (loaded via the <link> tags
// above it) rather than a full reskin — same approach as common Wikipedia
// dark-mode userscripts.
export const DARK_OVERRIDE_CSS = `
  html, body { background: #14181c !important; color: #d6d6d6 !important; }
  h1, h2, h3, h4, h5, h6 { color: #e8e8e8 !important; border-color: #3a3f47 !important; }
  a { color: #8ab4f8 !important; }
  a.new { color: #e0918f !important; }
  table, .infobox, .navbox, .vertical-navbox, .sidebar { background: #1f242b !important; color: #d6d6d6 !important; border-color: #3a3f47 !important; }
  .infobox th, .infobox td, table th, table td, th { background: #262c33 !important; color: #d6d6d6 !important; border-color: #3a3f47 !important; }
  img { filter: brightness(0.9) contrast(1.05); }
`;

// Vector's real TOC and collapsible sidebars are driven by JS we don't load
// (we only pull Wikipedia's stylesheets) — this replicates just the parts
// that matter: a plain sticky TOC on the left, infoboxes/sidebars pulled
// into their own column on the right instead of depending on Wikipedia's
// own float CSS (unreliable once those elements are inside our narrower
// content column), and a default-collapsed state with click-to-expand for
// `mw-collapsible` sections.
export const LAYOUT_CSS = `
  .wiki-race-layout { display: flex; align-items: flex-start; }
  .wiki-race-toc { position: sticky; top: 16px; border: 1px solid #a2a9b1; padding: 10px 14px; font-size: 0.875em; max-height: calc(100vh - 32px); overflow-y: auto; min-width: 0; }
  .wiki-race-toc-heading { font-weight: bold; font-size: 1.1em; margin-bottom: 4px; }
  .wiki-race-toc ul { list-style: none; margin: 0; padding-left: 1.2em; }
  .wiki-race-toc > ul { padding-left: 0; }
  .wiki-race-toc li { margin: 3px 0; }
  .wiki-race-toc a { text-decoration: none; }
  .wiki-race-toc-numb { color: #666; margin-right: 0.3em; }
  .wiki-race-content { flex: 1 1 auto; min-width: 0; display: block !important; }
  .wiki-race-details { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden; min-width: 0; }
  .wiki-race-details .infobox, .wiki-race-details .sidebar { float: none !important; width: 100% !important; margin: 0 0 16px 0 !important; }
  /* Wikipedia's "nowraplinks" navbox styling keeps link text on one line,
     which is fine at full article width but forces horizontal scrolling
     once that content is squeezed into this narrower column — override it
     so the box only ever grows by dragging, never by overflow. */
  .wiki-race-details a { white-space: normal !important; }
  .wiki-race-details, .wiki-race-details * { overflow-wrap: break-word; }
  .mw-collapsible.mw-collapsed > .mw-collapsible-content { display: none; }
  .mw-collapsible.mw-collapsed > .sidebar-list-title, .mw-collapsible.mw-collapsed > .wiki-race-extra-title { cursor: pointer; }
  .mw-collapsible.mw-collapsed > .sidebar-list-title::after, .mw-collapsible.mw-collapsed > .wiki-race-extra-title::after { content: " [show]"; color: #0645ad; font-weight: normal; }
  .mw-collapsible.wiki-race-expanded > .sidebar-list-title::after, .mw-collapsible.wiki-race-expanded > .wiki-race-extra-title::after { content: " [hide]"; }
  .mw-collapsible.wiki-race-expanded > .mw-collapsible-content { display: block; }
  .wiki-race-extra { margin-top: 32px; border-top: 1px solid #a2a9b1; padding-top: 10px; }
  .wiki-race-extra-title { font-weight: bold; font-size: 1.2em; }
  .wiki-race-resize-handle { flex: 0 0 16px; align-self: stretch; cursor: col-resize; position: relative; }
  .wiki-race-resize-handle::after { content: ""; position: absolute; top: 0; bottom: 0; left: 7px; width: 2px; background: #a2a9b1; }
  .wiki-race-resize-handle:hover::after, .wiki-race-resize-handle.wiki-race-active::after { background: #0645ad; width: 3px; left: 6.5px; }
  body.wiki-race-noselect { user-select: none; }
`;

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildArticleSrcDoc(
  stylesheetHrefs: string[],
  pageTitle: string,
  html: string,
  tocHtml: string,
  detailsHtml: string,
  isDark: boolean,
  tocWidth: number,
  detailsWidth: number
) {
  const links = stylesheetHrefs
    .map((href) => `<link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}">`)
    .join("");
  const darkStyle = isDark
    ? `<style>${DARK_OVERRIDE_CSS}\n.wiki-race-toc { background: #1f242b !important; border-color: #3a3f47 !important; }\n.wiki-race-toc-numb { color: #9aa0a6 !important; }\n.mw-collapsible.mw-collapsed > .sidebar-list-title::after, .mw-collapsible.mw-collapsed > .wiki-race-extra-title::after { color: #8ab4f8 !important; }\n.wiki-race-extra { border-color: #3a3f47 !important; }\n.wiki-race-resize-handle::after { background: #3a3f47; }</style>`
    : "";
  const widthStyle = `<style>.wiki-race-toc { flex: 0 0 ${tocWidth}px; } .wiki-race-details { flex: 0 0 ${detailsWidth}px; }</style>`;
  const toc = tocHtml
    ? `<nav class="wiki-race-toc" id="wiki-race-toc"><div class="wiki-race-toc-heading">Contents</div>${tocHtml}</nav><div class="wiki-race-resize-handle" data-resize="toc"></div>`
    : "";
  const details = detailsHtml
    ? `<div class="wiki-race-resize-handle" data-resize="details"></div><aside class="wiki-race-details" id="wiki-race-details">${detailsHtml}</aside>`
    : "";
  // Real Wikipedia's own classes — the loaded stylesheet formats this large
  // serif heading with its bottom border for free, same as the infobox/TOC.
  const heading = pageTitle
    ? `<h1 id="firstHeading" class="firstHeading mw-first-heading"><span class="mw-page-title-main">${escapeHtml(pageTitle)}</span></h1>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">${links}<style>body{margin:0;padding:16px;}${LAYOUT_CSS}</style>${widthStyle}${darkStyle}</head><body>${heading}<div class="wiki-race-layout">${toc}<div id="content" class="mw-body wiki-race-content"><div id="bodyContent" class="mw-body-content"><div id="mw-content-text" class="mw-parser-output">${html}</div></div></div>${details}</div></body></html>`;
}
