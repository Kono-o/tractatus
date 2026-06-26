<script lang="ts">
  import type { Essay, ReadingLogWithAuthor } from '$lib/db';
  import { estimateReadTimeMinutes } from '$lib/db';
  import GeneratedAvatar from './GeneratedAvatar.svelte';
  import { renderExcerpt } from '$lib/markdown';
  import {Heart} from '@lucide/svelte';

  let {
    username,
    userId = '',
    avatarSeed = null,
    avatarUrl = null,
    createdAt = null,
    essayCount = null,
    logCount = null,
    essays = [],
    logs = [],
    onEssayClick,
  }: {
    username: string;
    userId?: string;
    avatarSeed?: string | null;
    avatarUrl?: string | null;
    createdAt?: string | null;
    essayCount?: number | null;
    logCount?: number | null;
    essays?: Essay[];
    logs?: ReadingLogWithAuthor[];
    onEssayClick?: (essay: Essay) => void;
  } = $props();

  let profileTab = $state<'essays' | 'diary'>('essays');

  function countWords(s: string): number {
    return (s || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function fmtReadTime(n: number): string {
    return n === 1 ? '~1 min' : `~${n} mins`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function halfStars(r: number): number {
    return Math.round(r * 2);
  }

  let groupedLogs = $derived.by(() => {
    const groups: { label: string; logs: ReadingLogWithAuthor[] }[] = [];
    let currentLabel = '';
    let currentGroup: ReadingLogWithAuthor[] = [];
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

  function logDate(log: ReadingLogWithAuthor): string {
    const d = new Date(log.end_date || log.created_at);
    return d.toLocaleDateString(undefined, { day: 'numeric' });
  }
</script>

<div class="profile-view">
  <div class="profile-card">
    <div class="profile-avatar-wrap">
      {#key avatarSeed + '' + avatarUrl}
        <GeneratedAvatar {userId} seed={avatarSeed} avatarUrl={avatarUrl} size={64} rounded={8} />
      {/key}
    </div>
    <div class="profile-info">
      <h1 class="profile-name">@{username}</h1>
      {#if createdAt}
        <p class="profile-joined">Joined {new Date(createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</p>
      {/if}
      <div class="profile-stats">
        <span class="profile-stat">
          <span class="profile-stat-value">{essayCount ?? '…'}</span>
          <span class="profile-stat-label">{essayCount === 1 ? 'Essay' : 'Essays'}</span>
        </span>
        <span class="profile-stat-sep" aria-hidden="true">·</span>
        <span class="profile-stat">
          <span class="profile-stat-value">{logCount ?? '…'}</span>
          <span class="profile-stat-label">{logCount === 1 ? 'Log' : 'Logs'}</span>
        </span>
      </div>
    </div>
  </div>

  <div class="profile-tabs" role="group" aria-label="Profile section">
    <button
      type="button"
      class="profile-tab-btn"
      class:profile-tab-btn--active={profileTab === 'essays'}
      onclick={() => profileTab = 'essays'}
    >Essays</button>
    <button
      type="button"
      class="profile-tab-btn"
      class:profile-tab-btn--active={profileTab === 'diary'}
      onclick={() => profileTab = 'diary'}
    >Diary</button>
  </div>

  {#if profileTab === 'essays'}
    {#if essays.length > 0}
      <div class="profile-list">
        {#each essays as essay (essay.id)}
          <button type="button" class="profile-card-item" onclick={() => onEssayClick?.(essay)}>
            <div class="profile-card-item-body">
              <h2 class="profile-card-item-title">{essay.title || 'Untitled'}</h2>
              <p class="profile-card-item-meta">
                {countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}
                {#if essay.published_at}
                  · {formatDate(essay.published_at)}
                {/if}
              </p>
              {#if essay.content}
                <div class="profile-card-item-excerpt">{@html renderExcerpt(essay.content, 2)}</div>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {:else}
      <p class="profile-empty">No public essays yet.</p>
    {/if}
  {:else}
    {#if logs.length > 0}
      <div class="profile-diary">
        {#each groupedLogs as group (group.label)}
          <div class="profile-diary-month">
            <div class="profile-diary-label">{group.label}</div>
            <div class="profile-diary-entries">
              {#each group.logs as log (log.id)}
                <div class="profile-diary-entry">
                  <span class="profile-diary-day">{logDate(log)}</span>
                  {#if log.cover_url}
                    <img src={log.cover_url} alt="" class="profile-diary-cover" loading="lazy" />
                  {:else}
                    <div class="profile-diary-cover profile-diary-cover--empty">
                      <svg width="16" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 19.5"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/></svg>
                    </div>
                  {/if}
                  <div class="profile-diary-info">
                    <div class="profile-diary-title">{log.title}</div>
                    <div class="profile-diary-author">{log.author}</div>
                    <div class="profile-diary-reactions">
                      {#if log.rating}
                        <span class="pf-card-stars">
                          {#each [1,2,3,4,5] as val}
                            {@const half = halfStars(log.rating!)}
                            <svg class="pf-card-star" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
                        <span class:pf-card-liked--yes={log.liked === true} class:pf-card-liked--no={log.liked === false}>
                          <Heart class="size-3" fill={log.liked === true ? '#ef4444' : 'none'} aria-hidden="true" />
                        </span>
                      {/if}
                      {#if log.reread}
                        <span><svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></span>
                      {/if}
                    </div>
                    {#if log.review}
                      <div class="profile-diary-review">{log.review}</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="profile-empty">No reading logs yet.</p>
    {/if}
  {/if}
</div>

<style>
  .profile-view {
    max-width: 600px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    width: 100%;
  }

  .profile-card {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .profile-avatar-wrap {
    flex-shrink: 0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--border);
  }

  .profile-info {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .profile-name {
    font-family: var(--dm);
    font-size: 1.35rem;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-joined {
    font-family: var(--ui);
    font-size: 0.7rem;
    color: var(--hint);
    margin: 0;
  }

  .profile-stats {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }

  .profile-stat {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .profile-stat-value {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--ink);
    font-weight: 600;
  }

  .profile-stat-label {
    font-family: var(--ui);
    font-size: 0.65rem;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .profile-stat-sep {
    color: var(--border);
    font-size: 0.85rem;
  }

  .profile-tabs {
    display: flex;
    gap: 0;
    padding: 0 0 0.375rem;
  }

  .profile-tab-btn {
    flex: 1;
    height: 28px;
    border: none;
    background: transparent;
    font-family: var(--ui);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--hint);
    cursor: pointer;
    transition: color 150ms ease;
    border-bottom: 1.5px solid var(--border);
    margin-bottom: -1px;
  }

  .profile-tab-btn:hover {
    color: var(--text-muted);
  }

  .profile-tab-btn--active {
    color: var(--ink);
    border-bottom-color: var(--ink);
    font-weight: 700;
  }

  .profile-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding-top: 0.75rem;
  }

  .profile-card-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.7rem 0.8rem;
    border-radius: 8px;
    background: none;
    border: none;
    border-bottom: 0.5px solid var(--border);
    cursor: pointer;
    color: inherit;
    text-align: left;
    font: inherit;
    width: 100%;
    transition: background 0.15s ease;
  }

  .profile-card-item:last-child {
    border-bottom: none;
  }

  .profile-card-item:hover {
    background: var(--surf);
  }

  .profile-card-item-title {
    font-family: var(--dm);
    font-size: 0.95rem;
    color: var(--ink);
    line-height: 1.3;
    font-weight: 500;
    margin: 0;
  }

  .profile-card-item-meta {
    font-family: var(--ui);
    font-size: 0.65rem;
    color: var(--hint);
    margin: 0;
  }

  .profile-card-item-excerpt {
    font-family: var(--ss);
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin-top: 0.1rem;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
  }

  .profile-empty {
    font-family: var(--ui);
    font-size: 0.78rem;
    color: var(--hint);
    text-align: center;
    padding: 2.5rem 0;
  }

  /* Diary */
  .profile-diary {
    padding-top: 0.75rem;
  }

  .profile-diary-month {
    margin-bottom: 1.25rem;
  }

  .profile-diary-label {
    font-family: var(--ui);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--hint);
    margin-bottom: 0.5rem;
    padding: 0 0.2rem;
  }

  .profile-diary-entries {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .profile-diary-entry {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.5rem 0.5rem;
    border-bottom: 0.5px solid var(--border);
    transition: background 0.15s ease;
  }

  .profile-diary-entry:last-child {
    border-bottom: none;
  }

  .profile-diary-entry:hover {
    background: var(--surf);
  }

  .profile-diary-day {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--hint);
    min-width: 1.8rem;
    text-align: right;
    flex-shrink: 0;
    padding-top: 0.1rem;
  }

  .profile-diary-cover {
    width: 28px;
    height: 42px;
    object-fit: cover;
    border-radius: 3px;
    flex-shrink: 0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  }

  .profile-diary-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surf);
    border: 0.5px solid var(--border);
    color: var(--hint);
    box-shadow: none;
  }

  .profile-diary-info {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .profile-diary-title {
    font-family: var(--ui);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-diary-author {
    font-family: var(--ui);
    font-size: 0.68rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-diary-reactions {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-top: 1px;
  }

  .pf-card-stars {
    display: inline-flex;
    gap: 1px;
  }

  .pf-card-star {
    display: block;
  }

  .pf-card-liked--yes { color: #ef4444; }
  .pf-card-liked--no { color: var(--hint); opacity: 0.5; }

  .profile-diary-review {
    font-family: var(--ss);
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--text-muted);
    margin-top: 2px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
  }
</style>
