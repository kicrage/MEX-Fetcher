// Site comparison. Works on normalized Site objects (see api/siteinfo.js).

import { compare as compareVersions } from './semver.js';

/**
 * Extensions and skins of a site as a flat list of { name, kind, version, url, description }.
 * siteinfo reports skins inside `extensions` (type "skin"), so `site.skins` (skin codes) is not merged in.
 */
export function siteItems(site) {
    return (site.extensions || []).map(e => ({ ...e, kind: e.type === 'skin' ? 'skin' : 'extension' }));
}

/**
 * One row per extension/skin name across all sites.
 * status: SINGLE (1 site) | COMMON/EXTRA/MISSING (2 sites, relative to Base=first / Target=second)
 *         | COMMON (all) / PARTIAL / UNIQUE (3+ sites)
 * `mismatch` is true when the item is on 2+ sites with differing versions.
 */
export function compareSites(sites) {
    const n = sites.length;
    const maps = sites.map(s => new Map(siteItems(s).map(i => [i.name, i])));
    const names = new Set(maps.flatMap(m => [...m.keys()]));
    return [...names].map(name => {
        const items = maps.map(m => m.get(name) || null);
        const present = items.map(Boolean);
        const count = present.filter(Boolean).length;
        const info = items.find(Boolean);
        const versions = items.map(i => i ? i.version : null);
        const known = versions.filter(Boolean);
        let status;
        if (n === 1) status = 'SINGLE';
        else if (n === 2) status = count === 2 ? 'COMMON' : (present[0] ? 'EXTRA' : 'MISSING');
        else status = count === n ? 'COMMON' : (count === 1 ? 'UNIQUE' : 'PARTIAL');
        return {
            status,
            name,
            kind: info.kind,
            version: info.version,
            url: info.url,
            description: info.description,
            versions,
            present,
            baseVersion: versions[0] ?? null,
            targetVersion: versions[1] ?? null,
            mismatch: count > 1 && new Set(known).size > 1
        };
    });
}

/** Case-insensitive match against name and description. */
export function matchesQuery(row, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || (row.description || '').toLowerCase().includes(q);
}

/** Describes how version `to` relates to `from`: 'same' | 'newer' | 'older' | 'unknown'. */
export function versionRelation(from, to) {
    if (!from || !to) return 'unknown';
    if (from === to) return 'same';
    const c = compareVersions(from, to);
    if (c === null) return from === to ? 'same' : 'unknown';
    return c === 0 ? 'same' : (c < 0 ? 'newer' : 'older');
}

/** Differences between two snapshots of the same site (old → new). */
export function diffSites(oldSite, newSite) {
    const a = new Map(siteItems(oldSite).map(i => [i.name, i]));
    const b = new Map(siteItems(newSite).map(i => [i.name, i]));
    const added = [], removed = [], updated = [], unchanged = [];
    for (const [name, nb] of b) {
        const na = a.get(name);
        if (!na) added.push({ name, version: nb.version, kind: nb.kind });
        else if ((na.version || null) !== (nb.version || null)) {
            updated.push({ name, kind: nb.kind, from: na.version, to: nb.version, relation: versionRelation(na.version, nb.version) });
        } else unchanged.push({ name, version: nb.version, kind: nb.kind });
    }
    for (const [name, na] of a) if (!b.has(name)) removed.push({ name, version: na.version, kind: na.kind });
    const byName = (x, y) => x.name.localeCompare(y.name);
    return {
        added: added.sort(byName), removed: removed.sort(byName),
        updated: updated.sort(byName), unchanged: unchanged.sort(byName),
        core: oldSite.mwVersion !== newSite.mwVersion ? { from: oldSite.mwVersion, to: newSite.mwVersion } : null
    };
}
