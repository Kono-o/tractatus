<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { initNativeShell } from '$lib/native';

  let { children } = $props();

  onMount(() => {
    void initNativeShell();
  });
</script>

<svelte:head>
  <title>Tractatus</title>
</svelte:head>

{@render children() }