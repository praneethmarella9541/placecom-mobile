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
  * { box-sizing: border-box; max-width: 100% !important; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.45;
    color: #202124;
    background: #fff;
    word-wrap: break-word;
    overflow-wrap: break-word;
    overflow-x: hidden;
  }
  #${EMAIL_ROOT_ID} {
    padding: 6px 8px 8px;
    overflow: visible;
  }
  #${EMAIL_ROOT_ID} p,
  #${EMAIL_ROOT_ID} h1, #${EMAIL_ROOT_ID} h2, #${EMAIL_ROOT_ID} h3,
  #${EMAIL_ROOT_ID} h4, #${EMAIL_ROOT_ID} h5, #${EMAIL_ROOT_ID} h6 {
    margin: 0 0 0.45em 0;
    padding: 0;
    line-height: 1.45 !important;
  }
  #${EMAIL_ROOT_ID} div {
    margin: 0;
    padding: 0;
    min-height: 0 !important;
    height: auto !important;
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
  #${EMAIL_ROOT_ID} table {
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    border-collapse: collapse;
  }
  #${EMAIL_ROOT_ID} td, #${EMAIL_ROOT_ID} th {
    height: auto !important;
    min-height: 0 !important;
    padding: 2px 4px;
  }
  #${EMAIL_ROOT_ID} a { color: #1A73E8; }
  #${EMAIL_ROOT_ID} pre, #${EMAIL_ROOT_ID} code {
    white-space: pre-wrap;
    margin: 0;
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

export function wrapEmailHtmlBody(bodyHtml: string): string {
  const normalized = normalizeEmailHtmlForDisplay(bodyHtml);
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>${EMAIL_BODY_CSS}</style>
</head><body><div id="${EMAIL_ROOT_ID}">${normalized}</div></body></html>`;
}

export function wrapPlainTextAsEmailDocument(text: string): string {
  const escaped = (text || '(no body)')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n/g, '<br/>');
  return wrapEmailHtmlBody(`<div>${escaped}</div>`);
}
