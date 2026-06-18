<script lang="ts">
  import type { Essay } from '$lib/db';
  import { estimateReadTimeMinutes } from '$lib/db';
  import GeneratedAvatar from './GeneratedAvatar.svelte';
  import { renderExcerpt } from '$lib/markdown';

  let {
    username,
    userId = '',
    avatarSeed = null,
    avatarUrl = null,
    createdAt = null,
    essayCount = null,
    essays = [],
    onEssayClick,
  }: {
    username: string;
    userId?: string;
    avatarSeed?: string | null;
    avatarUrl?: string | null;
    createdAt?: string | null;
    essayCount?: number | null;
    essays?: Essay[];
    onEssayClick?: (essay: Essay) => void;
  } = $props();

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
        <GeneratedAvatar {userId} seed={avatarSeed} avatarUrl={avatarUrl} size={72} rounded={8} />
      {/key}
    </div>
    <div class="profile-info">
      <h1 class="profile-name">@{username}</h1>
      {#if createdAt}
        <p class="profile-joined">Joined {new Date(createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</p>
      {/if}
      <div class="profile-stat">
        <span class="profile-stat-value">{essayCount ?? '…'}</span>
        <span class="profile-stat-label">{essayCount === 1 ? 'Essay' : 'Essays'}</span>
      </div>
    </div>
  </div>

  {#if essays.length > 0}
    <div class="profile-essays">
      {#each essays as essay (essay.id)}
        <button type="button" class="profile-essay-card" onclick={() => onEssayClick?.(essay)}>
          <h2 class="profile-essay-title">{essay.title || 'Untitled'}</h2>
          <p class="profile-essay-meta">
            {countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}
            {#if essay.published_at}
              · {formatDate(essay.published_at)}
            {/if}
          </p>
          {#if essay.content}
            <div class="profile-essay-excerpt">{@html renderExcerpt(essay.content, 2)}</div>
          {/if}
        </button>
      {/each}
    </div>
  {:else}
    <p class="profile-empty">No public essays yet.</p>
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
    gap: 1.25rem;
    margin-bottom: 2.5rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid var(--rule);
  }

  .profile-avatar-wrap {
    flex-shrink: 0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--rule2);
  }

  .profile-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .profile-name {
    font-family: var(--dm);
    font-size: 1.4rem;
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
    font-size: 0.75rem;
    color: var(--hint);
    margin: 0;
  }

  .profile-stat {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.35rem;
  }

  .profile-stat-value {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    color: var(--ink);
    font-weight: 600;
  }

  .profile-stat-label {
    font-family: var(--ui);
    font-size: 0.7rem;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .profile-essays {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .profile-essay-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem 0.85rem;
    border-radius: 8px;
    background: none;
    border: 0.5px solid transparent;
    cursor: pointer;
    color: inherit;
    text-align: left;
    font: inherit;
    width: 100%;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .profile-essay-card:hover {
    background: var(--surf);
    border-color: var(--rule2);
  }

  .profile-essay-title {
    font-family: var(--dm);
    font-size: 1rem;
    color: var(--ink);
    line-height: 1.3;
    font-weight: 500;
    margin: 0;
  }

  .profile-essay-meta {
    font-family: var(--ui);
    font-size: 0.7rem;
    color: var(--hint);
    margin: 0;
  }

  .profile-essay-excerpt {
    font-family: var(--ss);
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.5;
    margin-top: 0.15rem;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
  }

  .profile-empty {
    font-family: var(--ui);
    font-size: 0.8rem;
    color: var(--hint);
    text-align: center;
    padding: 2.5rem 0;
  }
</style>
