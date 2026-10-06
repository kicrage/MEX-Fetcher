// Snapshot (Site ⇄ JSON) conversion. Pure; file I/O lives in the views.

import { normalizeSiteInfo } from '../api/siteinfo.js';
import { t } from '../i18n.js';

export const SNAPSHOT_FORMAT = 'mex-snapshot';
export const SNAPSHOT_VERSION = 1;

export function toSnapshot(site) {
    return { format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, savedAt: new Date().toISOString(), site };
}

export function snapshotFilename(site, stamp) {
    const host = (() => { try { return new URL(site.apiUrl).hostname; } catch (e) { return 'site'; } })();
    return `mex_snapshot_${host.replace(/[^\w.-]/g, '_')}_${stamp}.json`;
}

/**
 * Accepts either a MEX snapshot or the raw JSON of a siteinfo API response
 * (`{"query": {...}}`, or the inner object) and returns a Site.
 * @throws {Error} with a user-facing message when the text isn't usable.
 */
export function parseSiteJson(text, { label = null } = {}) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(t('snapshot.notJson'));
    }
    if (data?.format === SNAPSHOT_FORMAT) {
        if (data.version > SNAPSHOT_VERSION) throw new Error(t('snapshot.newer'));
        const s = data.site;
        if (!s || !Array.isArray(s.extensions)) throw new Error(t('snapshot.invalid'));
        return {
            manifests: {}, extensiontags: [], functionhooks: [], namespaces: [], libraries: [], skins: [], usergroups: [],
            ...s,
            source: 'snapshot',
            label: label || s.label,
            id: s.id || s.apiUrl || `snapshot-${s.fetchedAt}`
        };
    }
    const query = data?.query || data;
    if (!Array.isArray(query?.extensions)) {
        throw new Error(t('snapshot.noSiteinfo'));
    }
    return normalizeSiteInfo(query, { label, source: 'paste' });
}
