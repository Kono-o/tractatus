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
  import { fade } from 'svelte/transition';
  import { db, type ReadingLog } from '$lib/db';
  import { X, Star, Check, BookMarked } from '@lucide/svelte';
  import { readingList as sharedList, addToReadingList as sharedAdd, removeFromReadingList as sharedRemove } from '$lib/reading-list.svelte';

  let {
    searchQuery = '',
    onselect,
    searchExpanded = false,
    onaddbook,
  }: {
    searchQuery?: string;
    onselect?: () => void;
    searchExpanded?: boolean;
    onaddbook?: () => void;
  } = $props();

  // ── Carousel collapse ──
  let carouselCollapsed = $state(false);

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

  // ── Book details overlay ──
  let bookDetailsLoading = $state(false);
  let bookDetails: BookDetails | null = $state(null);
  let selectedBook: BookResult | null = $state<BookResult | null>(null);
  let bookSelected = $state(false);
  let showCoverLightbox = $state(false);
  let showLogForm = $state(false);
  let editingLog: ReadingLog | null = $state(null);
  let readingListTrack: HTMLElement | undefined = $state();
  let placeholderCount = $state(0);
  let placeholderCountForItems = $derived(Math.max(1, placeholderCount - sharedList.items.length));
  let touchStartX = 0;
  let touchStartScroll = 0;
  let trackScrolled = $state(false);

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
  let readDate = $state(new Date().toISOString().split('T')[0]);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let deleteConfirmId = $state<string | null>(null);

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
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, ch => entities[ch] || ch);
  }

  function selectBook(book: BookResult) {
    selectedBook = book;
    bookSelected = true;
    showLogForm = false;
    editingLog = null;
    bookDetails = null;
    bookDetailsLoading = true;
    void loadBookDetails(book.id);
  }

  function clearSelection() {
    selectedBook = null;
    bookSelected = false;
    bookDetails = null;
    bookDetailsLoading = false;
    showCoverLightbox = false;
    showLogForm = false;
    editingLog = null;
  }

  async function loadBookDetails(olid: string) {
    bookDetailsLoading = true;
    try {
      const cleanId = olid.replace('/works/', '');
      const res = await fetch(`https://openlibrary.org/works/${cleanId}.json`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      bookDetails = data as BookDetails;
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
  function editLog(log: ReadingLog) {
    editingLog = log;
    showLogForm = true;
    bookDetails = null;
    selectedBook = {
      id: log.book_id,
      title: log.title,
      author: log.author,
      coverUrl: log.cover_url,
      year: null,
      editions: null,
      publisher: null,
    };
    reviewText = log.review || '';
    rating = log.rating || 0;
    liked = log.liked;
    readDate = log.read_date;
    saveError = null;
  }

  function startLogging() {
    editingLog = null;
    reviewText = '';
    rating = 0;
    liked = null;
    readDate = new Date().toISOString().split('T')[0];
    saveError = null;
    showLogForm = true;
  }

  function setRating(val: number) {
    if (rating === val) { rating = 0; } else { rating = val; }
  }

  function cycleLiked() {
    if (liked === null) liked = true;
    else if (liked === true) liked = false;
    else liked = null;
  }

  async function saveLog() {
    if (!selectedBook) return;
    saving = true;
    saveError = null;
    try {
      const saved = await db.saveReadingLog({
        id: editingLog?.id ?? null,
        book_id: selectedBook.id,
        title: selectedBook.title,
        author: selectedBook.author,
        cover_url: selectedBook.coverUrl,
        rating: rating > 0 ? rating : null,
        liked: liked,
        review: reviewText.trim() || null,
        read_date: readDate,
      });
      if (editingLog) {
        logs = logs.map((l) => (l.id === saved.id ? saved : l));
      } else {
        logs = [saved, ...logs];
      }
      clearSelection();
    } catch (e: any) {
      saveError = e.message || 'Failed to save';
    } finally {
      saving = false;
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

  {#if sharedList.items.length > 0 || !searchQuery}
    <div class="rl-section">
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
              <button type="button" class="rl-card-remove" onclick={() => removeFromReadingList(item.id)} aria-label="Remove from list"><X class="size-3" aria-hidden="true" /></button>
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

  {#if selectedBook}
    <div class="overlay" transition:fade={{ duration: 150 }} onclick={clearSelection} role="dialog" aria-modal="true" aria-label="Book details">
      <div class="overlay-bg"></div>
      <div class="overlay-content" onclick={(e) => e.stopPropagation()}>

        {#if showLogForm}
          <div class="log-form">
            <div class="log-form-top">
              <h3 class="log-form-title">{editingLog ? 'Edit Log' : 'New Entry'}</h3>
              <button type="button" class="log-form-close" onclick={clearSelection} aria-label="Close"><X class="size-5" /></button>
            </div>
            <div class="log-form-book">
              {#if selectedBook.coverUrl}
                <img src={selectedBook.coverUrl} alt="" class="log-form-cover" loading="lazy" onerror={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
              {:else}
                <div class="log-form-cover log-form-cover--empty">
                  <BookMarked class="size-8" aria-hidden="true" />
                </div>
              {/if}
              <div class="log-form-book-meta">
                <div class="log-form-book-title">{selectedBook.title}</div>
                {#if selectedBook.author}
                  <div class="log-form-book-author">{selectedBook.author}</div>
                {/if}
              </div>
            </div>
            <div class="log-form-field">
              <label class="log-form-label">Rating</label>
              <div class="log-stars">
                {#each [0.5,1,1.5,2,2.5,3,3.5,4,4.5,5] as val}
                  <button type="button" class="log-star" class:log-star--on={val <= rating} class:log-star--half={val === rating && val % 1 !== 0} onclick={() => setRating(val)} aria-label="{val} stars">
                    <Star class="size-5" aria-hidden="true" />
                  </button>
                {/each}
              </div>
            </div>
            <div class="log-form-field">
              <label class="log-form-label">Liked it?</label>
              <button type="button" class="log-liked" class:log-liked--yes={liked === true} class:log-liked--no={liked === false} onclick={cycleLiked}>
                {#if liked === true}<Check class="size-4" aria-hidden="true" /> Liked
                {:else if liked === false}<X class="size-4" aria-hidden="true" /> Didn't like
                {:else}Skip{/if}
              </button>
            </div>
            <div class="log-form-field">
              <label class="log-form-label" for="lr">Review</label>
              <textarea id="lr" class="log-form-ta" bind:value={reviewText} placeholder="What did you think? (optional)" maxlength={5000} rows={4}></textarea>
            </div>
            <div class="log-form-field">
              <label class="log-form-label" for="ld">Date read</label>
              <input id="ld" type="date" class="log-form-date" bind:value={readDate} max={new Date().toISOString().split('T')[0]} />
            </div>
            {#if saveError}
              <div class="log-form-err">{saveError}</div>
            {/if}
            <button type="button" class="log-form-save" disabled={saving} onclick={saveLog}>
              {saving ? 'Saving…' : editingLog ? 'Update Entry' : 'Log Entry'}
            </button>
          </div>

        {:else}
          <div class="book-fade-layer">
            {#if bookDetailsLoading}
              <div class="book-fade-cell" transition:fade={{ duration: 150 }}>
                <div class="book-skel-header" />
                <div class="book-body">
                  <div class="book-skel-cover" />
                  <div class="book-skel-info">
                    <div class="book-skel-line" style="width:55%" />
                    <div class="book-skel-line" style="width:35%" />
                  </div>
                </div>
              </div>
            {/if}
            {#if !bookDetailsLoading && bookDetails}
              <div class="book-fade-cell" transition:fade={{ duration: 150 }}>
                <div class="book-header">
                  <h2 class="book-header-title">{selectedBook.title}</h2>
                  <button type="button" class="book-close" onclick={clearSelection} aria-label="Close"><X class="size-5" /></button>
                </div>
                <div class="book-body">
                  {#if selectedBook.coverUrl}
                    <img src={selectedBook.coverUrl} alt="" class="book-cover" role="button" tabindex="0" onclick={() => showCoverLightbox = true} onkeydown={(e) => { if (e.key === 'Enter') showCoverLightbox = true; }} />
                  {:else}
                    <div class="book-cover book-cover--empty">
                      <BookMarked class="size-10" aria-hidden="true" />
                    </div>
                  {/if}
                  <div class="book-info">
                    {#if selectedBook.author}
                      <div class="book-author">{selectedBook.author}</div>
                    {/if}
                    <div class="book-meta">
                      {#if selectedBook.year}<span>{selectedBook.year}</span>{/if}
                      {#if selectedBook.year && selectedBook.publisher}<span class="book-dot"></span>{/if}
                      {#if selectedBook.publisher}<span>{selectedBook.publisher}</span>{/if}
                      {#if selectedBook.first_publish_year}
                        {#if selectedBook.publisher || selectedBook.year}<span class="book-dot"></span>{/if}
                        <span>First published {selectedBook.first_publish_year}</span>
                      {/if}
                    </div>
                    <div class="book-actions">
                      {#if allReadingListItemIds.has(selectedBook.id)}
                        <button type="button" class="book-btn book-btn--remove" onclick={() => removeFromReadingList(selectedBook.id)}>Remove</button>
                      {:else}
                        <button type="button" class="book-btn book-btn--add" onclick={() => addToReadingList(selectedBook)}>Add to List</button>
                      {/if}
                      <button type="button" class="book-btn book-btn--log" onclick={() => showLogForm = true}>Log</button>
                    </div>
                  </div>
                </div>

                {#if bookDetails.description}
                  <div class="book-desc">{@html renderDescription(bookDetails.description)}</div>
                {/if}

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
              </div>
            {/if}
            {#if !bookDetailsLoading && !bookDetails}
              <div class="book-error">
                <p>Could not load book details.</p>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showCoverLightbox && selectedBook?.coverUrl}
    <div class="lightbox" onclick={() => showCoverLightbox = false} role="dialog" aria-modal="true" aria-label="Book cover">
      <img src={selectedBook.coverUrl.replace('-M.jpg', '-L.jpg')} alt="" class="lightbox-img" onclick={(e) => e.stopPropagation()} />
    </div>
  {/if}
</div>

<style>
  .diary-panel { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; }

  /* ───── Reading List Carousel ───── */
  .rl-section { }
  .rl-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; padding-left: 0.25rem; }
  .rl-header-left { display: flex; align-items: baseline; gap: 0.5rem; }
  .rl-title-btn { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .rl-title-btn:hover .rl-title { color: var(--ink); }
  .rl-chevron { color: var(--hint); opacity: 0.5; transition: transform 0.15s ease; }
  .rl-chevron--open { transform: rotate(90deg); }
  .rl-title { font-family: 'Inter', sans-serif; font-size: 0.7rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: var(--hint); margin: 0; transition: color 0.1s; }
  .rl-track-collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.2s ease; }
  .rl-track-collapse--open { grid-template-rows: 1fr; }
  .rl-track-collapse > .rl-track-wrap { min-height: 0; overflow: hidden; }
  .rl-count { font-family: 'Inter', sans-serif; font-size: 0.65rem; color: var(--hint); opacity: 0.5; }
  .rl-track-wrap { position: relative; overflow: hidden; -webkit-mask: linear-gradient(90deg, #000 calc(100% - 48px), transparent); mask: linear-gradient(90deg, #000 calc(100% - 48px), transparent); }
  .rl-track-wrap--scrolled { -webkit-mask: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 48px), transparent 100%); mask: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 48px), transparent 100%); }
  .rl-track { display: flex; gap: 8px; overflow-x: auto; scroll-behavior: smooth; padding: 4px 0 8px; scrollbar-width: none; }
  .rl-track::-webkit-scrollbar { display: none; }
  .rl-card { flex-shrink: 0; width: 100px; background: transparent; border: none; cursor: pointer; text-align: left; padding: 0; }
  .rl-card-wrap { position: relative; flex-shrink: 0; }
  .rl-card-wrap:hover .rl-card-remove { opacity: 1; }
  .rl-card-remove { position: absolute; top: 4px; right: 4px; opacity: 0; transition: opacity 0.12s; background: rgba(0,0,0,0.6); border: none; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; z-index: 2; }
  .rl-card-remove:hover { background: rgba(239,68,68,0.8); }
  .rl-card--placeholder { cursor: default; }
  .rl-card--add { cursor: pointer; display: flex; }
  .rl-card-plus { font-size: 3rem; font-weight: 200; color: color-mix(in srgb, var(--hint) 50%, transparent); line-height: 1; }
  .rl-card-img { width: 100px; height: 150px; object-fit: cover; border-radius: 6px; background: var(--surf); display: block; }
  .rl-card-img--add { display: flex; align-items: center; justify-content: center; flex: 1; background: color-mix(in srgb, var(--surf) 60%, var(--bg)); border: 1px dashed color-mix(in srgb, var(--border) 60%, transparent); }
  .rl-card-img--empty { display: flex; align-items: center; justify-content: center; color: var(--hint); }
  .rl-card-img--placeholder { background: color-mix(in srgb, var(--surf) 60%, var(--bg)); border: 1px dashed color-mix(in srgb, var(--border) 60%, transparent); }
  .rl-empty { font-size: 12px; color: var(--hint); padding: 0.5rem 0; }

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
  .overlay-content { position: relative; background: var(--bg); border-radius: 12px; max-width: 460px; width: 100%; max-height: 85vh; overflow-y: auto; padding: 1.25rem 1.5rem 1.5rem; box-shadow: 0 8px 32px rgba(0,0,0,0.35); animation: pop 0.2s cubic-bezier(0.34,1.56,0.64,1); }

  /* Book header */
  .book-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; margin-bottom: 1rem; }
  .book-header-title { font-family: var(--dm); font-size: 1.15rem; font-weight: 700; line-height: 1.3; letter-spacing: 0.02em; color: var(--ink); margin: 0; flex: 1; }
  .book-close { flex-shrink: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: transparent; border: none; cursor: pointer; color: var(--hint); transition: background 0.12s, color 0.12s; }
  .book-close:hover { background: var(--surf); color: var(--text); }

  /* Book body — cover + info */
  .book-body { display: flex; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
  .book-cover { width: 96px; height: 144px; object-fit: cover; border-radius: 8px; flex-shrink: 0; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: box-shadow 0.15s; }
  .book-cover:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
  .book-cover--empty { display: flex; align-items: center; justify-content: center; background: var(--surf); color: var(--hint); box-shadow: none; }
  .book-info { flex: 1; display: flex; flex-direction: column; gap: 8px; justify-content: center; }
  .book-author { font-size: 0.95rem; color: var(--hint); line-height: 1.4; }
  .book-meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 0.8rem; color: var(--hint-muted, var(--hint)); opacity: 0.8; }
  .book-dot { display: inline-block; width: 3px; height: 3px; border-radius: 50%; background: currentColor; }
  .book-actions { display: flex; gap: 6px; margin-top: 4px; }
  .book-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: transparent; cursor: pointer; font-size: 0.8rem; font-weight: 500; transition: background 0.12s, border-color 0.12s, color 0.12s; }
  .book-btn--add { color: #3b82f6; border-color: color-mix(in srgb, #3b82f6 40%, transparent); }
  .book-btn--add:hover { background: color-mix(in srgb, #3b82f6 10%, transparent); border-color: #3b82f6; }
  .book-btn--remove { color: #ef4444; border-color: color-mix(in srgb, #ef4444 40%, transparent); }
  .book-btn--remove:hover { background: color-mix(in srgb, #ef4444 10%, transparent); border-color: #ef4444; }
  .book-btn--log { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .book-btn--log:hover { opacity: 0.9; }

  /* Book description */
  .book-desc { font-size: 0.88rem; line-height: 1.65; color: var(--text); margin-top: 1rem; max-height: 280px; overflow-y: auto; scrollbar-width: thin; }

  /* Book sections (subjects, places, etc.) */
  .book-section { margin-top: 1rem; }
  .book-section-title { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--hint); margin: 0 0 0.5rem; }
  .book-tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .book-tag { padding: 3px 10px; border-radius: 6px; background: var(--surf); border: 1px solid var(--border); font-size: 0.78rem; color: var(--hint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }

  /* Book error */
  .book-error { padding: 2rem 0; text-align: center; font-size: 0.85rem; color: var(--hint); }
  .book-error p { margin: 0; }

  /* Book crossfade layer */
  .book-fade-layer { display: grid; }
  .book-fade-cell { grid-area: 1 / 1; }

  /* Book skeletons */
  .book-skel-header { height: 20px; width: 60%; border-radius: 6px; margin-bottom: 1rem; background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%); background-size: 200px 100%; animation: shimmer 1.5s ease-in-out infinite; }
  .book-skel-cover { width: 96px; height: 144px; border-radius: 8px; flex-shrink: 0; background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%); background-size: 200px 100%; animation: shimmer 1.5s ease-in-out infinite; }
  .book-skel-info { flex: 1; display: flex; flex-direction: column; gap: 10px; justify-content: center; }
  .book-skel-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%); background-size: 200px 100%; animation: shimmer 1.5s ease-in-out infinite; }

  /* ───── Log Form ───── */
  .log-form { display: flex; flex-direction: column; gap: 0.75rem; }
  .log-form-top { display: flex; justify-content: space-between; align-items: center; }
  .log-form-title { font-family: var(--dm); font-size: 1rem; font-weight: 700; color: var(--ink); margin: 0; }
  .log-form-close { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: transparent; border: none; cursor: pointer; color: var(--hint); transition: background 0.12s, color 0.12s; }
  .log-form-close:hover { background: var(--surf); color: var(--text); }
  .log-form-book { display: flex; align-items: center; gap: 12px; }
  .log-form-cover { width: 48px; height: 72px; object-fit: cover; border-radius: 4px; flex-shrink: 0; background: var(--surf); }
  .log-form-cover--empty { display: flex; align-items: center; justify-content: center; color: var(--hint); }
  .log-form-book-meta { min-width: 0; flex: 1; }
  .log-form-book-title { font-family: var(--dm); font-size: 0.85rem; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .log-form-book-author { font-size: 0.75rem; color: var(--hint); }
  .log-form-field { display: flex; flex-direction: column; gap: 4px; }
  .log-form-label { font-size: 11px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.04em; }
  .log-stars { display: flex; gap: 2px; }
  .log-star { background: transparent; border: none; cursor: pointer; padding: 2px; color: var(--hint); transition: color 0.15s; }
  .log-star:hover { color: #f59e0b; }
  .log-star--on { color: #f59e0b; }
  .log-liked { font-size: 11px; padding: 4px 10px; border-radius: 6px; border: 0.5px solid var(--rule); background: transparent; color: var(--hint); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; }
  .log-liked--yes { background: #065f46; color: #6ee7b7; border-color: #065f46; }
  .log-liked--no { background: #7f1d1d; color: #fca5a5; border-color: #7f1d1d; }
  .log-form-ta { width: 100%; background: transparent; border: 0.5px solid var(--rule); border-radius: 8px; padding: 8px; font-size: 12px; color: var(--ink); resize: vertical; font-family: inherit; outline: none; box-sizing: border-box; }
  .log-form-ta:focus { border-color: var(--accent); }
  .log-form-date { background: transparent; border: 0.5px solid var(--rule); border-radius: 8px; padding: 6px 8px; font-size: 12px; color: var(--ink); outline: none; max-width: 160px; }
  .log-form-date:focus { border-color: var(--accent); }
  .log-form-err { color: #ef4444; font-size: 11px; padding: 0.25rem 0; }
  .log-form-save { padding: 8px 16px; border-radius: 8px; border: none; background: var(--accent); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; align-self: flex-start; }
  .log-form-save:disabled { opacity: 0.5; cursor: default; }

  /* Lightbox */
  .lightbox { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; padding: 2rem; animation: fadeIn 0.2s ease-out; }
  .lightbox-img { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.5); animation: pop 0.25s cubic-bezier(0.34,1.56,0.64,1); }

  @keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: calc(200px + 100%) 0; } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pop { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
</style>
