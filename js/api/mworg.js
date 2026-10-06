// Maintenance status and bundling info from mediawiki.org's extension pages (via their categories).
// Best-effort: failures yield empty metadata, never errors. (Whether a REL branch exists is learned from the
// manifest fetch itself — ExtensionDistributor only lists *supported* branches, so it would mislead on older wikis.)

import { fetchApiJson } from './siteinfo.js';
import { mapLimit } from '../util.js';

const MWORG_API = 'https://www.mediawiki.org/w/api.php';
const BATCH = 50;

/** Reads maintenance state out of a page's category titles. Pure. */
export function parseCategories(categoryTitles) {
    const meta = {};
    for (const raw of categoryTitles) {
        const title = raw.replace(/^Category:/, '');
        // Category names verified against mediawiki.org (e.g. "Archived extensions", "Obsolete extensions").
        let m = /^(Obsolete|Archived|Unmaintained|Experimental|Stable) (?:extensions|skins)$/i.exec(title);
        if (m) {
            const s = m[1].toLowerCase();
            // The most severe state wins if a page is (wrongly) in several.
            const rank = { obsolete: 4, archived: 3, unmaintained: 2, experimental: 1, stable: 0 };
            if (meta.status === undefined || rank[s] > rank[meta.status]) meta.status = s;
        }
        m = /^(?:Extensions|Skins) bundled with MediaWiki (\d+\.\d+)$/i.exec(title);
        if (m) meta.bundledIn = m[1];
    }
    return meta;
}

const pageTitle = item => `${item.kind === 'skin' ? 'Skin' : 'Extension'}:${item.name.replace(/\s+/g, '_')}`;

/** @returns {Promise<Object<string, {status?: string, bundledIn?: string}>>} item name → meta */
export async function fetchMeta(items) {
    const byTitle = new Map(items.map(i => [pageTitle(i), i.name]));
    const titles = [...byTitle.keys()];
    const batches = [];
    for (let i = 0; i < titles.length; i += BATCH) batches.push(titles.slice(i, i + BATCH));

    const meta = {};
    await mapLimit(batches, 2, async batch => {
        try {
            const cats = new Map();      // normalized title → [category titles]
            const redirects = new Map(); // from → to
            let cont = {};
            do {
                const data = await fetchApiJson(MWORG_API, {
                    action: 'query', prop: 'categories', cllimit: 'max', redirects: '1',
                    titles: batch.join('|'), ...cont
                }, 'mediawiki.org');
                for (const r of data.query?.redirects || []) redirects.set(r.from, r.to);
                for (const p of data.query?.pages || []) {
                    const list = cats.get(p.title) || [];
                    list.push(...(p.categories || []).map(c => c.title));
                    cats.set(p.title, list);
                }
                cont = data.continue || null;
            } while (cont);

            for (const title of batch) {
                // The API normalizes titles ("_" → " "), and may follow redirects.
                const normalized = title.replace(/_/g, ' ');
                const final = redirects.get(normalized) || redirects.get(title) || normalized;
                const list = cats.get(final);
                if (list) meta[byTitle.get(title)] = parseCategories(list);
            }
        } catch (e) {
            console.warn('mediawiki.org metadata unavailable:', e.message);
        }
    });
    return meta;
}
