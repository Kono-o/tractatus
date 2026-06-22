import { db } from '$lib/db';

export interface ReadingListBook {
  id: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
}

export const readingList = $state<{
  items: ReadingListBook[];
  bookIds: Set<string>;
  loaded: boolean;
}>({
  items: [],
  bookIds: new Set(),
  loaded: false,
});

export async function loadReadingList() {
  const items = await db.listReadingList();
  readingList.items = items.map(i => ({
    id: i.book_id,
    title: i.title,
    author: i.author,
    coverUrl: i.cover_i ? `https://covers.openlibrary.org/b/id/${i.cover_i}-M.jpg` : null,
  }));
  readingList.bookIds = new Set(items.map(i => i.book_id));
  readingList.loaded = true;
}

export async function addToReadingList(book: { id: string; title: string; author: string | null; coverUrl: string | null }) {
  readingList.items = [...readingList.items, { ...book }];
  readingList.bookIds = new Set([...readingList.bookIds, book.id]);
  try {
    const cover_i = book.coverUrl ? parseInt(book.coverUrl.match(/\/b\/id\/(\d+)/)?.[1] ?? '') || null : null;
    await db.addToReadingList({
      book_id: book.id,
      title: book.title,
      author: book.author,
      cover_i,
    });
  } catch (e) {
    readingList.items = readingList.items.filter(b => b.id !== book.id);
    readingList.bookIds = new Set([...readingList.bookIds].filter(id => id !== book.id));
    console.warn('failed to add to reading list', e);
  }
}

export async function removeFromReadingList(bookId: string) {
  readingList.items = readingList.items.filter(b => b.id !== bookId);
  readingList.bookIds = new Set([...readingList.bookIds].filter(id => id !== bookId));
  try {
    await db.removeFromReadingList(bookId);
  } catch (e) {
    console.warn('failed to remove from reading list', e);
  }
}
