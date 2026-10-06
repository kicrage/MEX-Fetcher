import { t } from './i18n.js';

export const $ = id => document.getElementById(id);

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Parses user input into an http(s) URL. Adds https:// when no scheme is given. */
export function normalizeUrl(raw) {
    let text = String(raw).trim();
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) {
        text = 'https://' + text;
    }
    let url;
    try {
        url = new URL(text);
    } catch (e) {
        throw new Error(t('url.invalid', { raw }));
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(t('url.scheme', { raw }));
    }
    return url;
}

/** Returns the href only for http(s) URLs (guards against javascript: etc. from remote data). */
export function safeHref(raw) {
    try {
        const url = new URL(raw);
        return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
    } catch (e) {
        return null;
    }
}

export const textOrNull = v => (typeof v === 'string' && v !== '') ? v : null;

export function getTimestamp(date = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Downloads text content. `bom` adds a UTF-8 BOM for Excel compatibility (CSV). */
export function downloadFile(content, filename, mime = 'text/plain', bom = false) {
    const parts = bom ? [new Uint8Array([0xEF, 0xBB, 0xBF]), content] : [content];
    const blob = new Blob(parts, { type: `${mime};charset=utf-8;` });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/** Runs `worker` over `items` with at most `limit` in flight. Results keep input order. */
export async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function run() {
        while (next < items.length) {
            const i = next++;
            results[i] = await worker(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
}
