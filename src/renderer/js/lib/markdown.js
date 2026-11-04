/** Markdown saneado para el chat. */

let configured = false;

function ensureMarked() {
  if (!window.marked) return null;
  if (!configured) {
    window.marked.setOptions({
      gfm: true,
      breaks: true,
      headerIds: false,
      mangle: false
    });
    configured = true;
  }
  return window.marked;
}

export function renderMarkdown(text) {
  const source = String(text || '');
  const marked = ensureMarked();
  if (!marked || !window.DOMPurify) {
    return escape(source).replace(/\n/g, '<br>');
  }
  const html = marked.parse(source);
  return window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'onerror', 'onclick']
  });
}

function escape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
