<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    CircleAlert,
    CircleCheck,
    Lock,
    LockKeyhole,
    Mail,
    PenLine,
    RefreshCw,
    User,
  } from '@lucide/svelte';
  import AuthBrandIcon from '$lib/components/auth-brand-icons.svelte';
  import {
    db,
    isSupabaseConfigured,
    formatAuthError,
    MAX_PASSWORD_LEN,
    MAX_USERNAME_LEN,
    sanitizePasswordInput,
    sanitizeUsernameInput,
    validatePassword,
    validateUsername,
  } from '$lib/db';
  import { APP_VERSION } from '$lib/version';

  let { onAuthenticated }: { onAuthenticated?: () => void } = $props();

  let signingIn = $state(false);
  let authError = $state<string | null>(null);
  let authSuccess = $state<string | null>(null);
  let authFeedbackExiting = $state(false);
  let authFeedbackEntering = $state(false);
  let authFeedbackExitTimer: ReturnType<typeof setTimeout> | null = null;
  const AUTH_FEEDBACK_CROSSFADE_MS = 240;

  let authMode = $state<'signin' | 'signup'>('signup');
  let authUsername = $state('');
  let authPassword = $state('');
  let authConfirmPassword = $state('');

  let authFeedbackVisible = $derived(!!(authError || authSuccess));
  let authCrossfadeShowFeedback = $derived(authFeedbackVisible || authFeedbackExiting);
  let authSubmitBtnLit = $derived(
    !authFeedbackVisible || authFeedbackExiting || authFeedbackEntering,
  );
  let authFeedbackLit = $derived(
    authFeedbackVisible && !authFeedbackExiting && !authFeedbackEntering,
  );
  let authSubmitReady = $derived.by(() => {
    if (!authPassword) return false;
    if (!authUsername.trim()) return false;
    if (authMode === 'signup' && !authConfirmPassword) return false;
    return true;
  });

  function finishAuthFeedbackExit() {
    if (authFeedbackExitTimer) {
      clearTimeout(authFeedbackExitTimer);
      authFeedbackExitTimer = null;
    }
    authError = null;
    authSuccess = null;
    authFeedbackExiting = false;
    authFeedbackEntering = false;
  }

  async function setAuthError(message: string | null) {
    finishAuthFeedbackExit();
    authError = message;
    if (message) {
      authSuccess = null;
      authFeedbackEntering = true;
      await tick();
      authFeedbackEntering = false;
    }
  }

  async function setAuthSuccess(message: string | null) {
    finishAuthFeedbackExit();
    authSuccess = message;
    if (message) {
      authError = null;
      authFeedbackEntering = true;
      await tick();
      authFeedbackEntering = false;
    }
  }

  async function clearAuthFeedback() {
    if (!authError && !authSuccess) return;
    if (authFeedbackExiting) return;
    authFeedbackExiting = true;
    await tick();
    authFeedbackExitTimer = setTimeout(
      finishAuthFeedbackExit,
      AUTH_FEEDBACK_CROSSFADE_MS + 20,
    );
  }

  function onAuthCrossfadeTransitionEnd(e: TransitionEvent) {
    if (e.propertyName !== 'opacity' || !authFeedbackExiting) return;
    finishAuthFeedbackExit();
  }

  function setAuthMode(mode: 'signin' | 'signup') {
    authMode = mode;
    setAuthError(null);
    authSuccess = null;
    if (mode === 'signin') authConfirmPassword = '';
  }

  async function savePreferredAuthMode(mode: 'signin' | 'signup') {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: 'tractatus_preferred_auth_mode', value: mode });
    } catch {
      // Web or storage unavailable
    }
  }

  async function loadPreferredAuthMode() {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: 'tractatus_preferred_auth_mode' });
      if (value === 'signin' || value === 'signup') {
        authMode = value;
      } else {
        authMode = 'signup';
      }
    } catch {
      authMode = 'signup';
    }
  }

  async function handleUsernameAuth() {
    const username = authUsername.trim();
    if (!username || !authPassword) {
      setAuthError('Enter your username and password.');
      authSuccess = null;
      return;
    }
    const usernameErr = validateUsername(username);
    if (usernameErr) {
      setAuthError(usernameErr);
      authSuccess = null;
      return;
    }
    if (authMode === 'signup' && authPassword !== authConfirmPassword) {
      setAuthError('Passwords do not match.');
      authSuccess = null;
      return;
    }
    const passwordErr = validatePassword(authPassword);
    if (passwordErr) {
      setAuthError(passwordErr);
      authSuccess = null;
      return;
    }

    signingIn = true;
    setAuthError(null);
    authSuccess = null;
    await tick();
    try {
      if (authMode === 'signup') {
        const { session } = await db.signUpWithUsername(username, authPassword);
        if (session) {
          void savePreferredAuthMode('signin');
          authPassword = '';
          authConfirmPassword = '';
          onAuthenticated?.();
        } else {
          setAuthSuccess(
            'Account created. If sign-in fails, disable “Confirm email” in Supabase Auth settings (username accounts have no inbox).',
          );
          authMode = 'signin';
          authPassword = '';
          authConfirmPassword = '';
        }
      } else {
        await db.signInWithUsername(username, authPassword);
        void savePreferredAuthMode('signin');
        authPassword = '';
        onAuthenticated?.();
      }
    } catch (e) {
      console.error('Username auth failed', e);
      setAuthError(formatAuthError(e, undefined, 'username'));
    } finally {
      signingIn = false;
    }
  }

  onMount(() => {
    void loadPreferredAuthMode();
  });
</script>

<div class="flex flex-1 flex-col items-center justify-center pt-0 pb-10 px-2 gap-6 text-center min-h-0 -translate-y-6">
  <div class="w-20 h-20 rounded-2xl bg-[#141414] border border-[#1e1e1e] flex items-center justify-center transition-all duration-200 hover:border-[#2a2a2a]">
    <PenLine class="size-10 text-zinc-400" />
  </div>

  <div class="text-center">
    <div class="text-6xl font-bold tracking-[8px] text-white">TRACTATUS</div>
    <div class="text-[10px] tracking-[2px] text-emerald-400/70 mt-1">v{APP_VERSION}</div>
  </div>

  {#if !isSupabaseConfigured}
    <p class="max-w-sm text-[10px] leading-snug text-amber-400/90 border border-amber-900/50 bg-amber-950/30 rounded-lg px-3 py-2">
      Supabase is not configured. Set <code class="text-amber-200/90">PUBLIC_SUPABASE_URL</code> and
      <code class="text-amber-200/90">PUBLIC_SUPABASE_ANON_KEY</code> in Vercel, then redeploy.
    </p>
  {/if}

  <div class="auth-panel-card rounded-xl border border-[#1e1e1e] bg-[#141414] overflow-hidden">
    <div class="p-1 border-b border-[#1e1e1e] bg-[#111]">
      <div
        class="relative grid grid-cols-2 rounded border border-[#1e1e1e] bg-[#0a0a0a] p-0.5"
        role="group"
        aria-label="Authentication mode"
      >
        <div
          class="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-4px)] rounded bg-white transition-transform duration-200 ease-out"
          style="transform: translateX({authMode === 'signup' ? '0' : 'calc(100% + 4px)'})"
        ></div>
        <button
          type="button"
          class="relative z-10 h-9 flex items-center justify-center text-[10px] font-black tracking-[0.12em] transition-colors {authMode === 'signup' ? 'text-black' : 'text-zinc-500 hover:text-zinc-300'}"
          disabled={signingIn}
          onclick={() => setAuthMode('signup')}
        >
          SIGN UP
        </button>
        <button
          type="button"
          class="relative z-10 h-9 flex items-center justify-center text-[10px] font-black tracking-[0.12em] transition-colors {authMode === 'signin' ? 'text-black' : 'text-zinc-500 hover:text-zinc-300'}"
          disabled={signingIn}
          onclick={() => setAuthMode('signin')}
        >
          SIGN IN
        </button>
      </div>
    </div>

    <div class="p-3 text-left">
      <div class="relative mb-3 hidden" aria-hidden="true">
        <div class="flex justify-between gap-1.5 pointer-events-none select-none">
          <div
            class="relative overflow-hidden after:absolute after:inset-0 after:z-[1] after:bg-black/50 after:pointer-events-none after:content-[''] h-11 w-11 shrink-0 rounded-xl flex items-center justify-center bg-[#0a0a0a] text-zinc-400">
            <Mail class="size-5 relative z-0" />
          </div>
          <div
            class="relative overflow-hidden after:absolute after:inset-0 after:z-[1] after:bg-black/50 after:pointer-events-none after:content-[''] h-11 w-11 shrink-0 rounded-xl border border-[#30363d] flex items-center justify-center bg-[#24292f] text-white">
            <AuthBrandIcon brand="github" class="size-5 text-white relative z-0" />
          </div>
          <div
            class="relative overflow-hidden after:absolute after:inset-0 after:z-[1] after:bg-black/50 after:pointer-events-none after:content-[''] h-11 w-11 shrink-0 rounded-xl flex items-center justify-center bg-white">
            <AuthBrandIcon brand="google" class="size-5 relative z-0" />
          </div>
          <div
            class="relative overflow-hidden after:absolute after:inset-0 after:z-[1] after:bg-black/50 after:pointer-events-none after:content-[''] h-11 w-11 shrink-0 rounded-xl flex items-center justify-center bg-[#5865F2] text-white">
            <AuthBrandIcon brand="discord" class="size-5 text-white relative z-0" />
          </div>
          <div
            class="relative overflow-hidden after:absolute after:inset-0 after:z-[1] after:bg-black/50 after:pointer-events-none after:content-[''] h-11 w-11 shrink-0 rounded-xl flex items-center justify-center bg-black text-white">
            <AuthBrandIcon brand="x" class="size-5 text-white relative z-0" />
          </div>
        </div>
        <div
          class="absolute inset-0 z-10 flex items-center justify-center rounded-xl pointer-events-none px-1">
          <p
            class="text-[10px] font-black tracking-[0.1em] uppercase text-white text-center leading-tight"
            style="text-shadow: 0 0 2px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.55);">
            CURRENTLY UNDER DEVELOPMENT
          </p>
        </div>
      </div>

      <form
        class="flex flex-col gap-2.5"
        onsubmit={(e) => {
          e.preventDefault();
          if (signingIn || authError || authSuccess || !authSubmitReady) return;
          void handleUsernameAuth();
        }}>
        <div class="relative">
          <User class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            autocomplete="username"
            spellcheck="false"
            maxlength={MAX_USERNAME_LEN}
            bind:value={authUsername}
            disabled={signingIn}
            placeholder="username"
            class="h-11 w-full pl-10 pr-3 rounded-xl bg-[#0a0a0a] border border-[#1e1e1e] text-sm text-white placeholder:text-zinc-600 outline-none focus:border-zinc-500 disabled:opacity-60"
            oninput={(e) => {
              clearAuthFeedback();
              authUsername = sanitizeUsernameInput((e.currentTarget as HTMLInputElement).value);
            }}
          />
        </div>
        <div>
          <div class="relative">
            <Lock class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
            <input
              type="password"
              autocomplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              maxlength={MAX_PASSWORD_LEN}
              bind:value={authPassword}
              disabled={signingIn}
              placeholder="••••••••"
              class="h-11 w-full pl-10 pr-3 rounded-xl bg-[#0a0a0a] border border-[#1e1e1e] text-sm text-white placeholder:text-zinc-600 outline-none focus:border-zinc-500 disabled:opacity-60"
              oninput={(e) => {
                clearAuthFeedback();
                authPassword = sanitizePasswordInput((e.currentTarget as HTMLInputElement).value);
              }}
            />
          </div>
          <div
            class="auth-confirm-reveal"
            class:auth-confirm-reveal--open={authMode === 'signup'}
            aria-hidden={authMode !== 'signup'}
          >
            <div class="auth-confirm-reveal__inner">
              <div class="relative">
                <LockKeyhole class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none z-10" />
                <input
                  type="password"
                  autocomplete="new-password"
                  maxlength={MAX_PASSWORD_LEN}
                  bind:value={authConfirmPassword}
                  disabled={signingIn || authMode !== 'signup'}
                  placeholder=""
                  tabindex={authMode === 'signup' ? 0 : -1}
                  aria-label="Confirm password"
                  class="h-11 w-full pl-10 pr-3 rounded-xl bg-[#0a0a0a] border border-[#1e1e1e] text-sm text-white outline-none focus:border-zinc-500 disabled:opacity-60"
                  oninput={(e) => {
                    clearAuthFeedback();
                    authConfirmPassword = sanitizePasswordInput((e.currentTarget as HTMLInputElement).value);
                  }}
                />
                {#if authMode === 'signup' && !authConfirmPassword}
                  <span
                    class="absolute left-10 top-1/2 -translate-y-1/2 text-sm text-zinc-600 pointer-events-none select-none"
                    aria-hidden="true"
                  >••••••••</span>
                {/if}
              </div>
            </div>
          </div>
        </div>
        <div class="auth-submit-crossfade h-11 min-h-11">
          <button
            type="submit"
            class="auth-submit-crossfade__layer auth-submit-btn auth-submit-btn--default h-11 min-h-11 rounded-xl font-black text-[11px] tracking-[0.15em] flex items-center justify-center px-3 text-center leading-snug
              {authSubmitBtnLit ? 'auth-submit-crossfade__layer--lit auth-submit-crossfade__layer--interactive' : ''}
              {authFeedbackExiting ? 'auth-submit-crossfade__layer--top' : ''}"
            disabled={signingIn || authFeedbackLit || (!authSubmitReady && !authFeedbackExiting)}
            aria-hidden={!authSubmitBtnLit}
            aria-busy={signingIn}
            aria-label={signingIn ? 'Checking credentials' : authMode === 'signup' ? 'Sign up' : 'Sign in'}
            tabindex={authSubmitBtnLit ? 0 : -1}
          >
            {#if signingIn}
              <RefreshCw class="size-4 shrink-0 animate-spin" aria-hidden="true" />
            {:else}
              {authMode === 'signup' ? 'SIGN UP' : 'SIGN IN'}
            {/if}
          </button>
          {#if authCrossfadeShowFeedback}
            <div
              role="status"
              aria-live="polite"
              class="auth-submit-crossfade__layer auth-submit-btn auth-submit-btn--feedback h-11 min-h-11 rounded-xl font-black text-[11px] tracking-[0.15em] flex items-center justify-center px-3 text-center leading-snug
                {authError ? 'auth-submit-btn--error' : 'auth-submit-btn--success'}
                {authFeedbackLit ? 'auth-submit-crossfade__layer--lit auth-submit-crossfade__layer--top' : ''}
                {authError && authFeedbackLit ? 'auth-submit-btn--error-nudge' : ''}"
              title={authError ?? authSuccess ?? undefined}
              ontransitionend={onAuthCrossfadeTransitionEnd}
            >
              <span class="auth-submit-btn__feedback flex items-center gap-1.5 min-w-0 max-w-full">
                {#if authError}
                  <CircleAlert class="auth-submit-btn__icon size-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <CircleCheck class="auth-submit-btn__icon size-3.5 shrink-0" aria-hidden="true" />
                {/if}
                <span class="line-clamp-2 min-w-0">{authError ?? authSuccess}</span>
              </span>
            </div>
          {/if}
        </div>
      </form>
    </div>
  </div>
</div>