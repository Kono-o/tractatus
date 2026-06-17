<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import oxaniumLatin from '@fontsource-variable/oxanium/files/oxanium-latin-wght-normal.woff2?url';
  import spaceMonoLatin from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url';

  let { children } = $props();

  onMount(async () => {
    const { initNativeShell } = await import('$lib/native');
    void initNativeShell();
  });
</script>

<svelte:head>
  <title>Tractatus</title>
  <link rel="preload" href={oxaniumLatin} as="font" type="font/woff2" crossorigin="anonymous" />
  <link rel="preload" href={spaceMonoLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

<div data-sveltekit-preload-code="hover">
  {@render children() }
</div>