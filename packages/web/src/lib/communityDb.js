/**
 * On-device storage for posts written on the Community page, and for the photos and video
 * attached to them. IndexedDB rather than localStorage, because one phone video is larger
 * than the whole localStorage quota. Nothing in here is sent anywhere.
 *
 * A post and its media are written (and deleted) in one transaction, so a failure part way
 * through (a full disk, say) leaves nothing behind. When IndexedDB is unavailable (some
 * private windows), posts live in memory for this tab only, and storageMode() says so, so the
 * page can tell the student instead of promising to keep them.
 */
const DB_NAME = 'agora-community';
const DB_VERSION = 1;
const POSTS = 'posts';
const MEDIA = 'media';
const BLOCKED_WAIT_MS = 3000;

let dbPromise = null;
const memory = { posts: new Map(), media: new Map() };

function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let settled = false;
      const done = (db) => {
        if (settled) return;
        settled = true;
        resolve(db);
      };
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        done(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(POSTS)) db.createObjectStore(POSTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // A newer version opened in another tab: let it upgrade, and reopen on next use.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        done(db);
      };
      // Private mode or a broken database: fall back to memory for this tab.
      req.onerror = () => done(null);
      // Another tab holds an older version open. Wait a moment for it before giving up.
      req.onblocked = () => setTimeout(() => done(null), BLOCKED_WAIT_MS);
    });
  }
  return dbPromise;
}

function run(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    try {
      result = fn(tx);
    } catch (err) {
      // A write that throws right away (a full disk, a bad value) must not leave the writes
      // queued before it to commit on their own.
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
  });
}

/** 'idb' when posts survive a reload, 'memory' when they last only as long as this tab. */
export async function storageMode() {
  return (await open()) ? 'idb' : 'memory';
}

export async function listPosts() {
  const db = await open();
  if (!db) return [...memory.posts.values()];
  return (await run(db, POSTS, 'readonly', (tx) => tx.objectStore(POSTS).getAll())) || [];
}

export async function getMedia(id) {
  const db = await open();
  if (!db) return memory.media.get(id) || null;
  return (await run(db, MEDIA, 'readonly', (tx) => tx.objectStore(MEDIA).get(id))) || null;
}

/**
 * Save a post with its media, all or nothing. media: [{ id, blob }].
 */
export async function savePost(post, media = []) {
  const records = media.map((m) => ({ id: m.id, blob: m.blob }));
  const db = await open();
  if (!db) {
    for (const r of records) memory.media.set(r.id, r);
    memory.posts.set(post.id, post);
    return post;
  }
  await run(db, [POSTS, MEDIA], 'readwrite', (tx) => {
    const store = tx.objectStore(MEDIA);
    for (const r of records) store.put(r);
    return tx.objectStore(POSTS).put(post);
  });
  return post;
}

/** Delete a post and every stored file it points to, all or nothing. */
export async function removePost(post) {
  const ids = (post.media || []).map((m) => m.mediaId).filter(Boolean);
  const db = await open();
  if (!db) {
    for (const id of ids) memory.media.delete(id);
    memory.posts.delete(post.id);
    return;
  }
  await run(db, [POSTS, MEDIA], 'readwrite', (tx) => {
    const store = tx.objectStore(MEDIA);
    for (const id of ids) store.delete(id);
    return tx.objectStore(POSTS).delete(post.id);
  });
}

/** True for "the disk or the browser's quota is full". */
export function isQuotaError(err) {
  return Boolean(err && (err.name === 'QuotaExceededError' || err.code === 22 || /quota/i.test(String(err.message || ''))));
}

/** Photo types the page accepts. SVG is left out: it is a document, not a photo. */
export const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif']);

/**
 * Shrink a photo before it is stored: a phone JPEG is 4000 pixels wide and 5 MB, and neither
 * helps a post shown at 700 pixels. Transparent areas become white rather than black. A file
 * the browser cannot decode (HEIC in most desktop browsers) is kept as it is.
 */
export async function downscaleImage(file, maxEdge = 1600, quality = 0.84) {
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob || file;
  } catch {
    return file;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}
