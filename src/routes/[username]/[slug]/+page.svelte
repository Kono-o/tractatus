<script lang="ts">
  import { page } from '$app/stores';
  import { db, supabase, type Essay, estimateReadTimeMinutes } from '$lib/db';
  import { renderEssay } from '$lib/markdown';
  import GeneratedAvatar from '$lib/components/GeneratedAvatar.svelte';
  import { Eye, EyeClosed, ArrowLeft, User, Link } from '@lucide/svelte';
  import type { User as SupabaseUser } from '@supabase/supabase-js';

  let username = $derived($page.params.username);
  let slug = $derived($page.params.slug);

  let essay = $state<Essay | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let logoEyeOpen = $state(false);

  let currentUser = $state<SupabaseUser | null>(null);
  let avatarSeed = $state<string | null>(null);
  let avatarUrl = $state<string | null>(null);

  function goBack() {
    if (history.length > 1) history.back();
    else window.location.href = '/';
  }

  let linkCopied = $state(false);
  let linkCopiedTimer: ReturnType<typeof setTimeout> | undefined;

  function copyLink() {
    void navigator.clipboard.writeText(window.location.href);
    linkCopied = true;
    clearTimeout(linkCopiedTimer);
    linkCopiedTimer = setTimeout(() => { linkCopied = false; }, 1500);
  }

  function toggleLogoEye() {
    logoEyeOpen = !logoEyeOpen;
  }

  function countWords(s: string): number {
    return (s || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function fmtReadTime(n: number): string {
    return n === 1 ? '~1 min' : `~${n} mins`;
  }

  async function load() {
    loading = true;
    error = null;
    essay = null;
    try {
      if (!slug || !username) throw new Error('Missing slug or username');
      const found = await db.getPublicEssayByUsernameAndSlug(username, slug);
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

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      currentUser = user;
      try {
        avatarSeed = await db.getAvatarSeed();
        avatarUrl = await db.getAvatarUrl();
      } catch { /* ignore */ }
    }
  }

  $effect(() => {
    if (slug && username) void load();
    if (typeof window !== 'undefined') void loadUser();
  });
</script>

<svelte:head>
  <title>{essay?.title || 'Reading'}</title>
</svelte:head>

<div class="app app--pub w-full h-dvh max-h-dvh overflow-hidden select-none flex flex-col font-sans">
  <div class="pub-shell flex flex-col flex-1 min-h-0 w-full overflow-hidden">
    <div class="pub-header-wrap">
      <header class="pub-header pub-header--article">
        <div class="pub-header-start">
          <div class="pub-header-logo">
            <button
              type="button"
              class="pub-header-logo-eye"
              onclick={toggleLogoEye}
              aria-label={logoEyeOpen ? 'Close eye' : 'Open eye'}
            >
              {#if logoEyeOpen}
                <Eye class="pub-header-logo-icon" aria-hidden="true" />
              {:else}
                <EyeClosed class="pub-header-logo-icon" aria-hidden="true" />
              {/if}
            </button>
            <span class="pub-header-logo-text">Tractatus</span>
          </div>
        </div>
        <div class="pub-header-actions">
            {#if currentUser}
              <button type="button" onclick={goBack} class="pub-header-icon-btn pub-header-avatar" aria-label="Account and settings">
                {#key avatarSeed + '' + avatarUrl}
                  <GeneratedAvatar userId={currentUser.id} seed={avatarSeed} avatarUrl={avatarUrl} size={28} rounded={20} />
                {/key}
              </button>
            {:else}
              <button type="button" onclick={goBack} class="pub-header-icon-btn pub-header-guest-btn" aria-label="Sign in or sign up">
                <User class="size-3.5" aria-hidden="true" />
              </button>
            {/if}
        </div>
      </header>
      <div class="pub-header-sub">
        <button type="button" onclick={goBack} class="pub-header-back-btn">
          <ArrowLeft class="size-3.5" aria-hidden="true" />
          Back
        </button>
      </div>
    </div>
    <div class="pub-body flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div class="mode-panel">
        {#if loading}
          <div class="pub-empty">Loading article…</div>
        {:else if error}
          <div class="pub-empty">
            <div class="pub-empty-title">{error}</div>
              <button type="button" onclick={goBack} class="pub-article-back-link">← Back to feed</button>
          </div>
        {:else if essay}
          <article class="pub-article">
            <div class="flex items-start justify-between gap-2">
              <h1 class="pub-article-title flex-1 min-w-0">{essay.title || 'Untitled'}</h1>
              <button type="button" onclick={copyLink} class="mt-1 shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-1.5 relative" aria-label="Copy link">
                {#if linkCopied}
                  <span class="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">Copied!</span>
                {/if}
                <Link class="size-4" aria-hidden="true" />
              </button>
            </div>
            <div class="pub-article-byline">
              {#key essay.author_avatar_seed + '' + essay.author_avatar_url}
                <div class="pub-author-avatar">
                  <GeneratedAvatar
                    userId={essay.user_id}
                    seed={essay.author_avatar_seed}
                    avatarUrl={essay.author_avatar_url}
                    size={24}
                    rounded={20}
                  />
                </div>
              {/key}
              <span class="pub-author-meta">
                {essay.author_username || 'Anonymous'} &nbsp;·&nbsp;
                {new Date(essay.published_at || essay.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} &nbsp;·&nbsp;
                {countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}
              </span>
            </div>
            <div class="pub-article-prose reader-prose markdown-content">
              {@html renderEssay(essay.content)}
            </div>
          </article>
        {/if}
      </div>
    </div>
  </div>
</div>
