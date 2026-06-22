<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { db, type Essay } from '$lib/db';
  import EssayView from '$lib/components/EssayView.svelte';

  let username = $derived(($page.params.username).replace(/^@/, ''));
  let slug = $derived($page.params.slug);

  let essay = $state<Essay | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let linkCopied = $state(false);
  let linkCopiedTimer: ReturnType<typeof setTimeout> | undefined;

  function goBack() {
    void goto('/');
  }

  function copyLink() {
    void navigator.clipboard.writeText(window.location.href);
    linkCopied = true;
    clearTimeout(linkCopiedTimer);
    linkCopiedTimer = setTimeout(() => { linkCopied = false; }, 1500);
  }

  function viewUser() {
    if (essay?.author_username) {
      void goto('/@' + encodeURIComponent(essay.author_username) + '/');
    }
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

  $effect(() => {
    if (slug && username) void load();
  });
</script>

<svelte:head>
  <title>{essay?.title || 'Reading'} · Tractatus</title>
  {#if essay}
    <meta name="description" content="{essay.title} — by {essay.author_username}" />
    <meta property="og:title" content="{essay.title} · Tractatus" />
    <meta property="og:description" content="{essay.title} — by @{essay.author_username}" />
    <meta property="og:image" content="{$page.url.origin}/api/og/{essay.author_username}/{essay.slug}" />
    <meta property="og:url" content="{$page.url.origin}/@{essay.author_username}/{essay.slug}" />
    <meta property="og:type" content="article" />
    <meta name="twitter:title" content="{essay.title} · Tractatus" />
    <meta name="twitter:description" content="{essay.title} — by @{essay.author_username}" />
    <meta name="twitter:image" content="{$page.url.origin}/api/og/{essay.author_username}/{essay.slug}" />
    <link rel="canonical" href="{$page.url.origin}/@{essay.author_username}/{essay.slug}" />
  {/if}
</svelte:head>

{#if loading}
  <div class="pub-empty"><svg class="pub-loading-spinner" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round" /></svg></div>
{:else if error}
  <div class="pub-empty">
    <div class="pub-empty-title">{error}</div>
    <button type="button" onclick={goBack} class="pub-article-back-link">← Back to feed</button>
  </div>
{:else if essay}
  <EssayView {essay} {linkCopied} onCopyLink={copyLink} onViewUser={viewUser} />
{/if}
