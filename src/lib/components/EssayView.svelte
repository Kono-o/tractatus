<script lang="ts">
  import type { Essay } from '$lib/db';
  import { renderEssay } from '$lib/markdown';
  import { estimateReadTimeMinutes } from '$lib/db';
  import GeneratedAvatar from '$lib/components/GeneratedAvatar.svelte';
  import { Link, Check } from '@lucide/svelte';

  let {
    essay,
    linkCopied = false,
    onCopyLink,
    onViewUser,
    onProseClick,
  }: {
    essay: Essay;
    linkCopied?: boolean;
    onCopyLink?: () => void;
    onViewUser?: (e: MouseEvent) => void;
    onProseClick?: (e: MouseEvent) => void;
  } = $props();

  function countWords(s: string): number {
    return (s || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function fmtReadTime(n: number): string {
    return n === 1 ? '~1 min' : `~${n} mins`;
  }

  let formattedDate = $derived(
    new Date(essay.published_at || essay.updated_at).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    })
  );

  let wordCount = $derived(countWords(essay.content));
  let readTime = $derived(fmtReadTime(estimateReadTimeMinutes(essay.content)));
</script>

<article class="essay-view">
  <header class="essay-header">
    <h1 class="essay-title">{essay.title || 'Untitled'}</h1>

    <div class="essay-byline">
      <div class="essay-byline-left">
        <button type="button" class="essay-byline-author" onclick={(e) => { e.stopPropagation(); onViewUser?.(e); }}>
          <GeneratedAvatar
            userId={essay.user_id}
            seed={essay.author_avatar_seed}
            avatarUrl={essay.author_avatar_url}
            size={22}
            rounded={20}
          />
          <span class="essay-byline-name">{essay.author_username || 'Anonymous'}</span>
        </button>
        <span class="essay-byline-sep" aria-hidden="true">·</span>
        <span class="essay-byline-meta">{formattedDate}</span>
      </div>
      <div class="essay-byline-right">
        <span class="essay-byline-meta">{wordCount} words</span>
        <span class="essay-byline-sep" aria-hidden="true">·</span>
        <span class="essay-byline-meta">{readTime}</span>
        {#if onCopyLink}
          <button type="button" class="essay-copy-btn" onclick={onCopyLink} aria-label="Copy link">
            {#if linkCopied}
              <span class="essay-copy-toast"><Check class="size-3" aria-hidden="true" /> Copied</span>
            {:else}
              <Link class="size-3" aria-hidden="true" />
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </header>

  <div class="essay-divider"></div>

  <div class="essay-prose reader-prose markdown-content" onclick={onProseClick}>
    {@html renderEssay(essay.content)}
  </div>
</article>

<style>
  .essay-view {
    max-width: 680px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    width: 100%;
  }

  .essay-title {
    font-family: var(--dm);
    font-size: 1.75rem;
    line-height: 1.25;
    letter-spacing: -0.01em;
    color: var(--ink);
    font-weight: 500;
    margin: 0 0 0.85rem;
  }

  .essay-copy-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    background: none;
    border: none;
    padding: 0;
    color: var(--hint);
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .essay-copy-btn:hover {
    color: var(--muted);
  }

  .essay-copy-toast {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--green);
    font-family: var(--ui);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .essay-byline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.8rem;
    color: var(--muted);
    font-family: var(--ui);
  }

  .essay-byline-left {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }

  .essay-byline-right {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .essay-byline-author {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--ink);
    font-family: var(--ui);
    font-size: 0.8rem;
    transition: opacity 0.15s ease;
    flex-shrink: 0;
    outline: none;
  }

  .essay-byline-author:hover {
    opacity: 0.7;
  }

  .essay-byline-author:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .essay-byline-name {
    font-weight: 500;
    color: var(--ink);
  }

  .essay-byline-sep {
    color: var(--rule);
  }

  .essay-byline-meta {
    color: var(--hint);
    white-space: nowrap;
  }

  .essay-divider {
    height: 1px;
    background: var(--rule);
    width: 100vw;
    margin: 1.25rem 0 2rem calc(-50vw + 50%);
  }

  .essay-prose {
    font-size: 1rem;
    line-height: 1.75;
    color: var(--ink);
  }
</style>
