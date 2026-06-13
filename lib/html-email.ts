/** Helpers for compose / send HTML email bodies. */

export function htmlToPlain(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function plainToEditorHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<div>${escaped}</div>`;
}

export function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s);
}

export function stripOuterHtml(html: string): string {
  return html
    .replace(/<html[^>]*>/gi, '')
    .replace(/<\/html>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>/gi, '')
    .replace(/<\/body>/gi, '');
}

export const EMAIL_ROOT_ID = 'email-root';

/** Strip oversized spacer styles common in marketing / Outlook HTML. */
function stripLooseVerticalStyles(html: string): string {
  return html
    .replace(/\s+(margin|padding)\s*:\s*[^;"']+;?/gi, '')
    .replace(/\s+(min-)?height\s*:\s*(\d{2,})(px|pt|em|rem)?[^;"']*;?/gi, '')
    .replace(/\s+line-height\s*:\s*(\d{2,})(px|pt)?[^;"']*;?/gi, '')
    .replace(/\s+line-height\s*:\s*([3-9](?:\.\d+)?|\d{2,})[^;"']*;?/gi, '');
}

/** Trim extra vertical gaps common in Gmail / marketing HTML. */
export function normalizeEmailHtmlForDisplay(html: string): string {
  let s = stripOuterHtml(html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
  s = s.replace(/<p[^>]*>\s*(&nbsp;|\u00a0|\s|<br\s*\/?>)*\s*<\/p>/gi, '');
  s = s.replace(/<div[^>]*>\s*(&nbsp;|\u00a0|\s|<br\s*\/?>)*\s*<\/div>/gi, '');
  s = s.replace(/<tr[^>]*>\s*<td[^>]*>\s*(&nbsp;|\u00a0|\s|<br\s*\/?>)*\s*<\/td>\s*<\/tr>/gi, '');
  s = s.replace(/<div[^>]*>\s*<\/div>/gi, '');
  s = stripLooseVerticalStyles(s);
  return s.trim();
}

export const EMAIL_BODY_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    font-family: -apple-system, Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.45;
    color: #202124;
    background: #fff;
    word-wrap: break-word;
    overflow-wrap: break-word;
    overflow-x: hidden;
    -webkit-text-size-adjust: 100%;
  }
  #${EMAIL_ROOT_ID} {
    padding: 4px 0 8px;
    overflow: hidden;
    width: 100%;
    max-width: 100%;
  }
  #${EMAIL_ROOT_ID} p,
  #${EMAIL_ROOT_ID} h1, #${EMAIL_ROOT_ID} h2, #${EMAIL_ROOT_ID} h3,
  #${EMAIL_ROOT_ID} h4, #${EMAIL_ROOT_ID} h5, #${EMAIL_ROOT_ID} h6 {
    margin: 0 0 0.45em 0;
    padding: 0;
    line-height: 1.45 !important;
  }
  #${EMAIL_ROOT_ID} p:empty,
  #${EMAIL_ROOT_ID} div:empty {
    display: none !important;
    height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  #${EMAIL_ROOT_ID} ul, #${EMAIL_ROOT_ID} ol {
    margin: 0 0 0.45em 1.2em;
    padding: 0;
  }
  #${EMAIL_ROOT_ID} li { margin: 0 0 0.2em 0; }
  #${EMAIL_ROOT_ID} img {
    max-width: 100% !important;
    height: auto !important;
  }
  #${EMAIL_ROOT_ID} img[width="1"],
  #${EMAIL_ROOT_ID} img[width="0"] {
    max-height: 2px !important;
    opacity: 0;
  }
  #${EMAIL_ROOT_ID} a {
    color: #1A73E8;
    text-decoration: underline;
    word-break: break-all;
  }
  #${EMAIL_ROOT_ID} pre, #${EMAIL_ROOT_ID} code {
    white-space: pre-wrap;
    margin: 0;
    max-width: 100%;
    overflow-x: auto;
  }
  #${EMAIL_ROOT_ID} blockquote {
    margin: 0.35em 0 0.35em 8px;
    padding-left: 8px;
    border-left: 2px solid #e8eaed;
  }
  #${EMAIL_ROOT_ID} .gmail_quote,
  #${EMAIL_ROOT_ID} blockquote blockquote {
    margin-top: 0.35em;
  }
`;

/**
 * Fit wide ticket / marketing HTML inside the mail WebView.
 * Primary: viewport meta scaling (preserves table layouts).
 * Fallback: CSS transform when overflow is detected after layout.
 */
export const EMAIL_FIT_WIDTH_JS = `
(function() {
  function containerWidth() {
    if (window.__EMAIL_CONTAINER_WIDTH__ > 0) return window.__EMAIL_CONTAINER_WIDTH__;
    return window.innerWidth || document.documentElement.clientWidth || 320;
  }
  function parsePx(value) {
    if (!value) return 0;
    var n = parseInt(String(value).replace('px', ''), 10);
    return isNaN(n) ? 0 : n;
  }
  function declaredWidth(el) {
    var attr = parseInt(el.getAttribute('width') || '0', 10);
    if (attr > 40) return attr;
    if (el.style && el.style.width) {
      var sw = parsePx(el.style.width);
      if (sw > 40) return sw;
    }
    var inline = el.getAttribute('style') || '';
    var wm = inline.match(/(?:^|;)\\s*width\\s*:\\s*(\\d+)px/i);
    if (wm) return parseInt(wm[1], 10) || 0;
    var mm = inline.match(/(?:^|;)\\s*min-width\\s*:\\s*(\\d+)px/i);
    if (mm) return parseInt(mm[1], 10) || 0;
    return 0;
  }
  function detectDesignWidth(root) {
    var max = 0;
    root.querySelectorAll('table, img, td, th, div').forEach(function(el) {
      max = Math.max(max, declaredWidth(el));
    });
    return max;
  }
  function measureOverflowRight(root) {
    var rootLeft = root.getBoundingClientRect().left;
    var maxRight = rootLeft;
    root.querySelectorAll('table, img, td, th, div, p, span, a').forEach(function(el) {
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (r.right > maxRight) maxRight = r.right;
    });
    return Math.ceil(maxRight - rootLeft);
  }
  function measureScrollWidth(root) {
    var prevBody = document.body.style.overflow;
    var prevRoot = root.style.overflow;
    document.body.style.overflow = 'visible';
    root.style.overflow = 'visible';
    var w = Math.max(
      root.scrollWidth || 0,
      document.body.scrollWidth || 0,
      measureOverflowRight(root)
    );
    document.body.style.overflow = prevBody;
    root.style.overflow = prevRoot;
    return w;
  }
  function setViewport(content) {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', content);
  }
  function fit() {
    var root = document.getElementById('${EMAIL_ROOT_ID}');
    if (!root) return;
    var vw = containerWidth();
    root.style.transform = 'none';
    root.style.transformOrigin = 'top left';
    root.style.width = '';
    root.style.marginBottom = '0';

    var designW = detectDesignWidth(root);
    var layoutW = measureScrollWidth(root);
    var naturalW = Math.max(designW, layoutW, root.offsetWidth || 0);

    if (naturalW > vw + 2) {
      var scale = vw / naturalW;
      setViewport(
        'width=' + naturalW +
        ', initial-scale=' + scale +
        ', maximum-scale=' + scale +
        ', user-scalable=no'
      );
      return;
    }

    setViewport('width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

    var overflowW = measureOverflowRight(root);
    if (overflowW > vw + 2) {
      var s = vw / overflowW;
      root.style.width = overflowW + 'px';
      root.style.transform = 'scale(' + s + ')';
      root.style.transformOrigin = 'top left';
      root.style.marginBottom = Math.ceil(root.offsetHeight * (s - 1)) + 'px';
    }
  }
  fit();
  setTimeout(fit, 80);
  setTimeout(fit, 300);
  setTimeout(fit, 800);
  setTimeout(fit, 1500);
  window.addEventListener('load', fit);
})();
true;
`;

const BARE_URL_RE =
  /\b((?:https?:\/\/|www\.)[^\s<>"']+?)(?=[.,;:!?)}\]'"]*(?:\s|<|$))/gi;

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, '&quot;');
}

function wrapBareUrl(url: string): string {
  let core = url;
  let trail = '';
  while (/[.,;:!?)}\]'"]$/.test(core)) {
    trail = core.slice(-1) + trail;
    core = core.slice(0, -1);
  }
  if (!core) return url;
  const href = core.startsWith('www.') ? `https://${core}` : core;
  return `<a href="${escapeHtmlAttr(href)}">${escapeHtmlText(core)}</a>${trail}`;
}

/** Turn bare https://… URLs in a text segment into anchor tags. */
export function linkifyTextSegment(text: string): string {
  return text.replace(BARE_URL_RE, (match) => wrapBareUrl(match));
}

/** Linkify bare URLs in HTML without touching existing tags or href values. */
export function linkifyBareUrlsInHtml(html: string): string {
  const parts = html.split(/(<[^>]+>)/g);
  let insideAnchor = false;
  return parts
    .map((part) => {
      if (part.startsWith('<')) {
        const lower = part.toLowerCase();
        if (/^<a\b/.test(lower)) insideAnchor = true;
        else if (lower === '</a>') insideAnchor = false;
        return part;
      }
      if (insideAnchor) return part;
      return linkifyTextSegment(part);
    })
    .join('');
}

/** Escape plain text, preserve line breaks, and linkify URLs. */
export function linkifyPlainText(text: string): string {
  const escaped = escapeHtmlText(text).replace(/\n{3,}/g, '\n\n').replace(/\n/g, '<br/>');
  return linkifyTextSegment(escaped);
}

/** Guess the layout width of ticket / marketing HTML before WebView paint. */
export function detectEmailDesignWidth(html: string): number {
  let max = 0;
  const widthAttr = html.matchAll(/\bwidth\s*=\s*["']?(\d{3,4})\b/gi);
  for (const m of widthAttr) max = Math.max(max, parseInt(m[1]!, 10));
  const stylePx = html.matchAll(/\b(?:min-)?width\s*:\s*(\d{3,4})px/gi);
  for (const m of stylePx) max = Math.max(max, parseInt(m[1]!, 10));
  return max;
}

function initialViewportMeta(designWidth: number, containerWidth?: number): string {
  const cw = containerWidth && containerWidth > 0 ? containerWidth : 0;
  if (designWidth > 320 && cw > 0 && designWidth > cw) {
    const scale = Math.min(1, cw / designWidth);
    return `width=${designWidth}, initial-scale=${scale}, maximum-scale=${scale}, user-scalable=no`;
  }
  return 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
}

export function wrapEmailHtmlBody(bodyHtml: string, containerWidth?: number): string {
  const normalized = linkifyBareUrlsInHtml(normalizeEmailHtmlForDisplay(bodyHtml));
  const designWidth = detectEmailDesignWidth(normalized);
  const widthInit =
    containerWidth && containerWidth > 0
      ? `<script>window.__EMAIL_CONTAINER_WIDTH__=${Math.round(containerWidth)};</script>`
      : '';
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="${initialViewportMeta(designWidth, containerWidth)}"/>
<style>${EMAIL_BODY_CSS}</style>
${widthInit}
</head><body><div id="${EMAIL_ROOT_ID}">${normalized}</div></body></html>`;
}

export function wrapPlainTextAsEmailDocument(text: string, containerWidth?: number): string {
  return wrapEmailHtmlBody(`<div>${linkifyPlainText(text || '(no body)')}</div>`, containerWidth);
}
