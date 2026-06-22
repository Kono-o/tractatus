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
  const [inter400, inter700] = await Promise.all([
    fetchFont('https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap'),
    fetchFont('https://fonts.googleapis.com/css2?family=Inter:wght@700&display=swap'),
  ]);
  return [
    { name: 'Inter', data: inter400, weight: 400 as const, style: 'normal' as const },
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

const BG = '#f8f4eb';
const FG = '#1f1a14';
const ACCENT = '#2f3a2f';
const MUTED = '#8a8174';
const SEP = '#e6dfd3';

function brand() {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' } },
    h('div', { style: { width: '28px', height: '28px', borderRadius: '6px', background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      h('svg', { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: '#ffffff', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
        h('path', { d: 'M2 8a10.645 10.645 0 0 0 20 0' }),
        h('path', { d: 'm20 15-1.726-2.05' }),
        h('path', { d: 'm4 15 1.726-2.05' }),
      ),
    ),
    h('span', { style: { fontFamily: 'Inter', fontSize: '22px', fontWeight: 700, color: ACCENT, letterSpacing: '0.04em', textTransform: 'uppercase' } }, 'Tractatus'),
  );
}

function rule() {
  return h('div', { style: { width: '48px', height: '2px', borderRadius: '1px', background: SEP, margin: '20px 0' } });
}

function domain() {
  return h('div', { style: { fontFamily: 'Inter', fontSize: '12px', fontWeight: 400, color: MUTED, letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: '24px' } }, 'tractatus.app');
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
      h('div', { style: { fontFamily: 'Inter', fontSize: '40px', fontWeight: 700, color: FG, textAlign: 'center', lineHeight: 1.2, maxWidth: '560px' } }, 'A minimalist writing platform'),
      h('div', { style: { fontFamily: 'Inter', fontSize: '18px', fontWeight: 400, color: MUTED, textAlign: 'center', marginTop: '10px' } }, 'Write, publish, and share your thoughts.'),
      rule(),
      domain(),
    ),
  );
}

export async function profileOG(username: string, essayCount: number): Promise<Response> {
  return render(
    base(
      brand(),
      h('div', { style: { fontFamily: 'Inter', fontSize: '36px', fontWeight: 700, color: FG, textAlign: 'center', lineHeight: 1.3 } }, `@${username}`),
      h('div', { style: { fontFamily: 'Inter', fontSize: '16px', fontWeight: 400, color: MUTED, textAlign: 'center', marginTop: '6px' } },
        `${essayCount} ${essayCount === 1 ? 'essay' : 'essays'} written`,
      ),
      rule(),
      domain(),
    ),
  );
}

export async function essayOG(title: string, authorUsername: string, contentSnippet: string): Promise<Response> {
  const truncated = contentSnippet.length > 100
    ? contentSnippet.slice(0, 100).trimEnd() + '…'
    : contentSnippet;

  return render(
    base(
      brand(),
      h('div', { style: { fontFamily: 'Inter', fontSize: '32px', fontWeight: 700, color: FG, textAlign: 'center', lineHeight: 1.3, maxWidth: '640px' } }, title),
      h('div', { style: { fontFamily: 'Inter', fontSize: '14px', fontWeight: 400, color: MUTED, textAlign: 'center', marginTop: '6px', maxWidth: '480px', lineHeight: 1.5 } }, truncated),
      h('div', { style: { fontFamily: 'Inter', fontSize: '13px', fontWeight: 400, color: ACCENT, textAlign: 'center', marginTop: '16px' } }, `by @${authorUsername}`),
      rule(),
      domain(),
    ),
  );
}
