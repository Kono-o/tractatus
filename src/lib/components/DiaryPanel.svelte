<script context="module" lang="ts">
  interface BookResult {
    id: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    year: number | null;
    editions: number | null;
    publisher: string | null;
  }

  const searchCache = new Map<string, BookResult[]>();
</script>

<script lang="ts">
  import { db, type ReadingLog } from '$lib/db';
  import { X, Star, Check, BookMarked, Trash2 } from '@lucide/svelte';

  let { searchQuery = '', onselect, searchExpanded = false }: { searchQuery?: string; onselect?: () => void; searchExpanded?: boolean } = $props();

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

  let searchStatus = $derived.by(() => {
    if (searchPhase === 'contacting') return `OpenLibrary · ${elapsed.toFixed(1)}s`;
    if (searchPhase === 'error') return 'OpenLibrary · Failed!';
    if (searchPhase === 'done') {
      if (searchResults.length === 0) return `OpenLibrary · ${fetchDuration.toFixed(1)}s · 0 Results`;
      return `OpenLibrary · ${fetchDuration.toFixed(1)}s · ${searchResults.length} Results`;
    }
    return 'OpenLibrary · Online';
  });

  // Elapsed timer while fetching
  $effect(() => {
    if (searchPhase !== 'contacting') return;
    const t = setInterval(() => { elapsed = (performance.now() - fetchStartTime) / 1000; }, 50);
    return () => clearInterval(t);
  });

  let logs = $state<ReadingLog[]>([]);
  let logsLoading = $state(true);

  let selectedBook = $state<BookResult | null>(null);
  let editingLog = $state<ReadingLog | null>(null);
  let showLogForm = $state(false);

  let bookDetails = $state<any>(null);
  let bookDetailsLoading = $state(false);

  let reviewText = $state('');
  let rating = $state<number>(0);
  let liked: boolean | null = $state(null);
  let readDate = $state(new Date().toISOString().split('T')[0]);
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  let deleteConfirmId = $state<string | null>(null);

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

  async function doSearch(term: string) {
    if (term.length < 2) return false;

    currentAbort?.abort();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);
    currentAbort = ctrl;
    const gen = searchGen;
    searchError = null;
    searchLoading = true;
    elapsed = 0;
    fetchStartTime = performance.now();
    searchPhase = 'contacting';
    try {
      const solrQ = buildFuzzyQuery(term);
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(solrQ)}&limit=16&fields=key,title,author_name,cover_i,first_publish_year,edition_count,publisher`;
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
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-S.jpg` : null,
        year: doc.first_publish_year ?? null,
        editions: doc.edition_count ?? null,
        publisher: doc.publisher?.[0] ?? null,
      }));
      searchCache.set(term.toLowerCase().trim(), results);
      searchResults = results;
      selectedIndex = -1;
      fetchDuration = (performance.now() - fetchStartTime) / 1000;
      searchPhase = 'done';
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') return false;
      searchError = e.message;
      searchResults = [];
      selectedIndex = -1;
      searchPhase = 'error';
    } finally {
      if (searchGen === gen) searchLoading = false;
    }
    return false;
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

    // Synchronous cache check — no loading flash, results appear same frame
    const cacheKey = q.toLowerCase().trim();
    const cached = searchCache.get(cacheKey);
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
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => void doSearch(q), 30);

    return () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      currentAbort?.abort();
    };
  });

  function onDocKeydown(e: KeyboardEvent) {
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

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', onDocKeydown);
    return () => document.removeEventListener('keydown', onDocKeydown);
  });

  function selectBook(book: BookResult) {
    selectedBook = book;
    showLogForm = false;
    bookDetails = null;
    searchResults = [];
    searchLoading = false;
    searchError = null;
    selectedIndex = -1;
    onselect?.();
    fetchBookDetails(book.id);
  }

  async function fetchBookDetails(workId: string) {
    bookDetailsLoading = true;
    bookDetails = null;
    try {
      const olid = workId.replace('/works/', '');
      const res = await fetch(`https://openlibrary.org/works/${olid}.json`);
      if (!res.ok) throw new Error('Failed to fetch book details');
      const data = await res.json();
      bookDetails = data;
    } catch {
      bookDetails = null;
    } finally {
      bookDetailsLoading = false;
    }
  }

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

  function clearSelection() {
    selectedBook = null;
    editingLog = null;
    showLogForm = false;
    bookDetails = null;
    reviewText = '';
    rating = 0;
    liked = null;
    readDate = new Date().toISOString().split('T')[0];
    saveError = null;
  }

  function setRating(val: number) {
    if (rating === val) {
      rating = 0;
    } else {
      rating = val;
    }
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
  {#if selectedBook}
    {#if showLogForm}
      <div class="diary-entry-form">
        <div class="diary-entry-form-header">
          <button type="button" class="diary-back-btn" onclick={clearSelection}>
            ← Back
          </button>
          <h3 class="diary-entry-form-title">
            {editingLog ? 'Edit Log' : 'New Entry'}
          </h3>
        </div>

        <div class="diary-entry-book">
          {#if selectedBook.coverUrl}
            <img src={selectedBook.coverUrl} alt="" class="diary-entry-cover" loading="lazy" onerror={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
          {:else}
            <div class="diary-entry-cover diary-entry-cover--empty">
              <BookMarked class="size-8" aria-hidden="true" />
            </div>
          {/if}
          <div class="diary-entry-book-info">
            <div class="diary-entry-book-title">{selectedBook.title}</div>
            {#if selectedBook.author}
              <div class="diary-entry-book-author">{selectedBook.author}</div>
            {/if}
          </div>
        </div>

        <div class="diary-entry-field">
          <label class="diary-entry-label">Rating</label>
          <div class="diary-stars">
            {#each [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as val}
              <button
                type="button"
                class="diary-star-btn"
                class:diary-star-btn--active={val <= rating}
                class:diary-star-btn--half={val === rating && val % 1 !== 0}
                onclick={() => setRating(val)}
                aria-label="{val} stars"
              >
                <Star class="size-5" aria-hidden="true" />
              </button>
            {/each}
          </div>
        </div>

        <div class="diary-entry-field">
          <label class="diary-entry-label">Liked it?</label>
          <div class="diary-liked-row">
            <button
              type="button"
              class="diary-liked-btn"
              class:diary-liked-btn--yes={liked === true}
              class:diary-liked-btn--null={liked === null}
              onclick={cycleLiked}
            >
              {#if liked === true}
                <Check class="size-4" aria-hidden="true" />
                Liked
              {:else if liked === false}
                <X class="size-4" aria-hidden="true" />
                Didn't like
              {:else}
                Skip
              {/if}
            </button>
          </div>
        </div>

        <div class="diary-entry-field">
          <label class="diary-entry-label" for="diary-review">Review</label>
          <textarea
            id="diary-review"
            class="diary-entry-textarea"
            bind:value={reviewText}
            placeholder="What did you think? (optional)"
            maxlength={5000}
            rows={4}
          ></textarea>
        </div>

        <div class="diary-entry-field">
          <label class="diary-entry-label" for="diary-date">Date read</label>
          <input
            id="diary-date"
            type="date"
            class="diary-entry-date"
            bind:value={readDate}
            max={new Date().toISOString().split('T')[0]}
          />
        </div>

        {#if saveError}
          <div class="diary-entry-error">{saveError}</div>
        {/if}

        <button
          type="button"
          class="diary-save-btn"
          disabled={saving}
          onclick={saveLog}
        >
          {saving ? 'Saving…' : editingLog ? 'Update Entry' : 'Log Entry'}
        </button>
      </div>
    {:else}
      <div class="diary-info-panel">
        <div class="diary-info-header">
          <button type="button" class="diary-back-btn" onclick={clearSelection}>
            ← Back
          </button>
          <h3 class="diary-info-title">Book Details</h3>
        </div>

        {#if bookDetailsLoading}
          <div class="diary-info-loading">Loading details…</div>
        {:else if bookDetails}
          <div class="diary-info-top">
            {#if selectedBook.coverUrl}
              <img src={selectedBook.coverUrl} alt="" class="diary-info-cover" />
            {:else}
              <div class="diary-info-cover diary-info-cover--empty">
                <BookMarked class="size-10" aria-hidden="true" />
              </div>
            {/if}
            <div class="diary-info-top-text">
              <div class="diary-info-title-text">{selectedBook.title}</div>
              {#if selectedBook.author}
                <div class="diary-info-author">{selectedBook.author}</div>
              {/if}
              <div class="diary-info-meta-line">
                {#if selectedBook.year}<span>{selectedBook.year}</span>{/if}
                {#if selectedBook.year && selectedBook.publisher}<span class="diary-info-dot" />{/if}
                {#if selectedBook.publisher}<span>{selectedBook.publisher}</span>{/if}
                {#if (selectedBook.year || selectedBook.publisher) && selectedBook.editions}<span class="diary-info-dot" />{/if}
                {#if selectedBook.editions}<span>{selectedBook.editions} editions</span>{/if}
              </div>
            </div>
          </div>

          <div class="diary-info-section">
            <div class="diary-info-section-title">Description</div>
            <div class="diary-info-description">
              {#if typeof bookDetails.description === 'string'}
                {bookDetails.description}
              {:else if bookDetails.description?.value}
                {bookDetails.description.value}
              {:else}
                <span class="diary-info-missing">No description available.</span>
              {/if}
            </div>
          </div>

          <div class="diary-info-details-grid">
            {#if bookDetails.subjects?.length}
              <div class="diary-info-section">
                <div class="diary-info-section-title">Subjects</div>
                <div class="diary-info-tags">
                  {#each bookDetails.subjects.slice(0, 8) as subj}
                    <span class="diary-info-tag">{subj}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if bookDetails.subject_people?.length}
              <div class="diary-info-section">
                <div class="diary-info-section-title">People</div>
                <div class="diary-info-tags">
                  {#each bookDetails.subject_people.slice(0, 6) as person}
                    <span class="diary-info-tag">{person}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if bookDetails.subject_places?.length}
              <div class="diary-info-section">
                <div class="diary-info-section-title">Places</div>
                <div class="diary-info-tags">
                  {#each bookDetails.subject_places.slice(0, 4) as place}
                    <span class="diary-info-tag">{place}</span>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <button type="button" class="diary-log-btn" onclick={startLogging}>
            <BookMarked class="size-4" aria-hidden="true" />
            Log Reading
          </button>
        {:else}
          <div class="diary-info-loading">Could not load book details.</div>
        {/if}
      </div>
    {/if}
  {:else}
    <div class="search-results-box" class:search-results-box--open={searchExpanded}>
      <div class="diary-status" class:diary-status--error={searchPhase === 'error'}><span class="diary-status-dot" class:diary-status-dot--error={searchPhase === 'error'} />{searchStatus}</div>

      {#if searchQuery.trim().length >= 2}
        {#if searchLoading}
          <div class="diary-results diary-results--loading">
            {#each [1, 2, 3, 4, 5] as _}
              <div class="diary-skeleton">
                <div class="diary-skeleton-cover" />
                <div class="diary-skeleton-lines">
                  <div class="diary-skeleton-line diary-skeleton-line--title" />
                  <div class="diary-skeleton-line diary-skeleton-line--author" />
                </div>
              </div>
            {/each}
          </div>
        {:else if searchResults.length > 0}
          <div class="diary-results" role="listbox" aria-label="Search results">
            {#each searchResults as book, i}
              <button
                type="button"
                role="option"
                aria-selected={selectedIndex === i}
                class="diary-result"
                class:diary-result--selected={selectedIndex === i}
                data-search-index={i}
                onclick={() => selectBook(book)}
                onmouseenter={() => { selectedIndex = i; }}
              >
                {#if book.coverUrl}
                  <div class="diary-result-cover-wrap">
                    <div class="diary-result-cover--skeleton" />
                    <img src={book.coverUrl} alt="" class="diary-result-cover" loading="lazy" onload={(e) => { const el = e.target as HTMLElement; el.style.opacity = '1'; (el.previousElementSibling as HTMLElement).style.display = 'none'; }} onerror={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                  </div>
                {:else}
                  <div class="diary-result-cover diary-result-cover--empty">
                    <BookMarked class="size-5" aria-hidden="true" />
                  </div>
                {/if}
                <div class="diary-result-info">
                  <div class="diary-result-title">{@html highlightMatch(book.title, searchQuery)}</div>
                  {#if book.author}
                    <div class="diary-result-author">{#if book.year}{book.year}<span class="diary-result-dot" />{/if}{@html highlightMatch(book.author, searchQuery)}</div>
                  {/if}
                  <div class="diary-result-meta">
                    {#if book.publisher}{book.publisher}{/if}
                    {#if book.editions}{#if book.publisher}<span class="diary-result-dot" />{/if}{book.editions} ed.{/if}
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .diary-panel {
    padding: 0.75rem 1rem;
  }

  .diary-entry-error {
    color: #ef4444;
    font-size: 11px;
    padding: 0.25rem 0;
  }

  .diary-loading {
    font-size: 12px;
    color: var(--hint);
    padding: 1rem 0;
  }

  .diary-empty {
    font-size: 12px;
    color: var(--hint);
    padding: 1rem 0;
  }

  .diary-empty-query {
    color: var(--ink);
    font-weight: 500;
  }

  .search-results-box {
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.4rem 0.6rem;
    transition: max-height 0.25s ease-out, opacity 0.2s ease-out, margin 0.25s ease-out;
    margin: 0;
  }
  .search-results-box--open {
    max-height: 500px;
    opacity: 1;
    margin: 4px 0;
  }

  .diary-status {
    font-size: 10px;
    color: var(--hint);
    padding: 0.1rem 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0.2rem;
    display: flex;
    align-items: center;
  }
  .diary-status--error {
    color: #ef4444;
  }
  .diary-status-dot {
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #22c55e;
    margin-right: 0.3rem;
    box-shadow: 0 0 4px #22c55e;
  }
  .diary-status-dot--error {
    background: #ef4444;
    box-shadow: 0 0 4px #ef4444;
  }

  /* ── Skeleton ── */
  @keyframes shimmer {
    0% { background-position: -200px 0; }
    100% { background-position: calc(200px + 100%) 0; }
  }

  .diary-results--loading {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
  }

  .diary-skeleton {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px;
  }
  .diary-skeleton-cover {
    width: 36px;
    height: 54px;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%);
    background-size: 200px 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }
  .diary-skeleton-lines {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .diary-skeleton-line {
    height: 10px;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%);
    background-size: 200px 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
  .diary-skeleton-line--title {
    width: 35%;
  }
  .diary-skeleton-line--author {
    width: 25%;
  }

  /* ── Results ── */
  @keyframes diary-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .diary-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 340px;
    overflow-y: auto;
    overflow-x: hidden;
    scroll-behavior: smooth;
    animation: diary-fade-in 0.2s ease-out;
  }
  .diary-results:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 8px;
  }
  .diary-results {
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .diary-results::-webkit-scrollbar {
    width: 5px;
  }
  .diary-results::-webkit-scrollbar-track {
    background: transparent;
  }
  .diary-results::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  .diary-results::-webkit-scrollbar-thumb:hover {
    background: var(--hint);
  }

  .diary-result {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.1s;
  }
  .diary-result:hover {
    background: var(--surf);
  }
  .diary-result:active {
    background: var(--border);
  }

  .diary-result mark {
    background: var(--mark-bg, #b4c6d8);
    color: var(--text);
    padding: 0 0.1em;
    border-radius: 2px;
    font-weight: 600;
  }

  .diary-result-cover {
    width: 36px;
    height: 54px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .diary-result-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--hint);
    background: var(--surf);
  }
  .diary-result-cover-wrap {
    position: relative;
    flex-shrink: 0;
    width: 36px;
    height: 54px;
  }
  .diary-result-cover-wrap .diary-result-cover {
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .diary-result-cover--skeleton {
    width: 36px;
    height: 54px;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--surf) 25%, var(--border) 50%, var(--surf) 75%);
    background-size: 200px 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
  .diary-result-cover--hidden {
    display: none;
  }

  .diary-result-info {
    min-width: 0;
    flex: 1;
  }
  .diary-result-title {
    font-size: 12px;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .diary-result-author {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }
  .diary-result-dot {
    display: inline-block;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: currentColor;
    margin: 0 0.35em;
    vertical-align: middle;
  }
  .diary-result-meta {
    font-size: 11px;
    color: var(--hint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Entry Form */
  .diary-entry-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    font-family: var(--font-serif);
  }

  .diary-entry-form-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .diary-back-btn {
    background: transparent;
    border: none;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
  }

  .diary-entry-form-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    margin: 0;
  }

  /* Book Info Panel */
  .diary-info-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    font-family: var(--font-serif);
  }
  .diary-info-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .diary-info-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    margin: 0;
  }
  .diary-info-loading {
    font-size: 12px;
    color: var(--hint);
    padding: 2rem 0;
    text-align: center;
  }
  .diary-info-top {
    display: flex;
    gap: 14px;
  }
  .diary-info-cover {
    width: 80px;
    height: 120px;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .diary-info-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--hint);
    background: var(--surf);
  }
  .diary-info-top-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .diary-info-title-text {
    font-size: 16px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.3;
    font-family: var(--font-logo, var(--font-serif));
  }
  .diary-info-author {
    font-size: 13px;
    color: var(--hint);
    font-family: var(--font-serif);
  }
  .diary-info-meta-line {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
    font-family: var(--font-serif);
  }
  .diary-info-dot {
    display: inline-block;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
    margin: 0 0.4em;
    vertical-align: middle;
  }
  .diary-info-section {
    margin-top: 0.25rem;
  }
  .diary-info-section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.3rem;
    font-family: var(--font-serif);
  }
  .diary-info-description {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.55;
    max-height: 120px;
    overflow-y: auto;
    font-family: var(--font-serif);
  }
  .diary-info-missing {
    color: var(--hint);
    font-style: italic;
  }
  .diary-info-details-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .diary-info-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .diary-info-tag {
    font-size: 10px;
    color: var(--hint);
    background: var(--surf);
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }
  .diary-log-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .diary-log-btn:hover {
    background: var(--surf);
  }

  .diary-entry-book {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .diary-entry-cover {
    width: 48px;
    height: 72px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--surf);
  }
  .diary-entry-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--hint);
  }

  .diary-entry-book-info {
    min-width: 0;
    flex: 1;
  }
  .diary-entry-book-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }
  .diary-entry-book-author {
    font-size: 11px;
    color: var(--hint);
  }

  .diary-entry-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .diary-entry-label {
    font-size: 11px;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .diary-stars {
    display: flex;
    gap: 2px;
  }

  .diary-star-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: var(--hint);
    transition: color 0.15s;
  }
  .diary-star-btn:hover {
    color: #f59e0b;
  }
  .diary-star-btn--active {
    color: #f59e0b;
  }

  .diary-liked-row {
    display: flex;
    gap: 6px;
  }

  .diary-liked-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 0.5px solid var(--rule);
    background: transparent;
    color: var(--hint);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .diary-liked-btn--yes {
    background: #065f46;
    color: #6ee7b7;
    border-color: #065f46;
  }
  .diary-liked-btn--null {
    opacity: 0.6;
  }

  .diary-entry-textarea {
    width: 100%;
    background: transparent;
    border: 0.5px solid var(--rule);
    border-radius: 8px;
    padding: 8px;
    font-size: 12px;
    color: var(--ink);
    resize: vertical;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  .diary-entry-textarea:focus {
    border-color: var(--accent);
  }

  .diary-entry-date {
    background: transparent;
    border: 0.5px solid var(--rule);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--ink);
    outline: none;
    max-width: 160px;
  }
  .diary-entry-date:focus {
    border-color: var(--accent);
  }

  .diary-save-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    align-self: flex-start;
  }
  .diary-save-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .diary-section {
    margin-top: 0.5rem;
  }

  .diary-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 0.5rem;
  }

  .diary-log-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .diary-log-entry {
    display: flex;
    gap: 10px;
    padding: 8px;
    border-radius: 8px;
    border: 0.5px solid var(--rule);
    align-items: flex-start;
  }

  .diary-log-cover {
    width: 32px;
    height: 48px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--surf);
  }
  .diary-log-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--hint);
  }

  .diary-log-info {
    min-width: 0;
    flex: 1;
  }

  .diary-log-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    text-align: left;
    display: block;
  }
  .diary-log-title:hover {
    color: var(--accent);
  }

  .diary-log-author {
    font-size: 11px;
    color: var(--hint);
  }

  .diary-log-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    margin-top: 2px;
    flex-wrap: wrap;
  }

  .diary-log-rating {
    color: #f59e0b;
  }

  .diary-log-liked {
    color: #6ee7b7;
  }
  .diary-log-disliked {
    color: #f87171;
  }

  .diary-log-date {
    color: var(--hint);
  }

  .diary-log-review {
    font-size: 11px;
    color: var(--ink);
    margin-top: 4px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .diary-log-delete {
    background: transparent;
    border: none;
    color: var(--hint);
    cursor: pointer;
    padding: 4px;
    flex-shrink: 0;
    font-size: 11px;
    border-radius: 4px;
    min-width: 44px;
    text-align: center;
    transition: background 0.12s, color 0.12s;
  }
  .diary-log-delete:hover,
  .diary-log-delete:focus-visible {
    background: var(--surf);
    outline: none;
  }
  .diary-log-delete--confirm {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }
  .diary-log-delete--confirm:hover {
    background: rgba(239, 68, 68, 0.2);
  }
</style>

