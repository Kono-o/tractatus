<script lang="ts">
  import { auth } from '$lib/current-user.svelte';
  import { panels } from '$lib/panel-state.svelte';
  import { db, getAuthDisplayName } from '$lib/db';
  import PubHeaderAccountBtn from './PubHeaderAccountBtn.svelte';
  import { theme, toggleLogoEye } from '$lib/theme.svelte';
  import AuthScreen from './AuthScreen.svelte';
  import { Eye, EyeClosed, X } from '@lucide/svelte';

  function closeAuth() {
    panels.authOpen = false;
  }

  function closeSettings() {
    panels.settingsOpen = false;
  }

  async function signOut() {
    await db.signOut();
    panels.settingsOpen = false;
  }

  function handleAuthSuccess() {
    panels.authOpen = false;
  }

  let memberSince = $derived.by(() => {
    const raw = auth.currentUser?.created_at;
    if (!raw) return '—';
    return new Date(raw).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
    });
  });
</script>

{#if panels.authOpen && !auth.currentUser}
  <div
    class="settings-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Sign in or sign up"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) closeAuth(); }}
  >
    <div
      class="settings-panel-dialog auth-overlay-dialog rounded-xl shadow-xl overflow-hidden text-left"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="settings-panel-header">
        <div class="settings-panel-header__brand-row">
          <button
            type="button"
            class="settings-panel-brand__eye"
            onclick={toggleLogoEye}
            aria-label={theme.logoEyeOpen ? 'Close eye' : 'Open eye'}
          >
            {#if theme.logoEyeOpen}
              <Eye class="settings-panel-brand__eye-icon" aria-hidden="true" />
            {:else}
              <EyeClosed class="settings-panel-brand__eye-icon" aria-hidden="true" />
            {/if}
          </button>
          <span class="settings-panel-brand__lift">Tractatus</span>
        </div>
        <button type="button" aria-label="Close" class="settings-panel-header__close" onclick={closeAuth}>
          <X class="size-3.5" />
        </button>
      </div>
      <div class="settings-panel-body auth-overlay-body">
        <AuthScreen embedded onAuthenticated={handleAuthSuccess} />
      </div>
    </div>
  </div>
{/if}

{#if panels.settingsOpen && auth.currentUser}
  <div
    class="settings-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Account"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) closeSettings(); }}
  >
    <div class="settings-panel-dialog rounded-xl shadow-xl overflow-hidden text-left">
      <div class="settings-panel-header">
        <div class="settings-panel-header__brand-row">
          <button
            type="button"
            class="settings-panel-brand__eye"
            onclick={toggleLogoEye}
            aria-label={theme.logoEyeOpen ? 'Close eye' : 'Open eye'}
          >
            {#if theme.logoEyeOpen}
              <Eye class="settings-panel-brand__eye-icon" aria-hidden="true" />
            {:else}
              <EyeClosed class="settings-panel-brand__eye-icon" aria-hidden="true" />
            {/if}
          </button>
          <span class="settings-panel-brand__lift">Tractatus</span>
        </div>
        <button type="button" aria-label="Close" class="settings-panel-header__close" onclick={closeSettings}>
          <X class="size-3.5" />
        </button>
      </div>
      <div class="settings-panel-body settings-panel-body--panel">
        <div class="flex flex-col items-center gap-3 pt-3 pb-4 border-b border-[var(--rule2)]">
          <div class="flex items-center justify-center">
            <PubHeaderAccountBtn
              currentUser={auth.currentUser}
              showUserIcon={auth.showUserIcon}
              showAvatar={auth.showAvatar}
              avatarSeed={auth.avatarSeed}
              avatarUrl={auth.avatarUrl}
            />
          </div>
          <div class="text-center">
            <div class="text-sm font-medium text-[var(--ink)]">{getAuthDisplayName(auth.currentUser)}</div>
            <div class="text-xs text-[var(--muted)]">{auth.currentUser.email}</div>
            <div class="text-xs text-[var(--hint)] mt-0.5">Member since {memberSince}</div>
          </div>
        </div>
        <div class="flex flex-col gap-2 pt-3 pb-2 px-4">
          <button type="button" class="settings-panel-action-btn settings-panel-action-btn--signout" onclick={signOut}>
            <span class="settings-panel-action-btn__label">
              Sign out
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
