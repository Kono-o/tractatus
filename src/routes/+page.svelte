<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
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
    type Essay,
    slugifyTitle,
    estimateReadTimeMinutes,
    type ReadingLog,
  } from '$lib/db';
  import AuthScreen from '$lib/components/AuthScreen.svelte';
  import RichEditor from '$lib/components/RichEditor.svelte';
  // IMPORTANT: updater (and thus all @capacitor/* modules) must NOT be statically imported.
  // Static imports of native-only code cause 500 Internal Server Errors during SSR on Vercel.
  // We use dynamic import() only from client-side code (onMount + event handlers).
  import type { UpdateInfo } from '$lib/updater';
  import { APP_VERSION } from '$lib/version';
  import { isNativeApp } from '$lib/native';
  import { setAppIcon as _setAppIcon } from '$lib/icon-switcher';
  import DiaryPanel from '$lib/components/DiaryPanel.svelte';
  import EssayView from '$lib/components/EssayView.svelte';
  import ReadingLogDiary from '$lib/components/ReadingLogDiary.svelte';
  import type { User as SupabaseUser } from '@supabase/supabase-js';
  import {
    preprocessMarkdown,
    renderEssay,
    renderExcerpt,
    renderChangelog,
    handleCodeCopyClick,
  } from '$lib/markdown';
  import confetti from 'canvas-confetti';
  import {
    loadSupabasePanelSnapshot,
    formatSessionExpiry,
    formatBytes,
    type SupabasePanelSnapshot,
  } from '$lib/supabaseStatus';
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
    Undo2,
    Redo2,
    Bold,
    Italic,
    Strikethrough,
    Highlighter,
    Link,
    Image,
    Code,
    Code2,
    Minus,
    Quote,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Subscript,
    Superscript,
    Sigma,
    ArrowLeft,
    ChevronRight,
    X,

    Search,
    Plus,
    User,
    Eye,
    EyeClosed,
    Upload,
    Newspaper,
    BookOpen,
    Library as LibraryIcon,
  } from '@lucide/svelte';

  const FEED_SEARCH_DEBOUNCE_MS = 280;
  const FEED_EXCERPT_FEATURED_LINES = 6;
  const FEED_EXCERPT_ITEM_LINES = 3;
  const LIBRARY_EXCERPT_LINES = 3;

  function formatFeedDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fmtReadTime(n: number): string {
    return n === 1 ? '~1 min' : `~${n} mins`;
  }

  function selectFeedTab() {
    viewMode = 'feed';
    closeArticle();
    if (isWriting) void exitWriting();
    searchQuery = '';
    diarySearchQuery = '';
    librarySearchQuery = '';
    searchResults = [];
  }

  function selectMyLibraryTab() {
    if (!currentUser) {
      openAuthPanel();
      return;
    }
    viewMode = 'library';
    closeArticle();
    if (isWriting) void exitWriting();
    searchQuery = '';
    diarySearchQuery = '';
    searchResults = [];
  }

  function selectDiaryTab() {
    closeArticle();
    if (isWriting) void exitWriting();
    viewMode = 'diary';
    searchQuery = '';
    librarySearchQuery = '';
    searchResults = [];
  }

  let readingEssay = $state<Essay | null>(null);
  let readingEssayLoading = $state(false);
  let readingEssayError = $state<string | null>(null);
  let linkCopied = $state(false);
  let linkCopiedTimer: ReturnType<typeof setTimeout> | undefined;
  let feedLinkCopiedId = $state<string | null>(null);
  let feedLinkCopiedTimer: ReturnType<typeof setTimeout> | undefined;

  function closeArticle() {
    readingEssay = null;
    readingEssayError = null;
    readingEssayLoading = false;
    if (window.location.pathname !== '/') history.pushState(null, '', '/');
  }

  function copyLink() {
    void navigator.clipboard.writeText(window.location.href);
    linkCopied = true;
    clearTimeout(linkCopiedTimer);
    linkCopiedTimer = setTimeout(() => { linkCopied = false; }, 1500);
  }

  // Click handler for rendered article HTML. Delegates copy-button clicks and anchors.
  function onArticleProseClick(e: MouseEvent) {
    try {
      // Copy button handler (defined in src/lib/markdown.ts)
      handleCodeCopyClick(e);
    } catch (err) {
      // ignore
    }

    const tgt = e.target as HTMLElement | null;
    if (!tgt) return;

    // If an anchor (<a>) was clicked, handle external links by opening in new tab
    const a = tgt.closest('a') as HTMLAnchorElement | null;
    if (a && a.href) {
      const href = a.getAttribute('href') || '';
      // Let same-page anchors and internal routes behave normally
      if (href.startsWith('#') || href.startsWith('/') || href.startsWith(window.location.origin)) {
        return;
      }
      // External link: open in new tab and prevent default navigation
      try {
        window.open(href, '_blank', 'noopener');
        e.preventDefault();
      } catch (err) {
        // ignore
      }
    }
  }

  async function openArticle(essay: Essay) {
    const uname = essay.author_username;
    if (!uname) return;
    viewMode = 'feed';
    if (searchExpanded) await toggleSearch();
    readingEssayLoading = true;
    readingEssayError = null;
    readingEssay = null;
    try {
      if (essay.content?.trim()) {
        readingEssay = essay;
      } else if (uname) {
        const full = await db.getPublicEssayByUsernameAndSlug(uname, essay.slug);
        if (!full) readingEssayError = 'This essay is not public or does not exist.';
        else readingEssay = full;
      } else {
        readingEssayError = 'This essay is not public or does not exist.';
      }
    } catch (e) {
      console.warn('[article] load failed', e);
      readingEssayError = 'Failed to load essay.';
    } finally {
      readingEssayLoading = false;
    }
    history.pushState(null, '', `/@${encodeURIComponent(uname)}/${encodeURIComponent(essay.slug)}/`);
  }

  function handleHeaderBack() {
    if (isWriting) void exitWriting();
    else if (readingEssay) closeArticle();
    else void goto('/');
  }





  function focusExerciseNameInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
  const SIGN_OUT_HOLD_MS = 2000;
  const DELETE_ACCOUNT_HOLD_MS = 4000;
  const AUTH_FEEDBACK_CROSSFADE_MS = 240;

  let currentUser = $state<SupabaseUser | null>(null);
  let isAuthLoading = $state(true);
  let isLoading = $state(false);
  let hasInitialLoad = $state(false);

  // Account / settings panel (ported from Lift Tracker)
  let showSettingsPanel = $state(false);
  let showAuthPanel = $state(false);
  let supabasePanel = $state<SupabasePanelSnapshot | null>(null);
  let supabasePanelLoading = $state(false);
  let avatarSeed = $state<string | null>(null);
  let avatarShuffleCooldown = $state(false);
  let avatarUrl = $state<string | null>(null);
  let avatarUploading = $state(false);
  let avatarRemoveProgress = $state(0);
  let avatarRemoveTapPulseActive = $state(false);
  let avatarRemoveHoldTimer: ReturnType<typeof setInterval> | undefined;
  let avatarRemoveHoldEndTimer: ReturnType<typeof setTimeout> | undefined;
  let showUserIcon = $state(true);
  let showAvatar = $state(false);

  $effect(() => {
    if (!isAuthLoading) {
      if (currentUser) {
        if (hasInitialLoad) {
          showAvatar = true;
          showUserIcon = false;
        }
      } else {
        showUserIcon = true;
        showAvatar = false;
      }
    }
  });

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

  // ============================================
  // WRITINGS (essays) + live editor state
  // ============================================
  let essays = $state<Essay[]>([]);
  let essaysLoading = $state(false);
  let essaysLoadedOnce = $state(false);
  let libraryExcerpts = $state<Map<string, string>>(new Map());

  let isWriting = $state(false);
  let currentEssayId = $state<string | null>(null);
  let editorTitle = $state('');
  let editorContent = $state('');
  let editorSlug = $state('');
  let editorInitialSnapshot = $state<{ title: string; content: string; slug: string } | null>(null);

  let isSaving = $state(false);
  let lastSavedAt = $state<number | null>(null);
  let saveError = $state<string | null>(null);
  let deleteHoldProgress = $state(0);
  let deleteHoldTimer: ReturnType<typeof setInterval> | null = null;

  // Undo / Redo stacks (simple content snapshots)
  let undoStack = $state<Array<{ title: string; content: string; slug: string }>>([]);
  let redoStack = $state<Array<{ title: string; content: string; slug: string }>>([]);
  const MAX_HISTORY = 48;

  // Auto-save timer
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let isDirty = $derived.by(() => {
    if (!editorInitialSnapshot) return false;
    return (
      editorTitle !== editorInitialSnapshot.title ||
      editorContent !== editorInitialSnapshot.content ||
      editorSlug !== editorInitialSnapshot.slug
    );
  });

  let writingCount = $derived(essays.length);
  // total bytes used by essays (sum of title + content lengths)
  let essaysBytes = $derived.by(() => {
    return essays.reduce((sum, e) => {
      const titleLen = e.title ? e.title.length : 0;
      const contentLen = e.content ? e.content.length : 0;
      return sum + titleLen + contentLen;
    }, 0);
  });

  let libraryEssays = $derived(
    [...essays].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
  );

  let librarySearchQuery = $state('');
  let filteredLibraryEssays = $derived.by(() => {
    const q = librarySearchQuery.trim().toLowerCase();
    if (!q) return libraryEssays;
    return libraryEssays.filter(
      e =>
        (e.title || '').toLowerCase().includes(q) ||
        getExcerpt(e.content, 300).toLowerCase().includes(q),
    );
  });

  let libraryDeleteConfirmId = $state<string | null>(null);
  let libraryLogDeleteConfirmId = $state<string | null>(null);
  let libraryTab = $state<'essays' | 'diary'>('essays');
  let libraryLogs = $state<ReadingLog[]>([]);
  let libraryLogsLoading = $state(false);

  function handleLibraryDelete(essayId: string) {
    if (libraryDeleteConfirmId === essayId) {
      libraryDeleteConfirmId = null;
      void performLibraryDelete(essayId);
    } else {
      libraryDeleteConfirmId = essayId;
    }
  }

  function clearLibraryDeleteConfirm() {
    libraryDeleteConfirmId = null;
  }

  async function performLibraryDelete(essayId: string) {
    try {
      await db.deleteEssay(essayId);
      essays = essays.filter(e => e.id !== essayId);
    } catch (e) {
      console.error('[library] delete failed', e);
    }
  }

  function handleLibraryLogDelete(logId: string) {
    if (libraryLogDeleteConfirmId === logId) {
      libraryLogDeleteConfirmId = null;
      void performLibraryLogDelete(logId);
    } else {
      libraryLogDeleteConfirmId = logId;
    }
  }

  function clearLibraryLogDeleteConfirm() {
    libraryLogDeleteConfirmId = null;
  }

  async function performLibraryLogDelete(logId: string) {
    try {
      await db.deleteReadingLog(logId);
      libraryLogs = libraryLogs.filter(l => l.id !== logId);
    } catch (e) {
      console.error('[library] log delete failed', e);
    }
  }

  function countWords(s: string): number {
    return (s || '').trim().split(/\s+/).filter(Boolean).length;
  }
  let editorWordCount = $derived(countWords(editorContent));
  let editorReadMins = $derived(estimateReadTimeMinutes(editorContent));

  let currentEssay = $derived(essays.find(e => e.id === currentEssayId) ?? null);
  let isPublished = $derived(!!(currentEssay?.is_public || (currentEssayId && editorSlug && essays.some(e => e.id === currentEssayId && e.is_public))));

  // View modes for main menu
  let viewMode = $state<'feed' | 'diary' | 'library'>('feed');
  let publicFeed = $state<Essay[]>([]);
  let publicFeedLoading = $state(false);
  let publicFeedLoadedOnce = $state(false);
  let feedRefreshing = $state(false);
  let feedPullY = $state(0);
  let feedScrollEl = $state<HTMLElement | null>(null);
  let feedTouchStartY = $state(0);
  let feedTouchId = $state<number | null>(null);
  let searchQuery = $state('');
  let searchQueryError = $state<string | null>(null);
  // Deduping guard: timestamp of last feed refresh (ms)
  let lastFeedRefreshAt = $state<number | null>(null);
  const FEED_REFRESH_DEDUP_MS = 800; // ignore refreshes within 800ms of previous one

  let searchResults = $state<Essay[]>([]);
  let searchLoading = $state(false);
  let searchExpanded = $state(false);
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let feedSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let logoEyeOpen = $state(
    typeof localStorage !== 'undefined' && localStorage.getItem('logoEyeOpen') === 'true'
  );

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
      // Defensive: if DOM APIs aren't available or fail, ignore so SSR/hydration doesn't crash
      console.warn('[logoEye] failed to apply theme class', e);
    }
  });

  let isFeedSearching = $derived(searchQuery.trim().length > 0 && viewMode === 'feed');

  let feedSearchThrottleLast = 0;

  async function runFeedSearch(query: string) {
    const term = query.trim();
    searchQueryError = null;
    if (!term || term.length < 2) {
      searchResults = [];
      searchLoading = false;
      return;
    }
    if (term.length > 100) return;
    const now = Date.now();
    if (now - feedSearchThrottleLast < 1000) return;
    feedSearchThrottleLast = now;
    searchLoading = true;
    try {
      searchResults = await db.searchPublicEssays(term);
    } catch (e) {
      console.warn('[feed] search failed', e);
      searchResults = [];
      searchQueryError = (e as Error)?.message || 'Search failed.';
    } finally {
      searchLoading = false;
    }
  }

  let diarySearchQuery = $state('');

  function viewUser(username: string, avatarUrl?: string | null, avatarSeed?: string | null) {
    if (readingEssay) closeArticle();
    void goto('/@' + encodeURIComponent(username));
  }

  function onSearchInput(value: string) {
    searchQuery = value;
    searchQueryError = null;
    if (viewMode === 'library') {
      librarySearchQuery = value;
      return;
    }
    if (viewMode === 'diary') {
      diarySearchQuery = value;
      return;
    }
    if (viewMode === 'feed') {
      if (value.trim()) viewMode = 'feed';
    }
    if (feedSearchDebounceTimer) clearTimeout(feedSearchDebounceTimer);
    if (!value.trim()) {
      searchResults = [];
      searchLoading = false;
      return;
    }
    searchLoading = true;
    feedSearchDebounceTimer = setTimeout(() => {
      void runFeedSearch(value);
    }, FEED_SEARCH_DEBOUNCE_MS);
  }

  async function toggleSearch() {
    searchExpanded = !searchExpanded;
    if (searchExpanded) {
      await tick();
      searchInputEl?.focus();
      if (viewMode === 'library') {
        librarySearchQuery = '';
        searchQuery = '';
      }
      if (viewMode === 'diary') {
        diarySearchQuery = '';
      }
      return;
    }
    searchQuery = '';
    librarySearchQuery = '';
    diarySearchQuery = '';
    searchResults = [];
    searchLoading = false;
    if (feedSearchDebounceTimer) {
      clearTimeout(feedSearchDebounceTimer);
      feedSearchDebounceTimer = null;
    }
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (searchExpanded) void toggleSearch();
    }
  }

  /** Substack-style excerpt: strip basic markdown and truncate */
  function getExcerpt(content: string, maxLength = 140): string {
    if (!content) return '';
    let text = content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]+`/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > maxLength) text = text.slice(0, maxLength).trim() + '…';
    return text;
  }

  // Lift Tracker-style primary CTA (for WRITE button matching START WORKOUT)
  const WRITE_CTA = 'WRITE';
  const workoutCenterBtnClass =
    'workout-cta-center font-sans col-span-3 rounded-xl flex items-center justify-center text-center border-2 hover:brightness-110 group relative';
  const workoutCenterLabelClass =
    'workout-cta-label transition-[letter-spacing] group-hover:tracking-[0.2em]';
  const CENTER_CTA_MAX_CH = 16;

  function ctaChStyle(text: string, maxCh: number): string {
    const ch = Math.min(Math.max(text.length, 1), maxCh);
    return `--cta-ch:${ch}`;
  }

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


  $effect(() => {
  });


  async function loadAppData() {
    if (!currentUser) return;
    const isInitial = !hasInitialLoad;
    if (isInitial) {
      isLoading = true;
    }
    try {
      await Promise.all([loadAvatarSeed(), loadAvatarUrl(), preloadSupabaseBackend()]);
    } catch (e) {
      console.error(e);
    } finally {
      isLoading = false;
      hasInitialLoad = true;
    }
  }

  async function runStartupUpdateCheck() {
    if (didRunStartupUpdateCheck) return;
    if (!isNativeApp() || !currentUser) return;
    if (!hasInitialLoad || isLoading || (currentUser !== null && (isAuthLoading || isLoading))) return;
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
            void loadAppData();
          }
        }

        if (!currentUser && (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION')) {
          hasInitialLoad = false;
          isLoading = false;
          supabasePanel = null;
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

    const onPopState = () => {
      if (isWriting && window.location.pathname === '/') {
        void exitWriting();
      } else if (readingEssay && window.location.pathname === '/') {
        closeArticle();
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('popstate', onPopState);
    };
  });

  $effect(() => {
    if (currentUser && hasInitialLoad && !isAuthLoading && !isLoading && !didRunStartupUpdateCheck) {
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
    showAuthPanel = false;
  }

  function openAuthPanel() {
    showAuthPanel = true;
  }

  function closeAuthPanel() {
    showAuthPanel = false;
  }

  function handleWriteFabClick() {
    if (!currentUser) {
      openAuthPanel();
      return;
    }
    void enterNewWrite();
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

  async function loadAvatarUrl() {
    if (!currentUser) {
      avatarUrl = null;
      return;
    }
    try {
      avatarUrl = await db.getAvatarUrl();
    } catch {
      avatarUrl = null;
    }
  }

  let avatarFileInput: HTMLInputElement | undefined = $state();

  function triggerAvatarUpload() {
    avatarFileInput?.click();
  }

  async function handleAvatarFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(file.type)) {
      accountError = 'Please select a JPEG, PNG, WebP, AVIF, or GIF file.';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      accountError = 'File too large. Maximum 2 MB.';
      return;
    }
    avatarUploading = true;
    accountError = null;
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await fetch('/api/avatar/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || 'Upload failed');
      }
      const { url } = await res.json();
      await db.saveAvatarUrl(url);
      avatarUrl = url;
    } catch (e: any) {
      accountError = e?.message || 'Upload failed.';
    } finally {
      avatarUploading = false;
      input.value = '';
    }
  }

  async function handleAvatarRemove() {
    if (!currentUser) return;
    avatarUploading = true;
    accountError = null;
    try {
      const res = await fetch('/api/avatar/delete', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || 'Delete failed');
      }
      await db.saveAvatarUrl(null);
      avatarUrl = null;
    } catch (e: any) {
      accountError = e?.message || 'Remove failed.';
    } finally {
      avatarUploading = false;
    }
  }

  function startAvatarRemoveHold() {
    if (avatarUploading) return;
    avatarRemoveProgress = 0;
    avatarRemoveTapPulseActive = false;
    clearInterval(avatarRemoveHoldTimer);
    clearTimeout(avatarRemoveHoldEndTimer);
    const start = Date.now();
    avatarRemoveHoldTimer = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / 2000) * 100);
      avatarRemoveProgress = pct;
      if (pct >= 100) {
        clearInterval(avatarRemoveHoldTimer);
        avatarRemoveHoldTimer = undefined;
        avatarRemoveProgress = 0;
        void handleAvatarRemove();
      }
    }, 16);
  }

  function stopAvatarRemoveHold() {
    if (avatarRemoveProgress >= 100) return;
    clearInterval(avatarRemoveHoldTimer);
    avatarRemoveHoldTimer = undefined;
    if (avatarRemoveProgress > 0) {
      avatarRemoveTapPulseActive = true;
      avatarRemoveProgress = 0;
      avatarRemoveHoldEndTimer = setTimeout(() => {
        avatarRemoveTapPulseActive = false;
      }, 500);
    }
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
    if (currentUser) {
      void loadAvatarSeed();
      void loadAvatarUrl();
    }
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
    editingAccountName = false;
    accountNameEditValue = '';
    accountBusy = true;
    accountError = null;
    try {
      await db.renameUsername(newName);
      const refreshed = await db.getCurrentUser();
      if (refreshed) {
        currentUser = refreshed as any;
      }
      await db.saveAvatarSeed(avatarSeed);
      void loadAvatarUrl();
    } catch (e: any) {
      accountError = formatAccountError(e);
    } finally {
      accountBusy = false;
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
    avatarRemoveProgress = 0;
    avatarRemoveTapPulseActive = false;
    clearInterval(avatarRemoveHoldTimer);
    clearTimeout(avatarRemoveHoldEndTimer);
    avatarRemoveHoldTimer = undefined;
    avatarRemoveHoldEndTimer = undefined;
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

  // Load avatar data when user signs in
  $effect(() => {
    if (currentUser) {
      void loadAvatarSeed();
      void loadAvatarUrl();
    } else {
      avatarSeed = null;
      avatarUrl = null;
    }
  });

  // ============================================
  // WRITINGS HELPERS + LIVE EDITOR
  // ============================================

  async function loadEssays() {
    if (!currentUser) {
      essays = [];
      return;
    }
    const wasInitial = !essaysLoadedOnce;
    if (wasInitial) essaysLoading = true;
    try {
      const list = await db.listEssays();
      essays = list;
      essaysLoadedOnce = true;
      const m = new Map<string, string>();
      for (const e of list) {
        m.set(e.id, renderExcerpt(e.content, LIBRARY_EXCERPT_LINES));
      }
      libraryExcerpts = m;
    } catch (e) {
      console.warn('[essays] load failed', e);
    } finally {
      if (wasInitial) essaysLoading = false;
    }
  }

  async function loadLibraryLogs() {
    if (!currentUser) return;
    libraryLogsLoading = true;
    try {
      libraryLogs = await db.listReadingLogs();
    } catch (e) {
      console.warn('[library] load logs failed', e);
    } finally {
      libraryLogsLoading = false;
    }
  }

  async function loadPublicFeed() {
    // Deduplicate rapid/overlapping refreshes. If a refresh is in progress or
    // one completed very recently, skip to avoid duplicate work (e.g., pull-to-refresh
    // + auto-refresh firing together).
    const now = Date.now();
    if (publicFeedLoading) return;
    if (lastFeedRefreshAt && now - lastFeedRefreshAt < FEED_REFRESH_DEDUP_MS) return;

    lastFeedRefreshAt = now;
    publicFeedLoading = true;
    try {
      publicFeed = await db.listPublicFeed();
      publicFeedLoadedOnce = true;
    } catch (e) {
      console.warn('[feed] load failed', e);
    } finally {
      publicFeedLoading = false;
    }
  }

  function feedTouchStart(e: TouchEvent) {
    feedTouchStartY = e.touches[0].clientY;
    feedTouchId = e.touches[0].identifier;
    feedPullY = 0;
  }
  function feedTouchMove(e: TouchEvent) {
    if (feedTouchId === null) return;
    const t = [...e.changedTouches].find(t => t.identifier === feedTouchId);
    if (!t) return;
    if (feedScrollEl && feedScrollEl.scrollTop > 0) return;
    const dy = t.clientY - feedTouchStartY;
    if (dy <= 0) return;
    feedPullY = Math.min(dy * 0.5, 120);
    e.preventDefault();
  }
  function feedTouchEnd() {
    if (feedPullY > 60 && !publicFeedLoading && !feedRefreshing) {
      feedRefreshing = true;
      void loadPublicFeed().finally(() => { feedRefreshing = false; feedPullY = 0; });
    } else {
      feedPullY = 0;
    }
    feedTouchId = null;
    feedTouchStartY = 0;
  }

  function pushHistory() {
    // Push current editor state to undo, clear redo
    const snap = { title: editorTitle, content: editorContent, slug: editorSlug };
    // Avoid pushing identical
    const last = undoStack[undoStack.length - 1];
    if (last && last.title === snap.title && last.content === snap.content && last.slug === snap.slug) {
      return;
    }
    undoStack = [...undoStack.slice(-(MAX_HISTORY - 1)), snap];
    redoStack = [];
  }

  function applySnapshot(snap: { title: string; content: string; slug: string }) {
    editorTitle = snap.title;
    editorContent = snap.content;
    editorSlug = snap.slug;
  }

  function undo() {
    if (undoStack.length === 0) return;
    const current = { title: editorTitle, content: editorContent, slug: editorSlug };
    const prev = undoStack[undoStack.length - 1];
    redoStack = [...redoStack, current];
    undoStack = undoStack.slice(0, -1);
    applySnapshot(prev);
    scheduleAutoSave();
  }

  function redo() {
    if (redoStack.length === 0) return;
    const current = { title: editorTitle, content: editorContent, slug: editorSlug };
    const next = redoStack[redoStack.length - 1];
    undoStack = [...undoStack, current];
    redoStack = redoStack.slice(0, -1);
    applySnapshot(next);
    scheduleAutoSave();
  }

  function resetEditor() {
    editorTitle = '';
    editorContent = '';
    editorSlug = '';
    editorInitialSnapshot = null;
    undoStack = [];
    redoStack = [];
    lastSavedAt = null;
    saveError = null;
    currentEssayId = null;
    isSaving = false;
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    deleteHoldProgress = 0;
    stopDeleteHold();
  }

  function stopDeleteHold() {
    if (deleteHoldTimer) clearInterval(deleteHoldTimer);
    deleteHoldTimer = null;
    deleteHoldProgress = 0;
  }

  function startDeleteHold(e: Event) {
    if (e.cancelable) e.preventDefault();
    if (isSaving || !currentEssayId) return;
    const startTime = Date.now();
    deleteHoldTimer = setInterval(() => {
      deleteHoldProgress = Math.min(((Date.now() - startTime) / 1100) * 100, 100);
      if (deleteHoldProgress >= 100) {
        clearInterval(deleteHoldTimer!);
        deleteHoldTimer = null;
        deleteHoldProgress = 0;
        void performDelete();
      }
    }, 16);
  }

  async function performDelete() {
    if (!currentEssayId) return;
    const idToDelete = currentEssayId;
    isSaving = true;
    saveError = null;
    try {
      await db.deleteEssay(idToDelete);
      essays = essays.filter(e => e.id !== idToDelete);
      resetEditor();
      isWriting = false;
    } catch (e: any) {
      saveError = 'Delete failed. Try again.';
      console.error(e);
    } finally {
      isSaving = false;
    }
  }

  function generateSlugFromTitle(force = false) {
    if (!force && editorSlug && editorSlug !== slugifyTitle(editorTitle)) return;
    editorSlug = slugifyTitle(editorTitle);
  }

  async function ensureUniqueSlug(slug: string, excludeId: string | null, userId?: string | null): Promise<string> {
    let candidate = slug || 'untitled';
    let suffix = 2;
    while (!(await db.isSlugAvailable(candidate, excludeId, userId))) {
      candidate = `${slug}-${suffix}`;
      suffix += 1;
      if (suffix > 99) break; // safety
    }
    return candidate;
  }

  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (isWriting && (editorTitle.trim() || editorContent.trim())) {
        void autoSaveDraft();
      }
    }, 850);
  }

  async function autoSaveDraft() {
    if (!isWriting || isSaving) return;
    // Only auto-save if dirty
    if (!isDirty) return;
    await saveCurrent(false); // private
  }

  let saveThrottleLast = 0;

  async function saveCurrent(forcePublic: boolean) {
    if (isSaving) return;
    const now = Date.now();
    if (now - saveThrottleLast < 2000) return;
    saveThrottleLast = now;
    const title = (editorTitle || 'Untitled').trim();
    if (!title && !editorContent.trim()) {
      saveError = 'Add a title or some text first.';
      return;
    }
    const wordCount = editorContent.trim() ? editorContent.trim().split(/\s+/).length : 0;
    if (wordCount > 50000) {
      saveError = 'Essay exceeds 50,000 word limit.';
      isSaving = false;
      return;
    }
    if (new TextEncoder().encode(editorContent).length > 1_048_576) {
      saveError = 'Essay content exceeds 1 MB size limit.';
      isSaving = false;
      return;
    }

    saveError = null;
    isSaving = true;

    let targetSlug = editorSlug.trim() || slugifyTitle(title);
    const exclude = currentEssayId;

    try {
      targetSlug = await ensureUniqueSlug(targetSlug, exclude, currentUser?.id);

      const saved = await db.saveEssay({
        id: currentEssayId,
        title,
        content: editorContent,
        slug: targetSlug,
        is_public: forcePublic,
      });

      // Update local list
      const idx = essays.findIndex(e => e.id === saved.id);
      if (idx >= 0) {
        essays[idx] = saved;
      } else {
        essays = [saved, ...essays];
      }

      currentEssayId = saved.id;
      editorSlug = saved.slug;
      editorTitle = saved.title;
      // Keep content as user has it (in case server trims etc but no)

      lastSavedAt = Date.now();
      editorInitialSnapshot = { title: saved.title, content: editorContent, slug: saved.slug };
      // After explicit save we can trim history a little
      undoStack = undoStack.slice(-12);

      // Refresh from DB to guarantee the essay is persisted and visible in Library
      void loadEssays().catch(() => {});
      void loadLibraryLogs().catch(() => {});

      if (forcePublic) {
        void loadPublicFeed().catch(() => {});
      }
    } catch (e: any) {
      console.error('save essay failed', e);
      saveError = e?.message || 'Could not save. Check connection.';
    } finally {
      isSaving = false;
    }
  }

  function togglePublish() {
    const newPublic = !isPublished;
    const idx = essays.findIndex(e => e.id === currentEssayId);
    if (idx >= 0) {
      essays = essays.with(idx, { ...essays[idx], is_public: newPublic });
    }
    db.saveEssay({
      id: currentEssayId,
      title: editorTitle || 'Untitled',
      content: editorContent,
      slug: editorSlug || slugifyTitle(editorTitle || 'Untitled'),
      is_public: newPublic,
    }).then(() => {
      void loadPublicFeed().catch(() => {});
    }).catch((e) => {
      console.error('[toggle] publish failed', e);
      if (idx >= 0) {
        essays = essays.with(idx, { ...essays[idx], is_public: !newPublic });
      }
    });
  }

  async function toggleLibraryPublish(essay: Essay) {
    const newPublic = !essay.is_public;
    const idx = essays.findIndex(e => e.id === essay.id);
    if (idx >= 0) {
      essays = essays.with(idx, { ...essays[idx], is_public: newPublic });
    }
    try {
      await db.saveEssay({
        ...essay,
        is_public: newPublic,
      });
      void loadPublicFeed().catch(() => {});
    } catch (e) {
      console.error('[library] toggle publish failed', e);
      if (idx >= 0) {
        essays = essays.with(idx, { ...essays[idx], is_public: !newPublic });
      }
    }
  }

  function openEditorForEssay(essay: Essay) {
    resetEditor();
    currentEssayId = essay.id;
    editorTitle = essay.title;
    editorContent = essay.content;
    editorSlug = essay.slug;
    editorInitialSnapshot = { title: essay.title, content: essay.content, slug: essay.slug };
    undoStack = [];
    redoStack = [];
    isWriting = true;
    lastSavedAt = Date.now();
    // Seed one history entry
    undoStack = [{ title: essay.title, content: essay.content, slug: essay.slug }];
    history.pushState(null, '', '/');
  }

  async function enterNewWrite() {
    if (searchExpanded) await toggleSearch();
    closeArticle();
    resetEditor();
    isWriting = true;
    history.pushState(null, '', '/');
    editorTitle = '';
    editorContent = '';
    editorSlug = '';
    const nowStr = new Date().toISOString();
    // Create a transient initial so dirty detection works after first type
    editorInitialSnapshot = { title: '', content: '', slug: '' };
    undoStack = [];
    // Immediately create a draft placeholder? No — wait for first meaningful save.
    // But to have an id fast for user, we can create empty on first auto or explicit.
    // For now: do not create until first Save/Publish.
  }

  async function exitWriting() {
    if (!isWriting) return;
    // Auto-save one last time if dirty and has content
    if (isDirty && (editorTitle.trim() || editorContent.trim())) {
      await saveCurrent(false);
    }
    resetEditor();
    isWriting = false;
    // Refresh list in background
    void loadEssays();
    void loadLibraryLogs();
  }

  async function handleWriteButton() {
    if (isWriting) {
      // In editor: the CTA is publish — handled separately
      return;
    }
    await enterNewWrite();
  }

  // Textarea ref for caret ops
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  function getTextarea(): HTMLTextAreaElement | null {
    return textareaEl;
  }

  function saveSelection() {
    const ta = getTextarea();
    if (!ta) return { start: 0, end: 0 };
    return { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
  }

  function restoreSelection(start: number, end: number) {
    const ta = getTextarea();
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
  }

  function wrapSelection(before: string, after: string = before) {
    const ta = getTextarea();
    if (!ta) return;
    const { start, end } = saveSelection();
    const val = ta.value;
    const selected = val.slice(start, end);
    const newText = before + selected + after;
    const newVal = val.slice(0, start) + newText + val.slice(end);
    // push history before mutate for good undo
    pushHistory();
    editorContent = newVal;
    const newCaret = start + before.length + selected.length;
    // defer restore
    requestAnimationFrame(() => restoreSelection(newCaret, newCaret));
    scheduleAutoSave();
  }

  function insertAtCursor(text: string, selectOffset = 0) {
    const ta = getTextarea();
    if (!ta) {
      editorContent = (editorContent || '') + text;
      scheduleAutoSave();
      return;
    }
    const { start, end } = saveSelection();
    const val = ta.value;
    pushHistory();
    const newVal = val.slice(0, start) + text + val.slice(end);
    editorContent = newVal;
    const caret = start + text.length + selectOffset;
    requestAnimationFrame(() => restoreSelection(caret, caret));
    scheduleAutoSave();
  }

  function toggleBlockPrefix(prefix: string) {
    const ta = getTextarea();
    if (!ta) return;
    const { start } = saveSelection();
    const val = ta.value;
    // find line start
    let lineStart = val.lastIndexOf('\n', start - 1) + 1;
    if (lineStart < 0) lineStart = 0;
    const lineEnd = val.indexOf('\n', start);
    const currentLine = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);

    pushHistory();

    let newLine: string;
    if (currentLine.startsWith(prefix)) {
      newLine = currentLine.slice(prefix.length);
    } else if (/^#{1,6}\s/.test(currentLine) && prefix.startsWith('#')) {
      // replace heading level
      newLine = currentLine.replace(/^#{1,6}\s/, prefix);
    } else {
      newLine = prefix + currentLine;
    }

    const newVal = val.slice(0, lineStart) + newLine + val.slice(lineEnd === -1 ? val.length : lineEnd);
    editorContent = newVal;

    // keep caret roughly in place
    const delta = newLine.length - currentLine.length;
    requestAnimationFrame(() => restoreSelection(start + delta, start + delta));
    scheduleAutoSave();
  }

  function insertLink() {
    const ta = getTextarea();
    const { start, end } = saveSelection();
    const selected = (ta ? editorContent.slice(start, end) : '') || 'text';
    const url = prompt('Link URL (https://...)', 'https://');
    if (!url) return;
    const md = `[${selected}](${url})`;
    if (ta) {
      pushHistory();
      const val = editorContent;
      editorContent = val.slice(0, start) + md + val.slice(end);
      const newEnd = start + md.length;
      requestAnimationFrame(() => restoreSelection(start + 1, start + selected.length + 1)); // select the text part
    } else {
      insertAtCursor(md);
    }
    scheduleAutoSave();
  }

  function insertImageLink() {
    const url = prompt('Image URL (https://...)', 'https://');
    if (!url) return;
    const alt = prompt('Alt text (optional)', '') || '';
    insertAtCursor(`![${alt}](${url})`);
  }

  function insertCodeBlock() {
    wrapSelection('\n```\n', '\n```\n');
  }

  function insertInlineCode() {
    wrapSelection('`', '`');
  }

  function insertDivider() {
    insertAtCursor('\n\n---\n\n');
  }

  function insertQuote() {
    toggleBlockPrefix('> ');
  }

  function insertFootnote() {
    // Simple: insert marker at cursor + definition at end
    const num = (editorContent.match(/\[\^(\d+)\]/g) || []).length + 1;
    const marker = `[^${num}]`;
    const def = `\n\n[^${num}]: Your footnote here.\n`;
    const ta = getTextarea();
    if (ta) {
      const { start } = saveSelection();
      pushHistory();
      const val = editorContent;
      editorContent = val.slice(0, start) + marker + val.slice(start) + def;
      requestAnimationFrame(() => restoreSelection(start + marker.length, start + marker.length));
    } else {
      editorContent = (editorContent || '') + marker + def;
    }
    scheduleAutoSave();
  }

  function wrapLatex(inline = true) {
    if (inline) {
      wrapSelection('$', '$');
    } else {
      wrapSelection('\n$$\n', '\n$$\n');
    }
  }

  function applyAlign(align: 'left' | 'center' | 'right') {
    // Use a simple convention that render can handle:
    // ::: center\ntext\n:::
    const block = `\n::: ${align}\n\n\n:::\n`;
    insertAtCursor(block, -5); // caret inside
  }

  function insertHeading(level: number) {
    const prefix = '#'.repeat(Math.max(1, Math.min(6, level))) + ' ';
    toggleBlockPrefix(prefix);
  }

  function applyHighlight() {
    wrapSelection('==', '==');
  }

  function applySub() {
    wrapSelection('~', '~');
  }

  function applySup() {
    wrapSelection('^', '^');
  }

  // Keyboard shortcuts inside editor textarea
  function onEditorKeydown(e: KeyboardEvent) {
    const meta = e.ctrlKey || e.metaKey;
    if (!meta) return;

    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }
    if (e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrapSelection('**', '**');
      return;
    }
    if (e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrapSelection('*', '*');
      return;
    }
    if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      insertLink();
      return;
    }
    if (e.key === '`' || e.key === '~') {
      // allow user, no prevent
    }
  }

  function onEditorInput() {
    saveError = null;
    // Record history occasionally (not every keystroke for perf)
    // We push on explicit formatting and also here on larger pauses via autoSave schedule.
    // For undo button to be useful, push every N chars or on format.
    scheduleAutoSave();
  }

  // Load feed for everyone; essays only when signed in
  $effect(() => {
    if (!isAuthLoading && !publicFeedLoadedOnce) {
      void loadPublicFeed();
    }
    if (currentUser && hasInitialLoad && !essaysLoadedOnce) {
      void loadEssays();
      void loadLibraryLogs();
    }
    if (!currentUser) {
      essays = [];
      essaysLoadedOnce = false;
      viewMode = 'feed';
      if (isWriting) {
        resetEditor();
        isWriting = false;
      }
    }
  });

  // Keep writings count fresh in chip (already reactive via writingCount)

  // === Realtime feed updates ===
  let feedChannel: ReturnType<typeof supabase.channel> | null = null;
  let feedRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (!publicFeedLoadedOnce || feedChannel) return;

    feedChannel = supabase.channel('feed-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'essays', filter: 'is_public=eq.true' },
        () => scheduleFeedRefresh(),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'usernames' },
        () => scheduleFeedRefresh(),
      )
      .subscribe();
  });

  onDestroy(() => {
    if (feedChannel) {
      supabase.removeChannel(feedChannel);
      feedChannel = null;
    }
    if (feedRefreshTimer) {
      clearTimeout(feedRefreshTimer);
      feedRefreshTimer = null;
    }
  });

  function scheduleFeedRefresh() {
    if (feedRefreshTimer) clearTimeout(feedRefreshTimer);
    feedRefreshTimer = setTimeout(() => {
      feedRefreshTimer = null;
      if (publicFeedLoadedOnce) void loadPublicFeed();
    }, 2000);
  }

  // Keep writings count fresh in chip (already reactive via writingCount)
</script>

<svelte:head>
  <title>Tractatus</title>
  <meta property="og:title" content="Tractatus" />
  <meta property="og:description" content="A minimalist writing platform — write, publish, and share your thoughts." />
  <link rel="preconnect" href="https://covers.openlibrary.org" />
</svelte:head>

{#snippet panelHeaderRow()}
  <div class="settings-panel-header__brand-row">
    <button
      type="button"
      class="settings-panel-brand__eye"
      onclick={toggleLogoEye}
      aria-label={logoEyeOpen ? 'Close eye' : 'Open eye'}
    >
      {#if logoEyeOpen}
        <Eye class="settings-panel-brand__eye-icon" aria-hidden="true" />
      {:else}
        <EyeClosed class="settings-panel-brand__eye-icon" aria-hidden="true" />
      {/if}
    </button>
    <span class="settings-panel-brand__lift">Tractatus</span>
  </div>
{/snippet}

{#snippet compactHeader(writingMode = false, articleMode = false)}
  <div class="pub-header-wrap">
    <header
      class="pub-header"
      class:pub-header--search-open={searchExpanded && !writingMode && !articleMode}
      class:pub-header--article={articleMode}
    >
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
          <span
            class="pub-header-logo-text"
            class:pub-header-logo-text--hidden={searchExpanded && !articleMode && !writingMode}
            class:pub-header-logo-text--disabled={isAuthLoading || isLoading}
            aria-hidden={searchExpanded && !writingMode && !articleMode || undefined}
            role="button"
            tabindex={(isAuthLoading || isLoading) ? -1 : 0}
            onclick={() => { if (isAuthLoading || isLoading) return; if (writingMode) { void exitWriting(); } else if (articleMode) { closeArticle(); } }}
            onkeydown={(e) => { if (e.key === 'Enter') { if (isAuthLoading || isLoading) return; if (writingMode) { void exitWriting(); } else if (articleMode) { closeArticle(); } } }}
          >Tractatus</span>
        </div>
      </div>

      <div class="pub-header-actions">
        <div
          class="pub-header-search-slot"
          class:pub-header-search-slot--open={searchExpanded && !articleMode && !writingMode}
          class:pub-header-search-slot--hidden={articleMode}
          aria-hidden={articleMode || undefined}
          inert={articleMode || undefined}
        >
          <div class="pub-header-search-slot-inner">
            <span class="pub-header-search-slot-icon">
              <span class="pub-header-search-slot-icon__item" class:pub-header-search-slot-icon__item--active={!searchQuery.trim()} aria-hidden="true"><Search class="size-3.5" /></span>
              <button type="button" class="pub-header-search-slot-icon__item pub-header-search-slot-icon__clear" class:pub-header-search-slot-icon__item--active={searchQuery.trim().length > 0} onclick={() => { searchQuery = ''; onSearchInput(''); searchInputEl?.focus(); }} aria-label="Clear search"><X class="size-3.5" /></button>
            </span>
            <input
              bind:this={searchInputEl}
              type="search"
              class="pub-header-search-input"
              placeholder={viewMode === 'library' ? 'Filter essays…' : viewMode === 'diary' ? 'Search books…' : 'Search feed…'}
              bind:value={searchQuery}
              oninput={() => onSearchInput(searchQuery)}
              onkeydown={onSearchKeydown}
              aria-label={viewMode === 'library' ? 'Filter your essays' : viewMode === 'diary' ? 'Search books' : 'Search feed'}
              tabindex={searchExpanded ? 0 : -1}
            />
          </div>
        </div>
        <button
          type="button"
          class="pub-header-icon-btn pub-header-icon-btn--plain"
          class:pub-header-icon-btn--hidden={articleMode || writingMode}
          onclick={() => void toggleSearch()}
          aria-label={searchExpanded ? 'Close search' : 'Search essays'}
          aria-expanded={searchExpanded}
          tabindex={articleMode || writingMode ? -1 : undefined}
          inert={articleMode || writingMode || undefined}
        >
          <span class="pub-header-search-icon" class:pub-header-search-icon--open={searchExpanded}>
            {#if searchExpanded}
              <X class="size-5" aria-hidden="true" />
            {:else}
              <Search class="size-5" aria-hidden="true" />
            {/if}
          </span>
        </button>
        {#if writingMode}
          <button
            type="button"
            class="pub-header-meta-chip"
            class:pub-header-meta-chip--draft={!isPublished}
            class:pub-header-meta-chip--public={isPublished}
            onclick={togglePublish}
          >
            {isPublished ? 'Public' : 'Draft'}
          </button>
        {/if}
        <button
          type="button"
          class="pub-header-icon-btn"
          class:pub-header-avatar={!!currentUser}
          class:pub-header-guest-btn={!currentUser}
          onclick={currentUser ? openSettingsPanel : openAuthPanel}
          aria-label={currentUser ? 'Account and settings' : 'Sign in or sign up'}
        >
          <div style="position: relative; width: 28px; height: 28px; flex-shrink: 0; overflow: hidden;">
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
                <GeneratedAvatar userId={currentUser?.id ?? ''} seed={avatarSeed} avatarUrl={null} size={28} rounded={20} />
              </div>
            {/if}
          </div>
        </button>
      </div>
    </header>

    {#if articleMode || writingMode}
      <div class="pub-header-sub">
        <button
          type="button"
          class="pub-header-back-btn"
          onclick={handleHeaderBack}
          disabled={writingMode && isSaving}
          aria-label="Back to feed"
        >
          <ArrowLeft class="size-3.5" aria-hidden="true" />
          Back
        </button>
        {#if writingMode}
          <div class="pub-header-meta">
            <span class="pub-header-meta-wordcount">{editorWordCount} words · {fmtReadTime(editorReadMins)}</span>
            <span
              class="pub-header-meta-chip"
              class:pub-header-meta-chip--unsaved={!isSaving && !lastSavedAt}
              class:pub-header-meta-chip--saving={isSaving}
              class:pub-header-meta-chip--saved={!isSaving && !!lastSavedAt}
            >
              {#if isSaving}
                Saving
              {:else if lastSavedAt}
                Saved
              {:else}
                Unsaved
              {/if}
            </span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet feedCard(essay: Essay, featured = false)}
  <div
    class="pub-feed-card"
    class:pub-feed-card--featured={featured}
    onclick={(e) => { if ((e.target as HTMLElement).closest('button')) return; void openArticle(essay); }}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter') void openArticle(essay); }}
  >
    <div class="pub-feed-card-meta">
      <span class="pub-feed-card-meta-left">
        {#key essay.author_avatar_seed + '' + essay.author_avatar_url}
          <button type="button" class="user-chip" onclick={(e) => { e.stopPropagation(); viewUser(essay.author_username || 'Anonymous', essay.author_avatar_url, essay.author_avatar_seed); }}>
            <span class="pub-feed-card-avatar">
              <GeneratedAvatar
                userId={essay.user_id}
                seed={essay.author_avatar_seed}
                avatarUrl={essay.author_avatar_url}
                size={featured ? 24 : 20}
                rounded={20}
              />
            </span>
            <span class="pub-feed-card-byline">
              {essay.author_username || 'Anonymous'}
            </span>
          </button>
        {/key}
        <span class="pub-feed-card-sep" aria-hidden="true">·</span>
        <span class="pub-feed-card-date">{formatFeedDate(essay.published_at || essay.updated_at)}</span>
      </span>
      <span class="pub-feed-card-meta-right">
        <span class="pub-feed-card-readtime">{countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}</span>
        <span class="relative inline-flex items-center">
          <span role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); const url = `/@${encodeURIComponent(essay.author_username || '')}/${encodeURIComponent(essay.slug)}/`; void navigator.clipboard.writeText(window.location.origin + url); feedLinkCopiedId = essay.id; clearTimeout(feedLinkCopiedTimer); feedLinkCopiedTimer = setTimeout(() => { feedLinkCopiedId = null; }, 1500); }} onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); const url = `/@${encodeURIComponent(essay.author_username || '')}/${encodeURIComponent(essay.slug)}/`; void navigator.clipboard.writeText(window.location.origin + url); feedLinkCopiedId = essay.id; clearTimeout(feedLinkCopiedTimer); feedLinkCopiedTimer = setTimeout(() => { feedLinkCopiedId = null; }, 1500); } }} class="inline-flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors ml-1.5 p-1.5 relative" aria-label="Copy link">
            {#if feedLinkCopiedId === essay.id}
              <span class="absolute right-full top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 mr-1.5">Copied!</span>
            {/if}
            <Link class="size-4" aria-hidden="true" />
          </span>
        </span>
      </span>
    </div>
    <div class="pub-feed-card-body">
      <span
        class="pub-feed-card-title"
        class:pub-feed-card-title--featured={featured}
      >
        {essay.title || 'Untitled'}
      </span>
      {#if renderExcerpt(essay.content, featured ? FEED_EXCERPT_FEATURED_LINES : FEED_EXCERPT_ITEM_LINES)}
        <div
          class="pub-feed-card-excerpt markdown-content"
          class:pub-feed-card-excerpt--featured={featured}
        >
          {@html renderExcerpt(essay.content, featured ? FEED_EXCERPT_FEATURED_LINES : FEED_EXCERPT_ITEM_LINES)}
        </div>
      {/if}
    </div>
  </div>
{/snippet}
{#snippet writingsChip(ghost = false, reveal = false)}
  <div
    class="mt-1 mb-2"
    class:boot-panel-reveal-item={reveal}
    class:boot-panel-reveal-item--chips={reveal}
    aria-hidden={ghost}
  >
    <div class="flex justify-center text-[9px] text-zinc-400">
      <!-- container holds two chips horizontally -->
      <span class="inline-flex items-center gap-2">
        <span
          class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[color:var(--surf)] rounded border border-[color:var(--border)] justify-center text-[color:var(--hint)]"
          class:boot-panel-placeholder={ghost}
        >
          <Pencil class="size-3 shrink-0 {ghost ? 'boot-panel-placeholder__ghost' : ''}" aria-hidden="true" />
          <span class="leading-none {ghost ? 'boot-panel-placeholder__ghost' : ''}">{writingCount} essay{writingCount === 1 ? '' : 's'}</span>
        </span>

        <span
          class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[color:var(--surf)] rounded border border-[color:var(--border)] justify-center text-[color:var(--hint)]"
          class:boot-panel-placeholder={ghost}
          aria-label="Total storage used by essays"
        >
          <Sigma class="size-3 shrink-0 {ghost ? 'boot-panel-placeholder__ghost' : ''}" aria-hidden="true" />
          <span class="leading-none {ghost ? 'boot-panel-placeholder__ghost' : ''}">{formatBytes(essaysBytes ?? 0)}</span>
        </span>
      </span>
    </div>
  </div>
{/snippet}

<div class="app app--pub w-full h-dvh max-h-dvh overflow-hidden select-none flex flex-col font-sans">
  <div class="app-stage flex-1 flex flex-col min-h-0 w-full relative overflow-hidden">
  <div class="app-stage-scroll flex-1 min-h-0 flex flex-col overflow-hidden">
  <div
    class="app-stage-reveal app-stage-reveal--active app-stack-gap flex flex-col flex-1 min-h-0 w-full overflow-hidden"
  >
  <div class="pub-shell flex flex-col flex-1 min-h-0 w-full overflow-hidden">
    {@render compactHeader(isWriting, !!readingEssay)}

    <div class="pub-body flex flex-col flex-1 min-h-0" style={readingEssay ? 'overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none;' : undefined}>
  <div class="mode-panel">
  {#if currentUser && isWriting}
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div class="editor-wrap flex-1 min-h-0 flex flex-col mx-3 overflow-hidden">
        <RichEditor
          markdown={editorContent}
          onContentChange={(md) => { editorContent = md; saveError = null; scheduleAutoSave(); }}
          placeholder="Start writing…"
          title={editorTitle}
          onTitleInput={(e: Event) => {
            const raw = (e.currentTarget as HTMLInputElement).value;
            const sanitized = raw.replace(/[^\p{L}\p{N}\s-]/gu, '');
            if (sanitized === editorTitle) return;
            editorTitle = sanitized;
            saveError = null;
            generateSlugFromTitle();
            scheduleAutoSave();
          }}
          onTitleBlur={() => { generateSlugFromTitle(true); }}
          titleDisabled={isSaving}
          autoFocusTitle={true}
        />
      </div>

    </div>
  {:else}
    {#if !readingEssay && !readingEssayLoading}
    <nav class="pub-view-nav" aria-label="Feed, books, essays, and library">
      <button
        type="button"
        class="pub-view-tab"
        class:pub-view-tab--active={viewMode === 'feed'}
        onclick={selectFeedTab}
        disabled={isAuthLoading || isLoading}
      >
        <Newspaper class="pub-view-tab-icon size-3.5" aria-hidden="true" />
        Feed
      </button>
      <button
        type="button"
        class="pub-view-tab"
        class:pub-view-tab--active={viewMode === 'diary'}
        onclick={selectDiaryTab}
        disabled={isAuthLoading || isLoading}
      >
        <BookOpen class="pub-view-tab-icon size-3.5" aria-hidden="true" />
        Books
      </button>
      {#if currentUser}
        <button
          type="button"
          class="pub-view-tab"
          class:pub-view-tab--active={viewMode === 'library'}
          onclick={selectMyLibraryTab}
          disabled={isAuthLoading || isLoading}
          in:fade={{ duration: 280 }}
          style="margin-left: auto"
        >
          <LibraryIcon class="pub-view-tab-icon size-3.5" aria-hidden="true" />
          My Shelf
        </button>
      {/if}
    </nav>
    {/if}

  {#if viewMode === 'diary'}
    <div class="pub-scroll no-scrollbar">
      {#if currentUser}
        <DiaryPanel searchQuery={diarySearchQuery} searchExpanded={searchExpanded} onselect={() => { diarySearchQuery = ''; searchQuery = ''; }} onaddbook={toggleSearch} />
      {:else}
        <div class="pub-empty">
          <div class="pub-empty-title">Books</div>
          <div class="pub-empty-hint">Sign in to log your reading.</div>
        </div>
      {/if}
    </div>
  {:else if currentUser && viewMode === 'library'}
    <div class="pub-scroll no-scrollbar">
      <div class="lib-tabs" role="group" aria-label="Library section">
        <button
          type="button"
          class="lib-tab-btn"
          class:lib-tab-btn--active={libraryTab === 'essays'}
          onclick={() => libraryTab = 'essays'}
        >Essays</button>
        <button
          type="button"
          class="lib-tab-btn"
          class:lib-tab-btn--active={libraryTab === 'diary'}
          onclick={() => libraryTab = 'diary'}
        >Diary</button>
      </div>
      {#if libraryTab === 'essays'}
        {#if essaysLoading && !essaysLoadedOnce}
          <div class="pub-empty">Loading your writings…</div>
        {:else if filteredLibraryEssays.length === 0}
          <div class="pub-empty">
            {#if librarySearchQuery}
              <div class="pub-empty-title">No essays match "{librarySearchQuery.trim()}".</div>
            {:else}
              <div class="pub-empty-title">No writings yet.</div>
              <div class="pub-empty-hint">Tap the write button to start your first essay.</div>
            {/if}
          </div>
        {:else}
          <div class="lib-essay-list">
            {#each filteredLibraryEssays as essay (essay.id)}
              {@const excerpt = libraryExcerpts.get(essay.id)}
              <div class="lib-essay-card" class:lib-essay-card--public={essay.is_public}>
                <button
                  type="button"
                  class="lib-essay-body"
                  onclick={() => openEditorForEssay(essay)}
                >
                  <div class="lib-essay-top">
                    <div class="lib-essay-title">{essay.title || 'Untitled'}</div>
                    <span
                      class="lib-essay-badge"
                      class:lib-essay-badge--public={essay.is_public}
                      role="button"
                      tabindex="0"
                      onclick={(e) => { e.stopPropagation(); toggleLibraryPublish(essay); }}
                      onkeydown={(e) => e.key === 'Enter' && toggleLibraryPublish(essay)}
                    >
                      {essay.is_public ? 'Public' : 'Draft'}
                    </span>
                  </div>
                  {#if excerpt}
                    <div class="lib-essay-excerpt">{@html excerpt}</div>
                  {/if}
                  <div class="lib-essay-footer">
                    <span>{countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}</span>
                    {#if essay.is_public && essay.author_username}
                      <span role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); const url = `/@${encodeURIComponent(essay.author_username!)}/${encodeURIComponent(essay.slug)}/`; void navigator.clipboard.writeText(window.location.origin + url); feedLinkCopiedId = essay.id; clearTimeout(feedLinkCopiedTimer); feedLinkCopiedTimer = setTimeout(() => { feedLinkCopiedId = null; }, 1500); }} onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); const url = `/@${encodeURIComponent(essay.author_username!)}/${encodeURIComponent(essay.slug)}/`; void navigator.clipboard.writeText(window.location.origin + url); feedLinkCopiedId = essay.id; clearTimeout(feedLinkCopiedTimer); feedLinkCopiedTimer = setTimeout(() => { feedLinkCopiedId = null; }, 1500); } }} class="inline-flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors ml-1.5 p-1.5 relative" aria-label="Copy link">
                        {#if feedLinkCopiedId === essay.id}
                          <span class="absolute right-full top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 mr-1.5">Copied!</span>
                        {/if}
                        <Link class="size-4" aria-hidden="true" />
                      </span>
                    {/if}
                    <span class="lib-essay-dot" aria-hidden="true">·</span>
                    <span>{formatFeedDate(essay.updated_at)}</span>
                    {#if essay.is_public && essay.published_at}
                      <span class="lib-essay-dot" aria-hidden="true">·</span>
                      <span>Published {formatFeedDate(essay.published_at)}</span>
                    {/if}
                  </div>
                </button>
                <button
                  type="button"
                  class="lib-essay-delete"
                  class:lib-essay-delete--confirm={libraryDeleteConfirmId === essay.id}
                  aria-label={libraryDeleteConfirmId === essay.id ? 'Confirm delete' : 'Delete essay'}
                  onclick={() => handleLibraryDelete(essay.id)}
                  onblur={clearLibraryDeleteConfirm}
                >
                  {#if libraryDeleteConfirmId === essay.id}
                    Sure?
                  {:else}
                    <Trash2 class="size-3" aria-hidden="true" />
                  {/if}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        {#if libraryLogsLoading && libraryLogs.length === 0}
          <div class="pub-empty">Loading your diary…</div>
        {:else if libraryLogs.length === 0}
          <div class="pub-empty">
            <div class="pub-empty-title">No reading logs yet.</div>
            <div class="pub-empty-hint">Log a book from the Books tab.</div>
          </div>
        {:else}
          <ReadingLogDiary
            logs={libraryLogs}
            onDelete={handleLibraryLogDelete}
            deleteConfirmId={libraryLogDeleteConfirmId}
            onBlurDelete={clearLibraryLogDeleteConfirm}
          />
        {/if}
      {/if}
    </div>
  {:else}
    <div
      class="pub-scroll no-scrollbar"
      class:pub-scroll--refreshing={feedRefreshing}
      bind:this={feedScrollEl}
      ontouchstart={feedTouchStart}
      ontouchmove={feedTouchMove}
      ontouchend={feedTouchEnd}
    >
      {#if feedPullY > 0 || feedRefreshing}
        <div class="pub-feed-pull-indicator" style="height: {feedRefreshing ? 32 : feedPullY}px;">
          {#if feedRefreshing}
            <svg class="pub-feed-spinner" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round" />
            </svg>
          {:else}
            <svg class="pub-feed-spinner" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="opacity: {Math.min(feedPullY / 60, 1)};">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round" />
            </svg>
          {/if}
        </div>
      {/if}
      {#if readingEssayLoading}
        <div class="pub-empty">Loading article…</div>
      {:else if readingEssayError}
        <div class="pub-empty">
          <div class="pub-empty-title">{readingEssayError}</div>
          <button type="button" class="pub-article-back-link" onclick={closeArticle}>← Back to feed</button>
        </div>
      {:else if readingEssay}
        <EssayView essay={readingEssay} {linkCopied} onCopyLink={copyLink} onProseClick={onArticleProseClick} onViewUser={(e) => { e.stopPropagation(); viewUser(readingEssay!.author_username || 'Anonymous', readingEssay!.author_avatar_url, readingEssay!.author_avatar_seed); }} />
      {:else if isFeedSearching}
        {#if searchLoading}
          <div class="pub-empty">Searching…</div>
        {:else if searchQueryError}
          <div class="pub-empty pub-empty--search">
            <div class="pub-empty-title">{searchQueryError}</div>
          </div>
        {:else if searchResults.length === 0}
          <div class="pub-empty pub-empty--search">
            <div class="pub-empty-title">No essays match "{searchQuery.trim()}".</div>
            <div class="pub-empty-hint">Try a different title, author, or phrase.</div>
          </div>
        {:else}
          {#each searchResults as item, i (item.id)}
            <article
              class="pub-feed-item pub-feed-search-item"
              class:pub-feed-item--last={i === searchResults.length - 1}
              style="animation-delay: {Math.min(i * 30, 200)}ms"
            >
              {@render feedCard(item)}
            </article>
          {/each}
        {/if}
      {:else if isAuthLoading || isLoading}
        <div class="pub-feed-loading">
          <svg class="pub-feed-spinner" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round" />
          </svg>
        </div>
      {:else if publicFeedLoading && !feedRefreshing}
        <div class="pub-feed-loading">
          <svg class="pub-feed-spinner" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round" />
          </svg>
        </div>
      {:else if publicFeed.length === 0}
        <div class="pub-empty">
          <div class="pub-empty-title">The feed is quiet right now.</div>
          <div class="pub-empty-hint">Be the first to publish something.</div>
        </div>
      {:else}
        {@const featured = publicFeed[0]}
        {@const rest = publicFeed.slice(1)}
        <article class="pub-featured">
          {@render feedCard(featured, true)}
        </article>

        {#each rest as item, i}
          <article class="pub-feed-item" class:pub-feed-item--last={i === rest.length - 1}>
            {@render feedCard(item)}
          </article>
        {/each}
        <div class="pub-feed-end">- x -</div>
      {/if}
    </div>
  {/if}
  {/if}
    </div>
  </div>

    {#if !isWriting && !readingEssay && !readingEssayLoading}
      <button
        type="button"
        class="pub-write-fab"
        onclick={handleWriteFabClick}
        disabled={isAuthLoading || isLoading}
        aria-label={currentUser ? 'Write new essay' : 'Sign in to write'}
      >
        <Plus class="size-8" aria-hidden="true" />
      </button>
    {/if}
  </div>

  </div>
  </div>
  </div>

  <div class="app-footer">
    <a
      href="https://github.com/Kono-o/tractatus"
      target="_blank"
      rel="noopener noreferrer"
      title="Click to visit the Tractatus GitHub repo. Ctrl+click (or Cmd+click) the left side for the update demo, right side for the post-update demo."
    >
      <span
        role="button"
        tabindex="0"
        class="app-footer__brand"
        onclick={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); manuallyOpenUpdateMenu(); } }}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (e.ctrlKey || e.metaKey) manuallyOpenUpdateMenu(); } }}
      >
        TRACTATUS v{APP_VERSION}
      </span>
      <span class="app-footer__sep" aria-hidden="true">—</span>
      <span
        role="button"
        tabindex="0"
        class="app-footer__rights"
        onclick={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); manuallyOpenPostUpdateMenu(); } }}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (e.ctrlKey || e.metaKey) manuallyOpenPostUpdateMenu(); } }}
      >
        made by Arya
      </span>
    </a>
  </div>
</div>

{#if showAuthPanel && !currentUser}
  <div
    class="settings-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Sign in or sign up"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) closeAuthPanel(); }}
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
            aria-label={logoEyeOpen ? 'Close eye' : 'Open eye'}
          >
            {#if logoEyeOpen}
              <Eye class="settings-panel-brand__eye-icon" aria-hidden="true" />
            {:else}
              <EyeClosed class="settings-panel-brand__eye-icon" aria-hidden="true" />
            {/if}
          </button>
          <span class="settings-panel-brand__lift">Tractatus</span>
        </div>
        <button
          type="button"
          aria-label="Close"
          class="settings-panel-header__close"
          onclick={closeAuthPanel}
        >
          <X class="size-3.5" />
        </button>
      </div>
      <div class="settings-panel-body auth-overlay-body">
        <AuthScreen embedded onAuthenticated={handleAuthSuccess} />
      </div>
    </div>
  </div>
{/if}

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
    <div class="settings-panel-dialog rounded-xl shadow-xl overflow-hidden text-left">
      <div class="settings-panel-header">
        {@render panelHeaderRow()}
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

      <div class="settings-panel-body text-[10px] leading-snug">
        {#if currentUser}
          <div class="flex flex-col items-center gap-1.5 settings-panel-avatar-section">
            {#if avatarUrl}
              <button
                type="button"
                onclick={shuffleAvatarSeed}
                disabled={avatarShuffleCooldown || !!avatarUrl}
                class="cursor-default {avatarShuffleCooldown ? 'opacity-60 cursor-default' : ''}"
              >
                {#key avatarSeed + '' + avatarUrl}
                  <GeneratedAvatar userId={currentUser.id} seed={avatarSeed} avatarUrl={avatarUrl} size={80} />
                {/key}
              </button>
            {:else}
              <button
                type="button"
                onclick={shuffleAvatarSeed}
                disabled={avatarShuffleCooldown}
                class="cursor-pointer hover:opacity-90 active:scale-[0.96] transition-all focus:outline-none {avatarShuffleCooldown ? 'opacity-60 cursor-default' : ''}"
                title="Click to shuffle to a new random identicon seed (saved)"
              >
                {#key avatarSeed + '' + avatarUrl}
                  <GeneratedAvatar userId={currentUser.id} seed={avatarSeed} avatarUrl={avatarUrl} size={80} />
                {/key}
              </button>
            {/if}
            <div class="flex items-center justify-center gap-2 pt-1">
              {#if avatarUrl}
                <button
                  type="button"
                  title="Hold 2s to remove profile photo"
                  class="settings-panel-avatar-remove-btn {avatarRemoveTapPulseActive || avatarRemoveProgress > 0 ? 'settings-panel-avatar-remove-btn--active' : ''} {avatarRemoveTapPulseActive ? 'hold-cancel-tap-pulse' : ''}"
                  disabled={avatarUploading}
                  onmousedown={startAvatarRemoveHold}
                  onmouseup={stopAvatarRemoveHold}
                  onmouseleave={stopAvatarRemoveHold}
                  ontouchstart={startAvatarRemoveHold}
                  ontouchend={stopAvatarRemoveHold}
                >
                  <div class="settings-panel-avatar-remove-btn__fill" style="width: {avatarRemoveProgress}%;"></div>
                  <span class="settings-panel-avatar-remove-btn__label">
                    <Trash2 class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                    {avatarUploading ? 'Removing…' : 'Remove photo'}
                  </span>
                </button>
              {:else}
                <button
                  type="button"
                  class="settings-panel-avatar-upload-btn"
                  disabled={avatarUploading}
                  onclick={triggerAvatarUpload}
                >
                  <Upload class="size-3 shrink-0 pointer-events-none" aria-hidden="true" />
                  {avatarUploading ? 'Uploading…' : 'Upload photo'}
                </button>
              {/if}
            </div>
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            bind:this={avatarFileInput}
            class="hidden"
            onchange={handleAvatarFileChange}
          />
        {/if}
        <div class="settings-panel-stats">
          {#if supabasePanelLoading && !supabasePanel}
            <p class="settings-panel-loading">Loading backend…</p>
          {:else if supabasePanel}
            {@const panel = supabasePanel}
        {#if isAuthLoading}
          <span class="pub-header-icon-btn pub-header-avatar flex items-center justify-center">
            <RefreshCw class="size-4 animate-spin" style="color: var(--hint);" aria-hidden="true" />
          </span>
        {:else if currentUser}
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
                <span class="text-[10px] text-zinc-500 settings-panel-joined">joined {accountMemberSince}</span>
                <span class="text-[10px] text-zinc-500 settings-panel-joined">Session: {formatSessionExpiry(panel.expiresAt)}</span>
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

{#if showUpdatePrompt && updateInfo && (currentUser || !isNativeApp())}
  <div
    class="settings-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Update available"
    tabindex="-1"
  >
    <div class="settings-panel-dialog rounded-xl shadow-xl overflow-hidden text-left">
      <div class="settings-panel-header">
        {@render panelHeaderRow()}
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

      <div class="settings-panel-body text-[10px] leading-snug">
        <div class="flex flex-col items-center text-center">
          <div class="update-badge">
            UPDATE AVAILABLE
            {#if updateInfo.size}
              · {(updateInfo.size / 1024 / 1024).toFixed(1)} MB
            {/if}
          </div>

          <div class="mt-2 flex items-center gap-3">
            <div class="flex flex-col items-center">
              <div class="update-version-num update-version-num--muted">v{APP_VERSION}</div>
            </div>

            <ChevronRight class="update-version-arrow" aria-hidden="true" />

            <div class="flex flex-col items-center">
              <div class="update-version-num update-version-num--new">v{updateInfo.version}</div>
            </div>
          </div>
        </div>

        {#if updateInfo.notes}
          <div class="mt-3">
            <div class="update-section-label">WHAT'S NEW</div>
            <div class="update-notes-box max-h-40 overflow-auto rounded p-2.5 text-[10px] leading-snug markdown-content no-scrollbar">
              {@html renderChangelog(updateInfo.notes)}
            </div>
          </div>
        {:else}
          <p class="update-dialog-copy mt-3">A new version of Tractatus is ready.</p>
        {/if}

        {#if updateError && !updateInstalling}
          <p class="settings-panel-alert mt-2">{updateError}</p>
        {/if}

        <div class="mt-3 min-h-[1.75rem] flex items-center">
          {#if !updateInstalling}
            <span class="update-dialog-copy block text-center">Install to receive the latest features and fixes.</span>
          {:else if updateInstalling}
            {#if !isWaitingForUpdatePermission}
              <div class="flex items-center gap-2 w-full">
                <div class="flex-1 h-1.5 rounded bg-[color:var(--surf)] overflow-hidden border border-[color:var(--border)]">
                  <div
                    class="h-1.5 bg-emerald-500 transition-[width] duration-75"
                    style="width: {updateDownloadProgress}%"
                  ></div>
                </div>
                <span class="update-dialog-copy tabular-nums w-8 text-right">{updateDownloadProgress}%</span>
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
              ? 'settings-panel-action-btn settings-panel-action-btn--full pointer-events-none opacity-70'
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

{#if showPostUpdate && (currentUser || !isNativeApp())}
  <div
    class="settings-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="App updated"
    tabindex="-1"
  >
    <div class="settings-panel-dialog rounded-xl shadow-xl overflow-hidden text-left">
      <div class="settings-panel-header">
        {@render panelHeaderRow()}
        <button
          type="button"
          aria-label="Close"
          class="settings-panel-header__close"
          onclick={closePostUpdate}
        >
          <X class="size-3.5" />
        </button>
      </div>

      <div class="settings-panel-body text-[10px] leading-snug">
        <div class="flex flex-col items-center text-center">
          <div class="update-badge">
            UPDATED
            <Check class="size-3.5" aria-hidden="true" />
          </div>

          <div class="mt-2 flex items-center gap-3">
            <div class="flex flex-col items-center">
              <div class="update-version-num update-version-num--new">v{postUpdateVersion}</div>
            </div>
          </div>
        </div>

        {#if postUpdateNotes}
          <div class="mt-3">
            <div class="update-section-label">WHAT'S NEW</div>
            <div class="update-notes-box max-h-44 overflow-auto rounded p-2 text-[10px] leading-snug markdown-content no-scrollbar">
              {@html renderChangelog(postUpdateNotes)}
            </div>
            <span class="update-dialog-copy mt-2 block text-center">Thanks for staying up to date!</span>
          </div>
        {:else}
          <p class="update-dialog-copy mt-3 text-center">You're now running the latest version.</p>
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