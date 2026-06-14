<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { db, type Essay } from '$lib/db';
  import { renderEssay, handleCodeCopyClick } from '$lib/markdown';

  let slug = $derived($page.params.slug);

  let essay = $state<Essay | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  function onCodeCopyClick(e: MouseEvent) {
    handleCodeCopyClick(e);
  }

  async function load() {
    loading = true;
    error = null;
    essay = null;
    try {
      if (!slug) throw new Error('Missing slug');
      const found = await db.getPublicEssayBySlug(slug);
      if (!found) {
        error = 'This essay is not public or does not exist.';
      } else {
        essay = found;
      }
    } catch (e: any) {
      console.error(e);
      error = 'Failed to load essay.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  // React to slug change (SPA nav)
  $effect(() => {
    if (slug) void load();
  });
</script>

<div class="max-w-prose mx-auto p-8 pb-16">
  {#if loading}
    <div class="text-zinc-500 text-sm">Loading…</div>
  {:else if error}
    <div>
      <h1 class="text-3xl font-semibold mb-3 tracking-tight">Not found</h1>
      <p class="text-zinc-400">{error}</p>
      <a href="/" class="inline-block mt-6 text-sm underline">← Back to app</a>
    </div>
  {:else if essay}
    <h1 class="text-4xl font-semibold tracking-[-0.02em] mb-3">{essay.title}</h1>
    <div class="text-zinc-500 text-xs mb-8 tracking-wide">
      {new Date(essay.published_at || essay.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      {#if !essay.is_public}
        <span class="ml-2 text-amber-400/80">• DRAFT</span>
      {/if}
    </div>

    <article class="reader-prose markdown-content" onclick={onCodeCopyClick} onkeydown={onCodeCopyClick} role="presentation">
      {@html renderEssay(essay.content)}
    </article>

    <div class="mt-12 text-center">
      <a href="/" class="text-xs text-zinc-500 hover:text-zinc-400">← tractatus</a>
    </div>
  {/if}
</div>
