<script lang="ts">
  import type { ReadingLog } from '$lib/db';
  import { Heart, BookMarked, Trash2 } from '@lucide/svelte';

  let {
    logs = [],
    oncardclick,
    onDelete,
  }: {
    logs: ReadingLog[];
    oncardclick?: (log: ReadingLog) => void;
    onDelete?: (logId: string) => void;
  } = $props();

  let viewedLog: ReadingLog | null = $state(null);

  function closeReview() {
    viewedLog = null;
  }

  function logDate(log: ReadingLog): string {
    const d = new Date(log.end_date || log.created_at);
    return d.toLocaleDateString(undefined, { day: 'numeric' });
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
            <div class="rld-entry" role="button" tabindex="0" onclick={() => { oncardclick?.(log); viewedLog = log; }} onkeydown={(e) => { if (e.key === 'Enter') { oncardclick?.(log); viewedLog = log; } }}>
              <span class="rld-day">{logDate(log)}</span>
              <div class="rld-cover-wrap">
                <div class="rld-cover rld-cover--empty" aria-hidden="true"><BookMarked class="size-4" /></div>
                {#if log.cover_url}
                  <img src={log.cover_url} alt="" class="rld-cover rld-cover--img" loading="lazy" onerror={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                {/if}
              </div>
              <div class="rld-info">
                <div class="rld-title">{log.title}</div>
                <div class="rld-reactions">
                  {#if log.rating}
                    <span class="rld-stars">
                      {#each [1,2,3,4,5] as val}
                        {@const half = halfStars(log.rating)}
                        <svg class="rld-star" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--hint)">
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
                    <span class="rld-liked" class:rld-liked--yes={log.liked === true} class:rld-liked--no={log.liked === false}>
                      <Heart class="size-3" fill={log.liked === true ? '#ef4444' : 'none'} aria-hidden="true" />
                    </span>
                  {/if}
                  {#if log.reread}
                    <span class="rld-reread"><svg style="width:9px;height:9px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></span>
                  {/if}
                  {#if log.review}
                    <span class="rld-text-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="3" y1="20" x2="15" y2="20"/></svg></span>
                  {/if}
        </div>
      </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

{#if viewedLog}
  <div class="rld-overlay" role="dialog" aria-modal="true" aria-label="Review detail">
    <div class="rld-overlay-bg" onclick={closeReview}></div>
    <div class="rld-overlay-content">
      <button type="button" class="rld-close" onclick={closeReview} aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      <div class="rvw">
        <div class="rvw-head">
          <span class="rvw-head-date">{formatLogDate(viewedLog.created_at)}</span>
        </div>
        <div class="rvw-book">
          <div class="rvw-cover-wrap">
            <div class="rvw-cover rvw-cover--empty" aria-hidden="true"><BookMarked class="size-6" /></div>
            {#if viewedLog.cover_url}
              <img src={viewedLog.cover_url} alt="" class="rvw-cover rvw-cover--img" loading="lazy" onerror={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
            {/if}
          </div>
          <div class="rvw-book-info">
            <div class="rvw-book-title">{viewedLog.title || 'Untitled'}</div>
            <div class="rvw-book-author">{viewedLog.author || 'Unknown'}</div>
          </div>
        </div>
        <div class="rvw-body">
          {#if viewedLog.rating || viewedLog.liked !== null || viewedLog.reread}
            <div class="rvw-reactions">
              {#if viewedLog.rating}
                <span class="rvw-stars">
                  {#each [1,2,3,4,5] as val}
                    {@const half = halfStars(viewedLog.rating)}
                    <svg class="rvw-star" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--hint)">
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
              {#if viewedLog.liked !== null}
                <span class="rvw-liked" class:rvw-liked--yes={viewedLog.liked === true} class:rvw-liked--no={viewedLog.liked === false}>
                  <Heart class="size-4" fill={viewedLog.liked === true ? '#ef4444' : 'none'} aria-hidden="true" />
                </span>
              {/if}
              {#if viewedLog.reread}
                <span class="rvw-reread"><svg style="width:13px;height:13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></span>
              {/if}
              {#if onDelete}
                <button type="button" class="rvw-delete-btn" onclick={() => { const id = viewedLog!.id; closeReview(); onDelete(id); }} aria-label="Delete log"><Trash2 class="size-4" aria-hidden="true" /></button>
              {/if}
            </div>
          {/if}
          {#if viewedLog.review}
            <div class="rvw-text">{viewedLog.review}</div>
          {:else}
            <div class="rvw-text rvw-text--empty">No written review.</div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .rld { padding: 0 0 0.625rem; }
  .rld-month { margin: 0; }
  .rld-label { font-family: var(--ui); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--hint); padding: 0.3rem 0.4rem; background: var(--surf); border-radius: 5px; margin: 0; }
  .rld-entries { display: flex; flex-direction: column; }
  .rld-entry { display: flex; align-items: center; gap: 0.6rem; padding: 0.75rem 0.5rem; border-bottom: 0.5px solid var(--border); transition: background 0.15s ease; cursor: pointer; }
  .rld-entry:last-child { border-bottom: 0.5px solid var(--border); }
  .rld-entry:hover { background: var(--surf); }
  .rld-day { display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; color: var(--hint); width: 2rem; height: 2rem; flex-shrink: 0; background: var(--surf); border-radius: 6px; }
  .rld-cover-wrap { position: relative; flex-shrink: 0; align-self: stretch; width: 36px; }
  .rld-cover { width: 36px; object-fit: cover; border-radius: 3px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .rld-cover--img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .rld-cover--empty { display: flex; align-items: center; justify-content: center; height: 100%; min-height: 3rem; background: var(--surf); border: 0.5px solid var(--border); color: var(--hint); box-shadow: none; border-radius: 3px; }
  .rld-info { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; justify-content: center; }
  .rld-title { font-family: var(--dm); font-size: 0.9rem; font-weight: 700; color: var(--ink); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0.02em; }
  .rld-reactions { display: flex; align-items: center; gap: 3px; margin-top: 1px; }
  .rld-stars { display: inline-flex; gap: 1px; }
  .rld-star { display: block; }
  .rld-liked { display: inline-flex; align-items: center; }
  .rld-liked--yes { color: #ef4444; }
  .rld-liked--no { color: var(--hint); opacity: 0.5; }
  .rld-text-icon { display: inline-flex; align-items: center; color: var(--hint); }
  .rld-reread { display: inline-flex; align-items: center; justify-content: center; color: var(--hint); }

  /* ───── Review Popup Overlay ───── */
  .rld-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .rld-overlay-bg { position: absolute; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(2px); }
  .rld-overlay-content { position: relative; background: var(--bg); border-radius: 12px; max-width: 460px; width: 100%; height: auto; max-height: 520px; padding: 1.25rem 1.5rem 1.5rem; box-shadow: 0 8px 32px rgba(0,0,0,0.35); animation: pop 0.2s cubic-bezier(0.34,1.56,0.64,1); display: flex; flex-direction: column; }
  .rld-close { position: absolute; top: 0.75rem; right: 0.75rem; z-index: 2; background: transparent; border: none; cursor: pointer; color: var(--hint); padding: 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: background 0.15s, color 0.15s; background: color-mix(in srgb, var(--surf) 60%, transparent); }
  .rld-close:hover { background: var(--surf); color: var(--text); }
  .rvw { display: flex; flex-direction: column; gap: 0.875rem; overflow-y: auto; flex: 1; min-height: 0; }
  .rvw-head { display: flex; align-items: center; gap: 5px; font-family: var(--ui); font-size: 0.72rem; color: var(--hint); flex-shrink: 0; }
  .rvw-head-date { color: var(--hint); }
  .rvw-delete-btn { margin-left: auto; background: none; border: none; cursor: pointer; color: #ef4444; display: flex; align-items: center; justify-content: center; padding: 0; border-radius: 0; transition: opacity 0.15s; }
  .rvw-delete-btn:hover { opacity: 0.7; }
  .rvw-book { display: flex; gap: 0.75rem; padding: 0.75rem; background: var(--surf); border-radius: 10px; align-items: center; flex-shrink: 0; }
  .rvw-cover-wrap { position: relative; flex-shrink: 0; width: 56px; }
  .rvw-cover { width: 56px; height: 84px; object-fit: cover; border-radius: 5px; box-shadow: 0 1px 4px rgba(0,0,0,0.12); }
  .rvw-cover--img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .rvw-cover--empty { display: flex; align-items: center; justify-content: center; width: 56px; height: 84px; background: var(--surf); color: var(--hint); box-shadow: none; border-radius: 5px; }
  .rvw-book-info { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .rvw-book-title { font-family: var(--dm); font-weight: 700; font-size: 0.9rem; color: var(--ink); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0.02em; }
  .rvw-book-author { font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rvw-body { display: flex; flex-direction: column; gap: 0.625rem; }
  .rvw-reactions { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
  .rvw-stars { display: flex; gap: 2px; }
  .rvw-star { display: block; }
  .rvw-liked { display: inline-flex; align-items: center; margin-left: 4px; }
  .rvw-liked--yes { color: #ef4444; }
  .rvw-liked--no { color: var(--hint); opacity: 0.5; }
  .rvw-reread { display: inline-flex; align-items: center; justify-content: center; margin-left: 4px; color: var(--hint); }
  .rvw-text { font-size: 0.82rem; line-height: 1.7; color: var(--text); white-space: pre-wrap; word-break: break-word; }
  .rvw-text--empty { color: var(--hint); font-style: italic; font-size: 0.78rem; }
  @keyframes pop { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
</style>
