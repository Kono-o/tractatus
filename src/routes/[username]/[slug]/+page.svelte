<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { db, type Essay, estimateReadTimeMinutes } from '$lib/db';
  import EssayView from '$lib/components/EssayView.svelte';
  import { ArrowLeft, Eye, EyeClosed } from '@lucide/svelte';
  import { setAppIcon as _setAppIcon } from '$lib/icon-switcher';

  let username = $derived($page.params.username);
  let slug = $derived($page.params.slug);

  let essay = $state<Essay | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let linkCopied = $state(false);
  let linkCopiedTimer: ReturnType<typeof setTimeout> | undefined;

  let logoEyeOpen = $state(
    typeof localStorage !== 'undefined' && localStorage.getItem('logoEyeOpen') === 'true'
  );

  function goBack() {
    void goto('/');
  }

  function copyLink() {
    void navigator.clipboard.writeText(window.location.href);
    linkCopied = true;
    clearTimeout(linkCopiedTimer);
    linkCopiedTimer = setTimeout(() => { linkCopied = false; }, 1500);
  }

  function toggleLogoEye() {
    logoEyeOpen = !logoEyeOpen;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('logoEyeOpen', String(logoEyeOpen)); } catch {}
    }
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    try {
      const html = document.documentElement;
      const isDark = !logoEyeOpen;
      html.classList.toggle('dark', isDark);
      html.classList.add('theme-transitioning');
      setTimeout(() => html.classList.remove('theme-transitioning'), 250);
      _setAppIcon(isDark ? 'dark' : 'light');
    } catch (e) {
      console.warn('[logoEye] failed to apply theme class', e);
    }
  });

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
  <title>{essay?.title || 'Reading'}</title>
</svelte:head>

<div class="app app--pub w-full h-dvh max-h-dvh overflow-hidden select-none flex flex-col font-sans">
  <div class="pub-shell flex flex-col flex-1 min-h-0 w-full" style="overflow: hidden;">
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
            <span class="pub-header-logo-text" role="button" tabindex="0" onclick={goBack} onkeydown={(e) => { if (e.key === 'Enter') goBack(); }}>Tractatus</span>
          </div>
        </div>
        <div class="pub-header-actions"></div>
      </header>
      <div class="pub-header-sub">
        <button type="button" onclick={goBack} class="pub-header-back-btn">
          <ArrowLeft class="size-3.5" aria-hidden="true" />
          Back
        </button>
      </div>
    </div>
    <div class="flex flex-col flex-1 min-h-0 h-0 overflow-y-auto pub-scroll">

      {#if loading}
        <div class="pub-empty">Loading article…</div>
      {:else if error}
        <div class="pub-empty">
          <div class="pub-empty-title">{error}</div>
          <button type="button" onclick={goBack} class="pub-article-back-link">← Back to feed</button>
        </div>
      {:else if essay}
        <EssayView {essay} {linkCopied} onCopyLink={copyLink} />
      {/if}
    </div>
  </div>
</div>
