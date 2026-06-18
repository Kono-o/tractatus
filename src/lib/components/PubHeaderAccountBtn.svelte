<script lang="ts">
  import { fade } from 'svelte/transition';
  import GeneratedAvatar from './GeneratedAvatar.svelte';
  import { User, RefreshCw } from '@lucide/svelte';
  import type { User as SupabaseUser } from '@supabase/supabase-js';

  let {
    currentUser,
    isLoading = false,
    showUserIcon = true,
    showAvatar = false,
    avatarSeed = null,
    avatarUrl = null,
    onclick = () => {},
    disabled = false,
  } = $props<{
    currentUser: SupabaseUser | null;
    isLoading?: boolean;
    showUserIcon?: boolean;
    showAvatar?: boolean;
    avatarSeed?: string | null;
    avatarUrl?: string | null;
    onclick?: () => void;
    disabled?: boolean;
  }>();
</script>

<button
  type="button"
  class="pub-header-icon-btn"
  class:pub-header-avatar={!!currentUser}
  class:pub-header-guest-btn={!currentUser}
  {onclick}
  aria-label={currentUser ? 'Account and settings' : 'Sign in or sign up'}
  {disabled}
>
  <div style="position: relative; width: 28px; height: 28px; flex-shrink: 0; overflow: hidden;">
    {#if isLoading}
      <div class="flex items-center justify-center" style="width: 28px; height: 28px;">
        <RefreshCw class="size-3.5 animate-spin" style="color: var(--hint);" aria-hidden="true" />
      </div>
    {:else if currentUser}
      {#if showUserIcon}
        <div transition:fade={{ duration: 280 }}>
          <div class="flex items-center justify-center" style="width: 28px; height: 28px;">
            <User class="size-3.5" aria-hidden="true" />
          </div>
        </div>
      {/if}
      {#if showAvatar && avatarUrl}
        <div transition:fade={{ duration: 280 }} style="position: absolute; inset: 0; border-radius: 5.6px; overflow: hidden; box-shadow: 0 0 0 1px var(--rule2);">
          <img
            src={avatarUrl}
            width={28}
            height={28}
            loading="lazy"
            alt=""
            style="width: 100%; height: 100%; object-fit: cover; border-radius: 5.6px;"
          />
        </div>
      {/if}
      {#if showAvatar && !avatarUrl}
        <div transition:fade={{ duration: 280 }}>
          <GeneratedAvatar userId={currentUser.id} seed={avatarSeed} avatarUrl={null} size={28} rounded={20} />
        </div>
      {/if}
    {:else}
      <div class="flex items-center justify-center" style="width: 28px; height: 28px;">
        <User class="size-3.5" aria-hidden="true" />
      </div>
    {/if}
  </div>
</button>
