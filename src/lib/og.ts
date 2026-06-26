import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const FONT_CACHE = new Map<string, ArrayBuffer>();

async function fetchFont(cssUrl: string): Promise<ArrayBuffer> {
  if (FONT_CACHE.has(cssUrl)) return FONT_CACHE.get(cssUrl)!;
  const css = await (await fetch(cssUrl)).text();
  const match = css.match(/src:\s*url\(([^)]+)\)/);
  if (!match) throw new Error('Could not extract font URL from CSS');
  const fontUrl = match[1].replace(/["']/g, '');
  const data = await (await fetch(fontUrl)).arrayBuffer();
  FONT_CACHE.set(cssUrl, data);
  return data;
}

async function loadFonts() {
  const [inter400, inter600, inter700] = await Promise.all([
    fetchFont('https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap'),
    fetchFont('https://fonts.googleapis.com/css2?family=Inter:wght@600&display=swap'),
    fetchFont('https://fonts.googleapis.com/css2?family=Inter:wght@700&display=swap'),
  ]);
  return [
    { name: 'Inter', data: inter400, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: inter600, weight: 600 as const, style: 'normal' as const },
    { name: 'Inter', data: inter700, weight: 700 as const, style: 'normal' as const },
  ];
}

interface VNode {
  type: string;
  props: Record<string, unknown>;
  key: null;
}

function h(type: string, props: Record<string, unknown> | null, ...children: (VNode | string)[]): VNode {
  return {
    type,
    key: null,
    props: {
      ...(props ?? {}),
      children: children.length <= 1 ? (children[0] ?? '') : children,
    },
  };
}

const BG = '#14120f';
const FG = '#e8e0d4';
const ACCENT = '#6d7a6a';
const MUTED = '#8a8174';
const SEP = '#2e2a22';

function brand() {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '32px' } },
    h('div', { style: { width: '36px', height: '36px', borderRadius: '8px', background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      h('svg', { width: '22', height: '22', viewBox: '0 0 24 24', fill: 'none', stroke: '#14120f', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
        h('path', { d: 'M2 8a10.645 10.645 0 0 0 20 0' }),
        h('path', { d: 'm20 15-1.726-2.05' }),
        h('path', { d: 'm4 15 1.726-2.05' }),
      ),
    ),
    h('span', { style: { fontFamily: 'Inter', fontSize: '28px', fontWeight: 700, color: FG, letterSpacing: '0.04em' } }, 'Tractatus'),
  );
}

function rule() {
  return h('div', { style: { width: '56px', height: '2px', borderRadius: '1px', background: SEP, margin: '24px 0' } });
}

function domain() {
  return h('div', { style: { fontFamily: 'Inter', fontSize: '13px', fontWeight: 400, color: MUTED, letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: '28px' } }, 'tractatus.app');
}

function base(...children: (VNode | string)[]) {
  return h('div', {
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: BG,
      padding: '64px 80px',
    },
  }, ...children);
}

async function render(element: VNode): Promise<Response> {
  const fonts = await loadFonts();
  const svg = await satori(element, { width: 1200, height: 630, fonts });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png = resvg.render().asPng();
  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, immutable, no-transform, max-age=31536000',
    },
  });
}

export async function mainOG(): Promise<Response> {
  return render(
    base(
      brand(),
      h('div', { style: { fontFamily: 'Inter', fontSize: '48px', fontWeight: 700, color: FG, textAlign: 'center', lineHeight: 1.2, maxWidth: '640px' } }, 'A minimalist writing platform'),
      h('div', { style: { fontFamily: 'Inter', fontSize: '20px', fontWeight: 400, color: MUTED, textAlign: 'center', marginTop: '12px' } }, 'Write, publish, and share your thoughts.'),
      rule(),
      domain(),
    ),
  );
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  } catch { return ''; }
}

function readingTime(content: string): string {
  const words = content.trim().split(/\s+/).length;
  const min = Math.max(1, Math.ceil(words / 200));
  return `${min} min read`;
}

export async function profileOG(username: string, essayCount: number, logCount: number, createdAt: string | null): Promise<Response> {
  return render(
    base(
      brand(),
      h('div', {
        style: {
          fontFamily: 'Inter',
          fontSize: '52px',
          fontWeight: 700,
          color: FG,
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: '700px',
        }
      }, `@${username}`),
      h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', marginTop: '10px' } },
        h('div', { style: { fontFamily: 'Inter', fontSize: '16px', fontWeight: 400, color: MUTED } },
          `${essayCount} ${essayCount === 1 ? 'essay' : 'essays'}`,
        ),
        createdAt ? h('div', { style: { fontFamily: 'Inter', fontSize: '13px', fontWeight: 400, color: MUTED, opacity: '0.5' } }, `Joined ${formatDate(createdAt)}`) : null,
      ),
      rule(),
      domain(),
    ),
  );
}

export async function essayOG(
  title: string,
  authorUsername: string,
  contentSnippet: string,
  publishedAt: string | null,
  fullContent: string,
): Promise<Response> {
  const truncated = contentSnippet.length > 120
    ? contentSnippet.slice(0, 120).trimEnd() + '…'
    : contentSnippet;

  const min = readingTime(fullContent);

  return render(
    base(
      brand(),
      h('div', { style: { fontFamily: 'Inter', fontSize: '40px', fontWeight: 700, color: FG, textAlign: 'center', lineHeight: 1.25, maxWidth: '720px' } }, title),
      truncated ? h('div', { style: { fontFamily: 'Inter', fontSize: '16px', fontWeight: 400, color: MUTED, textAlign: 'center', marginTop: '10px', maxWidth: '520px', lineHeight: 1.5 } }, truncated) : null,
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginTop: '18px' } },
        h('span', { style: { fontFamily: 'Inter', fontSize: '14px', fontWeight: 600, color: ACCENT } }, `@${authorUsername}`),
        h('span', { style: { fontFamily: 'Inter', fontSize: '12px', fontWeight: 400, color: MUTED, opacity: '0.5' } }, min),
        publishedAt ? h('span', { style: { fontFamily: 'Inter', fontSize: '12px', fontWeight: 400, color: MUTED, opacity: '0.5' } }, formatDate(publishedAt)) : null,
      ),
      rule(),
      domain(),
    ),
  );
}
