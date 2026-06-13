<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
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
  } from '$lib/db';
  import AuthScreen from '$lib/components/AuthScreen.svelte';
  import RichEditor from '$lib/components/RichEditor.svelte';
  // IMPORTANT: updater (and thus all @capacitor/* modules) must NOT be statically imported.
  // Static imports of native-only code cause 500 Internal Server Errors during SSR on Vercel.
  // We use dynamic import() only from client-side code (onMount + event handlers).
  import type { UpdateInfo } from '$lib/updater';
  import { APP_VERSION } from '$lib/version';
  import { isNativeApp } from '$lib/native';
  import type { User as SupabaseUser } from '@supabase/supabase-js';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import hljs from 'highlight.js';
  import confetti from 'canvas-confetti';
  import {
    loadSupabasePanelSnapshot,
    formatSessionExpiry,
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
    X,
    BookOpen,
    Search,
    Plus,
    User,
  } from '@lucide/svelte';

  const FEED_SEARCH_DEBOUNCE_MS = 280;
  const FEED_EXCERPT_FEATURED = 400;
  const FEED_EXCERPT_ITEM = 160;

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
  }

  function selectLibraryTab() {
    if (!currentUser) {
      openAuthPanel();
      return;
    }
    viewMode = 'library';
    closeArticle();
    if (isWriting) void exitWriting();
  }

  let readingEssay = $state<Essay | null>(null);
  let readingEssayLoading = $state(false);
  let readingEssayError = $state<string | null>(null);

  function preprocessMarkdown(md: string): string {
    if (!md) return '';
    let out = md;
    out = out.replace(/(?<!=)==(.+?)==(?!=)/g, '<mark>$1</mark>');
    out = out.replace(/\^(.+?)\^/g, '<sup>$1</sup>');
    out = out.replace(/(?<!~)~(?!~)(.+?)~(?!~)/g, '<sub>$1</sub>');
    out = out.replace(/::: (center|left|right)\s*([\s\S]*?):::/g, (_m, align, inner) => {
      return `<div style="text-align:${align}">${inner.trim()}</div>`;
    });
    return out;
  }

  function renderEssay(md: string): string {
    if (!md) return '';
    if (typeof window === 'undefined' || typeof DOMPurify === 'undefined') {
      return md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
    const pre = preprocessMarkdown(md);
    const raw = marked.parse(pre, { breaks: true, gfm: true }) as string;
    const highlighted = raw.replace(/<pre><code(\s+class="[^"]*")?>([\s\S]*?)<\/code><\/pre>/g, (_m, cls, code) => {
      const decoded = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const result = hljs.highlightAuto(decoded);
      return `<pre><code class="hljs language-${result.language}">${result.value}</code></pre>`;
    });
    return DOMPurify.sanitize(highlighted, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
        'ul', 'ol', 'li', 'a', 'code', 'pre',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'hr', 'mark', 'sup', 'sub', 'div', 'span',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'img',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'class', 'src', 'alt'],
    });
  }

  function closeArticle() {
    readingEssay = null;
    readingEssayError = null;
    readingEssayLoading = false;
  }

  async function openArticle(essay: Essay) {
    viewMode = 'feed';
    if (searchExpanded) await toggleSearch();
    readingEssayLoading = true;
    readingEssayError = null;
    readingEssay = null;
    try {
      if (essay.content?.trim()) {
        readingEssay = essay;
      } else {
        const full = await db.getPublicEssayBySlug(essay.slug);
        if (!full) readingEssayError = 'This essay is not public or does not exist.';
        else readingEssay = full;
      }
    } catch (e) {
      console.warn('[article] load failed', e);
      readingEssayError = 'Failed to load essay.';
    } finally {
      readingEssayLoading = false;
    }
  }

  function handleHeaderBack() {
    if (isWriting) void exitWriting();
    else closeArticle();
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
  let stageRevealActive = $state(false);
  const BOOT_ACCOUNT_REVEAL_HOLD_MS = 900;

  // Account / settings panel (ported from Lift Tracker)
  let showSettingsPanel = $state(false);
  let showAuthPanel = $state(false);
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
  let libraryEssays = $derived(
    [...essays].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
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

  let libraryDeleteTargetId = $state<string | null>(null);
  let libraryDeleteProgress = $state(0);
  let libraryDeleteTimer: ReturnType<typeof setInterval> | null = null;

  function stopLibraryDeleteHold() {
    if (libraryDeleteTimer) clearInterval(libraryDeleteTimer);
    libraryDeleteTimer = null;
    libraryDeleteProgress = 0;
    libraryDeleteTargetId = null;
  }

  function startLibraryDeleteHold(essayId: string) {
    libraryDeleteTargetId = essayId;
    const startTime = Date.now();
    libraryDeleteProgress = 0;
    libraryDeleteTimer = setInterval(() => {
      libraryDeleteProgress = Math.min(((Date.now() - startTime) / 1100) * 100, 100);
      if (libraryDeleteProgress >= 100) {
        clearInterval(libraryDeleteTimer!);
        libraryDeleteTimer = null;
        libraryDeleteProgress = 0;
        libraryDeleteTargetId = null;
        void performLibraryDelete(essayId);
      }
    }, 16);
  }

  async function performLibraryDelete(essayId: string) {
    try {
      await db.deleteEssay(essayId);
      essays = essays.filter(e => e.id !== essayId);
    } catch (e) {
      console.error('[library] delete failed', e);
    }
  }

  function countWords(s: string): number {
    return (s || '').trim().split(/\s+/).filter(Boolean).length;
  }
  let editorWordCount = $derived(countWords(editorContent));
  let editorReadMins = $derived(estimateReadTimeMinutes(editorContent));

  let currentEssay = $derived(essays.find(e => e.id === currentEssayId) ?? null);
  let isPublished = $derived(!!(currentEssay?.is_public || (currentEssayId && editorSlug && essays.some(e => e.id === currentEssayId && e.is_public))));

  // For the CTA label transform
  let mainActionLabel = $derived(isPublished ? 'UPDATE' : 'PUBLISH');

  // View modes for main menu
  let viewMode = $state<'feed' | 'library'>('feed');
  let publicFeed = $state<Essay[]>([]);
  let publicFeedLoading = $state(false);
  let publicFeedLoadedOnce = $state(false);
  let feedRefreshing = $state(false);
  let feedPullY = $state(0);
  let feedScrollEl = $state<HTMLElement | null>(null);
  let feedTouchStartY = $state(0);
  let feedTouchId = $state<number | null>(null);
  let searchQuery = $state('');
  // Deduping guard: timestamp of last feed refresh (ms)
  let lastFeedRefreshAt = $state<number | null>(null);
  const FEED_REFRESH_DEDUP_MS = 800; // ignore refreshes within 800ms of previous one

  let searchResults = $state<Essay[]>([]);
  let searchLoading = $state(false);
  let searchExpanded = $state(false);
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let feedSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  let isFeedSearching = $derived(searchQuery.trim().length > 0 && viewMode === 'feed');

  async function runFeedSearch(query: string) {
    const term = query.trim();
    if (!term) {
      searchResults = [];
      searchLoading = false;
      return;
    }
    searchLoading = true;
    try {
      searchResults = await db.searchPublicEssays(term);
    } catch (e) {
      console.warn('[feed] search failed', e);
      searchResults = [];
    } finally {
      searchLoading = false;
    }
  }

  function onSearchInput(value: string) {
    searchQuery = value;
    if (viewMode === 'library') {
      librarySearchQuery = value;
      return;
    }
    if (value.trim()) viewMode = 'feed';
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
      return;
    }
    searchQuery = '';
    librarySearchQuery = '';
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

  function renderExcerpt(md: string, maxLength = 200): string {
    if (!md) return '';
    const processed = md
      .replace(/(?<!=)==(.+?)==(?!=)/g, '<mark>$1</mark>')
      .replace(/\^(.+?)\^/g, '<sup>$1</sup>')
      .replace(/(?<!~)~(.+?)~(?!~)/g, '<sub>$1</sub>');
    let html = marked.parse(processed, { breaks: true, gfm: true }) as string;
    html = html.replace(/<pre><code(\s+class="[^"]*")?>([\s\S]*?)<\/code><\/pre>/g, (_m, cls, code) => {
      const decoded = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const result = hljs.highlightAuto(decoded);
      return `<pre><code class="hljs language-${result.language}">${result.value}</code></pre>`;
    });
    if (html.length > maxLength) {
      html = html.slice(0, maxLength);
      const lastSpace = html.lastIndexOf(' ');
      if (lastSpace > 0) html = html.slice(0, lastSpace);
      html += '…';
    }
    return html;
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
        m.set(e.id, renderExcerpt(e.content, 120));
      }
      libraryExcerpts = m;
    } catch (e) {
      console.warn('[essays] load failed', e);
    } finally {
      if (wasInitial) essaysLoading = false;
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

  async function ensureUniqueSlug(slug: string, excludeId: string | null): Promise<string> {
    let candidate = slug || 'untitled';
    let suffix = 2;
    while (!(await db.isSlugAvailable(candidate, excludeId))) {
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

  async function saveCurrent(forcePublic: boolean) {
    if (isSaving) return;
    const title = (editorTitle || 'Untitled').trim();
    if (!title && !editorContent.trim()) {
      saveError = 'Add a title or some text first.';
      return;
    }
    saveError = null;
    isSaving = true;

    let targetSlug = editorSlug.trim() || slugifyTitle(title);
    const exclude = currentEssayId;

    try {
      targetSlug = await ensureUniqueSlug(targetSlug, exclude);

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

  async function handlePublish() {
    saveError = null;
    await saveCurrent(true);
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
    // focus title or content next tick (in markup we can use autofocus on enter)
  }

  async function enterNewWrite() {
    if (searchExpanded) await toggleSearch();
    closeArticle();
    resetEditor();
    isWriting = true;
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
</script>

{#snippet panelHeaderRow()}
  <div class="settings-panel-header__brand-row">
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
        <div
          class="pub-header-logo"
          class:pub-header-logo--hidden={searchExpanded && !articleMode && !writingMode}
          aria-hidden={searchExpanded && !writingMode && !articleMode}
        >
          Tractatus
        </div>
      </div>

      <div
        class="pub-header-search-slot"
        class:pub-header-search-slot--open={searchExpanded}
        class:pub-header-search-slot--hidden={articleMode}
        aria-hidden={articleMode || undefined}
        inert={articleMode || undefined}
      >
        <input
          bind:this={searchInputEl}
          type="search"
          class="pub-header-search-input"
          placeholder={viewMode === 'library' ? 'Filter essays…' : 'Search essays'}
          value={searchQuery}
          oninput={(e) => onSearchInput(e.currentTarget.value)}
          onkeydown={onSearchKeydown}
          aria-label={viewMode === 'library' ? 'Filter your essays' : 'Search all public essays'}
          tabindex={searchExpanded ? 0 : -1}
        />
      </div>

      <div class="pub-header-actions">
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
            class="pub-header-publish-btn"
            onclick={handlePublish}
            disabled={isSaving}
          >
            <BookOpen class="size-3" aria-hidden="true" />
            {mainActionLabel}
          </button>
        {/if}
        {#if currentUser}
          <button
            type="button"
            class="pub-header-icon-btn pub-header-avatar"
            onclick={openSettingsPanel}
            aria-label="Account and settings"
          >
            {#key avatarSeed}
              <GeneratedAvatar userId={currentUser.id} seed={avatarSeed} size={28} rounded={0} />
            {/key}
          </button>
        {:else}
          <button
            type="button"
            class="pub-header-icon-btn pub-header-guest-btn"
            onclick={openAuthPanel}
            aria-label="Sign in or sign up"
          >
            <User class="size-3.5" aria-hidden="true" />
          </button>
        {/if}
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
            <div class="pub-header-meta-status">
              <span class="pub-header-meta-dot" class:pub-header-meta-dot--active={isSaving}></span>
              <span>
                {#if isSaving}
                  Saving…
                {:else if lastSavedAt}
                  Saved {Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000))}s ago
                {:else}
                  Draft
                {/if}
              </span>
            </div>
            <span class="pub-header-meta-wordcount">{editorWordCount} words · {fmtReadTime(editorReadMins)}</span>
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
    onclick={() => void openArticle(essay)}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter') void openArticle(essay); }}
  >
    <div class="pub-feed-card-meta">
      <span class="pub-feed-card-meta-left">
        {#key essay.author_avatar_seed}
          <span class="pub-feed-card-avatar">
            <GeneratedAvatar
              userId={essay.user_id}
              seed={essay.author_avatar_seed}
              size={featured ? 24 : 20}
              rounded={0}
            />
          </span>
        {/key}
        <span class="pub-feed-card-byline">
          {essay.author_username || 'Anonymous'}
        </span>
        <span class="pub-feed-card-sep" aria-hidden="true">·</span>
        <span class="pub-feed-card-date">{formatFeedDate(essay.published_at || essay.updated_at)}</span>
      </span>
      <span class="pub-feed-card-meta-right">
        <span class="pub-feed-card-readtime">{countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}</span>
      </span>
    </div>
    <div class="pub-feed-card-body">
      <span
        class="pub-feed-card-title"
        class:pub-feed-card-title--featured={featured}
      >
        {essay.title || 'Untitled'}
      </span>
      {#if renderExcerpt(essay.content, FEED_EXCERPT_FEATURED)}
        <div
          class="pub-feed-card-excerpt markdown-content"
          class:pub-feed-card-excerpt--featured={featured}
        >
          {@html renderExcerpt(essay.content, FEED_EXCERPT_FEATURED)}
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
      <span
        class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[color:var(--surf)] rounded border border-[color:var(--border)] justify-center text-[color:var(--hint)]"
        class:boot-panel-placeholder={ghost}
      >
        <Pencil class="size-3 shrink-0 {ghost ? 'boot-panel-placeholder__ghost' : ''}" aria-hidden="true" />
        <span class="leading-none {ghost ? 'boot-panel-placeholder__ghost' : ''}">{writingCount} essay{writingCount === 1 ? '' : 's'}</span>
      </span>
    </div>
  </div>
{/snippet}

{#snippet bootScreen()}
  {@const panel = supabasePanel}
  <div
    class="settings-panel-dialog boot-panel-dialog rounded-xl shadow-xl overflow-hidden text-left"
    class:boot-panel-reveal--active={bootAccountReveal}
    role="status"
    aria-live="polite"
    aria-busy={!bootAccountReveal}
    aria-label={bootAccountReveal ? 'Account ready' : bootMessage}
  >
    <div class="settings-panel-header">
      {@render panelHeaderRow()}
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

<div class="app w-full h-dvh max-h-dvh overflow-hidden select-none flex flex-col font-sans" class:app--pub={!isAuthLoading}>
  <div class="app-stage flex-1 flex flex-col min-h-0 w-full relative overflow-hidden">
  <div class="app-stage-scroll flex-1 min-h-0 flex flex-col overflow-hidden">
  <div
    class="app-stage-reveal app-stack-gap flex flex-col flex-1 min-h-0 w-full overflow-hidden"
    class:app-stage-reveal--active={stageRevealActive || !isAuthLoading}
  >
  {#if isAuthLoading}
    <div class="app-loading flex-1 min-h-0 flex items-center justify-center">
      <div class="boot-panel-avatar-spinner" style="width: 2.25rem; height: 2.25rem; border-width: 3px;"></div>
    </div>
  {:else}
  <div class="pub-shell flex flex-col flex-1 min-h-0 w-full overflow-hidden">
    {@render compactHeader(isWriting, !!readingEssay)}

    <div class="pub-body flex flex-col flex-1 min-h-0 overflow-hidden">
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

      {#if currentEssayId}
        <div class="editor-action-bar mx-3">
          <button
            type="button"
            title="Hold to delete essay"
            class="editor-action-btn {deleteHoldProgress > 0 ? 'editor-action-btn--danger-hold' : 'editor-action-btn--danger'}"
            onmousedown={startDeleteHold}
            onmouseup={stopDeleteHold}
            onmouseleave={stopDeleteHold}
            ontouchstart={startDeleteHold}
            ontouchend={stopDeleteHold}
            disabled={isSaving}
          >
            <div class="settings-panel-action-btn__fill settings-panel-action-btn__fill--delete" style="width: {deleteHoldProgress}%;"></div>
            <span class="settings-panel-action-btn__label">
              <Trash2 class="size-3.5 shrink-0 pointer-events-none" aria-hidden="true" />
            </span>
          </button>
        </div>
      {/if}
    </div>
  {:else}
    {#if !readingEssay && !readingEssayLoading}
    <nav class="pub-view-nav" aria-label="Feed and library">
      <button
        type="button"
        class="pub-view-tab"
        class:pub-view-tab--active={viewMode === 'feed'}
        onclick={selectFeedTab}
      >
        Feed
      </button>
      {#if currentUser}
        <button
          type="button"
          class="pub-view-tab"
          class:pub-view-tab--active={viewMode === 'library'}
          onclick={selectLibraryTab}
        >
          Library
        </button>
      {/if}
    </nav>
    {/if}

  {#if currentUser && viewMode === 'library'}
    <div class="pub-scroll no-scrollbar" in:fly={{ x: 6, duration: 160, opacity: 1 }}>
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
          <div class="library-cards">
            {#each filteredLibraryEssays as essay (essay.id)}
              {@const excerpt = libraryExcerpts.get(essay.id)}
              <div class="library-card" class:library-card--public={essay.is_public}>
                <button
                  type="button"
                  class="library-card-body"
                  onclick={() => openEditorForEssay(essay)}
                >
                  <div class="library-card-top">
                    <div class="library-card-title">{essay.title || 'Untitled'}</div>
                    <span class="library-card-badge" class:library-card-badge--public={essay.is_public}>
                      {essay.is_public ? 'Public' : 'Draft'}
                    </span>
                  </div>
                  {#if excerpt}
                    <div class="library-card-excerpt">{@html excerpt}</div>
                  {/if}
                  <div class="library-card-footer">
                    <span>{countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}</span>
                    <span class="library-card-dot" aria-hidden="true">·</span>
                    <span>{formatFeedDate(essay.updated_at)}</span>
                    {#if essay.is_public && essay.published_at}
                      <span class="library-card-dot" aria-hidden="true">·</span>
                      <span>Published {formatFeedDate(essay.published_at)}</span>
                    {/if}
                  </div>
                </button>
                <button
                  type="button"
                  class="library-card-delete"
                  class:library-card-delete--hold={libraryDeleteTargetId === essay.id && libraryDeleteProgress > 0}
                  aria-label="Delete essay"
                  title="Hold to delete"
                  onmousedown={() => startLibraryDeleteHold(essay.id)}
                  onmouseup={stopLibraryDeleteHold}
                  onmouseleave={stopLibraryDeleteHold}
                  ontouchstart={() => startLibraryDeleteHold(essay.id)}
                  ontouchend={stopLibraryDeleteHold}
                >
                  {#if libraryDeleteTargetId === essay.id && libraryDeleteProgress > 0}
                    <div class="library-card-delete-fill" style="width: {libraryDeleteProgress}%;"></div>
                  {/if}
                  <Trash2 class="size-3" aria-hidden="true" />
                </button>
              </div>
            {/each}
          </div>
        {/if}
    </div>
  {:else}
    <div class="pub-scroll no-scrollbar" in:fly={{ x: -6, duration: 160, opacity: 1 }}>
      {#if readingEssayLoading}
        <div class="pub-empty">Loading article…</div>
      {:else if readingEssayError}
        <div class="pub-empty">
          <div class="pub-empty-title">{readingEssayError}</div>
          <button type="button" class="pub-article-back-link" onclick={closeArticle}>← Back to feed</button>
        </div>
      {:else if readingEssay}
        <article class="pub-article">
          <h1 class="pub-article-title">{readingEssay.title || 'Untitled'}</h1>
          <div class="pub-article-byline">
            {#key readingEssay.author_avatar_seed}
              <div class="pub-author-avatar">
                <GeneratedAvatar
                  userId={readingEssay.user_id}
                  seed={readingEssay.author_avatar_seed}
                  size={24}
                  rounded={0}
                />
              </div>
            {/key}
            <span class="pub-author-meta">
              {readingEssay.author_username || 'Anonymous'} &nbsp;·&nbsp;
              {new Date(readingEssay.published_at || readingEssay.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} &nbsp;·&nbsp;
              {countWords(readingEssay.content)} words · {fmtReadTime(estimateReadTimeMinutes(readingEssay.content))}
            </span>
          </div>
          <div class="pub-article-prose reader-prose markdown-content">
            {@html renderEssay(readingEssay.content)}
          </div>
        </article>
      {:else if isFeedSearching}
        {#if searchLoading}
          <div class="pub-empty">Searching…</div>
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
      {:else if publicFeedLoading}
        <div class="pub-empty">Loading essays…</div>
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
        aria-label={currentUser ? 'Write new essay' : 'Sign in to write'}
      >
        <Plus class="size-6" aria-hidden="true" />
      </button>
    {/if}
  </div>
  {/if}

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
        Tractatus v{APP_VERSION}
      </span>
      <span class="app-footer__sep" aria-hidden="true">—</span>
      <span
        role="button"
        tabindex="0"
        class="app-footer__rights"
        onclick={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); manuallyOpenPostUpdateMenu(); } }}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (e.ctrlKey || e.metaKey) manuallyOpenPostUpdateMenu(); } }}
      >
        All rights reserved by Arya.
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
        <span class="settings-panel-brand__lift">Tractatus</span>
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

            <div class="update-version-arrow" aria-hidden="true">→</div>

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

{#if showPostUpdate && !bootOverlayVisible && (currentUser || !isNativeApp())}
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