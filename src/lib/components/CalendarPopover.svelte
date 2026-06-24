<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';

  let {
    value = $bindable(''),
    label = 'Date',
  }: {
    value: string;
    label?: string;
  } = $props();

  let open = $state(false);
  let viewYear = $state(new Date().getFullYear());
  let viewMonth = $state(new Date().getMonth());
  let popoverStyle = $state('');

  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let triggerEl: HTMLButtonElement | undefined = $state();

  function prevMonth() { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } }
  function nextMonth() { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } }

  function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
  function firstDow(y: number, m: number) { return new Date(y, m, 1).getDay(); }

  function isToday(y: number, m: number, d: number) {
    const t = new Date();
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  }

  function isSelected(y: number, m: number, d: number) {
    if (!value) return false;
    const parts = value.split('-');
    return parseInt(parts[0]) === y && parseInt(parts[1]) === m + 1 && parseInt(parts[2]) === d;
  }

  function pick(y: number, m: number, d: number) {
    value = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    open = false;
  }

  function formatDisplay(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toggle() {
    if (open) { open = false; return; }
    if (triggerEl) {
      const r = triggerEl.getBoundingClientRect();
      const gap = 6;
      popoverStyle = `top:${r.bottom + gap}px;left:${r.left}px;min-width:${Math.max(r.width, 220)}px`;
    }
    open = true;
  }

  $effect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open = false; }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function clearDate() {
    value = '';
    open = false;
  }
</script>

<div class="cal-wrap">
  <button
    ref={triggerEl}
    type="button"
    class="cal-trigger"
    class:cal-open={open}
    onclick={toggle}
  >
    <span class="cal-label">{label}</span>
    <span class="cal-value">{formatDisplay(value) || 'Pick date'}</span>
  </button>

  {#if open}
    <div class="cal-backdrop" onclick={() => open = false}></div>
    <div class="cal-popover" style={popoverStyle}>
      <div class="cal-header">
        <button type="button" class="cal-nav" onclick={prevMonth} aria-label="Previous month">
          <ChevronLeft class="size-4" />
        </button>
        <span class="cal-month-label">{monthNames[viewMonth]} {viewYear}</span>
        <button type="button" class="cal-nav" onclick={nextMonth} aria-label="Next month">
          <ChevronRight class="size-4" />
        </button>
      </div>
      <div class="cal-grid" role="grid">
        {#each weekdays as wd}
          <div class="cal-wd">{wd}</div>
        {/each}
        {#each Array(firstDow(viewYear, viewMonth)) as _}
          <div></div>
        {/each}
        {#each Array(daysInMonth(viewYear, viewMonth)) as _, i}
          {@const day = i + 1}
          <button
            type="button"
            class="cal-day"
            class:cal-day--today={isToday(viewYear, viewMonth, day)}
            class:cal-day--sel={isSelected(viewYear, viewMonth, day)}
            onclick={() => pick(viewYear, viewMonth, day)}
          >
            {day}
          </button>
        {/each}
      </div>
      {#if value}
        <button type="button" class="cal-clear" onclick={clearDate}>Clear</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cal-wrap { flex: 1; min-width: 0; }
  .cal-trigger { width: 100%; background: transparent; border: 0.5px solid var(--border); border-radius: 8px; padding: 6px 9px; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; cursor: pointer; text-align: left; transition: border-color 0.12s; font-family: inherit; box-sizing: border-box; }
  .cal-trigger:hover, .cal-open { border-color: var(--text-muted); }
  .cal-label { font-size: 10px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.04em; line-height: 1; }
  .cal-value { font-size: 0.7rem; color: var(--ink); font-family: var(--font-mono); line-height: 1.3; }
  .cal-backdrop { position: fixed; inset: 0; z-index: 49; }
  .cal-popover { position: fixed; z-index: 50; background: var(--card); border: 0.5px solid var(--border); border-radius: 10px; padding: 10px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
  .cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .cal-nav { background: transparent; border: none; cursor: pointer; padding: 4px; border-radius: 6px; color: var(--text-muted); display: flex; transition: background 0.1s; }
  .cal-nav:hover { background: var(--border); }
  .cal-month-label { font-size: 0.8rem; font-weight: 600; color: var(--text); }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
  .cal-wd { text-align: center; font-size: 10px; color: var(--hint); font-weight: 600; padding: 3px 0; }
  .cal-day { background: transparent; border: none; cursor: pointer; aspect-ratio: 1; border-radius: 6px; font-size: 0.8rem; color: var(--ink); text-align: center; transition: background 0.1s; font-family: inherit; font-weight: 450; display: flex; align-items: center; justify-content: center; }
  .cal-day:hover { background: var(--border); }
  .cal-day--today { font-weight: 700; color: var(--text); }
  .cal-day--sel { background: var(--text); color: var(--bg); font-weight: 600; }
  .cal-day--sel:hover { background: var(--text); }
  .cal-clear { background: transparent; border: none; cursor: pointer; font-size: 11px; color: var(--hint); padding: 8px 0 0; width: 100%; text-align: center; font-family: inherit; transition: color 0.1s; display: block; }
  .cal-clear:hover { color: #ef4444; }
</style>
