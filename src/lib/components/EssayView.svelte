<script lang="ts">
  import type { Essay } from '$lib/db';
  import { renderEssay } from '$lib/markdown';
  import { estimateReadTimeMinutes } from '$lib/db';
  import GeneratedAvatar from '$lib/components/GeneratedAvatar.svelte';
  import { Link } from '@lucide/svelte';

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
</script>

<article class="pub-article">
  <div class="pub-article-header">
    <div class="flex items-start justify-between gap-2">
      <h1 class="pub-article-title flex-1 min-w-0">{essay.title || 'Untitled'}</h1>
      {#if onCopyLink}
        <button type="button" onclick={onCopyLink} class="mt-1 shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-1.5 relative" aria-label="Copy link">
          {#if linkCopied}
            <span class="absolute right-full top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 mr-1.5">Copied!</span>
          {/if}
          <Link class="size-4" aria-hidden="true" />
        </button>
      {/if}
    </div>
    <div class="pub-article-byline">
      {#key essay.author_avatar_seed + '' + essay.author_avatar_url}
        <button type="button" class="user-chip" onclick={(e) => { e.stopPropagation(); onViewUser?.(e); }}>
          <div class="pub-author-avatar">
            <GeneratedAvatar
              userId={essay.user_id}
              seed={essay.author_avatar_seed}
              avatarUrl={essay.author_avatar_url}
              size={24}
              rounded={20}
            />
          </div>
          <span class="pub-author-meta pub-author-name">
            {essay.author_username || 'Anonymous'}
          </span>
        </button>
      {/key}

      <span class="pub-author-meta pub-author-info">
        {new Date(essay.published_at || essay.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · {countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}
      </span>
    </div>
  </div>
  <div class="pub-article-prose reader-prose markdown-content" onclick={onProseClick}>
    {@html renderEssay(essay.content)}
  </div>
</article>
