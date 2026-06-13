<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import oxaniumLatin from '@fontsource-variable/oxanium/files/oxanium-latin-wght-normal.woff2?url';
  import spaceMonoLatin from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url';

  let { children } = $props();

  onMount(async () => {
    // Dynamic import: native/Capacitor code must never run during SSR (prevents 500s on Vercel).
    // Only the Capacitor static build (Android/PWA) or client hydration executes this.
    const { initNativeShell } = await import('$lib/native');
    void initNativeShell();
  });
</script>

<svelte:head>
  <title>Tractatus</title>
  <link rel="preload" href={oxaniumLatin} as="font" type="font/woff2" crossorigin="anonymous" />
  <link rel="preload" href={spaceMonoLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

{@render children() }