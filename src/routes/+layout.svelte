<script lang="ts">
  import '../app.css';
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { auth } from '$lib/current-user.svelte';
  import { panels } from '$lib/panel-state.svelte';
  import { loadReadingList } from '$lib/reading-list.svelte';
  import { supabase, db } from '$lib/db';
  import PubHeader from '$lib/components/PubHeader.svelte';
  import PubHeaderAccountBtn from '$lib/components/PubHeaderAccountBtn.svelte';
  import AccountPanel from '$lib/components/AccountPanel.svelte';
  import oxaniumLatin from '@fontsource-variable/oxanium/files/oxanium-latin-wght-normal.woff2?url';
  import spaceMonoLatin from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url';
  import { Search } from '@lucide/svelte';

  let { children } = $props();

  let subscriptionCleanup: (() => void) | undefined;

  onMount(async () => {
    const { initNativeShell } = await import('$lib/native');
    void initNativeShell();

    // Get stored session synchronously — handles cases where INITIAL_SESSION
    // already fired before this subscription was registered.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        auth.currentUser = session.user as any;
      }
    } catch (e) {
      console.error('getSession failed', e);
    }
    auth.isAuthLoading = false;

    // Listen for future auth events (sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        auth.currentUser = session.user as any;
      } else {
        auth.currentUser = null;
      }
    });

    subscriptionCleanup = () => subscription.unsubscribe();
  });

  onDestroy(() => {
    subscriptionCleanup?.();
  });

  async function loadAvatarData() {
    if (!auth.currentUser) return;
    try {
      const [seed, url] = await Promise.all([
        db.getAvatarSeed(),
        db.getAvatarUrl(),
      ]);
      auth.avatarSeed = seed;
      auth.avatarUrl = url;
    } catch (e) {
      console.warn('[layout] failed to load avatar', e);
    }
    auth.showUserIcon = false;
    auth.showAvatar = true;
  }

  $effect(() => {
    if (auth.currentUser && !auth.isAuthLoading) {
      void loadAvatarData();
      void loadReadingList();
    } else if (!auth.currentUser) {
      auth.avatarSeed = null;
      auth.avatarUrl = null;
      auth.showUserIcon = true;
      auth.showAvatar = false;
    }
  });
</script>

<svelte:head>
  <title>Tractatus</title>
  <meta name="description" content="A minimalist writing platform — write, publish, and share your thoughts." />
  <meta property="og:site_name" content="Tractatus" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Tractatus" />
  <meta property="og:description" content="A minimalist writing platform — write, publish, and share your thoughts." />
  <meta property="og:image" content="{$page.url.origin}/api/og" />
  <meta property="og:url" content="{$page.url.origin}{$page.url.pathname}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Tractatus" />
  <meta name="twitter:description" content="A minimalist writing platform — write, publish, and share your thoughts." />
  <meta name="twitter:image" content="{$page.url.origin}/api/og" />
  <link rel="canonical" href="{$page.url.origin}{$page.url.pathname}" />
  <link rel="preload" href={oxaniumLatin} as="font" type="font/woff2" crossorigin="anonymous" />
  <link rel="preload" href={spaceMonoLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

<div class="app app--pub w-full h-dvh max-h-dvh overflow-hidden select-none flex flex-col font-sans">
  {#if $page.route.id?.startsWith('/[username]')}
    <div class="app-stage flex-1 flex flex-col min-h-0 w-full relative overflow-hidden">
      <div class="app-stage-scroll flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="app-stage-reveal app-stage-reveal--active app-stack-gap flex flex-col flex-1 min-h-0 w-full overflow-hidden">
          <div class="pub-shell flex flex-col flex-1 min-h-0 w-full overflow-hidden">
            <PubHeader
              articleMode={true}
              onLogoClick={() => goto('/')}
            >
              <div
                class="pub-header-search-slot pub-header-search-slot--hidden"
                aria-hidden="true"
                inert
              >
                <div class="pub-header-search-slot-inner">
                  <span class="pub-header-search-slot-icon">
                    <span class="pub-header-search-slot-icon__item pub-header-search-slot-icon__item--active" aria-hidden="true"><Search class="size-3.5" /></span>
                  </span>
                  <input type="search" class="pub-header-search-input" tabindex="-1" aria-label="Search" />
                </div>
              </div>
              <button
                type="button"
                class="pub-header-icon-btn pub-header-icon-btn--plain pub-header-icon-btn--hidden"
                aria-hidden="true"
                tabindex="-1"
                inert
              ></button>
              <PubHeaderAccountBtn
                currentUser={auth.currentUser}
                isLoading={auth.isAuthLoading}
                showUserIcon={auth.showUserIcon}
                showAvatar={auth.showAvatar}
                avatarSeed={auth.avatarSeed}
                avatarUrl={auth.avatarUrl}
                onclick={() => {
                  if (auth.currentUser) {
                    panels.settingsOpen = true;
                  } else {
                    panels.authOpen = true;
                  }
                }}
                disabled={auth.isAuthLoading}
              />
            </PubHeader>
            <div class="pub-body flex flex-col flex-1 min-h-0" style="overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent;">
              {@render children()}
            </div>
            <AccountPanel />
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="app-stage flex-1 flex flex-col min-h-0 w-full relative overflow-hidden">
      <div class="app-stage-scroll flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="app-stage-reveal app-stage-reveal--active app-stack-gap flex flex-col flex-1 min-h-0 w-full overflow-hidden">
          {@render children()}
        </div>
      </div>
    </div>
  {/if}
</div>
