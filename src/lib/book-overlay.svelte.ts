type BookData = { id: string; title?: string; author?: string | null; coverUrl?: string | null };
type BookCallback = (data: BookData) => void;

let _handler: BookCallback | null = null;

export function setBookHandler(fn: BookCallback | null) {
  _handler = fn;
}

export function triggerBookOverlay(data: BookData) {
  _handler?.(data);
}
