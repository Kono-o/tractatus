<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/db';
  import type { User } from '@supabase/supabase-js';

  let user = $state<User | null>(null);

  onMount(async () => {
    user = await db.getCurrentUser();
    // The real editor lives on the home screen (big WRITE button like Lift Tracker).
    // Redirect to root for the full live experience.
    window.location.href = '/';
  });
</script>

<div class="max-w-prose mx-auto p-8 text-center text-zinc-400">
  <p>Opening the editor…</p>
</div>