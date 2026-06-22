<script lang="ts">
  import { BookMarked, Trash2 } from '@lucide/svelte';

  interface BookItem {
    id: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
  }

  let { items = [], onremove, onselect }: { items?: BookItem[]; onremove?: (id: string) => void; onselect?: (book: BookItem) => void } = $props();
</script>

<div class="reading-list">
  {#if items.length === 0}
    <div class="reading-list-empty">
      <BookMarked class="size-6" aria-hidden="true" />
      <span>Your reading list is empty.</span>
      <span class="reading-list-empty-hint">Search for books above to add them.</span>
    </div>
  {:else}
    {#each items as item (item.id)}
      <div class="reading-list-item">
        {#if item.coverUrl}
          <img src={item.coverUrl} alt="" class="reading-list-cover" loading="lazy" />
        {:else}
          <div class="reading-list-cover reading-list-cover--empty">
            <BookMarked class="size-4" aria-hidden="true" />
          </div>
        {/if}
        <button
          type="button"
          class="reading-list-info"
          onclick={() => onselect?.(item)}
        >
          <div class="reading-list-title">{item.title}</div>
          {#if item.author}
            <div class="reading-list-author">{item.author}</div>
          {/if}
        </button>
        {#if onremove}
          <button
            type="button"
            class="reading-list-remove"
            onclick={() => onremove(item.id)}
            aria-label="Remove from reading list"
          >
            <Trash2 class="size-3.5" aria-hidden="true" />
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .reading-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0.5rem 0;
  }
  .reading-list-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 2rem 0;
    color: var(--hint);
    font-size: 12px;
  }
  .reading-list-empty-hint {
    font-size: 10px;
    color: var(--hint);
    opacity: 0.7;
  }
  .reading-list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 0.5px solid var(--rule);
    background: var(--card);
  }
  .reading-list-cover {
    width: 32px;
    height: 48px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--surf);
  }
  .reading-list-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--hint);
    background: var(--surf);
  }
  .reading-list-info {
    min-width: 0;
    flex: 1;
    cursor: pointer;
    background: transparent;
    border: none;
    padding: 0;
    text-align: left;
  }
  .reading-list-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .reading-list-title:hover {
    color: var(--accent);
  }
  .reading-list-author {
    font-size: 10px;
    color: var(--hint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .reading-list-remove {
    background: transparent;
    border: none;
    color: var(--hint);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
  }
  .reading-list-remove:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }
</style>
