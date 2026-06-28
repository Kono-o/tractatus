<script module lang="ts">
  interface BookResult {
    id: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    year: number | null;
    editions: number | null;
    publisher: string | null;
    first_publish_year?: number | null;
    subject_places?: string[];
    subject_times?: string[];
    subjects?: string[];
    subject_people?: string[];
    description?: string | null;
    isbn?: string | null;
    pages?: number | null;
    publish_date?: string | null;
  }

  interface BookDetails {
    description?: unknown;
    subjects?: string[];
    subject_places?: string[];
    subject_times?: string[];
    subject_people?: string[];
    first_publish_year?: number | null;
  }

  const searchCache = new Map<string, BookResult[]>();
  const MAX_CACHE = 50;
  function cacheSet(key: string, val: BookResult[]) {
    if (searchCache.has(key)) searchCache.delete(key);
    if (searchCache.size >= MAX_CACHE) {
      const first = searchCache.keys().next().value;
      if (first !== undefined) searchCache.delete(first);
    }
    searchCache.set(key, val);
  }
  function cacheGet(key: string): BookResult[] | undefined {
    const val = searchCache.get(key);
    if (val !== undefined) {
      searchCache.delete(key);
      searchCache.set(key, val);
    }
    return val;
  }
</script>

<script lang="ts">
  import { marked } from 'marked';
  import { fade } from 'svelte/transition';
  import { db, supabase, type ReadingLog, type ReadingLogWithAuthor } from '$lib/db';
  import { X, Star, BookMarked, Plus, Heart, Trash2 } from '@lucide/svelte';
  import CalendarPopover from './CalendarPopover.svelte';
  import GeneratedAvatar from './GeneratedAvatar.svelte';
  import { readingList as sharedList, addToReadingList as sharedAdd, removeFromReadingList as sharedRemove } from '$lib/reading-list.svelte';

  const PF_CARD_HEIGHT = 120;
  const PF_COVER_W = 80;
  const PF_COVER_H = 120;

  function capitalizeTitle(s: string): string {
    const articles = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'with', 'in', 'of', 'up', 'as', 'is', 'it']);
    return s.replace(/\w+/g, (w, i) =>
      i === 0 || !articles.has(w.toLowerCase()) ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase()
    );
  }

  function formatLogDate(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  let {
    searchQuery = '',
    onselect,
    searchExpanded = false,
    onaddbook,
    initialPublicLogs,
    currentUserId = null,
    onDelete,
  }: {
    searchQuery?: string;
    onselect?: () => void;
    searchExpanded?: boolean;
    onaddbook?: () => void;
    initialPublicLogs?: ReadingLogWithAuthor[];
    currentUserId?: string | null;
    onDelete?: (logId: string) => void;
  } = $props();

  // ── Carousel collapse ──
  let carouselCollapsed = $state(false);

  $effect(() => {
    if (searchExpanded && carouselCollapsed) {
      carouselCollapsed = false;
    }
  });

  // ── Search state ──
  let searchResults = $state<BookResult[]>([]);
  let searchLoading = $state(false);
  let searchError = $state<string | null>(null);
  let selectedIndex = $state(-1);
  let searchSource = $state<'client-cache' | 'server-cache' | 'openlibrary' | null>(null);
  let searchPhase = $state<'idle' | 'debouncing' | 'contacting' | 'done' | 'error'>('idle');
  let fetchDuration = $state(0);
  let searchGen = 0;
  let currentAbort: AbortController | null = null;
  let fetchStartTime = 0;
  let elapsed = $state(0);
  let searchTerm = $state('');
  let searchPage = $state(1);
  let hasMore = $state(false);
  let loadingMore = $state(false);
  let sentinelEl: HTMLElement | undefined = $state();

  let searchStatusSuffix = $derived.by(() => {
    if (searchPhase === 'contacting') return `${elapsed.toFixed(1)}s`;
    if (searchPhase === 'debouncing') return '0.0s';
    if (searchPhase === 'error') return 'Failed!';
    if (searchPhase === 'done') {
      if (searchResults.length === 0) return `${fetchDuration.toFixed(1)}s · 0 Results`;
      return `${fetchDuration.toFixed(1)}s · ${searchResults.length} Results`;
    }
    return 'Online';
  });
  let statusActive = $derived(searchPhase !== 'idle' && !(searchPhase === 'done' && searchResults.length === 0));

  $effect(() => {
    if (searchPhase !== 'contacting') return;
    const t = setInterval(() => { elapsed = (performance.now() - fetchStartTime) / 1000; }, 50);
    return () => clearInterval(t);
  });

  // ── Reading logs ──
  let logs = $state<ReadingLog[]>([]);
  let logsLoading = $state(true);

  async function loadLogs() {
    logsLoading = true;
    try {
      logs = await db.listReadingLogs();
    } catch (e) {
      console.warn('[diary] load logs failed', e);
    } finally {
      logsLoading = false;
    }
  }

  $effect(() => {
    void loadLogs();
  });

  function populateFormFromLog(log: ReadingLog) {
    editingLog = log;
    reviewText = log.review || '';
    const r = log.rating || 0;
    liked = log.liked === true ? true : null;
    reread = true;
    rating = Math.round(r * 2);
    startDate = log.start_date || log.read_date || '';
    endDate = log.end_date || '';
    logLastSavedAt = Date.now();
    saveError = null;
    logSnapshot = null;
    takeLogSnapshot();
  }

  function clearForm() {
    editingLog = null;
    reviewText = '';
    rating = 0;
    liked = null;
    reread = false;
    startDate = new Date().toISOString().split('T')[0];
    endDate = new Date().toISOString().split('T')[0];
    logLastSavedAt = null;
    saveError = null;
    logSnapshot = null;
    takeLogSnapshot();
  }

  // ── Book details overlay ──
  let bookDetailsLoading = $state(false);
  let bookDetails: BookDetails | null = $state(null);
  let selectedBook: BookResult | null = $state<BookResult | null>(null);
  let bookYear: number | null = $state<number | null>(null);
  let bookSelected = $state(false);
  let descCollapsed = $state(false);
  let panelTab = $state<'review' | 'info'>('info');
  let showCoverLightbox = $state(false);
  let editingLog: ReadingLog | null = $state(null);
  let readingListTrack: HTMLElement | undefined = $state();
  let placeholderCount = $state(0);
  let placeholderCountForItems = $derived(Math.max(1, placeholderCount - sharedList.items.length));
  let touchStartX = 0;
  let touchStartScroll = 0;
  let trackScrolled = $state(false);
  let publicReadingLogs: ReadingLogWithAuthor[] = $state(initialPublicLogs ?? []);
  let publicReadingLogsLoaded = $state(initialPublicLogs !== undefined);
  let viewedPublicReview: ReadingLogWithAuthor | null = $state<ReadingLogWithAuthor | null>(null);
  let pendingReviewRestore: ReadingLogWithAuthor | null = $state<ReadingLogWithAuthor | null>(null);
  function refreshPublicReadingLogs() {
    db.listPublicReadingLogs().then(logs => {
      publicReadingLogs = logs;
    }).catch(() => {});
  }

  let logsChannel: ReturnType<typeof supabase.channel> | null = $state(null);
  let logsFallbackTimer: ReturnType<typeof setInterval> | undefined = $state();

  $effect(() => {
    if (!publicReadingLogsLoaded) {
      db.listPublicReadingLogs().then(logs => {
        publicReadingLogs = logs;
        publicReadingLogsLoaded = true;
      }).catch(() => {
        publicReadingLogsLoaded = true;
      });
    }
  });

  $effect(() => {
    if (!publicReadingLogsLoaded) return;

    logsChannel = supabase.channel('public-logs-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'reading_logs' },
        () => { refreshPublicReadingLogs(); },
      )
      .subscribe();

    logsFallbackTimer = setInterval(refreshPublicReadingLogs, 300_000);

    return () => {
      if (logsChannel) {
        supabase.removeChannel(logsChannel);
        logsChannel = null;
      }
      if (logsFallbackTimer) {
        clearInterval(logsFallbackTimer);
        logsFallbackTimer = undefined;
      }
    };
  });

  function onTrackTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
    touchStartScroll = readingListTrack?.scrollLeft ?? 0;
  }

  function onTrackTouchMove(e: TouchEvent) {
    if (!readingListTrack) return;
    const dx = touchStartX - e.touches[0].clientX;
    readingListTrack.scrollLeft = touchStartScroll + dx;
  }

  function onTrackWheel(e: WheelEvent) {
    if (!readingListTrack) return;
    e.preventDefault();
    readingListTrack.scrollLeft += e.deltaY;
  }

  function onTrackScroll() {
    trackScrolled = (readingListTrack?.scrollLeft ?? 0) > 0;
  }

  let searchHasContent = $derived(searchLoading || searchResults.length > 0);

  let allReadingListItemIds = $derived(new Set([...sharedList.bookIds, ...logs.map(l => l.book_id)]));

  $effect(() => {
    const track = readingListTrack;
    if (!track) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      const cardSlot = 108; // 100px card + 8px gap
      placeholderCount = Math.floor(w / cardSlot) + 1;
    });
    ro.observe(track);
    return () => ro.disconnect();
  });

  // ── Log form state ──
  let reviewText = $state('');
  let rating = $state<number>(0);
  let liked: boolean | null = $state(null);
  let reread = $state(false);
  let startDate = $state('');
  let endDate = $state('');
  let saveError = $state<string | null>(null);
  let deleteConfirmId = $state<string | null>(null);
  let logSaving = $state(false);
  let logLastSavedAt: number | null = null;
  let logSnapshot: string | null = $state(null);
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  let logIsDirty = $derived(logSnapshot !== null && serializeForm() !== logSnapshot);

  function serializeForm() {
    return JSON.stringify({ reviewText, rating, liked, reread, startDate, endDate });
  }

  function takeLogSnapshot() {
    logSnapshot = serializeForm();
  }

  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (!logIsDirty) return;
      void doSaveLog();
    }, 850);
  }

  $effect(() => {
    const _ = serializeForm();
    if (logSnapshot !== null) {
      scheduleAutoSave();
    }
    return () => { if (autoSaveTimer) clearTimeout(autoSaveTimer); };
  });

  // ── Helper functions ──
  function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function highlightMatch(text: string, query: string): string {
    const q = query.trim();
    if (!q) return escHtml(text);
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }

  function escapeSolr(s: string): string {
    return s.replace(/[+\-&|!(){}[\]^"~*?:\\\/]/g, '\\$&');
  }

  function buildFuzzyQuery(q: string): string {
    const words = q.trim().split(/\s+/).filter(Boolean);
    return words.map((w) => {
      const escaped = escapeSolr(w);
      const term = w.length < 3 ? escaped : `${escaped}~`;
      return `(title:${term} OR author_name:${term})`;
    }).join(' AND ');
  }

  // ── Search ──
  async function doSearch(term: string, page: number = 1) {
    if (term.length < 2) return false;

    currentAbort?.abort();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);
    currentAbort = ctrl;
    const gen = searchGen;
    searchError = null;
    if (page === 1) {
      searchLoading = true;
      elapsed = 0;
      fetchStartTime = performance.now();
      searchPhase = 'contacting';
    }
    try {
      const solrQ = buildFuzzyQuery(term);
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(solrQ)}&limit=16&page=${page}&fields=key,title,author_name,cover_i,first_publish_year,edition_count,publisher,subject,subject_place,subject_time,subject_person,isbn,number_of_pages_median,publish_date,description`;
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`OpenLibrary returned ${res.status}`);
      }
      const data = await res.json();
      const docs: any[] = data.docs ?? [];
      const results: BookResult[] = docs.map((doc: any) => ({
        id: doc.key ?? '',
        title: doc.title ?? 'Untitled',
        author: doc.author_name?.[0] ?? null,
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        year: doc.first_publish_year ?? null,
        editions: doc.edition_count ?? null,
        publisher: doc.publisher?.[0] ?? null,
        first_publish_year: doc.first_publish_year ?? null,
        subject_places: doc.subject_place ?? [],
        subject_times: doc.subject_time ?? [],
        subjects: doc.subject ?? [],
        subject_people: doc.subject_person ?? [],
        isbn: doc.isbn?.[0] ?? null,
        pages: doc.number_of_pages_median ?? null,
        publish_date: doc.publish_date?.[0] ?? null,
      }));
      if (page === 1) {
        cacheSet(term.toLowerCase().trim(), results);
        searchResults = results;
        searchPage = 1;
        fetchDuration = (performance.now() - fetchStartTime) / 1000;
        searchPhase = 'done';
      } else {
        searchResults = [...searchResults, ...results];
        searchPage = page;
      }
      hasMore = results.length === 16 && searchResults.length < 256;
      selectedIndex = -1;
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') return false;
      if (page === 1) {
        searchError = e.message;
        searchResults = [];
        selectedIndex = -1;
        searchPhase = 'error';
      }
    } finally {
      if (searchGen === gen && page === 1) searchLoading = false;
    }
    return false;
  }

  $effect(() => {
    const el = sentinelEl;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && searchPhase !== 'error') {
        void loadMore();
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  });

  async function loadMore() {
    if (loadingMore || !hasMore || searchPhase === 'error') return;
    loadingMore = true;
    try {
      await doSearch(searchTerm, searchPage + 1);
    } finally {
      loadingMore = false;
    }
  }

  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const q = searchQuery.trim();
    searchGen++;
    searchError = null;
    if (q.length < 2) {
      searchResults = [];
      searchLoading = false;
      selectedIndex = -1;
      searchSource = null;
      fetchDuration = 0;
      searchPhase = 'idle';
      return;
    }

    const cacheKey = q.toLowerCase().trim();
    const cached = cacheGet(cacheKey);
    if (cached) {
      searchResults = cached;
      searchLoading = false;
      searchSource = 'client-cache';
      fetchDuration = 0;
      searchPhase = 'done';
      return;
    }

    searchResults = [];
    searchPhase = 'debouncing';
    searchLoading = true;
    searchSource = null;
    searchTerm = q;
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => void doSearch(q), 30);

    return () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      currentAbort?.abort();
    };
  });

  // ── Keyboard navigation ──
  $effect(() => {
    if (typeof document === 'undefined') return;
    function onKeydown(e: KeyboardEvent) {
      if (selectedBook) return;
      if (searchQuery.trim().length < 2) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (searchResults.length === 0) return;
        selectedIndex = Math.min(selectedIndex + 1, searchResults.length - 1);
        document.querySelector(`[data-search-index="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (searchResults.length === 0) return;
        if (selectedIndex <= 0) { selectedIndex = -1; return; }
        selectedIndex = Math.max(selectedIndex - 1, 0);
        document.querySelector(`[data-search-index="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
          e.preventDefault();
          selectBook(searchResults[selectedIndex]);
        }
      }
    }
    function onPopState() {
      if (selectedBook) clearSelection();
    }
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('popstate', onPopState);
    };
  });

  $effect(() => {
    if (!bookSelected && selectedBook) {
      clearSelection();
    }
  });

  $effect(() => {
    if (!showCoverLightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') showCoverLightbox = false;
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ── Book actions ──
  function renderDescription(desc: unknown): string {
    if (!desc) return '';
    let text = '';
    if (typeof desc === 'string') text = desc;
    else if (typeof desc === 'object' && desc !== null) {
      const d = desc as Record<string, unknown>;
      text = typeof d.value === 'string' ? d.value : JSON.stringify(d);
    }
    return marked.parse(text, { async: false }) as string;
  }

  async function fetchBookByOlid(olid: string): Promise<BookResult | null> {
    try {
      const cleanId = olid.replace('/works/', '');
      let title: string | null = null;
      let author: string | null = null;
      let coverUrl: string | null = null;
      let year: number | null = null;
      let editions: number | null = null;
      let publisher: string | null = null;
      let first_publish_year: number | null = null;
      let isbn: string | null = null;
      let pages: number | null = null;
      let publish_date: string | null = null;

      // Try works API for title, year, author
      const wRes = await fetch(`https://openlibrary.org/works/${cleanId}.json`);
      if (wRes.ok) {
        const wData = await wRes.json();
        title = wData.title ?? null;
        first_publish_year = wData.first_publish_year ?? null;
        if (!year) year = first_publish_year;
        if (wData.authors?.[0]?.author?.key) {
          try {
            const aRes = await fetch(`https://openlibrary.org${wData.authors[0].author.key}.json`);
            if (aRes.ok) {
              const aData = await aRes.json();
              author = aData.name ?? null;
            }
          } catch {}
        }
      }

      // Try search API for cover, publisher, editions, isbn, pages
      const sRes = await fetch(
        `https://openlibrary.org/search.json?q=key:${cleanId}&limit=1&fields=key,title,author_name,cover_i,first_publish_year,edition_count,publisher,isbn,number_of_pages_median,publish_date`
      );
      if (sRes.ok) {
        const sData = await sRes.json();
        const doc = sData.docs?.[0];
        if (doc) {
          if (!title) title = doc.title ?? null;
          if (!author) author = doc.author_name?.[0] ?? null;
          coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null;
          if (!year) year = doc.first_publish_year ?? null;
          editions = doc.edition_count ?? null;
          publisher = doc.publisher?.[0] ?? null;
          if (!first_publish_year) first_publish_year = doc.first_publish_year ?? null;
          isbn = doc.isbn?.[0] ?? null;
          pages = doc.number_of_pages_median ?? null;
          publish_date = doc.publish_date?.[0] ?? null;
        }
      }

      if (title === null && author === null && coverUrl === null && year === null) return null;

      return {
        id: olid,
        title: title || 'Untitled',
        author,
        coverUrl,
        year,
        editions,
        publisher,
        first_publish_year,
        isbn,
        pages,
        publish_date,
      };
    } catch {
      return null;
    }
  }

  function openBookFromLog(log: ReadingLog | ReadingLogWithAuthor) {
    selectedBook = { id: log.book_id, title: log.title || '', author: log.author, coverUrl: log.cover_url, year: null, editions: null, publisher: null, first_publish_year: null };
    bookYear = null;
    bookSelected = true;
    editingLog = null;
    bookDetails = null;
    bookDetailsLoading = true;
    rereviewed = false;
    void loadBookDetails(log.book_id);

    const matching = logs.filter(l => l.book_id === log.book_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (matching.length > 0) {
      populateFormFromLog(matching[0]);
    } else {
      clearForm();
    }

    fetchBookByOlid(log.book_id).then(fullBook => {
      if (fullBook) {
        selectedBook = {
          ...selectedBook,
          ...(fullBook.title ? { title: fullBook.title } : {}),
          ...(fullBook.author ? { author: fullBook.author } : {}),
          ...(fullBook.coverUrl ? { coverUrl: fullBook.coverUrl } : {}),
          year: fullBook.year ?? selectedBook.year,
          ...(fullBook.publisher ? { publisher: fullBook.publisher } : {}),
          first_publish_year: fullBook.first_publish_year ?? selectedBook.first_publish_year,
          ...(fullBook.editions ? { editions: fullBook.editions } : {}),
          ...(fullBook.isbn ? { isbn: fullBook.isbn } : {}),
          ...(fullBook.pages ? { pages: fullBook.pages } : {}),
          ...(fullBook.publish_date ? { publish_date: fullBook.publish_date } : {}),
        };
        if (fullBook.year) bookYear = fullBook.year;
      }
    });
  }

  function selectBook(book: BookResult) {
    selectedBook = book;
    bookYear = book.year;
    bookSelected = true;
    editingLog = null;
    bookDetails = null;
    bookDetailsLoading = true;
    rereviewed = false;
    void loadBookDetails(book.id);

    const matching = logs.filter(l => l.book_id === book.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (matching.length > 0) {
      populateFormFromLog(matching[0]);
    } else {
      clearForm();
    }
  }

  $effect(() => {
    const _logs = logs;
    const book = selectedBook;
    if (!book || !_logs.length) return;
    if (editingLog || rereviewed) return;
    const matching = _logs.filter(l => l.book_id === book.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (matching.length > 0) {
      populateFormFromLog(matching[0]);
    }
  });

  function clearSelection() {
    if (pendingReviewRestore) {
      viewedPublicReview = pendingReviewRestore;
      pendingReviewRestore = null;
      return;
    }
    selectedBook = null;
    bookYear = null;
    bookSelected = false;
    bookDetails = null;
    bookDetailsLoading = false;
    showCoverLightbox = false;
    editingLog = null;
    rereviewed = false;
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
  }

  function closeBookInfo() {
    if (pendingReviewRestore) {
      viewedPublicReview = pendingReviewRestore;
      pendingReviewRestore = null;
    }
    selectedBook = null;
    bookYear = null;
    bookSelected = false;
    bookDetails = null;
    bookDetailsLoading = false;
    showCoverLightbox = false;
    editingLog = null;
    rereviewed = false;
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
  }

  function viewReviewDetail(log: ReadingLogWithAuthor) {
    viewedPublicReview = log;
  }

  function clearReviewDetail() {
    viewedPublicReview = null;
  }

  let hasExistingLogs = $derived(selectedBook ? logs.some(l => l.book_id === selectedBook.id) : false);
  let rereviewed = $state(false);

  function rereview() {
    clearForm();
    startDate = '';
    endDate = '';
    reread = true;
    editingLog = null;
    rereviewed = true;
  }

  async function loadBookDetails(olid: string) {
    bookDetailsLoading = true;
    try {
      const cleanId = olid.replace('/works/', '');
      const res = await fetch(`https://openlibrary.org/works/${cleanId}.json`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      bookDetails = data as BookDetails;
      if (data.first_publish_year && !bookYear) {
        bookYear = data.first_publish_year;
      }
      if (!bookYear) {
        try {
          const sr = await fetch(`https://openlibrary.org/search.json?q=key:${cleanId}&limit=1&fields=first_publish_year`);
          if (sr.ok) {
            const sd = await sr.json();
            const fpy = sd.docs?.[0]?.first_publish_year;
            if (fpy) bookYear = fpy;
          }
        } catch {}
      }
    } catch (e) {
      console.warn('[diary] failed to load book details', e);
      bookDetails = null;
    } finally {
      bookDetailsLoading = false;
    }
  }

  $effect(() => {
    if (!selectedBook?.coverUrl) return;
    const largeUrl = selectedBook.coverUrl.replace('-M.jpg', '-L.jpg');
    const img = new Image();
    img.src = largeUrl;
  });

  async function addToReadingList(book: BookResult) {
    await sharedAdd(book);
  }

  async function removeFromReadingList(bookId: string) {
    await sharedRemove(bookId);
  }

  // ── Log form helpers ──
  function setRating(val: number) {
    const full = val * 2;
    const half = full - 1;
    if (rating === full) {
      rating = half;
    } else if (rating === half) {
      rating = 0;
    } else {
      rating = full;
    }
  }

  function toggleLiked() {
    liked = liked === null ? true : liked === true ? false : null;
  }

  async function doSaveLog() {
    if (!selectedBook) return;
    if (!startDate || !endDate) return;
    logSaving = true;
    saveError = null;
    try {
      const effectiveRating = rating / 2;

      const duplicate = logs.find(l =>
        l.book_id === selectedBook.id &&
        l.start_date === startDate &&
        l.id !== editingLog?.id
      );
      if (duplicate) {
        throw new Error('You already logged this book on this date.');
      }

      const saved = await db.saveReadingLog({
        id: editingLog?.id ?? null,
        book_id: selectedBook.id,
        title: selectedBook.title,
        author: selectedBook.author,
        cover_url: selectedBook.coverUrl,
        rating: effectiveRating > 0 ? effectiveRating : null,
        liked: liked,
        reread: reread,
        review: reviewText.trim() || null,
        start_date: startDate,
        end_date: endDate || null,
      });
      if (editingLog) {
        logs = logs.map((l) => (l.id === saved.id ? saved : l));
      } else {
        editingLog = saved;
        logs = [saved, ...logs];
      }
      logLastSavedAt = Date.now();
      takeLogSnapshot();
      refreshPublicReadingLogs();
    } catch (e: any) {
      saveError = e.message || 'Failed to save';
    } finally {
      logSaving = false;
    }
  }

  async function handleDelete(id: string) {
    if (deleteConfirmId !== id) {
      deleteConfirmId = id;
      return;
    }
    deleteConfirmId = null;
    try {
      await db.deleteReadingLog(id);
      logs = logs.filter((l) => l.id !== id);
      refreshPublicReadingLogs();
    } catch (e) {
      console.warn('[diary] delete failed', e);
    }
  }

  function renderStars(val: number): string {
    const full = Math.floor(val);
    const half = val % 1 !== 0;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

<div class="diary-panel">
    <div class="rl-section" class:rl-section--collapsed={carouselCollapsed}>
    {#if sharedList.items.length > 0 || !searchQuery}
      <div class="rl-header">
        <div class="rl-header-left">
          <button type="button" class="rl-title-btn" onclick={() => carouselCollapsed = !carouselCollapsed}>
            <h3 class="rl-title">My Reading List</h3>
            <svg class="rl-chevron" class:rl-chevron--open={!carouselCollapsed} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          <span class="rl-count">{sharedList.items.length} {sharedList.items.length === 1 ? 'Book' : 'Books'}</span>
        </div>
      </div>
      <div class="rl-track-collapse" class:rl-track-collapse--open={!carouselCollapsed}>
      <div class="rl-collapse-inner">
      <div class="search-box">
        <div class="search-box-inner">
          <div class="search-status" class:search-status--active={statusActive} class:search-status--error={searchPhase === 'error'}>
            <span class="search-dot" class:search-dot--error={searchPhase === 'error'}></span>
            <span class="search-label"><strong>OpenLibrary</strong> · {searchStatusSuffix}</span>
          </div>

          {#if searchPhase === 'error'}
            <div class="search-retry" transition:fade>
              <button type="button" class="search-retry-btn" onclick={() => void doSearch(searchQuery)}>Retry</button>
            </div>
          {/if}

          <div class="search-results-wrap" class:search-results-wrap--open={searchHasContent}>
            {#if searchLoading}
              <div class="search-results-layer" transition:fade>
                <div class="search-skeletons">
                  {#each [1,2,3,4,5] as _}
                    <div class="search-skel">
                      <div class="search-skel-cover"></div>
                      <div class="search-skel-lines">
                        <div class="search-skel-line search-skel-line--t"></div>
                        <div class="search-skel-line search-skel-line--a"></div>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
            {#if !searchLoading && searchResults.length > 0}
              <div class="search-results-layer" transition:fade>
                <div class="search-results" role="listbox" aria-label="Search results">
              {#each searchResults as book, i}
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedIndex === i}
                  class="search-result"
                  class:search-result--sel={selectedIndex === i}
                  data-search-index={i}
                  onclick={() => selectBook(book)}
                  onmouseenter={() => { selectedIndex = i; }}
                >
                  {#if book.coverUrl}
                    <div class="search-result-cover-wrap">
                      <div class="search-result-cover-skel"></div>
                      <img src={book.coverUrl} alt="" class="search-result-cover" loading="lazy" onload={(e) => { const el = e.target as HTMLElement; el.style.opacity = '1'; (el.previousElementSibling as HTMLElement).style.display = 'none'; }} onerror={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                    </div>
                  {:else}
                    <div class="search-result-cover search-result-cover--empty">
                      <BookMarked class="size-5" aria-hidden="true" />
                    </div>
                  {/if}
                  <div class="search-result-info">
                    <div class="search-result-title">{@html highlightMatch(book.title, searchQuery)}</div>
                    {#if book.author}
                      <div class="search-result-author">{#if book.year}{book.year}<span class="sep-dot"></span>{/if}{@html highlightMatch(book.author, searchQuery)}</div>
                    {/if}
                    <div class="search-result-meta">
                      {#if book.publisher}{book.publisher}{/if}
                      {#if book.editions}{#if book.publisher}<span class="sep-dot"></span>{/if}{book.editions} ed.{/if}
                    </div>
                  </div>
                </button>
              {/each}
              <div bind:this={sentinelEl} class="search-sentinel">
                {#if loadingMore}
                  <span class="search-spinner"></span>
                {:else if hasMore}
                  <button type="button" class="search-more-btn" onclick={loadMore}>Load more</button>
                {/if}
              </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      </div>
      <div class="rl-track-wrap" class:rl-track-wrap--scrolled={trackScrolled} onwheel={onTrackWheel}>
        <div bind:this={readingListTrack} class="rl-track" ontouchstart={onTrackTouchStart} ontouchmove={onTrackTouchMove} onscroll={onTrackScroll}>
          {#each sharedList.items as item (item.id)}
            <div class="rl-card-wrap">
              <button type="button" class="rl-card" onclick={() => selectBook(item)}>
                {#if item.coverUrl}
                  <img src={item.coverUrl} alt="" class="rl-card-img" loading="lazy" />
                {:else}
                  <div class="rl-card-img rl-card-img--empty">
                    <BookMarked class="size-6" aria-hidden="true" />
                  </div>
                {/if}
              </button>
            </div>
          {/each}
          {#each Array(placeholderCountForItems) as _, i}
            {#if i === 0}
              <button type="button" class="rl-card rl-card--add" onclick={onaddbook}>
                <div class="rl-card-img rl-card-img--add">
                  <span class="rl-card-plus">+</span>
                </div>
              </button>
            {:else}
              <div class="rl-card rl-card--placeholder">
                <div class="rl-card-img rl-card-img--placeholder" />
              </div>
            {/if}
          {/each}
        </div>
      </div>
      </div>
      </div>
  {/if}
    </div>

  {#if publicReadingLogsLoaded && publicReadingLogs.length > 0}
    <div class="pf-sep"></div>
    <div class="pf-section">
      <div class="pf-list">
        {#each publicReadingLogs as log (log.id)}
          <div class="pf-card" role="button" tabindex="0" onclick={() => viewReviewDetail(log)} onkeydown={(e) => { if (e.key === 'Enter') viewReviewDetail(log); }}>
            <div class="pf-card-body" style="height: {PF_CARD_HEIGHT}px">
              {#if log.cover_url}
                <img src={log.cover_url} alt="" class="pf-card-cover" loading="lazy" style="width:{PF_COVER_W}px;height:{PF_COVER_H}px;cursor:pointer" onclick={(e) => { e.stopPropagation(); openBookFromLog(log); }} />
              {:else}
                <div class="pf-card-cover pf-card-cover--empty" style="width:{PF_COVER_W}px;height:{PF_COVER_H}px;cursor:pointer" onclick={(e) => { e.stopPropagation(); openBookFromLog(log); }}>
                  <BookMarked class="size-4" aria-hidden="true" />
                </div>
              {/if}
              <div class="pf-card-info">
                <div class="pf-card-meta">
                  <span class="pf-card-meta-left">
                    <span class="pf-card-avatar">
                      <GeneratedAvatar userId={log.user_id} seed={log.author_avatar_seed} avatarUrl={log.author_avatar_url} size={16} rounded={16} />
                    </span>
                    <span class="pf-card-byline">{log.author_username || 'Anonymous'}</span>
                    <span class="pf-card-sep" aria-hidden="true">·</span>
                    <span class="pf-card-date">{formatLogDate(log.created_at)}</span>
                  </span>
                </div>
                <div class="pf-card-book-title">{log.title || 'Untitled'}</div>
                <div class="pf-card-book-author">{log.author || 'Unknown'}</div>
                {#if log.rating || log.liked !== null || log.reread}
                  <div class="pf-card-reactions">
                    {#if log.rating}
                      <span class="pf-card-stars">
                        {#each [1,2,3,4,5] as val}
                          {@const half = Math.round(log.rating! * 2)}
                          <svg class="pf-card-star" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--hint)">
                            {#if val * 2 <= half}
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="#f59e0b" fill="#f59e0b" />
                            {:else if val * 2 - 1 === half}
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="#f59e0b" />
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" clip-path="inset(0 50% 0 0)" fill="#f59e0b" />
                            {:else}
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="currentColor" fill="none" />
                            {/if}
                          </svg>
                        {/each}
                      </span>
                    {/if}
                    {#if log.liked !== null}
                      <span class="pf-card-liked" class:pf-card-liked--yes={log.liked === true} class:pf-card-liked--no={log.liked === false}>
                        <Heart class="size-3" fill={log.liked === true ? '#ef4444' : 'none'} aria-hidden="true" />
                      </span>
                    {/if}
                    {#if log.reread}
                      <span class="pf-card-reread"><svg style="width:9px;height:9px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></span>
                    {/if}
                  </div>
                {/if}
                {#if log.review}
                  <div class="pf-card-review">{log.review}</div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if !publicReadingLogsLoaded}
    <div class="pf-sep"></div>
    <div class="pf-section">
      <div class="pf-list">
        {#each [1,2,3] as _}
          <div class="pf-card pf-card--skel">
            <div class="pf-card-body" style="height: {PF_CARD_HEIGHT}px">
              <span class="pf-skel pf-skel--cover" style="width:{PF_COVER_W}px;height:{PF_COVER_H}px"></span>
              <div class="pf-card-info">
                <div class="pf-card-meta">
                  <div class="pf-card-meta-left">
                    <span class="pf-skel pf-skel--avatar"></span>
                    <span class="pf-skel pf-skel--line pf-skel--w20" style="height:12px"></span>
                    <span class="pf-skel pf-skel--sep"></span>
                    <span class="pf-skel pf-skel--line pf-skel--w16" style="height:12px"></span>
                  </div>
                </div>
                <span class="pf-skel pf-skel--line pf-skel--w85" style="height:16px"></span>
                <span class="pf-skel pf-skel--line pf-skel--w50" style="height:13px;margin-top:2px"></span>
                <div class="pf-card-reactions" style="margin-top:4px">
                  <span class="pf-skel pf-skel--line pf-skel--w25" style="height:13px"></span>
                </div>
                <span class="pf-skel pf-skel--line pf-skel--w95" style="height:12px;margin-top:2px"></span>
                <span class="pf-skel pf-skel--line pf-skel--w70" style="height:12px"></span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if selectedBook}
    <div class="overlay" transition:fade={{ duration: 150 }} onclick={closeBookInfo} role="dialog" aria-modal="true" aria-label="Book details">
      <div class="overlay-bg"></div>
      <div class="overlay-content" onclick={(e) => e.stopPropagation()}>

        <button type="button" class="book-close book-close--top" onclick={closeBookInfo} aria-label="Close"><X class="size-5" /></button>
        <div class="book-body">
          {#if selectedBook.coverUrl}
            <img src={selectedBook.coverUrl} alt="" class="book-cover" role="button" tabindex="0" onclick={() => showCoverLightbox = true} onkeydown={(e) => { if (e.key === 'Enter') showCoverLightbox = true; }} />
          {:else}
            <div class="book-cover book-cover--empty">
              <BookMarked class="size-10" aria-hidden="true" />
            </div>
          {/if}
          <div class="book-info">
            <h2 class="book-header-title">{capitalizeTitle(selectedBook.title)}</h2>
            <div class="book-author">{selectedBook.author || 'Anonymous'}</div>
              <div class="book-meta">
                <span class="book-year">{bookYear ? String(bookYear) : '—'}</span>
                {#if selectedBook.publisher}
                  <span class="book-dot"></span>
                  <span>{selectedBook.publisher}</span>
                {/if}
              </div>
            <div class="book-actions">
              {#if sharedList.bookIds.has(selectedBook.id)}
                <button type="button" class="book-btn book-btn--remove" onclick={() => removeFromReadingList(selectedBook.id)}><X class="size-3.5" aria-hidden="true" />Remove from List</button>
              {:else}
                <button type="button" class="book-btn book-btn--add" onclick={() => addToReadingList(selectedBook)}><Plus class="size-3.5" aria-hidden="true" />Add to List</button>
              {/if}
            </div>
          </div>
        </div>

            <div class="panel-tabs" role="group" aria-label="Panel section">
              <button
                type="button"
                class="panel-tab-btn"
                class:panel-tab-btn--active={panelTab === 'info'}
                onclick={() => panelTab = 'info'}
              >Info</button>
              <button
                type="button"
                class="panel-tab-btn"
                class:panel-tab-btn--active={panelTab === 'review'}
                onclick={() => panelTab = 'review'}
              >Review</button>
            </div>
          <div class="panel-scroll">
            {#if panelTab === 'review'}
            <div class="review-wrap" transition:fade={{ duration: 150 }}>
            <div class="review-rating">
              <div class="review-stars">
                {#each [1,2,3,4,5] as val}
                  <button type="button" class="review-star" class:review-star--on={val * 2 <= rating} onclick={() => setRating(val)} aria-label="{val} stars">
                    {#if val * 2 <= rating}
                      <Star class="size-6" fill="#f59e0b" aria-hidden="true" />
                    {:else if val * 2 - 1 === rating}
                      <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" clip-path="inset(0 50% 0 0)" fill="#f59e0b" />
                      </svg>
                    {:else}
                      <Star class="size-6" fill="none" aria-hidden="true" />
                    {/if}
                  </button>
                {/each}
              </div>
              <div class="review-actions">
                <button type="button" class="review-heart" class:review-heart--on={liked === true} class:review-heart--off={liked === false} onclick={toggleLiked} aria-label="Toggle liked">
                    <Heart class="size-5" fill={liked === true ? '#ef4444' : 'none'} aria-hidden="true" />
                </button>
                {#if hasExistingLogs}
                  <button type="button" class="review-rereview" onclick={rereview} aria-label="Re-review">
                    RE-REVIEW?
                  </button>
                {/if}
              </div>
            </div>
            <textarea id="lr" class="review-ta" bind:value={reviewText} placeholder="What did you think?" maxlength={5000}></textarea>
            <div class="review-dates">
              <CalendarPopover label="Start" bind:value={startDate} />
              <CalendarPopover label="End" bind:value={endDate} />
            </div>
            {#if saveError}
              <div class="review-err">{saveError}</div>
            {/if}
            </div>
            {:else if panelTab === 'info'}
            <div transition:fade={{ duration: 150 }}>
            <div class="book-details">
              {#if bookDetailsLoading}
                <div class="book-details-loading">
                  <span class="book-details-spinner"></span>
                </div>
              {/if}
              {#if !bookDetailsLoading && bookDetails}
                <div class="book-section">
                  <button type="button" class="book-section-title-btn" onclick={() => descCollapsed = !descCollapsed}>
                    <h3 class="book-section-title">Description</h3>
                    <svg class="section-chevron" class:section-chevron--open={!descCollapsed} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                  </button>
                  <div class="desc-collapse" class:desc-collapse--open={!descCollapsed}>
                {#if bookDetails.description}
                  <div class="book-desc">{@html renderDescription(bookDetails.description)}</div>
                {:else}
                  <div class="book-desc book-desc--empty">No description</div>
                {/if}
                  </div>
                </div>
                {#if bookDetails.subjects?.length}
                  <div class="book-section">
                    <h3 class="book-section-title">Subjects</h3>
                    <div class="book-tags">
                      {#each bookDetails.subjects.slice(0, 8) as s}
                        <span class="book-tag">{s}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if bookDetails.subject_places?.length}
                  <div class="book-section">
                    <h3 class="book-section-title">Places</h3>
                    <div class="book-tags">
                      {#each bookDetails.subject_places.slice(0, 4) as p}
                        <span class="book-tag">{p}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if bookDetails.subject_people?.length}
                  <div class="book-section">
                    <h3 class="book-section-title">People</h3>
                    <div class="book-tags">
                      {#each bookDetails.subject_people.slice(0, 4) as p}
                        <span class="book-tag">{p}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if bookDetails.subject_times?.length}
                  <div class="book-section">
                    <h3 class="book-section-title">Time Periods</h3>
                    <div class="book-tags">
                      {#each bookDetails.subject_times.slice(0, 4) as t}
                        <span class="book-tag">{t}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
              {/if}
              {#if !bookDetailsLoading && !bookDetails}
                <div class="book-desc book-desc--empty">Could not load book details.</div>
              {/if}
            </div>
            </div>
            {/if}
          </div>
      </div>
    </div>
  {/if}

  {#if showCoverLightbox && selectedBook?.coverUrl}
    <div class="lightbox" onclick={() => showCoverLightbox = false} role="dialog" aria-modal="true" aria-label="Book cover">
      <img src={selectedBook.coverUrl.replace('-M.jpg', '-L.jpg')} alt="" class="lightbox-img" onclick={(e) => e.stopPropagation()} />
    </div>
  {/if}

  {#if viewedPublicReview}
    <div class="overlay" transition:fade={{ duration: 150 }} onclick={clearReviewDetail} role="dialog" aria-modal="true" aria-label="Review detail">
      <div class="overlay-bg"></div>
      <div class="overlay-content overlay-content--review" onclick={(e) => e.stopPropagation()}>
        <button type="button" class="book-close book-close--top" onclick={clearReviewDetail} aria-label="Close"><X class="size-5" /></button>
        <div class="rv-wrap">
          <div class="rv-head">
            <span class="rv-head-avatar">
              <GeneratedAvatar userId={viewedPublicReview.user_id} seed={viewedPublicReview.author_avatar_seed} avatarUrl={viewedPublicReview.author_avatar_url} size={18} rounded={18} />
            </span>
            <span class="rv-head-name">{viewedPublicReview.author_username || 'Anonymous'}</span>
            <span class="rv-head-sep">·</span>
            <span class="rv-head-date">{formatLogDate(viewedPublicReview.created_at)}</span>
          </div>
          <div class="rv-book" role="button" tabindex="0" onclick={() => { const l = viewedPublicReview; if (l) { pendingReviewRestore = l; clearReviewDetail(); openBookFromLog(l); }}} onkeydown={(e) => { if (e.key === 'Enter') { const l = viewedPublicReview; if (l) { pendingReviewRestore = l; clearReviewDetail(); openBookFromLog(l); }}}}>
            <div class="rv-cover-wrap">
              {#if viewedPublicReview.cover_url}
                <img src={viewedPublicReview.cover_url} alt="" class="rv-cover" loading="lazy" />
              {:else}
                <div class="rv-cover rv-cover--empty"><BookMarked class="size-6" aria-hidden="true" /></div>
              {/if}
            </div>
            <div class="rv-book-info">
              <div class="rv-book-title">{viewedPublicReview.title || 'Untitled'}</div>
              <div class="rv-book-author">{viewedPublicReview.author || 'Unknown'}</div>
            </div>
          </div>
          <div class="rv-body">
            {#if viewedPublicReview.rating || viewedPublicReview.liked !== null || viewedPublicReview.reread}
              <div class="rv-reactions">
                {#if viewedPublicReview.rating}
                  <span class="rv-stars">
                    {#each [1,2,3,4,5] as val}
                      {@const half = Math.round(viewedPublicReview.rating! * 2)}
                      <svg class="rv-star" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--hint)">
                        {#if val * 2 <= half}
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="#f59e0b" fill="#f59e0b" />
                        {:else if val * 2 - 1 === half}
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="#f59e0b" />
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" clip-path="inset(0 50% 0 0)" fill="#f59e0b" />
                        {:else}
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="currentColor" fill="none" />
                        {/if}
                      </svg>
                    {/each}
                  </span>
                {/if}
                {#if viewedPublicReview.liked !== null}
                  <span class="rv-liked" class:rv-liked--yes={viewedPublicReview.liked === true} class:rv-liked--no={viewedPublicReview.liked === false}>
                    <Heart class="size-4" fill={viewedPublicReview.liked === true ? '#ef4444' : 'none'} aria-hidden="true" />
                  </span>
                {/if}
                {#if viewedPublicReview.reread}
                  <span class="rv-reread"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></span>
                {/if}
                {#if currentUserId && viewedPublicReview.user_id === currentUserId}
                  <button type="button" class="rv-delete-btn" onclick={() => { const id = viewedPublicReview!.id; viewedPublicReview = null; onDelete?.(id); }} aria-label="Delete log"><Trash2 class="size-4" aria-hidden="true" /></button>
                {/if}
              </div>
            {/if}
            {#if viewedPublicReview.review}
              <div class="rv-text">{viewedPublicReview.review}</div>
            {:else}
              <div class="rv-text rv-text--empty">No written review.</div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .diary-panel { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; }

  /* ───── Reading List Carousel ───── */
  .rl-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .rl-section--collapsed { margin-bottom: -0.75rem; }
  .rl-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0; padding-left: 0.25rem; }
  .rl-header-left { display: flex; align-items: baseline; gap: 0.5rem; }
  .rl-title-btn { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .rl-title-btn:hover .rl-title { color: var(--ink); }
  .rl-chevron { color: var(--hint); opacity: 0.5; transition: transform 0.15s ease; }
  .rl-chevron--open { transform: rotate(90deg); }
  .rl-title { font-family: 'Inter', sans-serif; font-size: 0.7rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: var(--hint); margin: 0; transition: color 0.1s; }
  .rl-track-collapse { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 0.2s ease, opacity 0.15s ease; }
  .rl-track-collapse--open { grid-template-rows: 1fr; opacity: 1; }
  .rl-collapse-inner { min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 0.5rem; }
  .rl-count { font-family: 'Inter', sans-serif; font-size: 0.65rem; color: var(--hint); opacity: 0.5; }
  .rl-track-wrap { position: relative; overflow: hidden; -webkit-mask: linear-gradient(90deg, #000 calc(100% - 48px), transparent); mask: linear-gradient(90deg, #000 calc(100% - 48px), transparent); }
  .rl-track-wrap--scrolled { -webkit-mask: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 48px), transparent 100%); mask: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 48px), transparent 100%); }
  .rl-track { display: flex; gap: 8px; overflow-x: auto; scroll-behavior: smooth; padding: 4px 0 8px; scrollbar-width: none; }
  .rl-track::-webkit-scrollbar { display: none; }
  .rl-card { flex-shrink: 0; width: 100px; background: transparent; border: none; cursor: pointer; text-align: left; padding: 0; }
  .rl-card-wrap { position: relative; flex-shrink: 0; }

  .rl-card--placeholder { cursor: default; }
  .rl-card--add { cursor: pointer; display: flex; }
  .rl-card-plus { font-size: 3rem; font-weight: 200; color: color-mix(in srgb, var(--hint) 50%, transparent); line-height: 1; }
  .rl-card-img { width: 100px; height: 150px; object-fit: contain; border-radius: 6px; background: var(--surf); display: block; }
  .rl-card-img--add { display: flex; align-items: center; justify-content: center; flex: 1; background: color-mix(in srgb, var(--surf) 60%, var(--bg)); border: 1px dashed color-mix(in srgb, var(--border) 60%, transparent); }
  .rl-card-img--empty { display: flex; align-items: center; justify-content: center; color: var(--hint); }
  .rl-card-img--placeholder { background: color-mix(in srgb, var(--surf) 60%, var(--bg)); border: 1px dashed color-mix(in srgb, var(--border) 60%, transparent); }
  .rl-empty { font-size: 12px; color: var(--hint); padding: 0.5rem 0; }

  /* ───── Public Feed ───── */
  .pf-sep { height: 1px; background: var(--feed-rule, var(--border)); margin: 0 -0.75rem; }
  .pf-section { margin-top: -0.75rem; }
  .pf-list { display: flex; flex-direction: column; }
  .pf-card { padding: 1rem 0.75rem; border-bottom: 0.5px solid var(--feed-rule, var(--border)); transition: background 150ms ease; cursor: pointer; margin-left: calc(-0.75rem); margin-right: calc(-0.75rem); }
  .pf-card:first-child { padding-top: 0.75rem; }
  .pf-card:last-child { border-bottom: none; }
  .pf-card:last-child::after { content: ''; display: block; height: 1px; background: var(--feed-rule, var(--border)); margin-top: 1rem; margin-left: calc(-0.75rem); margin-right: calc(-0.75rem); }
  .pf-card:hover { background: color-mix(in srgb, var(--surf) 50%, transparent); }
  .pf-card-body { display: flex; gap: 14px; overflow: hidden; }
  .pf-card-cover { object-fit: contain; border-radius: 6px; flex-shrink: 0; background: var(--surf); }
  .pf-card-cover--empty { display: flex; align-items: center; justify-content: center; background: var(--surf); color: var(--hint); }
  .pf-card-info { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
  .pf-card-meta { display: flex; align-items: center; margin-bottom: 6px; font-family: var(--ui); font-size: 11px; color: var(--hint); line-height: 1; }
  .pf-card-meta-left { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .pf-card-avatar { flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .pf-card-byline { font-size: 12px; font-weight: 500; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 8rem; }
  .pf-card-sep { color: var(--border); user-select: none; }
  .pf-card-date { white-space: nowrap; }
  .pf-card-book-title { font-family: var(--dm); font-size: 15px; font-weight: 700; line-height: 1.35; color: var(--ink); white-space: normal; overflow: visible; word-break: break-word; letter-spacing: 0.02em; }
  .pf-card-book-author { font-size: 12px; color: var(--text-muted); }
  .pf-card-reactions { display: flex; align-items: center; gap: 2px; margin-top: 4px; flex-wrap: wrap; }
  .pf-card-stars { display: flex; gap: 2px; }
  .pf-card-star { display: block; }
  .pf-card-liked { display: inline-flex; align-items: center; margin-left: 5px; line-height: 1; }
  .pf-card-liked--yes { color: #ef4444; }
  .pf-card-liked--no { color: var(--hint); opacity: 0.5; }
  .pf-card-reread { display: inline-flex; align-items: center; justify-content: center; color: var(--hint); margin-left: 5px; }
  .pf-card-review { font-family: var(--ss); font-size: 13px; line-height: 1.55; color: var(--text-muted); overflow: hidden; max-height: 4em; mask-image: linear-gradient(to bottom, black 60%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%); margin-top: 4px; }
  .pf-card--skel { pointer-events: none; }
  .pf-skel { display: block; background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%); background-size: 200px 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: 4px; }
  .pf-skel--cover { border-radius: 6px; flex-shrink: 0; background: var(--surf); }
  .pf-skel--avatar { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; }
  .pf-skel--sep { width: 3px; height: 3px; border-radius: 50%; flex-shrink: 0; }
  .pf-skel--line { height: 12px; }
  .pf-skel--w16 { width: 16%; }
  .pf-skel--w20 { width: 20%; }
  .pf-skel--w25 { width: 25%; }
  .pf-skel--w40 { width: 40%; }
  .pf-skel--w50 { width: 50%; }
  .pf-skel--w60 { width: 60%; }
  .pf-skel--w70 { width: 70%; }
  .pf-skel--w80 { width: 80%; }
  .pf-skel--w85 { width: 85%; }
  .pf-skel--w90 { width: 90%; }
  .pf-skel--w95 { width: 95%; }

  /* ───── Search Box ───── */
  .search-box { border: 1px solid var(--border); border-radius: 6px; }
  .search-box-inner { padding: 0.5rem 0.6rem 0.4rem; }
  .search-status { font-family: var(--font-mono); font-size: 10px; color: var(--hint); padding: 0.1rem 0; margin-bottom: 0.1rem; display: flex; align-items: center; border-bottom: 1px solid transparent; transition: border-color 0.15s; }
  .search-status--active { border-bottom-color: var(--border); }
  .search-status--error { color: #ef4444; }
  .search-label strong { font-weight: 600; }
  .search-dot { display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: #22c55e; margin-right: 0.3rem; box-shadow: 0 0 4px #22c55e; }
  .search-dot--error { background: #ef4444; box-shadow: 0 0 4px #ef4444; }
  .search-retry { display: flex; justify-content: center; padding: 0.5rem 0; }
  .search-retry-btn { font-size: 11px; padding: 4px 14px; border-radius: 6px; border: 0.5px solid var(--border); background: transparent; color: var(--accent); cursor: pointer; }
  .search-retry-btn:hover { background: var(--surf); }

  /* Search skeletons */
  .search-skeletons { display: flex; flex-direction: column; gap: 2px; }
  .search-skel { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; }
  .search-skel-cover { width: 36px; height: 54px; border-radius: 4px; flex-shrink: 0; background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%); background-size: 200px 100%; animation: shimmer 1.5s ease-in-out infinite; }
  .search-skel-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .search-skel-line { height: 10px; border-radius: 4px; background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%); background-size: 200px 100%; animation: shimmer 1.5s ease-in-out infinite; }
  .search-skel-line--t { width: 35%; }
  .search-skel-line--a { width: 25%; }

  /* Search results */
  .search-results-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.2s ease; }
  .search-results-wrap--open { grid-template-rows: 1fr; }
  .search-results-layer { grid-area: 1 / 1; min-height: 0; overflow: hidden; }
  .search-results { display: flex; flex-direction: column; gap: 2px; max-height: 340px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  .search-results::-webkit-scrollbar { width: 5px; }
  .search-results::-webkit-scrollbar-track { background: transparent; }
  .search-results::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .search-result { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; background: transparent; border: none; cursor: pointer; text-align: left; width: 100%; transition: background 0.1s; }
  .search-result:hover { background: var(--surf); }
  .search-result:active { background: var(--border); }
  .search-result mark { background: var(--mark-bg, #b4c6d8); color: var(--text); padding: 0 0.1em; border-radius: 2px; font-weight: 600; }
  .search-result-cover { width: 36px; height: 54px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
  .search-result-cover--empty { display: flex; align-items: center; justify-content: center; color: var(--hint); background: var(--surf); }
  .search-result-cover-wrap { position: relative; flex-shrink: 0; width: 36px; height: 54px; }
  .search-result-cover-wrap .search-result-cover { position: absolute; top: 0; left: 0; opacity: 0; transition: opacity 0.2s; }
  .search-result-cover-skel { width: 36px; height: 54px; border-radius: 4px; background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%); background-size: 200px 100%; animation: shimmer 1.5s ease-in-out infinite; }
  .search-result-info { min-width: 0; flex: 1; }
  .search-result-title { font-family: var(--font-mono); font-size: 12px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search-result-author { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .search-result-meta { font-family: var(--font-mono); font-size: 11px; color: var(--hint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sep-dot { display: inline-block; width: 2px; height: 2px; border-radius: 50%; background: currentColor; margin: 0 0.35em; vertical-align: middle; }
  .search-sentinel { display: flex; justify-content: center; padding: 0.5rem 0 0.25rem; }
  .search-more-btn { font-family: var(--font-mono); font-size: 10px; padding: 4px 14px; border-radius: 6px; border: 0.5px solid var(--border); background: transparent; color: var(--accent); cursor: pointer; }
  .search-more-btn:hover { background: var(--surf); }
  .search-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; }

  /* ───── Overlay ───── */
  .overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .overlay-bg { position: absolute; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(2px); }
  .overlay-content { position: relative; background: var(--bg); border-radius: 12px; max-width: 460px; width: 100%; height: 480px; padding: 1.25rem 1.5rem 1.5rem; box-shadow: 0 8px 32px rgba(0,0,0,0.35); animation: pop 0.2s cubic-bezier(0.34,1.56,0.64,1); display: flex; flex-direction: column; }

  /* Book header */
  .book-header-title { font-family: var(--dm); font-size: 1.15rem; font-weight: 700; line-height: 1.35; letter-spacing: 0.02em; color: var(--ink); margin: 0; }
  .book-close { flex-shrink: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: transparent; border: none; cursor: pointer; color: var(--hint); transition: background 0.12s, color 0.12s; }
  .book-close:hover { background: var(--surf); color: var(--text); }
  .book-close--top { position: absolute; top: 0.75rem; right: 0.75rem; z-index: 1; }

  /* Book body — cover + info */
  .book-body { display: flex; gap: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border); flex-shrink: 0; }

  .book-cover { width: 88px; height: 132px; object-fit: cover; border-radius: 6px; flex-shrink: 0; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: box-shadow 0.15s; }
  .book-cover:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
  .book-cover--empty { display: flex; align-items: center; justify-content: center; background: var(--surf); color: var(--hint); box-shadow: none; }
  .book-info { flex: 1; display: flex; flex-direction: column; gap: 6px; justify-content: center; }
  .book-author { font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; }
  .book-meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); }
  .book-dot { display: inline-block; width: 2px; height: 2px; border-radius: 50%; background: currentColor; opacity: 0.5; }
  .book-actions { display: flex; margin-top: 4px; }
  .book-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 6px; border: 0.5px solid var(--border); background: transparent; cursor: pointer; font-family: var(--font-mono); font-size: 0.7rem; color: var(--hint); transition: background 0.12s, border-color 0.12s, color 0.12s; }
  .book-btn:hover { background: var(--surf); color: var(--text); }
  .book-btn--add { color: var(--ink); border-color: var(--border); }
  .book-btn--add:hover { background: var(--surf); color: var(--text); border-color: var(--text-muted); }
  .book-btn--remove { color: #ef4444; border-color: color-mix(in srgb, #ef4444 40%, transparent); }
  .book-btn--remove:hover { background: color-mix(in srgb, #ef4444 10%, transparent); border-color: #ef4444; }

  /* Panel scroll area */
  .panel-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 0.75rem; }
  .panel-scroll::-webkit-scrollbar { width: 4px; }
  .panel-scroll::-webkit-scrollbar-track { background: transparent; }
  .panel-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

  /* Panel tab slider — minimalist */
  .panel-tabs { display: flex; gap: 0; padding: 0 0 0.375rem; }
  .panel-tab-btn { flex: 1; height: 28px; border: none; background: transparent; font-family: var(--ui); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--hint); cursor: pointer; transition: color 150ms ease; border-bottom: 1.5px solid var(--border); margin-bottom: -1px; }
  .panel-tab-btn:hover { color: var(--text-muted); }
  .panel-tab-btn--active { color: var(--ink); border-bottom-color: var(--ink); font-weight: 700; }

  /* Review form */
  .review-wrap { flex: 1; display: flex; flex-direction: column; gap: 0.75rem; min-height: 0; }
  .review-rating { display: flex; align-items: center; justify-content: space-between; }
  .review-stars { display: flex; gap: 2px; }
  .review-star { background: transparent; border: none; cursor: pointer; padding: 3px; color: var(--hint); transition: color 0.15s, transform 0.12s; border-radius: 6px; }
  .review-star:hover { color: #f59e0b; transform: scale(1.15); }
  .review-star:active { transform: scale(0.9); }
  .review-star--on { color: #f59e0b; }
  .review-actions { display: flex; align-items: center; gap: 8px; }
  .review-heart { background: transparent; border: none; cursor: pointer; padding: 3px; color: var(--hint); display: flex; transition: color 0.15s, transform 0.12s; border-radius: 6px; }
  .review-heart:hover { color: #ef4444; transform: scale(1.15); }
  .review-heart:active { transform: scale(0.9); }
  .review-heart--on { color: #ef4444; }
  .review-heart--off { color: var(--hint); opacity: 0.5; }
  .review-rereview { background: transparent; border: 1px solid var(--border); cursor: pointer; padding: 0 0.75rem; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: 0.25rem; color: var(--ink); font-size: 9px; font-weight: 600; font-family: var(--ui); letter-spacing: 0.04em; transition: background 0.12s, border-color 0.12s; white-space: nowrap; }
  .review-rereview:hover { border-color: var(--text-muted); }
  .review-ta { width: 100%; background: transparent; border: 0.5px solid var(--border); border-radius: 8px; padding: 10px 11px; font-size: 0.8rem; color: var(--ink); resize: none; font-family: inherit; outline: none; box-sizing: border-box; line-height: 1.5; transition: border-color 0.12s; flex: 1; min-height: 0; }
  .review-ta:focus { border-color: var(--text-muted); }
  .review-ta::placeholder { color: var(--hint); opacity: 0.5; }
  .review-dates { display: flex; align-items: flex-end; gap: 8px; }
  .review-err { color: #ef4444; font-size: 11px; }

  /* Book details */
  .book-details { display: flex; flex-direction: column; gap: 0.75rem; }
  .book-details-loading { display: flex; align-items: center; justify-content: center; padding: 1.5rem 0; }
  .book-details-spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid var(--border); border-top-color: var(--text-muted); border-radius: 50%; animation: spin 0.6s linear infinite; }
  .book-desc { font-size: 0.78rem; line-height: 1.6; color: var(--text); word-wrap: break-word; }
  .book-desc p { margin: 0 0 0.5em; }
  .book-desc p:last-child { margin-bottom: 0; }
  .book-desc a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .book-desc a:hover { opacity: 0.8; }
  .book-desc em { font-style: italic; }
  .book-desc strong { font-weight: 700; }
  .book-desc--empty { color: var(--hint); opacity: 0.6; font-style: italic; }
  .book-section { }
  .book-section-title { font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--hint); opacity: 0.7; margin: 0; }
  .book-section-title-btn { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; margin: 0 0 0.4rem; }
  .book-section-title-btn:hover .book-section-title { opacity: 1; }
  .section-chevron { color: var(--hint); opacity: 0.5; transition: transform 0.15s ease; }
  .section-chevron--open { transform: rotate(90deg); }
  .desc-collapse { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 0.2s ease, opacity 0.15s ease; }
  .desc-collapse--open { grid-template-rows: 1fr; opacity: 1; }
  .desc-collapse > .book-desc { min-height: 0; overflow: hidden; }
  .book-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .book-tag { padding: 2px 8px; border-radius: 5px; background: var(--surf); border: 0.5px solid var(--border); font-family: var(--font-mono); font-size: 0.65rem; color: var(--hint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }

  /* Lightbox */
  .lightbox { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; padding: 2rem; animation: fadeIn 0.2s ease-out; }
  .lightbox-img { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.5); animation: pop 0.25s cubic-bezier(0.34,1.56,0.64,1); }

  @keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: calc(200px + 100%) 0; } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pop { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }

  /* ───── Review Detail Overlay ───── */
  .overlay-content--review { height: auto; max-height: 520px; min-height: 0; padding: 1.25rem 1.5rem 1.5rem; }
  .rv-wrap { display: flex; flex-direction: column; gap: 0.875rem; overflow-y: auto; flex: 1; min-height: 0; }
  .rv-head { display: flex; align-items: center; gap: 5px; font-family: var(--ui); font-size: 0.72rem; color: var(--hint); flex-shrink: 0; }
  .rv-head-avatar { flex-shrink: 0; display: flex; }
  .rv-head-name { font-weight: 600; color: var(--text-muted); }
  .rv-head-sep { color: var(--border); }
  .rv-head-date { color: var(--hint); }
  .rv-book { display: flex; gap: 0.75rem; padding: 0.75rem; background: var(--surf); border-radius: 10px; align-items: center; cursor: pointer; transition: background 0.15s ease, box-shadow 0.15s ease; outline: none; flex-shrink: 0; }
  .rv-book:hover { background: color-mix(in srgb, var(--accent) 4%, var(--surf)); box-shadow: 0 0 0 0.5px var(--border); }
  .rv-book:focus-visible { box-shadow: 0 0 0 1.5px var(--ink); }
  .rv-cover-wrap { flex-shrink: 0; }
  .rv-cover { width: 56px; height: 84px; object-fit: cover; border-radius: 5px; flex-shrink: 0; background: var(--surf); box-shadow: 0 1px 4px rgba(0,0,0,0.12); display: block; }
  .rv-cover--empty { display: flex; align-items: center; justify-content: center; background: var(--surf); color: var(--hint); box-shadow: none; }
  .rv-book-info { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .rv-book-title { font-family: var(--dm); font-weight: 700; font-size: 0.9rem; color: var(--ink); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0.02em; }
  .rv-book-author { font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rv-body { display: flex; flex-direction: column; gap: 0.625rem; }
  .rv-reactions { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
  .rv-stars { display: flex; gap: 2px; }
  .rv-star { display: block; }
  .rv-liked { display: inline-flex; align-items: center; margin-left: 4px; }
  .rv-liked--yes { color: #ef4444; }
  .rv-liked--no { color: var(--hint); opacity: 0.5; }
  .rv-reread { display: inline-flex; align-items: center; margin-left: 4px; color: var(--hint); }
  .rv-delete-btn { margin-left: auto; background: none; border: none; cursor: pointer; color: #ef4444; display: flex; align-items: center; justify-content: center; padding: 0; border-radius: 0; transition: opacity 0.15s; }
  .rv-delete-btn:hover { opacity: 0.7; }
  .rv-text { font-size: 0.82rem; line-height: 1.7; color: var(--text); white-space: pre-wrap; word-break: break-word; }
  .rv-text--empty { color: var(--hint); font-style: italic; font-size: 0.78rem; }
</style>
