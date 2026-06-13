<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/db';
  import type { User } from '@supabase/supabase-js';

  let user = $state<User | null>(null);

  onMount(async () => {
    user = await db.getCurrentUser();
    if (!user) {
      // Redirect to home for auth
      window.location.href = '/';
    }
  });
</script>

<div class="max-w-2xl mx-auto p-8">
  <h1 class="text-3xl font-semibold mb-2">New post</h1>
  <p class="text-zinc-400 mb-8">This is a stub. Full editor coming next.</p>

  <div class="border border-[#222] bg-[#111] rounded-2xl p-6">
    <input 
      type="text" 
      placeholder="Title" 
      class="w-full bg-transparent text-2xl font-medium border-b border-[#222] pb-2 mb-4 focus:outline-none"
    />
    
    <textarea 
      placeholder="Write something beautiful..." 
      class="w-full h-96 bg-transparent resize-y font-serif text-lg leading-relaxed focus:outline-none"
    ></textarea>
  </div>

  <div class="mt-6 flex gap-3">
    <button class="px-6 py-2 bg-white text-black rounded-xl text-sm font-medium">Publish</button>
    <button class="px-6 py-2 border border-[#333] rounded-xl text-sm">Save draft</button>
  </div>
</div>