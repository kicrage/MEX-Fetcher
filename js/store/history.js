// Snapshot history in IndexedDB. Every function degrades to a no-op/empty result if IndexedDB is unavailable.

const DB_NAME = 'mex-fetcher';
const STORE = 'snapshots';

function open() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
            store.createIndex('apiUrl', 'apiUrl');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function tx(mode, fn) {
    const db = await open();
    try {
        return await new Promise((resolve, reject) => {
            const t = db.transaction(STORE, mode);
            const result = fn(t.objectStore(STORE));
            t.oncomplete = () => resolve(result.value ?? result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
    } finally {
        db.close();
    }
}

const wrap = req => { const holder = {}; req.onsuccess = () => { holder.value = req.result; }; return holder; };

/** Stores a snapshot of `site` (keyed by its apiUrl). Returns the new id or null. */
export async function saveSnapshot(site) {
    if (!site.apiUrl) return null;
    try {
        return await tx('readwrite', s => wrap(s.add({ apiUrl: site.apiUrl, label: site.label, savedAt: Date.now(), site })));
    } catch (e) {
        console.warn('Could not save the history snapshot:', e);
        return null;
    }
}

/** Newest first. Without `apiUrl`, returns snapshots of every site. */
export async function listSnapshots(apiUrl = null) {
    try {
        const rows = await tx('readonly', s => wrap(apiUrl ? s.index('apiUrl').getAll(apiUrl) : s.getAll()));
        return (rows || []).sort((a, b) => b.savedAt - a.savedAt);
    } catch (e) {
        return [];
    }
}

export async function deleteSnapshot(id) {
    try { await tx('readwrite', s => wrap(s.delete(id))); } catch (e) { /* ignore */ }
}

export async function clearSnapshots() {
    try { await tx('readwrite', s => wrap(s.clear())); } catch (e) { /* ignore */ }
}
