import { normalizeUrl } from '../util.js';
import { fetchApiJson } from './siteinfo.js';
import { t } from '../i18n.js';

/** Candidate api.php URLs for whatever the user pasted (article URL, index.php URL, bare host...). Pure. */
export function apiCandidates(raw) {
    const u = normalizeUrl(raw);
    const origin = u.origin;
    const path = u.pathname;
    const out = [];
    const add = p => { const c = origin + p; if (!out.includes(c)) out.push(c); };

    if (/\/api\.php$/i.test(path)) return [origin + path];

    const index = /^(.*)\/index\.php(?:\/.*)?$/i.exec(path);
    if (index) add(`${index[1]}/api.php`);
    const wiki = /^(.*?)\/wiki(?:\/.*)?$/i.exec(path);
    if (wiki) { add(`${wiki[1]}/w/api.php`); add(`${wiki[1]}/api.php`); }
    // A directory-like path ("/w", "/wiki/") may itself hold api.php
    const dir = path.replace(/\/+$/, '');
    if (dir && !index && !wiki) add(`${dir}/api.php`);
    add('/w/api.php');
    add('/api.php');
    add('/mediawiki/api.php');
    return out;
}

async function isMediaWikiApi(apiUrl) {
    try {
        const data = await fetchApiJson(apiUrl, { action: 'query', meta: 'siteinfo', siprop: 'general' }, 'probe');
        return !!data?.query?.general;
    } catch (e) {
        return false;
    }
}

/** Tries the page's own <link rel="EditURI"> as a last resort (only works where CORS allows the page fetch). */
async function apiFromHtml(raw) {
    try {
        const res = await fetch(normalizeUrl(raw).href, { headers: { Accept: 'text/html' } });
        if (!res.ok) return null;
        const html = await res.text();
        const m = /<link[^>]+rel=["']EditURI["'][^>]*href=["']([^"']+)["']/i.exec(html)
            || /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']EditURI["']/i.exec(html);
        if (!m) return null;
        const href = new URL(m[1].replace(/&amp;/g, '&'), raw);
        href.search = '';
        return href.href;
    } catch (e) {
        return null;
    }
}

/**
 * Resolves user input to a working api.php URL.
 * @returns {Promise<{apiUrl: string, discovered: boolean}>}
 * @throws when nothing responds like a MediaWiki API.
 */
export async function discoverApi(raw) {
    const candidates = apiCandidates(raw);
    if (candidates.length === 1 && /\/api\.php$/i.test(candidates[0])) {
        // The user pointed at api.php explicitly: trust it, let fetchSite report any problem.
        return { apiUrl: normalizeUrl(raw).href.split('?')[0], discovered: false };
    }
    for (const c of candidates) {
        if (await isMediaWikiApi(c)) return { apiUrl: c, discovered: true };
    }
    const viaHtml = await apiFromHtml(raw);
    if (viaHtml && await isMediaWikiApi(viaHtml)) return { apiUrl: viaHtml, discovered: true };
    throw new Error(t('discover.notFound', { raw }));
}
