<script lang="ts">
  let { userId = '', size = 32, className = '', rounded = 8, seed } = $props<{
    userId?: string;
    size?: number;
    className?: string;
    rounded?: number;
    seed?: string | null;
  }>();

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
    const sat = 28 + (h % 13);
    const light = 72 + (h % 11);

    // Background: lighter version
    const bgLight = Math.min(96, light + 20);
    const bgSat = Math.max(10, sat - 16);

    const cellColor = `oklch(${(light + 3) / 100} ${(sat + 1) / 100} ${hue})`;
    const bgColor = `oklch(${bgLight / 100} ${bgSat / 100} ${hue})`;

    // Build symmetric 5x5 grid
    const g: boolean[][] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      const row: number[] = [];
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

<svg
  width={size}
  height={size}
  viewBox="0 0 100 100"
  class={`generated-avatar overflow-hidden ${className}`}
  style={`border-radius: ${borderRadius};`}
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