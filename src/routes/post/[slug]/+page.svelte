<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { db, type Essay } from '$lib/db';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';

  let slug = $derived($page.params.slug);

  let essay = $state<Essay | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  function preprocessMarkdown(md: string): string {
    if (!md) return '';
    // Custom extensions (keep simple, no external plugins)
    let out = md;

    // ==highlight==
    out = out.replace(/==(.+?)==/g, '<mark>$1</mark>');

    // ^sup^ and ~sub~ (non-greedy, avoid breaking urls etc)
    out = out.replace(/\^(.+?)\^/g, '<sup>$1</sup>');
    out = out.replace(/~(.+?)~/g, '<sub>$1</sub>');

    // ::: align blocks (center / left / right) — very light custom
    out = out.replace(/::: (center|left|right)\s*([\s\S]*?):::/g, (_m, align, inner) => {
      const style = `text-align:${align}`;
      return `<div style="${style}">${inner.trim()}</div>`;
    });

    return out;
  }

  function renderEssay(md: string): string {
    if (!md) return '';
    if (typeof window === 'undefined' || typeof DOMPurify === 'undefined') {
      // SSR / early fallback — very basic
      return md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
    const pre = preprocessMarkdown(md);
    // Use GFM + breaks for nice writing feel
    const raw = marked.parse(pre, { breaks: true, gfm: true }) as string;

    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
        'ul', 'ol', 'li',
        'a', 'code', 'pre',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'hr',
        'mark', 'sup', 'sub', 'div', 'span',
        'table', 'thead', 'tbody', 'tr', 'th', 'td'
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'class'],
    });
  }

  async function load() {
    loading = true;
    error = null;
    essay = null;
    try {
      if (!slug) throw new Error('Missing slug');
      const found = await db.getPublicEssayBySlug(slug);
      if (!found) {
        error = 'This essay is not public or does not exist.';
      } else {
        essay = found;
      }
    } catch (e: any) {
      console.error(e);
      error = 'Failed to load essay.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  // React to slug change (SPA nav)
  $effect(() => {
    if (slug) void load();
  });
</script>

<div class="max-w-prose mx-auto p-8 pb-16">
  {#if loading}
    <div class="text-zinc-500 text-sm">Loading…</div>
  {:else if error}
    <div>
      <h1 class="text-3xl font-semibold mb-3 tracking-tight">Not found</h1>
      <p class="text-zinc-400">{error}</p>
      <a href="/" class="inline-block mt-6 text-sm underline">← Back to app</a>
    </div>
  {:else if essay}
    <h1 class="text-4xl font-semibold tracking-[-0.02em] mb-3">{essay.title}</h1>
    <div class="text-zinc-500 text-xs mb-8 tracking-wide">
      {new Date(essay.published_at || essay.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      {#if !essay.is_public}
        <span class="ml-2 text-amber-400/80">• DRAFT</span>
      {/if}
    </div>

    <article class="reader-prose markdown-content">
      {@html renderEssay(essay.content)}
    </article>

    <div class="mt-12 text-center">
      <a href="/" class="text-xs text-zinc-500 hover:text-zinc-400">← tractatus</a>
    </div>
  {/if}
</div>
