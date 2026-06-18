<script lang="ts">
  import { theme, toggleLogoEye } from '$lib/theme.svelte';
  import { Eye, EyeClosed, ArrowLeft } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  let {
    articleMode = false,
    writingMode = false,
    logoDisabled = false,
    onLogoClick = () => {},
    children,
  } = $props<{
    articleMode?: boolean;
    writingMode?: boolean;
    logoDisabled?: boolean;
    onLogoClick?: () => void;
    children?: Snippet;
  }>();

  let hasBack = $derived(articleMode || writingMode);
</script>

<div class="pub-header-wrap">
  <header class="pub-header" class:pub-header--article={articleMode} class:pub-header--search-open={false}>
    <div class="pub-header-start">
      <div class="pub-header-logo">
        {#if hasBack}
          <button
            type="button"
            class="pub-header-logo-back"
            onclick={onLogoClick}
            aria-label="Back"
          >
            <ArrowLeft class="pub-header-logo-back-icon" aria-hidden="true" />
          </button>
        {:else}
          <button
            type="button"
            class="pub-header-logo-eye"
            onclick={toggleLogoEye}
            aria-label={theme.logoEyeOpen ? 'Close eye' : 'Open eye'}
          >
            {#if theme.logoEyeOpen}
              <Eye class="pub-header-logo-icon" aria-hidden="true" />
            {:else}
              <EyeClosed class="pub-header-logo-icon" aria-hidden="true" />
            {/if}
          </button>
        {/if}
        <span
          class="pub-header-logo-text"
          class:pub-header-logo-text--disabled={logoDisabled}
          role="button"
          tabindex={logoDisabled ? -1 : 0}
          onclick={onLogoClick}
          onkeydown={(e) => { if (e.key === 'Enter') onLogoClick(); }}
        >Tractatus</span>
      </div>
    </div>
    <div class="pub-header-actions">
      {@render children?.()}
    </div>
  </header>
</div>
