import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

export function preprocessMarkdown(md: string): string {
  if (!md) return '';
  let out = md;
  out = out.replace(/(?<!=)==(.+?)==(?!=)/g, '<mark>$1</mark>');
  out = out.replace(/\^(.+?)\^/g, '<sup>$1</sup>');
  out = out.replace(/(?<!~)~(?!~)(.+?)~(?!~)/g, '<sub>$1</sub>');
  out = out.replace(/::: (center|left|right)\s*([\s\S]*?):::/g, (_m, align, inner) => {
    return `<div style="text-align:${align}">${inner.trim()}</div>`;
  });
  return out;
}

function highlightCodeBlocks(raw: string): string {
  return raw.replace(/<pre><code(\s+class="[^"]*")?>([\s\S]*?)<\/code><\/pre>/g, (_m, cls, code) => {
    const decoded = code
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const result = hljs.highlightAuto(decoded);
    const lang = result.language && result.language !== 'plaintext' ? result.language : '';
    return `<div class="code-block-wrap" data-lang="${lang}"><div class="code-block-header">${
      lang ? `<span class="code-block-lang">${lang}</span>` : '<span></span>'
    }<button type="button" class="code-block-copy" aria-label="Copy code"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button></div><pre><code class="hljs language-${result.language}">${result.value}</code></pre></div>`;
  });
}

function ssrEscape(md: string): string {
  return md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

export function renderEssay(md: string): string {
  if (!md) return '';
  if (typeof window === 'undefined' || typeof DOMPurify === 'undefined') {
    return ssrEscape(md);
  }
  const pre = preprocessMarkdown(md);
  const raw = marked.parse(pre, { breaks: true, gfm: true }) as string;
  const highlighted = highlightCodeBlocks(raw);
  return DOMPurify.sanitize(highlighted, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
      'ul', 'ol', 'li', 'a', 'code', 'pre',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'hr', 'mark', 'sup', 'sub', 'div', 'span',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img', 'button',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'class', 'src', 'alt', 'data-lang', 'aria-label'],
  });
}

/**
 * Render markdown to HTML truncated by line count (not characters).
 * Lines are counted on the rendered HTML by splitting on block-level elements.
 */
export function renderExcerpt(md: string, maxLines = 3): string {
  if (!md) return '';
  if (typeof window === 'undefined' || typeof DOMPurify === 'undefined') {
    const escaped = ssrEscape(md);
    const lines = escaped.split('<br>');
    return lines.slice(0, maxLines).join('<br>') + (lines.length > maxLines ? '…' : '');
  }
  const pre = preprocessMarkdown(md);
  const raw = marked.parse(pre, { breaks: true, gfm: true }) as string;
  const highlighted = highlightCodeBlocks(raw);
  const sanitized = DOMPurify.sanitize(highlighted, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
      'ul', 'ol', 'li', 'a', 'code', 'pre',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'hr', 'mark', 'sup', 'sub', 'div', 'span',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'class', 'src', 'alt'],
  });

  // Split on block-level tags to count lines
  const blockTagRegex = /<\/?(?:p|div|h[1-6]|blockquote|pre|li|hr|br|table|tr)[^>]*>/gi;
  const parts = sanitized.split(blockTagRegex).filter(Boolean);
  const lineBreaks = (sanitized.match(/<br\s*\/?>/gi) || []).length;
  const blockLines = parts.length;
  const totalLines = blockLines + lineBreaks;

  if (totalLines <= maxLines) return sanitized;

  // Truncate at the maxLines-th block-level boundary
  let count = 0;
  let result = '';
  const tokens = sanitized.split(/(<[^>]+>)/);
  for (const token of tokens) {
    if (/^<(?:p|div|h[1-6]|blockquote|pre|li|hr|br|table|tr)\b/i.test(token)) {
      count++;
      if (count > maxLines) break;
    }
    result += token;
  }
  return result + '…';
}

/** Render changelog/release notes — uses same pipeline as renderEssay */
export function renderChangelog(md: string): string {
  return renderEssay(md);
}

/** Shared event handler for copy buttons in rendered essay HTML */
export function handleCodeCopyClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const copyBtn = target.closest('.code-block-copy') as HTMLElement | null;
  if (!copyBtn) return;
  const wrap = copyBtn.closest('.code-block-wrap') as HTMLElement | null;
  if (!wrap) return;
  const code = wrap.querySelector('code');
  if (!code) return;
  const text = code.textContent || '';
  if (!text.trim()) return;
  void navigator.clipboard.writeText(text).then(() => {
    const originalHtml = copyBtn.innerHTML;
    copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
    setTimeout(() => { copyBtn.innerHTML = originalHtml; }, 1800);
  }).catch(() => {});
}
