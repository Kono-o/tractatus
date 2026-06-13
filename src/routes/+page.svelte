<script lang="ts">
  import { onMount, tick } from 'svelte';
  import GeneratedAvatar from '$lib/components/GeneratedAvatar.svelte';
  import {
    db,
    supabase,
    validateUsername,
    validatePassword,
    getAuthDisplayName,
    isUsernameAccount,
    canChangePassword,
    formatAccountError,
    formatAuthError,
    MAX_PASSWORD_LEN,
    MAX_USERNAME_LEN,
    sanitizePasswordInput,
    sanitizeUsernameInput,
  } from '$lib/db';
  import AuthScreen from '$lib/components/AuthScreen.svelte';
  // IMPORTANT: updater (and thus all @capacitor/* modules) must NOT be statically imported.
  // Static imports of native-only code cause 500 Internal Server Errors during SSR on Vercel.
  // We use dynamic import() only from client-side code (onMount + event handlers).
  import type { UpdateInfo } from '$lib/updater';
  import { APP_VERSION } from '$lib/version';
  import { isNativeApp } from '$lib/native';
  import type { User as SupabaseUser } from '@supabase/supabase-js';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import confetti from 'canvas-confetti';
  import {
    loadSupabasePanelSnapshot,
    formatSupabaseLatencyMs,
    formatSessionExpiry,
    type SupabasePanelSnapshot,
  } from '$lib/supabaseStatus';
  import HeaderClock from '$lib/components/HeaderClock.svelte';
  import {
    Check,
    CircleAlert,
    CircleCheck,
    Lock,
    LockKeyhole,
    LogOut,
    Pencil,
    RefreshCw,
    Trash2,
    X,
  } from '@lucide/svelte';

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function getISOWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  function focusExerciseNameInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
  const SIGN_OUT_HOLD_MS = 2000;
  const DELETE_ACCOUNT_HOLD_MS = 4000;
  const AUTH_FEEDBACK_CROSSFADE_MS = 240;

  function renderChangelog(text: string): string {
    if (!text) return '';
    if (typeof window === 'undefined' || typeof DOMPurify === 'undefined') {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
    const rawHtml = marked.parse(text, { breaks: true, gfm: true }) as string;
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'],
    });
  }

  let currentUser = $state<SupabaseUser | null>(null);
  let isAuthLoading = $state(true);
  let isLoading = $state(false);
  let hasInitialLoad = $state(false);
  let bootMessage = $state('Checking session…');
  let showBootScreen = $derived(currentUser !== null && (isAuthLoading || isLoading));
  let bootOverlayVisible = $state(false);
  let bootOverlayExiting = $state(false);
  let bootAccountReveal = $state(false);
  let stageRevealActive = $state(true);
  const BOOT_ACCOUNT_REVEAL_HOLD_MS = 900;

  // Account / settings panel (ported from Lift Tracker)
  let showSettingsPanel = $state(false);
  let supabasePanel = $state<SupabasePanelSnapshot | null>(null);
  let supabasePanelLoading = $state(false);
  let avatarSeed = $state<string | null>(null);
  let avatarShuffleCooldown = $state(false);

  let accountBusy = $state(false);
  let accountError = $state<string | null>(null);
  let editingAccountName = $state(false);
  let accountNameEditValue = $state('');
  let showChangePasswordForm = $state(false);
  let changePasswordNew = $state('');
  let changePasswordConfirm = $state('');
  let changePasswordError = $state<string | null>(null);
  let changePasswordSuccess = $state<string | null>(null);
  let changePasswordFeedbackExiting = $state(false);
  let changePasswordFeedbackEntering = $state(false);
  let changePasswordFeedbackExitTimer: ReturnType<typeof setTimeout> | null = null;

  let dbIoFlash = $state(false);
  let dbIoFlashTimer: ReturnType<typeof setTimeout> | null = null;

  let signOutHoldTimer: ReturnType<typeof setInterval> | null = null;
  let signOutProgress = $state(0);
  let signOutTapPulseActive = $state(false);
  let deleteAccountHoldTimer: ReturnType<typeof setInterval> | null = null;
  let deleteAccountProgress = $state(0);
  let deleteAccountTapPulseActive = $state(false);

  let holdCautionDisplayKind = $state<'signout' | 'delete' | null>(null);
  let holdCautionMorphFade = $state(true);

  // Self-update (Android sideload only). Mirrors settings panel UX: centered + blur.
  let showUpdatePrompt = $state(false);
  let updateInfo = $state<UpdateInfo | null>(null);
  let updateDownloadProgress = $state(0);
  let updateInstalling = $state(false);
  let updateError = $state<string | null>(null);
  let downloadedApkPath = $state<string | null>(null);

  let isWaitingForUpdatePermission = $derived(
    updateInstalling &&
    updateDownloadProgress === 0 &&
    !!updateError &&
    /unknown|permission|Install unknown apps/i.test(updateError),
  );

  let showPostUpdate = $state(false);
  let postUpdateVersion = $state('');
  let postUpdateNotes = $state('');
  let didRunStartupUpdateCheck = $state(false);

  $effect(() => {
    if (showPostUpdate) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      confetti({ particleCount: 50, angle: 90, spread: 50, origin: { y: 0.6 } });
    }
  });

  $effect(() => {
    if (showUpdatePrompt && !isNativeApp()) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      confetti({ particleCount: 50, angle: 90, spread: 50, origin: { y: 0.6 } });
    }
  });

  // Lazy loader for updater. Called only from client code (onMount, click handlers).
  // This keeps @capacitor/* and native code out of the SSR module graph.
  let _updaterMod: typeof import('$lib/updater') | null = null;
  async function getUpdater() {
    if (!_updaterMod) {
      _updaterMod = await import('$lib/updater');
    }
    return _updaterMod;
  }

  function onBootOverlayTransitionEnd(e: TransitionEvent) {
    if (e.propertyName !== 'opacity' || !bootOverlayExiting) return;
    bootOverlayVisible = false;
    bootOverlayExiting = false;
    bootAccountReveal = false;
  }

  $effect(() => {
    if (showBootScreen) {
      bootOverlayVisible = true;
      bootOverlayExiting = false;
      bootAccountReveal = false;
      return;
    }
    let cancelled = false;
    let revealHoldTimer: ReturnType<typeof setTimeout> | undefined;
    let exitFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    bootAccountReveal = false;

    if (!currentUser) {
      bootOverlayVisible = false;
      bootOverlayExiting = false;
      void tick().then(() => {
        if (cancelled) return;
        stageRevealActive = true;
      });
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      await tick();
      if (cancelled) return;
      await preloadSupabaseBackend();
      if (cancelled) return;
      stageRevealActive = true;
      bootAccountReveal = true;
      revealHoldTimer = setTimeout(() => {
        if (cancelled) return;
        bootOverlayExiting = true;
        exitFallbackTimer = setTimeout(() => {
          if (cancelled || !bootOverlayExiting) return;
          bootOverlayVisible = false;
          bootOverlayExiting = false;
          bootAccountReveal = false;
        }, 340);
      }, BOOT_ACCOUNT_REVEAL_HOLD_MS);
    })();

    return () => {
      cancelled = true;
      if (revealHoldTimer) clearTimeout(revealHoldTimer);
      if (exitFallbackTimer) clearTimeout(exitFallbackTimer);
    };
  });

  async function loadAppData() {
    if (!currentUser) return;
    const isInitial = !hasInitialLoad;
    if (isInitial) {
      isLoading = true;
      bootMessage = 'Loading your account…';
    }
    try {
      bootMessage = 'Syncing backend…';
      await Promise.all([loadAvatarSeed(), preloadSupabaseBackend()]);
      if (isInitial) bootMessage = 'Almost ready…';
    } catch (e) {
      console.error(e);
      if (isInitial) bootMessage = 'Sync failed — retrying when ready…';
    } finally {
      isLoading = false;
      hasInitialLoad = true;
    }
  }

  async function runStartupUpdateCheck() {
    if (didRunStartupUpdateCheck) return;
    if (!isNativeApp() || !currentUser) return;
    if (!hasInitialLoad || !stageRevealActive || isLoading || bootOverlayVisible || showBootScreen) return;
    didRunStartupUpdateCheck = true;

    setTimeout(() => {
      void (async () => {
        try {
          const u = await getUpdater();
          const post = await u.checkForPostUpdateChangelog();
          if (post && !showUpdatePrompt) {
            postUpdateVersion = post.version;
            postUpdateNotes = post.notes ?? '';
            showPostUpdate = true;
            return;
          }

          const info = await u.shouldShowUpdatePrompt();
          if (info) {
            updateInfo = info;
            updateDownloadProgress = 0;
            updateInstalling = false;
            updateError = null;
            downloadedApkPath = null;
            showUpdatePrompt = true;
          }
        } catch (e) {
          console.error('[updater] startup check failed (non-fatal)', e);
        }
      })();
    }, 250);
  }

  onMount(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      void (async () => {
        if (session?.user) {
          const { data: { user }, error } = await supabase.auth.getUser();
          if (error || !user) {
            currentUser = null;
            if (error) await supabase.auth.signOut();
          } else {
            currentUser = user;
          }
        } else {
          currentUser = null;
        }

        if (
          event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'SIGNED_OUT' ||
          event === 'TOKEN_REFRESHED'
        ) {
          isAuthLoading = false;
        }

        if (currentUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
          if (!hasInitialLoad) {
            bootMessage = 'Welcome back — loading data…';
            void loadAppData();
          }
        }

        if (!currentUser && (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION')) {
          hasInitialLoad = false;
          isLoading = false;
          supabasePanel = null;
          bootMessage = 'Checking session…';
        }
      })();
    });

    void (async () => {
      try {
        await supabase.auth.getSession();
      } catch (e) {
        console.error('getSession failed', e);
        isAuthLoading = false;
      }
    })();

    if (isNativeApp()) {
      void (async () => {
        const w = (typeof window !== 'undefined' ? (window as any) : {}) as any;
        if (!w.__TRACTATUS_UPDATER_RESUME_LISTENER) {
          w.__TRACTATUS_UPDATER_RESUME_LISTENER = true;
          const { App } = await import('@capacitor/app');
          App.addListener('resume', () => {
            if (
              showUpdatePrompt &&
              updateInstalling &&
              updateError &&
              /unknown|permission|Install unknown apps/i.test(updateError) &&
              !downloadedApkPath
            ) {
              setTimeout(() => {
                if (showUpdatePrompt && updateInstalling && !downloadedApkPath) {
                  void startUpdateInstall();
                }
              }, 220);
            }
          }).catch(() => {});
        }
      })();
    }

    return () => {
      subscription.unsubscribe();
    };
  });

  $effect(() => {
    if (currentUser && hasInitialLoad && stageRevealActive && !bootOverlayVisible && !showBootScreen && !didRunStartupUpdateCheck) {
      void runStartupUpdateCheck();
    }
  });

  function closeUpdatePrompt() {
    if (updateInstalling) return;
    if (updateInfo) {
      void getUpdater().then((u) => u.dismissUpdateThisLaunch(updateInfo!.version));
    }
    showUpdatePrompt = false;
  }

  function resetUpdateUi() {
    showUpdatePrompt = false;
    updateInfo = null;
    updateDownloadProgress = 0;
    updateInstalling = false;
    updateError = null;
    downloadedApkPath = null;
  }

  async function startUpdateInstall() {
    if (!updateInfo) return;
    if (updateInstalling && !updateError) return;

    const u = await getUpdater();
    updateError = null;
    updateInstalling = true;
    if (!downloadedApkPath) {
      updateDownloadProgress = 0;
    }

    if (!isNativeApp()) {
      try {
        const link = document.createElement('a');
        link.href = updateInfo.downloadUrl;
        link.download = `tractatus-v${updateInfo.version}.apk`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        await new Promise((r) => setTimeout(r, 750));
        updateDownloadProgress = 0;
        for (let p = 0; p <= 100; p += 5) {
          updateDownloadProgress = p;
          await new Promise((r) => setTimeout(r, 70));
        }
        updateDownloadProgress = 100;
        setTimeout(() => {
          updateInstalling = false;
          downloadedApkPath = null;
        }, 150);
      } catch {
        updateError = 'Could not start download. Please visit the releases page manually.';
        updateInstalling = false;
        downloadedApkPath = null;
      }
      return;
    }

    try {
      const canInstallFn = (u.UpdaterNative as any).canInstallFromUnknownSources;
      let canInstall = true;
      if (typeof canInstallFn === 'function') {
        const res = await canInstallFn();
        canInstall = !!res?.canInstall;
      }
      if (!canInstall) {
        updateError = 'Tractatus needs permission to install updates from unknown sources.';
        updateInstalling = true;
        updateDownloadProgress = 0;
        downloadedApkPath = null;
        try {
          await u.openInstallPermissionSettings();
        } catch {}
        return;
      }
    } catch (permErr) {
      console.warn('[updater] permission pre-check failed, will let installApk enforce it', permErr);
    }

    if (downloadedApkPath) {
      try {
        await u.promptInstallApk(downloadedApkPath);
      } catch (e: any) {
        const msg = String(e?.message || e || 'Install failed');
        if (msg.includes('permission_required')) {
          updateError = 'Please allow "Install unknown apps" for Tractatus in the settings screen, then return here and tap INSTALL.';
          try {
            await u.openInstallPermissionSettings();
          } catch {}
        } else {
          updateError = msg;
          updateInstalling = false;
          downloadedApkPath = null;
        }
      }
      return;
    }

    await new Promise((r) => setTimeout(r, 750));

    try {
      const progressListener = (data: { progress?: number }) => {
        if (data.progress != null) {
          updateDownloadProgress = Math.min(100, Math.max(0, data.progress));
        }
      };
      u.UpdaterNative.addListener('downloadProgress', progressListener);

      const result = await u.UpdaterNative.downloadUpdate({
        url: updateInfo.downloadUrl,
        expectedSize: updateInfo.size || 0,
      });

      downloadedApkPath = result.path;

      try {
        u.UpdaterNative.removeListener('downloadProgress', progressListener);
      } catch {
        u.UpdaterNative.removeAllListeners('downloadProgress');
      }

      updateDownloadProgress = 100;
      await u.promptInstallApk(result.path);
    } catch (e: any) {
      const msg = String(e?.message || e || 'Update failed');
      if (msg.includes('permission_required')) {
        updateError = 'Please allow "Install unknown apps" for Tractatus in the settings screen, then return here and tap INSTALL.';
        try {
          await u.openInstallPermissionSettings();
        } catch {}
      } else if (msg.toLowerCase().includes('parsing') || msg.toLowerCase().includes('corrupted') || msg.toLowerCase().includes('size mismatch')) {
        updateError = msg + ' Tap "Download manually from GitHub" below as a fallback.';
        updateInstalling = false;
        downloadedApkPath = null;
      } else {
        updateError = msg;
        updateInstalling = false;
        downloadedApkPath = null;
      }
    }
  }

  function closePostUpdate() {
    showPostUpdate = false;
  }

  function openGitHubReleases() {
    const url = updateInfo?.tag
      ? `https://github.com/Kono-o/tractatus/releases/tag/${updateInfo.tag}`
      : 'https://github.com/Kono-o/tractatus/releases';
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
  }

  function handleAuthSuccess() {
    didRunStartupUpdateCheck = false;
  }

  let accountDisplayName = $derived(getAuthDisplayName(currentUser));
  let accountCanChangePassword = $derived(canChangePassword(currentUser));
  let accountMemberSince = $derived.by(() => {
    const raw = currentUser?.created_at;
    if (!raw) return '—';
    return new Date(raw).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  });

  let headerBarLabel = $derived.by(() => {
    const now = new Date();
    const umons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const nice = `${now.getDate()} ${umons[now.getMonth()]} ${now.getFullYear()}`;
    const week = getISOWeekNumber(now);
    return `${nice} · ${DAY_NAMES[now.getDay()].toUpperCase()} · W${week}`;
  });

  let changePasswordFeedbackVisible = $derived(!!(changePasswordError || changePasswordSuccess));
  let changePasswordCrossfadeShowFeedback = $derived(
    changePasswordFeedbackVisible || changePasswordFeedbackExiting,
  );
  let changePasswordSubmitBtnLit = $derived(
    !changePasswordFeedbackVisible ||
      changePasswordFeedbackExiting ||
      changePasswordFeedbackEntering,
  );
  let changePasswordFeedbackLit = $derived(
    changePasswordFeedbackVisible &&
      !changePasswordFeedbackExiting &&
      !changePasswordFeedbackEntering,
  );
  let changePasswordSubmitReady = $derived(
    !!changePasswordNew && !!changePasswordConfirm,
  );

  let holdCautionKind = $derived.by((): 'signout' | 'delete' | null => {
    if (deleteAccountProgress > 0) return 'delete';
    if (signOutProgress > 0) return 'signout';
    return null;
  });
  let holdCautionMessage = $derived(
    holdCautionDisplayKind === 'delete'
      ? 'Permanently deletes your account and all data.'
      : holdCautionDisplayKind === 'signout'
        ? 'Ends your session on this device.'
        : '',
  );

  $effect(() => {
    const kind = holdCautionKind;
    if (kind) {
      holdCautionMorphFade = false;
      holdCautionDisplayKind = kind;
    } else if (holdCautionDisplayKind) {
      holdCautionMorphFade = true;
      holdCautionDisplayKind = null;
    }
  });

  // === Ported account / supabase panel logic (adapted, no Lift-specific workout data) ===
  async function loadAvatarSeed() {
    if (!currentUser) {
      avatarSeed = null;
      return;
    }
    try {
      avatarSeed = await db.getAvatarSeed();
    } catch {
      avatarSeed = null;
    }
  }

  function flashDbIoIndicator() {
    dbIoFlash = true;
    if (dbIoFlashTimer) clearTimeout(dbIoFlashTimer);
    dbIoFlashTimer = setTimeout(() => {
      dbIoFlash = false;
      dbIoFlashTimer = null;
    }, 100);
  }

  function shuffleAvatarSeed() {
    if (!currentUser || avatarShuffleCooldown) return;
    avatarShuffleCooldown = true;
    const newSeed = Math.random().toString(36).slice(2, 10);
    avatarSeed = newSeed;
    void db.saveAvatarSeed(newSeed).catch((e) => console.warn('avatar seed save failed', e));
    setTimeout(() => {
      avatarShuffleCooldown = false;
    }, 50);
  }

  async function preloadSupabaseBackend() {
    const showLoading = supabasePanel === null;
    if (showLoading) supabasePanelLoading = true;
    try {
      supabasePanel = await loadSupabasePanelSnapshot();
    } catch (e) {
      console.warn('[supabase] preload failed', e);
    } finally {
      if (showLoading) supabasePanelLoading = false;
    }
  }

  async function refreshSupabasePanel() {
    supabasePanelLoading = true;
    try {
      supabasePanel = await loadSupabasePanelSnapshot();
      flashDbIoIndicator();
    } catch (e) {
      console.warn('[supabase] panel refresh failed', e);
    } finally {
      supabasePanelLoading = false;
    }
  }

  function openSettingsPanel() {
    accountError = null;
    editingAccountName = false;
    accountNameEditValue = '';
    stopSignOutHold();
    stopDeleteAccountHold();
    showSettingsPanel = true;
    if (!supabasePanel) {
      void refreshSupabasePanel();
    }
    if (currentUser) void loadAvatarSeed();
  }

  function closeSettingsPanel() {
    if (accountBusy) return;
    resetSettingsPanelUi();
  }

  function beginAccountNameEdit() {
    if (!isUsernameAccount(currentUser) || accountBusy || editingAccountName) return;
    accountError = null;
    accountNameEditValue = getAuthDisplayName(currentUser);
    editingAccountName = true;
  }

  function cancelAccountNameEdit() {
    editingAccountName = false;
    accountNameEditValue = '';
  }

  async function commitAccountNameEdit() {
    if (!currentUser || !isUsernameAccount(currentUser) || accountBusy) {
      editingAccountName = false;
      return;
    }
    const newName = accountNameEditValue.trim();
    const current = getAuthDisplayName(currentUser);
    if (!newName || newName === current) {
      editingAccountName = false;
      return;
    }
    const validation = validateUsername(newName);
    if (validation) {
      accountError = validation;
      editingAccountName = false;
      return;
    }
    accountBusy = true;
    accountError = null;
    try {
      await db.renameUsername(newName);
      // refresh user
      const refreshed = await db.getCurrentUser();
      if (refreshed) {
        // note: in full app we'd update a shared currentUser, here we trigger re-load in parent effect if needed
        // for simplicity re-assign
        currentUser = refreshed as any;
      }
      await db.saveAvatarSeed(avatarSeed); // preserve seed on rename
    } catch (e: any) {
      accountError = formatAccountError(e);
    } finally {
      accountBusy = false;
      editingAccountName = false;
      accountNameEditValue = '';
    }
  }

  function finishChangePasswordFeedbackExit() {
    if (changePasswordFeedbackExitTimer) {
      clearTimeout(changePasswordFeedbackExitTimer);
      changePasswordFeedbackExitTimer = null;
    }
    changePasswordError = null;
    changePasswordSuccess = null;
    changePasswordFeedbackExiting = false;
    changePasswordFeedbackEntering = false;
  }

  async function setChangePasswordError(message: string | null) {
    finishChangePasswordFeedbackExit();
    changePasswordError = message;
    if (message) {
      changePasswordSuccess = null;
      changePasswordFeedbackEntering = true;
      await tick();
      changePasswordFeedbackEntering = false;
    }
  }

  async function setChangePasswordSuccess(message: string | null) {
    finishChangePasswordFeedbackExit();
    changePasswordSuccess = message;
    if (message) {
      changePasswordError = null;
      changePasswordFeedbackEntering = true;
      await tick();
      changePasswordFeedbackEntering = false;
    }
  }

  async function clearChangePasswordFeedback() {
    if (!changePasswordError && !changePasswordSuccess) return;
    if (changePasswordFeedbackExiting) return;
    changePasswordFeedbackExiting = true;
    await tick();
    changePasswordFeedbackExitTimer = setTimeout(
      finishChangePasswordFeedbackExit,
      AUTH_FEEDBACK_CROSSFADE_MS + 20,
    );
  }

  function onChangePasswordCrossfadeTransitionEnd(e: TransitionEvent) {
    if (e.propertyName !== 'opacity' || !changePasswordFeedbackExiting) return;
    finishChangePasswordFeedbackExit();
  }

  function resetChangePasswordForm() {
    showChangePasswordForm = false;
    changePasswordNew = '';
    changePasswordConfirm = '';
    finishChangePasswordFeedbackExit();
  }

  function toggleChangePasswordForm() {
    if (accountBusy) return;
    if (showChangePasswordForm) {
      resetChangePasswordForm();
      return;
    }
    finishChangePasswordFeedbackExit();
    showChangePasswordForm = true;
  }

  function resetSettingsPanelUi() {
    showSettingsPanel = false;
    editingAccountName = false;
    accountNameEditValue = '';
    stopSignOutHold();
    stopDeleteAccountHold();
    holdCautionDisplayKind = null;
    holdCautionMorphFade = true;
    resetChangePasswordForm();
    accountError = null;
  }

  function pulseSignOutTapFlash() {
    signOutTapPulseActive = false;
    requestAnimationFrame(() => {
      signOutTapPulseActive = true;
    });
  }

  function pulseDeleteAccountTapFlash() {
    deleteAccountTapPulseActive = false;
    requestAnimationFrame(() => {
      deleteAccountTapPulseActive = true;
    });
  }

  function onSignOutTapPulseEnd(e: AnimationEvent) {
    if (e.animationName === 'hold-skip-tap-pulse') signOutTapPulseActive = false;
  }

  function onDeleteAccountTapPulseEnd(e: AnimationEvent) {
    if (e.animationName === 'hold-cancel-tap-pulse') deleteAccountTapPulseActive = false;
  }

  function startSignOutHold(e: Event) {
    if (e.cancelable) e.preventDefault();
    if (accountBusy) return;
    pulseSignOutTapFlash();
    const startTime = Date.now();
    signOutHoldTimer = setInterval(() => {
      signOutProgress = Math.min(((Date.now() - startTime) / SIGN_OUT_HOLD_MS) * 100, 100);
      if (signOutProgress >= 100) {
        clearInterval(signOutHoldTimer!);
        signOutHoldTimer = null;
        signOutProgress = 0;
        void handleSignOut();
      }
    }, 20);
  }

  function stopSignOutHold() {
    if (signOutHoldTimer) clearInterval(signOutHoldTimer);
    signOutHoldTimer = null;
    signOutProgress = 0;
    signOutTapPulseActive = false;
  }

  function startDeleteAccountHold(e: Event) {
    if (e.cancelable) e.preventDefault();
    if (accountBusy) return;
    pulseDeleteAccountTapFlash();
    const startTime = Date.now();
    deleteAccountHoldTimer = setInterval(() => {
      deleteAccountProgress = Math.min(((Date.now() - startTime) / DELETE_ACCOUNT_HOLD_MS) * 100, 100);
      if (deleteAccountProgress >= 100) {
        clearInterval(deleteAccountHoldTimer!);
        deleteAccountHoldTimer = null;
        deleteAccountProgress = 0;
        void handleDeleteAccount();
      }
    }, 20);
  }

  function stopDeleteAccountHold() {
    if (deleteAccountHoldTimer) clearInterval(deleteAccountHoldTimer);
    deleteAccountHoldTimer = null;
    deleteAccountProgress = 0;
    deleteAccountTapPulseActive = false;
  }

  async function handleChangePassword() {
    if (
      accountBusy ||
      !accountCanChangePassword ||
      changePasswordFeedbackLit ||
      !changePasswordSubmitReady
    ) {
      return;
    }

    const passwordErr = validatePassword(changePasswordNew);
    if (passwordErr) {
      setChangePasswordError(passwordErr);
      return;
    }
    if (changePasswordNew !== changePasswordConfirm) {
      setChangePasswordError('Passwords do not match.');
      return;
    }

    accountBusy = true;
    finishChangePasswordFeedbackExit();
    await tick();
    try {
      const { error } = await supabase.auth.updateUser({ password: changePasswordNew });
      if (error) throw error;
      changePasswordNew = '';
      changePasswordConfirm = '';
      setChangePasswordSuccess('Password updated.');
    } catch (e) {
      console.error('Change password failed', e);
      setChangePasswordError(formatAuthError(e));
    } finally {
      accountBusy = false;
    }
  }

  async function handleSignOut() {
    if (accountBusy) return;
    accountBusy = true;
    accountError = null;
    resetSettingsPanelUi();
    try {
      await db.signOut();
      currentUser = null;
      avatarSeed = null;
    } catch (e) {
      console.error('Sign out failed', e);
      accountError = formatAuthError(e);
    } finally {
      accountBusy = false;
    }
  }

  async function handleDeleteAccount() {
    if (accountBusy || !currentUser) return;
    accountBusy = true;
    accountError = null;
    stopDeleteAccountHold();
    try {
      const res = await fetch('/api/delete-account', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Delete failed');
      }
      currentUser = null;
      resetSettingsPanelUi();
      avatarSeed = null;
    } catch (e) {
      console.error('Delete account failed', e);
      accountError = formatAccountError(e);
    } finally {
      accountBusy = false;
    }
  }

  async function manuallyOpenUpdateMenu() {
    try {
      const u = await getUpdater();
      const release = await u.fetchLatestRelease();
      const info = release ? u.releaseToUpdateInfo(release) : null;

      if (info) {
        updateInfo = info;
      } else {
        updateInfo = {
          version: '0.0.2',
          notes: 'Demo of the update menu (triggered from the website footer).\n\nIn the real Android app this appears automatically after sign-in when a newer GitHub release is detected.',
          downloadUrl: 'https://github.com/Kono-o/tractatus/releases/download/v0.0.2/tractatus-v0.0.2.apk',
          apiAssetUrl: 'https://github.com/Kono-o/tractatus/releases/download/v0.0.2/tractatus-v0.0.2.apk',
          size: 1200000,
          tag: 'v0.0.2',
        };
      }
      updateDownloadProgress = 0;
      updateInstalling = false;
      updateError = null;
      downloadedApkPath = null;
      showUpdatePrompt = true;
    } catch (e) {
      console.error('[updater] manual open failed to fetch:', e);
      updateInfo = {
        version: '0.0.2',
        notes: 'Demo of the update menu (triggered from the website footer). Fetch failed — see console for details.',
        downloadUrl: 'https://github.com/Kono-o/tractatus/releases/download/v0.0.2/tractatus-v0.0.2.apk',
        apiAssetUrl: 'https://github.com/Kono-o/tractatus/releases/download/v0.0.2/tractatus-v0.0.2.apk',
        size: 1200000,
        tag: 'v0.0.2',
      };
      updateDownloadProgress = 0;
      updateInstalling = false;
      updateError = null;
      downloadedApkPath = null;
      showUpdatePrompt = true;
    }
  }

  function manuallyOpenPostUpdateMenu() {
    postUpdateVersion = APP_VERSION;
    postUpdateNotes = '- Full auto-update support for the sideloaded Android APK\n- Update check after sign-in when a newer GitHub release is detected\n- Centered blur update prompt (matches account/settings style)\n- "Install" is unclosable during download + shows real-time progress\n- Permission check for unknown sources happens *before* downloading\n- Reliable native download (HttpURLConnection + verification)\n- Post-update "what\'s new" changelog popup on first launch\n- Stable signing key across releases';
    showPostUpdate = true;
  }

  // Load avatar seed when user signs in
  $effect(() => {
    if (currentUser) {
      void loadAvatarSeed();
    } else {
      avatarSeed = null;
    }
  });
</script>

{#snippet writingsChip(ghost = false, reveal = false)}
  <div
    class="mt-1 mb-2"
    class:boot-panel-reveal-item={reveal}
    class:boot-panel-reveal-item--chips={reveal}
    aria-hidden={ghost}
  >
    <div class="flex justify-center text-[9px] text-zinc-400">
      <span
        class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#1e1e1e] rounded border border-[#2a2a2a] justify-center"
        class:boot-panel-placeholder={ghost}
      >
        <Pencil class="size-3 shrink-0 {ghost ? 'boot-panel-placeholder__ghost' : ''}" aria-hidden="true" />
        <span class="leading-none {ghost ? 'boot-panel-placeholder__ghost' : ''}">0 writings</span>
      </span>
    </div>
  </div>
{/snippet}

{#snippet bootScreen()}
  {@const panel = supabasePanel}
  <div
    class="settings-panel-dialog boot-panel-dialog rounded-xl border border-[#1e1e1e] bg-[#141414] shadow-xl overflow-hidden text-left"
    class:boot-panel-reveal--active={bootAccountReveal}
    role="status"
    aria-live="polite"
    aria-busy={!bootAccountReveal}
    aria-label={bootAccountReveal ? 'Account ready' : bootMessage}
  >
    <div class="settings-panel-header">
      <div class="settings-panel-header__title">
        <div class="settings-panel-brand" aria-hidden="true">
          <span class="settings-panel-brand__lift">TRACTATUS</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="settings-panel-header__supabase" aria-hidden="true">
          <span class="settings-panel-header__supabase-label">Supabase</span>
          <span class="settings-panel-header__dot-wrap">
            <span
              class="db-io-dot settings-panel-header__dot"
              class:db-io-dot--active={bootAccountReveal && !!panel && panel.health.ok && panel.sessionOk}
              class:boot-panel-dot-pulse={!bootAccountReveal}
            ></span>
          </span>
          <span
            class="settings-panel-header__latency"
            class:boot-panel-reveal-item={bootAccountReveal}
            class:boot-panel-reveal-item--header={bootAccountReveal}
          >
            {#if bootAccountReveal && panel?.health.latencyMs != null}
              {formatSupabaseLatencyMs(panel.health.latencyMs)}
            {:else if bootAccountReveal}
              —
            {:else}
              …
            {/if}
          </span>
        </div>
        <button
          type="button"
          class="settings-panel-header__close"
          disabled
          aria-hidden="true"
          tabindex="-1"
        >
          <X class="size-3.5" />
        </button>
      </div>
    </div>

    <div class="settings-panel-body text-[10px] leading-snug">
      {#if bootAccountReveal && currentUser && panel}
        <div class="flex justify-center py-1 boot-panel-reveal-item boot-panel-reveal-item--avatar">
          {#key avatarSeed}
            <GeneratedAvatar userId={currentUser.id} seed={avatarSeed} size={80} />
          {/key}
        </div>

        <div class="settings-panel-stats">
          <div class="settings-panel-header__identity boot-panel-reveal-item boot-panel-reveal-item--identity">
            <span class="settings-panel-header__name">{accountDisplayName}</span>
            <span class="text-[10px] text-zinc-500">joined {accountMemberSince}</span>
            <span class="text-[10px] text-zinc-500">Session: {formatSessionExpiry(panel.expiresAt)}</span>
            <span class="settings-panel-header__user-id" title={currentUser.id}>{currentUser.id}</span>
          </div>

          {@render writingsChip(false, true)}

          {#if panel.health.error || panel.sessionError}
            <p class="settings-panel-alert boot-panel-reveal-item boot-panel-reveal-item--chips">
              {panel.sessionError ?? panel.health.error}
            </p>
          {/if}
        </div>

        <div class="settings-panel-account boot-panel-reveal-item boot-panel-reveal-item--actions">
          {#if accountCanChangePassword}
            <div class="settings-panel-password">
              <div class="settings-panel-action-btn settings-panel-action-btn--full settings-panel-action-btn--change-password">
                <span class="settings-panel-action-btn__label">
                  <LockKeyhole class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                  CHANGE PASSWORD
                </span>
              </div>
            </div>
          {/if}

          <div class="settings-panel-actions-reveal settings-panel-actions-reveal--open">
            <div class="settings-panel-actions-reveal__inner">
              <div class="settings-panel-actions">
                <div class="settings-panel-action-btn settings-panel-action-btn--signout">
                  <span class="settings-panel-action-btn__label">
                    <LogOut class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                    SIGN OUT
                  </span>
                </div>
                <div class="settings-panel-action-btn settings-panel-action-btn--delete">
                  <span class="settings-panel-action-btn__label">
                    <Trash2 class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                    DELETE
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="flex justify-center py-1">
          <div class="boot-panel-avatar-spinner" aria-hidden="true"></div>
        </div>

        <div class="settings-panel-stats">
          <div class="settings-panel-header__identity boot-panel-placeholder" aria-hidden="true">
            <span class="settings-panel-header__name boot-panel-placeholder__ghost">account name</span>
            <span class="text-[10px] boot-panel-placeholder__ghost">joined Jan 2026</span>
            <span class="text-[10px] boot-panel-placeholder__ghost">Session: 1h 00m</span>
            <span class="settings-panel-header__user-id boot-panel-placeholder__ghost">00000000-0000-0000-0000-000000000000</span>
          </div>

          {@render writingsChip(true)}
        </div>

        <div class="settings-panel-account" aria-hidden="true">
          <div class="settings-panel-password">
            <div class="settings-panel-action-btn settings-panel-action-btn--full settings-panel-action-btn--change-password boot-panel-placeholder">
              <span class="settings-panel-action-btn__label boot-panel-placeholder__ghost">
                <LockKeyhole class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                CHANGE PASSWORD
              </span>
            </div>
          </div>

          <div class="settings-panel-actions-reveal settings-panel-actions-reveal--open">
            <div class="settings-panel-actions-reveal__inner">
              <div class="settings-panel-actions">
                <div class="settings-panel-action-btn settings-panel-action-btn--signout boot-panel-placeholder">
                  <span class="settings-panel-action-btn__label boot-panel-placeholder__ghost">
                    <LogOut class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                    SIGN OUT
                  </span>
                </div>
                <div class="settings-panel-action-btn settings-panel-action-btn--delete boot-panel-placeholder">
                  <span class="settings-panel-action-btn__label boot-panel-placeholder__ghost">
                    <Trash2 class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                    DELETE
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <p class="sr-only">{bootAccountReveal ? 'Account ready' : bootMessage}</p>
  </div>
{/snippet}

<div class="app w-full h-dvh max-h-dvh overflow-hidden select-none text-white bg-black flex flex-col font-sans">
  <div class="app-stage flex-1 flex flex-col min-h-0 w-full relative overflow-hidden">
  <div class="app-stage-scroll flex-1 min-h-0 flex flex-col overflow-hidden">
  <div
    class="app-stage-reveal app-stack-gap flex flex-col flex-1 min-h-0 w-full overflow-hidden"
    class:app-stage-reveal--active={stageRevealActive || !currentUser}
  >
  {#if currentUser}
  <div class="app-stage-sticky app-stack-gap shrink-0 flex flex-col">
  <div class="week-calendar-swipe rounded-xl border border-[#1e1e1e] bg-[#141414] overflow-hidden">
    <div class="flex items-center gap-2 min-h-8 px-2 py-1.5 border-b border-[#1e1e1e] bg-[#111] text-[10px] tracking-[1px]">
      <button
        type="button"
        title="Account and backend"
        aria-label="Account and backend"
        class="w-7 h-7 shrink-0 rounded bg-emerald-950/40 flex items-center justify-center hover:bg-emerald-900/40 transition"
        onclick={(e) => { e.stopPropagation(); openSettingsPanel(); }}
      >
        {#key avatarSeed}
          <GeneratedAvatar userId={currentUser.id} seed={avatarSeed} size={26} rounded={2} className="rounded" />
        {/key}
      </button>
      <div class="flex-1 flex items-center gap-2 min-w-0">
        <div class="flex-1 flex items-center gap-2 min-w-0 py-0.5 -my-0.5 px-1 min-w-0">
          <span class="min-w-0 flex-1 truncate text-left leading-none font-bold text-zinc-200 pointer-events-none">{headerBarLabel}</span>
        </div>
        <span class="header-clock-group shrink-0">
          <HeaderClock />
          <button
            type="button"
            class="db-io-dot-btn"
            aria-label="Account and backend"
            title="Account and backend"
            onclick={openSettingsPanel}
          >
            <span
              class="db-io-dot"
              class:db-io-dot--active={dbIoFlash}
              aria-hidden="true"
            ></span>
          </button>
        </span>
      </div>
    </div>
    <div
      class="week-calendar-panel grid"
      style="grid-template-rows: 0fr"
      aria-hidden="true"
    >
      <div class="overflow-hidden min-h-0 pointer-events-none"></div>
    </div>
  </div>
  </div>
  {:else}
    <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <AuthScreen onAuthenticated={handleAuthSuccess} />
    </div>
  {/if}
  </div>

  {#if bootOverlayVisible && currentUser}
    <div
      class="boot-overlay"
      class:boot-overlay--exit={bootOverlayExiting}
      ontransitionend={onBootOverlayTransitionEnd}
    >
      {@render bootScreen()}
    </div>
  {/if}
  </div>
  </div>

  <div class="app-footer flex items-baseline justify-center gap-x-1 text-center text-[9px] tracking-[0.5px] text-zinc-500 shrink-0 leading-none">
    <a
      href="https://github.com/Kono-o/tractatus"
      target="_blank"
      rel="noopener noreferrer"
      class="hover:text-zinc-300 active:text-white transition-colors"
      title="Click to visit the Tractatus GitHub repo. Ctrl+click (or Cmd+click) the left side for the update demo, right side for the post-update demo."
    >
      <span
        class="cursor-pointer hover:text-zinc-300 active:text-white transition-colors"
        onclick={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); manuallyOpenUpdateMenu(); } }}
      >
        TRACTATUS v{APP_VERSION}
      </span>
      <span class="text-zinc-500 select-none">—</span>
      <span
        class="cursor-pointer hover:text-zinc-300 active:text-white transition-colors"
        onclick={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); manuallyOpenPostUpdateMenu(); } }}
      >
        All rights reserved by Arya.
      </span>
    </a>
  </div>
</div>

<!-- Account menu / backend panel (identical UX to Lift Tracker account menu, without LT-specific data) -->
{#if showSettingsPanel}
  <div
    class="settings-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Account and backend"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) closeSettingsPanel(); }}
  >
    <div class="settings-panel-dialog rounded-xl border border-[#1e1e1e] bg-[#141414] shadow-xl overflow-hidden text-left">
      <div class="settings-panel-header">
        <div class="settings-panel-header__title">
          <div class="settings-panel-brand" aria-hidden="true">
            <span class="settings-panel-brand__lift">TRACTATUS</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="settings-panel-header__supabase" aria-label="Supabase connection">
            <span class="settings-panel-header__supabase-label">Supabase</span>
            <span class="settings-panel-header__dot-wrap" aria-hidden="true">
              <span
                class="db-io-dot settings-panel-header__dot"
                class:db-io-dot--active={!!supabasePanel && supabasePanel.health.ok && supabasePanel.sessionOk}
              ></span>
            </span>
            <span class="settings-panel-header__latency">
              {#if supabasePanelLoading}
                …
              {:else if supabasePanel?.health.latencyMs != null}
                {formatSupabaseLatencyMs(supabasePanel.health.latencyMs)}
              {:else}
                —
              {/if}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            class="settings-panel-header__close"
            disabled={accountBusy}
            onclick={closeSettingsPanel}
          >
            <X class="size-3.5" />
          </button>
        </div>
      </div>

      <div class="settings-panel-body text-[10px] leading-snug">
        {#if currentUser}
          <div class="flex justify-center py-1">
            <button
              type="button"
              onclick={shuffleAvatarSeed}
              disabled={avatarShuffleCooldown}
              class="cursor-pointer hover:opacity-90 active:scale-[0.96] transition-all focus:outline-none {avatarShuffleCooldown ? 'opacity-60 cursor-default' : ''}"
              title="Click to shuffle to a new random identicon seed (saved)"
            >
              {#key avatarSeed}
                <GeneratedAvatar userId={currentUser.id} seed={avatarSeed} size={80} />
              {/key}
            </button>
          </div>
        {/if}
        <div class="settings-panel-stats">
          {#if supabasePanelLoading && !supabasePanel}
            <p class="settings-panel-loading">Loading backend…</p>
          {:else if supabasePanel}
            {@const panel = supabasePanel}
            {#if currentUser}
              <div class="settings-panel-header__identity">
                {#if editingAccountName && isUsernameAccount(currentUser)}
                  <input
                    type="text"
                    autocomplete="username"
                    spellcheck="false"
                    maxlength={MAX_USERNAME_LEN}
                    class="settings-panel-header__name-input"
                    use:focusExerciseNameInput
                    bind:value={accountNameEditValue}
                    oninput={(e) => {
                      accountNameEditValue = sanitizeUsernameInput((e.currentTarget as HTMLInputElement).value);
                    }}
                    onblur={() => void commitAccountNameEdit()}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelAccountNameEdit();
                      }
                    }}
                    disabled={accountBusy}
                  />
                {:else if isUsernameAccount(currentUser)}
                  <button
                    type="button"
                    class="settings-panel-header__name settings-panel-header__name--editable"
                    title="Click to rename username"
                    disabled={accountBusy}
                    onclick={beginAccountNameEdit}
                  >
                    {accountDisplayName}
                  </button>
                {:else}
                  <span class="settings-panel-header__name">{accountDisplayName}</span>
                {/if}
                <span class="text-[10px] text-zinc-500">joined {accountMemberSince}</span>
                <span class="text-[10px] text-zinc-500">Session: {formatSessionExpiry(panel.expiresAt)}</span>
                <span class="settings-panel-header__user-id" title={currentUser.id}>{currentUser.id}</span>
              </div>
            {:else}
              <span class="settings-panel-header__name text-zinc-400">Backend</span>
            {/if}
            {@render writingsChip()}

            {#if panel.health.error || panel.sessionError}
              <p class="settings-panel-alert">
                {panel.sessionError ?? panel.health.error}
              </p>
            {/if}
          {/if}
        </div>

        {#if currentUser}
          <div class="settings-panel-account">
            {#if accountError && !showChangePasswordForm}
              <p class="settings-panel-alert">
                {accountError}
              </p>
            {/if}

            {#if accountCanChangePassword}
              <div class="settings-panel-password"
                class:settings-panel-password--open={showChangePasswordForm}>
                {#if showChangePasswordForm}
                  <button
                    type="button"
                    class="settings-panel-action-btn settings-panel-action-btn--full settings-panel-action-btn--password-cancel"
                    disabled={accountBusy}
                    onclick={toggleChangePasswordForm}
                  >
                    <span class="settings-panel-action-btn__label">
                      <X class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                      CANCEL
                    </span>
                  </button>
                {:else}
                  <button
                    type="button"
                    class="settings-panel-action-btn settings-panel-action-btn--full
                      {holdCautionDisplayKind === 'delete'
                        ? 'settings-panel-action-btn--hold-caution-delete'
                        : holdCautionDisplayKind === 'signout'
                          ? 'settings-panel-action-btn--hold-caution-signout'
                          : 'settings-panel-action-btn--change-password'}
                      {holdCautionMorphFade && !holdCautionDisplayKind
                        ? 'settings-panel-action-btn--morph'
                        : ''}"
                    disabled={accountBusy || holdCautionKind !== null}
                    aria-live={holdCautionDisplayKind ? 'polite' : undefined}
                    onclick={toggleChangePasswordForm}
                  >
                    {#if holdCautionDisplayKind}
                      <span class="settings-panel-action-btn__caution-msg">{holdCautionMessage}</span>
                    {:else}
                      <span class="settings-panel-action-btn__label">
                        <LockKeyhole class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                        CHANGE PASSWORD
                      </span>
                    {/if}
                  </button>
                {/if}

                <div
                  class="auth-confirm-reveal"
                  class:auth-confirm-reveal--open={showChangePasswordForm}
                  aria-hidden={!showChangePasswordForm}
                >
                  <div class="auth-confirm-reveal__inner">
                    <form
                      class="settings-panel-password-form"
                      onsubmit={(e) => {
                        e.preventDefault();
                        if (
                          accountBusy ||
                          changePasswordFeedbackLit ||
                          !changePasswordSubmitReady
                        ) {
                          return;
                        }
                        void handleChangePassword();
                      }}
                    >
                      <div class="relative">
                        <Lock class="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500 pointer-events-none" />
                        <input
                          type="password"
                          autocomplete="new-password"
                          maxlength={MAX_PASSWORD_LEN}
                          bind:value={changePasswordNew}
                          disabled={accountBusy}
                          placeholder="••••••••"
                          aria-label="New password"
                          class="settings-panel-password-input"
                          oninput={(e) => {
                            clearChangePasswordFeedback();
                            changePasswordNew = sanitizePasswordInput((e.currentTarget as HTMLInputElement).value);
                          }}
                        />
                      </div>
                      <div class="relative">
                        <LockKeyhole class="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500 pointer-events-none z-10" />
                        <input
                          type="password"
                          autocomplete="new-password"
                          maxlength={MAX_PASSWORD_LEN}
                          bind:value={changePasswordConfirm}
                          disabled={accountBusy}
                          placeholder=""
                          aria-label="Confirm password"
                          class="settings-panel-password-input"
                          oninput={(e) => {
                            clearChangePasswordFeedback();
                            changePasswordConfirm = sanitizePasswordInput((e.currentTarget as HTMLInputElement).value);
                          }}
                        />
                        {#if !changePasswordConfirm}
                          <span
                            class="absolute left-9 top-1/2 -translate-y-1/2 text-[0.6875rem] text-zinc-600 pointer-events-none select-none"
                            aria-hidden="true"
                          >••••••••</span>
                        {/if}
                      </div>
                      <div class="auth-submit-crossfade settings-panel-password-save-crossfade">
                        <button
                          type="submit"
                          class="auth-submit-crossfade__layer auth-submit-btn settings-panel-password-save-btn settings-panel-password-save-btn--ready font-black flex items-center justify-center text-center leading-snug
                            {changePasswordSubmitBtnLit ? 'auth-submit-crossfade__layer--lit auth-submit-crossfade__layer--interactive' : ''}
                            {changePasswordFeedbackExiting ? 'auth-submit-crossfade__layer--top' : ''}"
                          disabled={accountBusy || changePasswordFeedbackLit || (!changePasswordSubmitReady && !changePasswordFeedbackExiting)}
                          aria-hidden={!changePasswordSubmitBtnLit}
                          aria-busy={accountBusy}
                          aria-label={accountBusy ? 'Saving password' : 'Save password'}
                          tabindex={changePasswordSubmitBtnLit ? 0 : -1}
                        >
                          {#if accountBusy}
                            <RefreshCw class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                          {:else}
                            SAVE PASSWORD
                          {/if}
                        </button>
                        {#if changePasswordCrossfadeShowFeedback}
                          <div
                            role="status"
                            aria-live="polite"
                            class="auth-submit-crossfade__layer auth-submit-btn auth-submit-btn--feedback settings-panel-password-save-btn font-black flex items-center justify-center text-center leading-snug
                              {changePasswordError ? 'auth-submit-btn--error' : 'auth-submit-btn--success'}
                              {changePasswordFeedbackLit ? 'auth-submit-crossfade__layer--lit auth-submit-crossfade__layer--top' : ''}
                              {changePasswordError && changePasswordFeedbackLit ? 'auth-submit-btn--error-nudge' : ''}"
                            title={changePasswordError ?? changePasswordSuccess ?? undefined}
                            ontransitionend={onChangePasswordCrossfadeTransitionEnd}
                          >
                            <span class="auth-submit-btn__feedback flex items-center gap-1.5 min-w-0 max-w-full">
                              {#if changePasswordError}
                                <CircleAlert class="auth-submit-btn__icon size-3.5 shrink-0" aria-hidden="true" />
                              {:else}
                                <CircleCheck class="auth-submit-btn__icon size-3.5 shrink-0" aria-hidden="true" />
                              {/if}
                              <span class="line-clamp-2 min-w-0">{changePasswordError ?? changePasswordSuccess}</span>
                            </span>
                          </div>
                        {/if}
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            {/if}

            <div
              class="settings-panel-actions-reveal"
              class:settings-panel-actions-reveal--open={!showChangePasswordForm}
              aria-hidden={showChangePasswordForm}
            >
              <div class="settings-panel-actions-reveal__inner">
                <div class="settings-panel-actions">
                  <button
                    type="button"
                    title="Hold 2s to sign out"
                    class="settings-panel-action-btn {signOutTapPulseActive ? 'hold-skip-tap-pulse' : signOutProgress > 0 ? 'settings-panel-action-btn--signout-active' : 'settings-panel-action-btn--signout'}"
                    disabled={accountBusy || showChangePasswordForm}
                    tabindex={showChangePasswordForm ? -1 : 0}
                    onmousedown={startSignOutHold}
                    onmouseup={stopSignOutHold}
                    onmouseleave={stopSignOutHold}
                    ontouchstart={startSignOutHold}
                    ontouchend={stopSignOutHold}
                    onanimationend={onSignOutTapPulseEnd}
                  >
                    <div class="settings-panel-action-btn__fill settings-panel-action-btn__fill--signout" style="width: {signOutProgress}%;"></div>
                    <span class="settings-panel-action-btn__label">
                      <LogOut class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                      {accountBusy ? '…' : 'SIGN OUT'}
                    </span>
                  </button>

                  <button
                    type="button"
                    title="Hold 4s to delete account and all data"
                    class="settings-panel-action-btn {deleteAccountTapPulseActive ? 'hold-cancel-tap-pulse' : deleteAccountProgress > 0 ? 'settings-panel-action-btn--delete-active' : 'settings-panel-action-btn--delete'}"
                    disabled={accountBusy || showChangePasswordForm}
                    tabindex={showChangePasswordForm ? -1 : 0}
                    onmousedown={startDeleteAccountHold}
                    onmouseup={stopDeleteAccountHold}
                    onmouseleave={stopDeleteAccountHold}
                    ontouchstart={startDeleteAccountHold}
                    ontouchend={stopDeleteAccountHold}
                    onanimationend={onDeleteAccountTapPulseEnd}
                  >
                    <div class="settings-panel-action-btn__fill settings-panel-action-btn__fill--delete" style="width: {deleteAccountProgress}%;"></div>
                    <span class="settings-panel-action-btn__label">
                      <Trash2 class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                      {accountBusy ? '…' : 'DELETE'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if showUpdatePrompt && updateInfo && !bootOverlayVisible && (currentUser || !isNativeApp())}
  <div
    class="settings-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Update available"
    tabindex="-1"
  >
    <div class="settings-panel-dialog rounded-xl border border-[#1e1e1e] bg-[#141414] shadow-xl overflow-hidden text-left">
      <div class="settings-panel-header">
        <div class="settings-panel-header__title">
          <div class="settings-panel-brand" aria-hidden="true">
            <span class="settings-panel-brand__lift">TRACTATUS</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            aria-label="Close"
            class="settings-panel-header__close"
            disabled={updateInstalling}
            onclick={closeUpdatePrompt}
          >
            <X class="size-3.5" />
          </button>
        </div>
      </div>

      <div class="settings-panel-body text-[10px] leading-snug">
        <div class="flex flex-col items-center text-center">
          <div class="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/60 px-3 py-0.5 text-emerald-400 text-[10px] font-medium tracking-[1.5px]">
            UPDATE AVAILABLE
            {#if updateInfo.size}
              · {(updateInfo.size / 1024 / 1024).toFixed(1)} MB
            {/if}
          </div>

          <div class="mt-2 flex items-center gap-3">
            <div class="flex flex-col items-center">
              <div class="update-version-num text-zinc-400">v{APP_VERSION}</div>
            </div>

            <div class="text-emerald-500 text-2xl leading-none">→</div>

            <div class="flex flex-col items-center">
              <div class="update-version-num font-semibold text-emerald-400">v{updateInfo.version}</div>
            </div>
          </div>
        </div>

        {#if updateInfo.notes}
          <div class="mt-3">
            <div class="mb-1 text-[9px] font-medium tracking-[1px] text-zinc-500">WHAT'S NEW</div>
            <div class="max-h-40 overflow-auto rounded border border-[#1e1e1e] bg-[#0d0d0d] p-2.5 text-[10px] leading-snug text-zinc-300 markdown-content no-scrollbar">
              {@html renderChangelog(updateInfo.notes)}
            </div>
          </div>
        {:else}
          <p class="mt-3 text-center text-zinc-400">A new version of Tractatus is ready.</p>
        {/if}

        {#if updateError && !updateInstalling}
          <p class="settings-panel-alert mt-2">{updateError}</p>
        {/if}

        <div class="mt-3 min-h-[1.75rem] flex items-center">
          {#if !updateInstalling}
            <span class="block text-center text-[10px] text-zinc-400">Install to receive the latest features and fixes.</span>
          {:else if updateInstalling}
            {#if !isWaitingForUpdatePermission}
              <div class="flex items-center gap-2 w-full">
                <div class="flex-1 h-1.5 rounded bg-[#1e1e1e] overflow-hidden">
                  <div
                    class="h-1.5 bg-emerald-500 transition-[width] duration-75"
                    style="width: {updateDownloadProgress}%"
                  ></div>
                </div>
                <span class="text-[10px] text-zinc-400 tabular-nums w-8 text-right">{updateDownloadProgress}%</span>
              </div>
            {/if}
            {#if updateError}
              <p class="mt-1.5 text-[10px] text-amber-400">{updateError}</p>
            {/if}
          {/if}
        </div>

        <div class="mt-3 grid grid-cols-1 gap-2">
          <button
            type="button"
            class={updateInstalling && !updateError
              ? 'settings-panel-action-btn settings-panel-action-btn--full pointer-events-none opacity-70 border-[#1e1e1e] text-zinc-400'
              : 'settings-panel-action-btn settings-panel-action-btn--full settings-panel-action-btn--update-primary'}
            disabled={updateInstalling && !updateError}
            onclick={startUpdateInstall}
          >
            <span class="settings-panel-action-btn__label font-bold tracking-[0.5px]">
              {!updateInstalling ? 'INSTALL UPDATE' : (updateError ? 'INSTALL' : 'Installing…')}
            </span>
          </button>
          {#if updateInstalling && updateError}
            <button
              type="button"
              class="settings-panel-action-btn settings-panel-action-btn--full"
              onclick={openGitHubReleases}
            >
              <span class="settings-panel-action-btn__label">Download manually from GitHub</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showPostUpdate && !bootOverlayVisible && (currentUser || !isNativeApp())}
  <div
    class="settings-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="App updated"
    tabindex="-1"
  >
    <div class="settings-panel-dialog rounded-xl border border-[#1e1e1e] bg-[#141414] shadow-xl overflow-hidden text-left">
      <div class="settings-panel-header">
        <div class="settings-panel-header__title">
          <div class="settings-panel-brand" aria-hidden="true">
            <span class="settings-panel-brand__lift">TRACTATUS</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            aria-label="Close"
            class="settings-panel-header__close"
            onclick={closePostUpdate}
          >
            <X class="size-3.5" />
          </button>
        </div>
      </div>

      <div class="settings-panel-body text-[10px] leading-snug">
        <div class="flex flex-col items-center text-center">
          <div class="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/60 px-3 py-0.5 text-emerald-400 text-[10px] font-medium tracking-[1.5px]">
            UPDATED
            <Check class="size-3.5" />
          </div>

          <div class="mt-2 flex items-center gap-3">
            <div class="flex flex-col items-center">
              <div class="update-version-num font-semibold text-emerald-400">v{postUpdateVersion}</div>
            </div>
          </div>
        </div>

        {#if postUpdateNotes}
          <div class="mt-3">
            <div class="mb-1 text-[9px] font-medium tracking-[1px] text-zinc-500">WHAT'S NEW</div>
            <div class="max-h-44 overflow-auto rounded border border-[#1e1e1e] bg-[#0d0d0d] p-2 text-[10px] leading-snug text-zinc-300 markdown-content no-scrollbar">
              {@html renderChangelog(postUpdateNotes)}
            </div>
            <span class="mt-2 block text-center text-[10px] text-zinc-400">Thanks for staying up to date!</span>
          </div>
        {:else}
          <p class="mt-3 text-center text-zinc-400">You're now running the latest version.</p>
        {/if}

        <div class="mt-3 grid grid-cols-1 gap-2">
          <button
            type="button"
            class="settings-panel-action-btn settings-panel-action-btn--full settings-panel-action-btn--update-primary"
            onclick={closePostUpdate}
          >
            <span class="settings-panel-action-btn__label font-bold tracking-[0.5px]">GOT IT</span>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}