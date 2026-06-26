<script lang="ts">
  import type { Essay, ReadingLogWithAuthor } from '$lib/db';
  import { estimateReadTimeMinutes } from '$lib/db';
  import GeneratedAvatar from './GeneratedAvatar.svelte';
  import { renderExcerpt } from '$lib/markdown';
  import ReadingLogDiary from './ReadingLogDiary.svelte';

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
      <ReadingLogDiary {logs} />
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
</style>
