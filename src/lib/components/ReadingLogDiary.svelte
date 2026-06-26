<script lang="ts">
  import type { ReadingLog } from '$lib/db';
  import { Heart, BookMarked, Trash2 } from '@lucide/svelte';

  let {
    logs = [],
    onDelete,
    deleteConfirmId = null,
    onBlurDelete,
  }: {
    logs: ReadingLog[];
    onDelete?: (id: string) => void;
    deleteConfirmId?: string | null;
    onBlurDelete?: () => void;
  } = $props();

  function logDate(log: ReadingLog): string {
    const d = new Date(log.end_date || log.created_at);
    return d.toLocaleDateString(undefined, { day: 'numeric' });
  }

  function halfStars(r: number): number {
    return Math.round(r * 2);
  }

  let groupedLogs = $derived.by(() => {
    const groups: { label: string; logs: ReadingLog[] }[] = [];
    let currentLabel = '';
    let currentGroup: ReadingLog[] = [];
    for (const log of logs) {
      const d = new Date(log.end_date || log.created_at);
      const label = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
      if (label !== currentLabel) {
        if (currentGroup.length) groups.push({ label: currentLabel, logs: currentGroup });
        currentLabel = label;
        currentGroup = [];
      }
      currentGroup.push(log);
    }
    if (currentGroup.length) groups.push({ label: currentLabel, logs: currentGroup });
    return groups;
  });
</script>

{#if logs.length > 0}
  <div class="rld">
    {#each groupedLogs as group (group.label)}
      <div class="rld-month">
        <div class="rld-label">{group.label}</div>
        <div class="rld-entries">
          {#each group.logs as log (log.id)}
            <div class="rld-entry">
              <span class="rld-day">{logDate(log)}</span>
              {#if log.cover_url}
                <img src={log.cover_url} alt="" class="rld-cover" loading="lazy" />
              {:else}
                <div class="rld-cover rld-cover--empty">
                  <BookMarked class="size-4" aria-hidden="true" />
                </div>
              {/if}
              <div class="rld-info">
                <div class="rld-title">{log.title}</div>
                <div class="rld-author">{log.author || 'Unknown'}</div>
                <div class="rld-reactions">
                  {#if log.rating}
                    <span class="rld-stars">
                      {#each [1,2,3,4,5] as val}
                        {@const half = halfStars(log.rating)}
                        <svg class="rld-star" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          {#if val * 2 <= half}
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#f59e0b" />
                          {:else if val * 2 - 1 === half}
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" clip-path="inset(0 50% 0 0)" fill="#f59e0b" />
                          {:else}
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" />
                          {/if}
                        </svg>
                      {/each}
                    </span>
                  {/if}
                  {#if log.liked !== null}
                    <span class:rld-liked--yes={log.liked === true} class:rld-liked--no={log.liked === false}>
                      <Heart class="size-3" fill={log.liked === true ? '#ef4444' : 'none'} aria-hidden="true" />
                    </span>
                  {/if}
                  {#if log.reread}
                    <span><svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></span>
                  {/if}
                </div>
                {#if log.review}
                  <div class="rld-review">{log.review}</div>
                {/if}
              </div>
              {#if onDelete}
                <button
                  type="button"
                  class="rld-delete"
                  class:rld-delete--confirm={deleteConfirmId === log.id}
                  aria-label={deleteConfirmId === log.id ? 'Confirm delete' : 'Delete log'}
                  onclick={() => onDelete(log.id)}
                  onblur={onBlurDelete}
                >
                  {#if deleteConfirmId === log.id}
                    Sure?
                  {:else}
                    <Trash2 class="size-3" aria-hidden="true" />
                  {/if}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .rld { padding: 0.625rem 0; }
  .rld-month { margin-bottom: 1.25rem; }
  .rld-label { font-family: var(--ui); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--hint); margin-bottom: 0.5rem; padding: 0 0.2rem; }
  .rld-entries { display: flex; flex-direction: column; }
  .rld-entry { display: flex; align-items: stretch; gap: 0.6rem; padding: 0.5rem 0.5rem; border-bottom: 0.5px solid var(--border); transition: background 0.15s ease; }
  .rld-entry:last-child { border-bottom: none; }
  .rld-entry:hover { background: var(--surf); }
  .rld-day { display: inline-block; font-family: var(--font-mono); font-size: 0.78rem; color: var(--hint); min-width: 1.8rem; text-align: center; flex-shrink: 0; padding-top: 0.1rem; }
  .rld-cover { width: 28px; height: 42px; object-fit: cover; border-radius: 3px; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .rld-cover--empty { display: flex; align-items: center; justify-content: center; background: var(--surf); border: 0.5px solid var(--border); color: var(--hint); box-shadow: none; }
  .rld-info { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .rld-title { font-family: var(--ui); font-size: 0.8rem; font-weight: 600; color: var(--ink); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rld-author { font-family: var(--ui); font-size: 0.68rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rld-reactions { display: flex; align-items: center; gap: 3px; margin-top: 1px; }
  .rld-stars { display: inline-flex; gap: 1px; }
  .rld-star { display: block; }
  .rld-liked--yes { color: #ef4444; }
  .rld-liked--no { color: var(--hint); opacity: 0.5; }
  .rld-review { font-family: var(--ss); font-size: 0.72rem; line-height: 1.45; color: var(--text-muted); margin-top: 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-clamp: 2; }
  .rld-delete { display: flex; align-items: center; justify-content: center; width: 28px; border: none; background: transparent; color: var(--hint); cursor: pointer; flex-shrink: 0; font-family: var(--ui); font-size: 8px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; transition: color 120ms ease, background-color 120ms ease; border-radius: 6px; margin: 0.375rem 0; align-self: stretch; }
  .rld-delete:hover { color: var(--muted); background: var(--surf); }
  .rld-delete:focus-visible { outline: 1.5px solid var(--ink); outline-offset: -1.5px; }
  .rld-delete--confirm { color: #dc2626; background: #fef2f2; }
  :global(.dark) .rld-delete--confirm { color: #fca5a5; background: #2a1a1a; }
</style>
