<script lang="ts">
  let { userId = '', size = 32, className = '', rounded = 8, seed } = $props<{
    userId?: string;
    size?: number;
    className?: string;
    rounded?: number;
    seed?: string | null; // influences identicon; falls back gracefully for SSR / logged-out state
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

  function paletteFromHash(h: number): { cubeColor: string; bgColor: string } {
    const hue = h % 360;
    const saturation = 72 + (h % 17);
    const lightness = 48 + (h % 9);
    const hueOffset = ((h >> 5) & 1) === 0 ? 14 : -14;
    const bgHue = (hue + hueOffset + 360) % 360;
    const bgSaturation = Math.max(18, saturation - 46);
    const bgLightness = Math.min(88, lightness + 30);

    return {
      cubeColor: `hsl(${hue} ${saturation}% ${lightness}%)`,
      bgColor: `hsl(${bgHue} ${bgSaturation}% ${bgLightness}%)`,
    };
  }

  const effectiveId = $derived(seed || userId || 'default');
  const hash = $derived(hashCode(effectiveId));

  const GRID_SIZE = 5;
  const cellSize = 100 / GRID_SIZE;

  const avatarData = $derived.by(() => {
    const h = hash;
    const { cubeColor, bgColor } = paletteFromHash(h);

    const g: boolean[][] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < Math.ceil(GRID_SIZE / 2); x++) {
        const bitPos = (y * 5 + x * 2) % 31;
        const on = ((h >> bitPos) & 1) === 1;
        row.push(on);
      }
      const mirrored = [...row];
      const start = GRID_SIZE % 2 === 0 ? row.length - 1 : row.length - 2;
      for (let x = start; x >= 0; x--) {
        mirrored.push(row[x]);
      }
      g.push(mirrored);
    }

    const cells: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (g[y][x]) cells.push({ x, y });
      }
    }

    return { cubeColor, bgColor, cells };
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
      fill={avatarData.cubeColor}
      rx="2"
    />
  {/each}
</svg>