/**
 * DOM helpers shared by the extractors: document-order indexing and
 * "page chrome" detection (navigation, footers, cookie banners, ads...).
 */

const CHROME_TAGS = new Set(['nav', 'footer', 'dialog']);
const CHROME_ROLES = /^(navigation|contentinfo|banner|search|dialog|alertdialog|menu|menubar)$/i;
const CHROME_CLASS = /(^|[\s_-])(nav|navbar|navigation|menu|megamenu|breadcrumbs?|footer|cookies?|consent|gdpr|social|share|sharing|skip-link|newsletter|paywall|modal|popup|ad|ads|advert|advertisement|sponsored)([\s_-]|$)/i;

export const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export class PageContext {
  constructor($, pageUrl) {
    this.$ = $;
    this.pageUrl = pageUrl;
    this.pre = new Map();  // node -> pre-order index
    this.end = new Map();  // node -> index of last descendant
    this._chrome = new Map();
    this._textLen = new Map();
    this._index($.root()[0]);
  }

  _index(root) {
    let i = 0;
    const walk = (n) => {
      this.pre.set(n, i++);
      if (n.children) for (const c of n.children) if (c.type === 'tag') walk(c);
      this.end.set(n, i - 1);
    };
    walk(root);
  }

  contains(ancestor, node) {
    const p = this.pre.get(node);
    return p > this.pre.get(ancestor) && p <= this.end.get(ancestor);
  }

  textLen(node) {
    let n = this._textLen.get(node);
    if (n === undefined) {
      n = this.$(node).text().replace(/\s+/g, ' ').length;
      this._textLen.set(node, n);
    }
    return n;
  }

  /** True if the node sits in navigation, site header/footer, banners, ads, etc. */
  isChrome(node) {
    if (!node || node.type !== 'tag') return false;
    if (this._chrome.has(node)) return this._chrome.get(node);
    let result = false;
    const name = node.name;
    const attrs = node.attribs || {};
    if (name === 'body' || name === 'html' || name === 'main') result = false;
    else if (CHROME_TAGS.has(name)) result = true;
    else if (attrs.role && CHROME_ROLES.test(attrs.role)) result = true;
    else if (name === 'header' && !this._hasAncestor(node, /^(article|section|main)$/)) result = true;
    // Class/id hints only apply to modest blocks, so a page wrapper like
    // <div class="layout menu-open"> doesn't swallow the whole page.
    else if (CHROME_CLASS.test(`${attrs.class || ''} ${attrs.id || ''}`) && !this._isHeading(node) &&
      this.textLen(node) < 4000) result = true;
    if (!result && node.parent) result = this.isChrome(node.parent);
    this._chrome.set(node, result);
    return result;
  }

  _isHeading(node) {
    return HEADING_TAGS.has(node.name);
  }

  _hasAncestor(node, re) {
    for (let p = node.parent; p && p.type === 'tag'; p = p.parent) if (re.test(p.name)) return true;
    return false;
  }
}

/** Remove non-content nodes. Call after metadata/JSON-LD have been read. */
export function stripNoise($) {
  $('script, style, noscript, template, svg, iframe, object, embed, canvas, [hidden], [aria-hidden="true"]:not(:has(a)), [style*="display:none"], [style*="display: none"]').remove();
  // Pad block-ish elements with whitespace so text of adjacent blocks doesn't run together
  // (<h3>Title</h3><p>Summary</p> must read "Title Summary", not "TitleSummary").
  $('p, div, h1, h2, h3, h4, h5, h6, li, dt, dd, td, th, span, time, figcaption, blockquote, section, article, header, footer, br').after(' ');
}
