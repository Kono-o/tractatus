<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    CircleAlert,
    CircleCheck,
    Lock,
    LockKeyhole,
    RefreshCw,
    User,
  } from '@lucide/svelte';
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

  let { onAuthenticated, embedded = false }: { onAuthenticated?: () => void; embedded?: boolean } = $props();

  let signingIn = $state(false);
  let authError = $state<string | null>(null);
  let authSuccess = $state<string | null>(null);
  let authFeedbackExiting = $state(false);
  let authFeedbackEntering = $state(false);
  let authFeedbackExitTimer: ReturnType<typeof setTimeout> | null = null;
  const AUTH_FEEDBACK_CROSSFADE_MS = 240;

  let authMode = $state<'signin' | 'signup'>('signin');
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
        authMode = 'signin';
      }
    } catch {
      authMode = 'signin';
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
            'Account created. If sign-in fails, disable "Confirm email" in Supabase Auth settings (username accounts have no inbox).',
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

<div class="auth-screen" class:auth-screen--embedded={embedded}>
  {#if !embedded}
    <div class="auth-screen-hero">
      <h1 class="auth-screen-logo">Tractatus</h1>
      <p class="auth-screen-version">v{APP_VERSION}</p>
    </div>
  {/if}

  {#if !isSupabaseConfigured}
    <p class="auth-screen-alert">
      Supabase is not configured. Set <code>PUBLIC_SUPABASE_URL</code> and
      <code>PUBLIC_SUPABASE_ANON_KEY</code> in Vercel, then redeploy.
    </p>
  {/if}

  <div class="auth-panel-card auth-screen-card">
    <div class="auth-screen-card-header">
      <div class="auth-screen-mode" role="group" aria-label="Authentication mode">
        <div
          class="auth-screen-mode-pill"
          style="transform: translateX({authMode === 'signin' ? '0' : '100%'})"
        ></div>
        <button
          type="button"
          class="auth-screen-mode-btn"
          class:auth-screen-mode-btn--active={authMode === 'signin'}
          disabled={signingIn}
          onclick={() => setAuthMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          class="auth-screen-mode-btn"
          class:auth-screen-mode-btn--active={authMode === 'signup'}
          disabled={signingIn}
          onclick={() => setAuthMode('signup')}
        >
          Sign up
        </button>
      </div>
    </div>

    <div class="auth-screen-card-body">
      <form
        class="auth-screen-form"
        onsubmit={(e) => {
          e.preventDefault();
          if (signingIn || authError || authSuccess || !authSubmitReady) return;
          void handleUsernameAuth();
        }}
      >
        <div class="auth-screen-field">
          <User class="auth-screen-field-icon" aria-hidden="true" />
          <input
            type="text"
            autocomplete="username"
            spellcheck="false"
            maxlength={MAX_USERNAME_LEN}
            bind:value={authUsername}
            disabled={signingIn}
            placeholder="username"
            class="auth-screen-input"
            oninput={(e) => {
              clearAuthFeedback();
              authUsername = sanitizeUsernameInput((e.currentTarget as HTMLInputElement).value);
            }}
          />
        </div>

        <div class="auth-screen-field-group">
          <div class="auth-screen-field">
            <Lock class="auth-screen-field-icon" aria-hidden="true" />
            <input
              type="password"
              autocomplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              maxlength={MAX_PASSWORD_LEN}
              bind:value={authPassword}
              disabled={signingIn}
              placeholder="••••••••"
              class="auth-screen-input"
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
              <div class="auth-screen-field">
                <LockKeyhole class="auth-screen-field-icon" aria-hidden="true" />
                <input
                  type="password"
                  autocomplete="new-password"
                  maxlength={MAX_PASSWORD_LEN}
                  bind:value={authConfirmPassword}
                  disabled={signingIn || authMode !== 'signup'}
                  placeholder=""
                  tabindex={authMode === 'signup' ? 0 : -1}
                  aria-label="Confirm password"
                  class="auth-screen-input"
                  oninput={(e) => {
                    clearAuthFeedback();
                    authConfirmPassword = sanitizePasswordInput((e.currentTarget as HTMLInputElement).value);
                  }}
                />
                {#if authMode === 'signup' && !authConfirmPassword}
                  <span class="auth-screen-input-ghost" aria-hidden="true">••••••••</span>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <div class="auth-submit-crossfade auth-screen-submit-crossfade">
          <button
            type="submit"
            class="auth-submit-crossfade__layer auth-submit-btn auth-screen-submit
              {authSubmitBtnLit ? 'auth-submit-crossfade__layer--lit auth-submit-crossfade__layer--interactive auth-screen-submit--ready' : ''}
              {authFeedbackExiting ? 'auth-submit-crossfade__layer--top' : ''}"
            disabled={signingIn || authFeedbackLit || (!authSubmitReady && !authFeedbackExiting)}
            aria-hidden={!authSubmitBtnLit}
            aria-busy={signingIn}
            aria-label={signingIn ? 'Checking credentials' : authMode === 'signup' ? 'Sign up' : 'Sign in'}
            tabindex={authSubmitBtnLit ? 0 : -1}
          >
            {#if signingIn}
              <RefreshCw class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            {:else}
              {authMode === 'signup' ? 'SIGN UP' : 'SIGN IN'}
            {/if}
          </button>
          {#if authCrossfadeShowFeedback}
            <div
              role="status"
              aria-live="polite"
              class="auth-submit-crossfade__layer auth-submit-btn auth-submit-btn--feedback auth-screen-submit
                {authError ? 'auth-screen-submit--error' : 'auth-screen-submit--success'}
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
