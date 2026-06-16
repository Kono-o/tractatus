<script lang="ts">
  import { db, type ReadingLog } from '$lib/db';
  import { Star, X, Check, BookMarked, Trash2 } from '@lucide/svelte';

  interface BookResult {
    id: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    year: number | null;
  }

  let { searchQuery = '' }: { searchQuery?: string } = $props();

  let searchResults = $state<BookResult[]>([]);
  let searchLoading = $state(false);
  let searchError = $state<string | null>(null);

  let logs = $state<ReadingLog[]>([]);
  let logsLoading = $state(true);

  let selectedBook = $state<BookResult | null>(null);
  let editingLog = $state<ReadingLog | null>(null);

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

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function doSearch(term: string) {
    if (term.length < 2) {
      searchResults = [];
      searchLoading = false;
      return;
    }
    searchLoading = true;
    searchError = null;
    try {
      const res = await fetch(`/api/books/search?q=${encodeURIComponent(term)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Search failed' }));
        throw new Error(err.message || 'Search failed');
      }
      const data = await res.json();
      searchResults = data.results ?? [];
    } catch (e: any) {
      searchError = e.message;
      searchResults = [];
    } finally {
      searchLoading = false;
    }
  }

  $effect(() => {
    const q = searchQuery;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchError = null;
    if (!q.trim()) {
      searchResults = [];
      searchLoading = false;
      return;
    }
    const timer = setTimeout(() => void doSearch(q.trim()), 350);
    searchDebounceTimer = timer;

    return () => {
      clearTimeout(timer);
    };
  });

  function selectBook(book: BookResult) {
    selectedBook = book;
    editingLog = null;
    reviewText = '';
    rating = 0;
    liked = null;
    readDate = new Date().toISOString().split('T')[0];
    saveError = null;
  }

  function editLog(log: ReadingLog) {
    editingLog = log;
    selectedBook = {
      id: log.book_id,
      title: log.title,
      author: log.author,
      coverUrl: log.cover_url,
      year: null,
    };
    reviewText = log.review || '';
    rating = log.rating || 0;
    liked = log.liked;
    readDate = log.read_date;
    saveError = null;
  }

  function clearSelection() {
    selectedBook = null;
    editingLog = null;
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
          <img src={selectedBook.coverUrl} alt={selectedBook.title} class="diary-entry-cover" />
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
    {#if searchError}
      <div class="diary-search-error">{searchError}</div>
    {/if}

    {#if searchLoading}
      <div class="diary-loading">Searching…</div>
    {:else if searchResults.length > 0}
      <div class="diary-results">
        {#each searchResults as book}
          <button type="button" class="diary-result" onclick={() => selectBook(book)}>
            {#if book.coverUrl}
              <img src={book.coverUrl} alt={book.title} class="diary-result-cover" />
            {:else}
              <div class="diary-result-cover diary-result-cover--empty">
                <BookMarked class="size-5" aria-hidden="true" />
              </div>
            {/if}
            <div class="diary-result-info">
              <div class="diary-result-title">{book.title}</div>
              {#if book.author}
                <div class="diary-result-author">{book.author}{#if book.year} · {book.year}{/if}</div>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {:else if searchQuery.length >= 2 && !searchLoading}
      <div class="diary-empty">No books found.</div>
    {/if}

    <div class="diary-section">
      <h3 class="diary-section-title">Reading Log</h3>
      {#if logsLoading}
        <div class="diary-loading">Loading…</div>
      {:else if logs.length === 0}
        <div class="diary-empty">No entries yet. Search and log a book above.</div>
      {:else}
        <div class="diary-log-list">
          {#each logs as log}
            <div class="diary-log-entry">
              {#if log.cover_url}
                <img src={log.cover_url} alt={log.title} class="diary-log-cover" />
              {:else}
                <div class="diary-log-cover diary-log-cover--empty">
                  <BookMarked class="size-4" aria-hidden="true" />
                </div>
              {/if}
              <div class="diary-log-info">
                <button type="button" class="diary-log-title" onclick={() => editLog(log)}>
                  {log.title}
                </button>
                {#if log.author}
                  <div class="diary-log-author">{log.author}</div>
                {/if}
                <div class="diary-log-meta">
                  {#if log.rating}
                    <span class="diary-log-rating">{renderStars(log.rating)}</span>
                  {/if}
                  {#if log.liked === true}
                    <span class="diary-log-liked">Liked</span>
                  {:else if log.liked === false}
                    <span class="diary-log-disliked">Didn't like</span>
                  {/if}
                  <span class="diary-log-date">{formatDate(log.read_date)}</span>
                </div>
                {#if log.review}
                  <div class="diary-log-review">{log.review}</div>
                {/if}
              </div>
              <button
                type="button"
                class="diary-log-delete"
                class:diary-log-delete--confirm={deleteConfirmId === log.id}
                onclick={() => handleDelete(log.id)}
                onblur={() => { if (deleteConfirmId === log.id) deleteConfirmId = null; }}
                aria-label={deleteConfirmId === log.id ? 'Confirm delete' : 'Delete entry'}
              >
                {#if deleteConfirmId === log.id}
                  Sure?
                {:else}
                  <Trash2 class="size-3" aria-hidden="true" />
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .diary-panel {
    padding: 0.75rem 1rem;
  }

  .diary-search-error,
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

  .diary-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 1rem;
    max-height: 280px;
    overflow-y: auto;
  }

  .diary-result {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px;
    border-radius: 8px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.15s;
  }
  .diary-result:hover {
    background: var(--surface);
  }

  .diary-result-cover {
    width: 36px;
    height: 54px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--surface);
  }
  .diary-result-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--hint);
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
    background: var(--surface);
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
    background: var(--surface);
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
  }
  .diary-log-delete:hover {
    background: var(--surface);
  }
  .diary-log-delete--confirm {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }
</style>
