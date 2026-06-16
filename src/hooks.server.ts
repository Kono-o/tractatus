import type { Handle } from '@sveltejs/kit';

const MAX_BODY_SIZE = 6 * 1024 * 1024;

export const handle: Handle = async ({ event, resolve }) => {
  if (event.request.body) {
    const contentLength = event.request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
      return new Response('Request body too large', { status: 413 });
    }
  }
  return resolve(event);
};
