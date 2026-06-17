<script lang="ts">
  let { userId = '', size = 32, className = '', rounded = 8, seed, avatarUrl } = $props<{
    userId?: string;
    size?: number;
    className?: string;
    rounded?: number;
    seed?: string | null;
    avatarUrl?: string | null;
  }>();

  let imgError = $state(false);

  const borderRadius = $derived(`${(rounded / 100) * size}px`);

  function hashCode(str: string): number {
    if (typeof str !== 'string' || str.length === 0) return 0;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  const effectiveId = $derived(seed || userId || 'default');
  const hash = $derived(hashCode(effectiveId));

  const GRID_SIZE = 5;
  const cellSize = 100 / GRID_SIZE;

  const avatarData = $derived.by(() => {
    const h = hash;

    const hue = h % 360;
    const cellSat = 22 + (h % 20);
    const cellLight = 70 + (h % 14);

    // Background: same hue, nearly desaturated, slightly lighter
    const bgSat = 0 + (h % 10);
    const bgLight = Math.min(97, cellLight + 16);

    const cellColor = `oklch(${cellLight / 100} ${cellSat / 100} ${hue})`;
    const bgColor = `oklch(${bgLight / 100} ${bgSat / 100} ${hue})`;

    // Build symmetric 5x5 grid
    const g: boolean[][] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < Math.ceil(GRID_SIZE / 2); x++) {
        const bitPos = (y * 5 + x * 2) % 31;
        const on = ((h >> bitPos) & 1) === 1;
        if (!on) {
          row.push(false);
        } else {
          row.push(true);
        }
      }
      const mirrored = [...row];
      const start = GRID_SIZE % 2 === 0 ? row.length - 1 : row.length - 2;
      for (let x = start; x >= 0; x--) {
        mirrored.push(row[x]);
      }
      g.push(mirrored);
    }

    // Flatten cells
    const cells: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (g[y][x]) cells.push({ x, y });
      }
    }

    return { cellColor, bgColor, cells };
  });
</script>

{#if avatarUrl && !imgError}
  <img
    src={avatarUrl}
    width={size}
    height={size}
    class={`generated-avatar overflow-hidden ${className}`}
    style={`border-radius: ${borderRadius}; object-fit: cover; box-shadow: 0 0 0 1px var(--rule2);`}
    alt=""
    loading="lazy"
    onerror={() => { imgError = true; }}
  />
{:else}
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    class={`generated-avatar overflow-hidden ${className}`}
    style={`border-radius: ${borderRadius}; box-shadow: 0 0 0 1px var(--rule2);`}
    aria-hidden="true"
  >
    <rect x="0" y="0" width="100" height="100" fill={avatarData.bgColor} rx={rounded} />

    {#each avatarData.cells as cell (cell.x + '-' + cell.y)}
      <rect
        x={cell.x * cellSize + 2}
        y={cell.y * cellSize + 2}
        width={cellSize - 4}
        height={cellSize - 4}
        fill={avatarData.cellColor}
        rx="2"
      />
    {/each}
  </svg>
{/if}