<script lang="ts">
  import { onMount } from 'svelte';
  import GeneratedAvatar from '$lib/components/GeneratedAvatar.svelte';
  import { db, supabase, formatAuthError, sanitizeUsernameInput, validateUsername, validatePassword, getAuthDisplayName, isUsernameAccount } from '$lib/db';
  import { checkForUpdate, shouldShowUpdatePrompt, downloadApkToCache, promptInstallApk, openInstallPermissionSettings, checkForPostUpdateChangelog, dismissUpdateThisLaunch, setLastSeenVersion, type UpdateInfo } from '$lib/updater';
  import { APP_VERSION } from '$lib/version';
  import type { User } from '@supabase/supabase-js';

  let currentUser = $state<User | null>(null);
  let authMode = $state<'signup' | 'signin'>('signup');
  let username = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');
  let success = $state('');

  // Same first-use behavior as Lift Tracker
  let preferredAuthMode = $state<'signup' | 'signin'>('signup');

  // Auto-update state (Android only, from GitHub Releases)
  let showUpdatePrompt = $state(false);
  let updateInfo = $state<UpdateInfo | null>(null);
  let downloadProgress = $state(0);
  let isDownloading = $state(false);
  let showUpdatedModal = $state(false);
  let postUpdateNotes = $state('');

  async function loadPreferredAuthMode() {
    if (typeof window === 'undefined') return;
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: 'tractatus_auth_mode' });
      if (value === 'signin' || value === 'signup') {
        preferredAuthMode = value;
        authMode = value;
      } else {
        // First time on device -> signup first (resets on uninstall)
        preferredAuthMode = 'signup';
        authMode = 'signup';
      }
    } catch {
      // Web or no preferences - default to signup for first experience
      preferredAuthMode = 'signup';
      authMode = 'signup';
    }
  }

  async function savePreferredAuthMode(mode: 'signup' | 'signin') {
    if (typeof window === 'undefined') return;
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: 'tractatus_auth_mode', value: mode });
    } catch {}
  }

  async function loadUser() {
    const user = await db.getCurrentUser();
    currentUser = user;
    if (user) {
      // After successful auth, default to signin next time
      await savePreferredAuthMode('signin');
    }
  }

  onMount(async () => {
    await loadPreferredAuthMode();
    await loadUser();

    // Listen for auth changes
    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user ?? null;
      if (currentUser) {
        savePreferredAuthMode('signin');
      }
    });

    // Check for post-update changelog (shows "UPDATED" with notes once after upgrade)
    if (currentUser) {
      const postUpdate = await checkForPostUpdateChangelog();
      if (postUpdate) {
        postUpdateNotes = postUpdate.notes;
        showUpdatedModal = true;
      }
    }
  });

  // Check for updates after successful sign-in (mirrors Lift Tracker behavior)
  async function checkForAppUpdateAfterAuth() {
    try {
      const info = await shouldShowUpdatePrompt();
      if (info) {
        updateInfo = info;
        showUpdatePrompt = true;
      }
    } catch (e) {
      console.warn('[tractatus] Update check failed', e);
    }
  }

  async function handleAuth() {
    if (!username || !password) {
      error = 'Username and password required.';
      return;
    }

    const uErr = validateUsername(username);
    if (uErr) {
      error = uErr;
      return;
    }

    const pErr = validatePassword(password);
    if (pErr) {
      error = pErr;
      return;
    }

    loading = true;
    error = '';
    success = '';

    try {
      if (authMode === 'signup') {
        await db.signUpWithUsername(username, password);
        success = 'Account created! Check your "email" (username-based) or sign in.';
        // After signup success, next time default to signin
        await savePreferredAuthMode('signin');
      } else {
        await db.signInWithUsername(username, password);
        await loadUser();
        success = 'Signed in successfully.';
        // Trigger auto-update check (same timing as original app: after auth + data loaded)
        setTimeout(() => {
          checkForAppUpdateAfterAuth();
        }, 800);
      }
    } catch (e: any) {
      error = formatAuthError(e, undefined, 'username');
    } finally {
      loading = false;
    }
  }

  async function handleSignOut() {
    await db.signOut();
    currentUser = null;
    username = '';
    password = '';
    error = '';
    success = '';
    // Next cold start should prefer signin
  }

  function switchMode(mode: 'signup' | 'signin') {
    authMode = mode;
    error = '';
    success = '';
  }

  let displayName = $derived(currentUser ? getAuthDisplayName(currentUser) : '');
</script>

<div class="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6">
  <div class="max-w-md w-full">
    <div class="text-center mb-10">
      <div class="flex justify-center mb-4">
        <GeneratedAvatar seed={currentUser ? 'tractatus' : null} size={64} />
      </div>
      <h1 class="text-4xl font-bold tracking-tighter">Tractatus</h1>
      <p class="text-zinc-400 mt-1">A place for writing that matters.</p>
    </div>

    {#if currentUser}
      <div class="bg-[#111] border border-[#222] rounded-2xl p-8">
        <div class="flex items-center gap-4 mb-6">
          <GeneratedAvatar seed={displayName} size={48} />
          <div>
            <div class="font-semibold text-xl">@{displayName}</div>
            <div class="text-xs text-zinc-500">Signed in</div>
          </div>
        </div>

        <div class="space-y-3">
          <a href="/write" class="block w-full bg-white text-black font-medium py-3 rounded-xl text-center hover:bg-zinc-200 transition">Start writing</a>
          <button 
            onclick={handleSignOut}
            class="w-full border border-[#333] py-3 rounded-xl text-sm hover:bg-[#1a1a1a] transition"
          >
            Sign out
          </button>
        </div>
      </div>
    {:else}
      <div class="bg-[#111] border border-[#222] rounded-2xl p-8">
        <!-- Tabs like the original -->
        <div class="flex border-b border-[#222] mb-6">
          <button 
            class="flex-1 py-3 text-sm font-medium {authMode === 'signup' ? 'text-white border-b-2 border-white' : 'text-zinc-500 hover:text-zinc-300'}"
            onclick={() => switchMode('signup')}
          >
            Sign up
          </button>
          <button 
            class="flex-1 py-3 text-sm font-medium {authMode === 'signin' ? 'text-white border-b-2 border-white' : 'text-zinc-500 hover:text-zinc-300'}"
            onclick={() => switchMode('signin')}
          >
            Sign in
          </button>
        </div>

        <form onsubmit={(e) => { e.preventDefault(); handleAuth(); }} class="space-y-4">
          <div>
            <label class="text-xs uppercase tracking-widest text-zinc-500 block mb-1.5">Username</label>
            <input 
              type="text" 
              bind:value={username}
              class="w-full bg-black border border-[#222] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#444]"
              placeholder="yourname"
              autocomplete="username"
            />
            <div class="text-[10px] text-zinc-600 mt-1">3-24 characters, letters, numbers, _ -</div>
          </div>

          <div>
            <label class="text-xs uppercase tracking-widest text-zinc-500 block mb-1.5">Password</label>
            <input 
              type="password" 
              bind:value={password}
              class="w-full bg-black border border-[#222] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#444]"
              placeholder="••••••••"
              autocomplete={authMode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {#if error}
            <div class="text-red-400 text-sm bg-red-950/30 border border-red-900/50 p-3 rounded-xl">{error}</div>
          {/if}

          {#if success}
            <div class="text-emerald-400 text-sm bg-emerald-950/30 border border-emerald-900/50 p-3 rounded-xl">{success}</div>
          {/if}

          <button 
            type="submit"
            disabled={loading || !username || !password}
            class="w-full bg-white text-black font-semibold py-3.5 rounded-2xl disabled:opacity-50 active:scale-[0.985] transition mt-2"
          >
            {loading ? 'Please wait...' : authMode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div class="text-center text-[10px] text-zinc-600 mt-6">
          {authMode === 'signup' ? 'Already have an account?' : "Don't have an account?"} 
          <button 
            class="underline hover:no-underline" 
            onclick={() => switchMode(authMode === 'signup' ? 'signin' : 'signup')}
          >
            {authMode === 'signup' ? 'Sign in' : 'Sign up'}
          </button>
        </div>
      </div>
    {/if}

    <div class="text-center text-[10px] text-zinc-600 mt-8">
      Same auth system as Lift Tracker. New Supabase project required.
    </div>
  </div>
</div>

<!-- Update prompt (centered, blur background, like the original) -->
{#if showUpdatePrompt && updateInfo}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
    <div class="bg-[#111] border border-[#222] rounded-2xl max-w-md w-full p-6">
      <div class="text-xl font-semibold mb-2">Update available</div>
      <div class="text-sm text-zinc-400 mb-4">Tractatus v{updateInfo.version} is ready.</div>

      {#if updateInfo.notes}
        <div class="max-h-40 overflow-auto text-sm mb-4 bg-black/50 p-3 rounded border border-[#222] whitespace-pre-wrap">
          {updateInfo.notes}
        </div>
      {/if}

      <div class="flex gap-3">
        <button 
          class="flex-1 py-2.5 border border-[#333] rounded-xl text-sm"
          onclick={() => { dismissUpdateThisLaunch(updateInfo!.version); showUpdatePrompt = false; }}
        >
          Later
        </button>
        <button 
          class="flex-1 py-2.5 bg-white text-black font-medium rounded-xl text-sm disabled:opacity-60"
          disabled={isDownloading}
          onclick={async () => {
            if (!updateInfo) return;
            isDownloading = true;
            downloadProgress = 0;
            try {
              const path = await downloadApkToCache(updateInfo, (p) => downloadProgress = p);
              await promptInstallApk(path);
              showUpdatePrompt = false;
            } catch (e: any) {
              if (e.message?.includes('permission_required')) {
                await openInstallPermissionSettings();
              } else {
                alert(e.message || 'Update failed. Please try again.');
              }
            } finally {
              isDownloading = false;
            }
          }}
        >
          {isDownloading ? `Downloading ${downloadProgress}%` : 'Download & Install'}
        </button>
      </div>
      <div class="text-[10px] text-center text-zinc-500 mt-3">Installs via the system package installer (sideloading).</div>
    </div>
  </div>
{/if}

<!-- Post-update "UPDATED" modal -->
{#if showUpdatedModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
    <div class="bg-[#111] border border-[#222] rounded-2xl max-w-md w-full p-6 text-center">
      <div class="text-2xl mb-2">✅ Updated</div>
      <div class="text-sm mb-4">You're now on Tractatus v{APP_VERSION}</div>

      {#if postUpdateNotes}
        <div class="text-left text-sm bg-black/60 p-3 rounded mb-4 max-h-48 overflow-auto whitespace-pre-wrap border border-[#222]">
          {postUpdateNotes}
        </div>
      {/if}

      <button 
        class="w-full bg-white text-black py-2.5 rounded-xl font-medium"
        onclick={() => { showUpdatedModal = false; postUpdateNotes = ''; }}
      >
        Got it
      </button>
    </div>
  </div>
{/if}