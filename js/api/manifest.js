// extension.json / skin.json retrieval. Dependency data is not exposed by the siteinfo API, so we read each
// extension's manifest from its source repository (Wikimedia's GitHub mirror, or the item's own GitHub repo).

import { mapLimit } from '../util.js';
import { t } from '../i18n.js';

const CONCURRENCY = 6;
const TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const CACHE_PREFIX = 'mex:manifest:v1:';
const MANUAL_KEY = 'mex:manifest:manual:v1';

/** Names whose repository/manifest file can't be derived from the name. */
export const OVERRIDES = {
    // Wikibase ships two manifests from one repo (siteinfo reports e.g. "WikibaseClient").
    'WikibaseRepository': { repo: 'Wikibase', file: 'extension-repo.json' },
    'WikibaseRepo': { repo: 'Wikibase', file: 'extension-repo.json' },
    'WikibaseClient': { repo: 'Wikibase', file: 'extension-client.json' },
    'Wikibase Repository': { repo: 'Wikibase', file: 'extension-repo.json' },
    'Wikibase Repo': { repo: 'Wikibase', file: 'extension-repo.json' },
    'Wikibase Client': { repo: 'Wikibase', file: 'extension-client.json' },
    'Cologne Blue': { repo: 'CologneBlue' },
    'MinervaNeue': { repo: 'MinervaNeue' },
    'Universal Language Selector': { repo: 'UniversalLanguageSelector' }
};

const storage = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } }
};

/** https://gerrit.wikimedia.org/g/mediawiki/extensions/Foo/+/abc → { kind, repo } */
export function repoFromGerritUrl(url) {
    const m = /\/mediawiki\/(extensions|skins)\/([^/+?#]+)/.exec(String(url || ''));
    return m ? { kind: m[1] === 'skins' ? 'skin' : 'extension', repo: decodeURIComponent(m[2]) } : null;
}

/** https://www.mediawiki.org/wiki/Extension:Foo_Bar → { kind, repo: 'FooBar' } */
export function repoFromDocUrl(url) {
    const m = /mediawiki\.org\/wiki\/(Extension|Skin):([^/?#]+)/i.exec(String(url || ''));
    return m ? { kind: m[1].toLowerCase() === 'skin' ? 'skin' : 'extension', repo: decodeURIComponent(m[2]).replace(/[_\s]+/g, '') } : null;
}

/** Wikimedia's GitHub mirror: https://github.com/wikimedia/mediawiki-extensions-Foo/commit/abc → { kind, repo } */
export function repoFromWikimediaGithub(url) {
    const m = /^https:\/\/github\.com\/wikimedia\/mediawiki-(extensions|skins)-([^/#?]+)/.exec(String(url || ''));
    return m ? { kind: m[1] === 'skins' ? 'skin' : 'extension', repo: m[2] } : null;
}

function repoFromGithub(vcsUrl) {
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/|$)/.exec(String(vcsUrl || ''));
    return m ? { owner: m[1], name: m[2] } : null;
}

/**
 * Where to look for an item's manifest, best guess first.
 * @returns {{ repo: string, kind: string, urls: {url: string, branch: string, branchMissing: boolean}[] }}
 */
export function manifestCandidates(item, branch) {
    const kind = item.kind === 'skin' || item.type === 'skin' ? 'skin' : 'extension';
    const override = OVERRIDES[item.name];
    const wikimedia = repoFromGerritUrl(item.vcsUrl) || repoFromWikimediaGithub(item.vcsUrl);
    const resolved = wikimedia || repoFromDocUrl(item.url);
    const repo = override?.repo || resolved?.repo || item.name.replace(/\s+/g, '');
    const file = override?.file || (kind === 'skin' ? 'skin.json' : 'extension.json');
    const urls = [];

    const wmf = `https://raw.githubusercontent.com/wikimedia/mediawiki-${kind === 'skin' ? 'skins' : 'extensions'}-${repo}`;
    const gh = wikimedia ? null : repoFromGithub(item.vcsUrl); // a Wikimedia mirror URL is not a third-party repo
    const isWikimedia = !!wikimedia || !gh;

    if (isWikimedia) {
        const first = branch || 'master';
        urls.push({ url: `${wmf}/${first}/${file}`, branch: first, branchMissing: false });
        if (first !== 'master') urls.push({ url: `${wmf}/master/${file}`, branch: 'master', branchMissing: true });
    }
    if (gh) {
        const ref = item.vcsVersion || 'HEAD';
        urls.push({ url: `https://raw.githubusercontent.com/${gh.owner}/${gh.name}/${ref}/${file}`, branch: ref, branchMissing: false });
    }
    return { repo, kind, urls };
}

/** Normalizes raw extension.json/skin.json into the shape the core modules use. */
export function normalizeManifest(json, { repo = null, kind = 'extension', requested = null, usedBranch = null, branchMissing = false, source = 'github', rawUrl = null } = {}) {
    const requires = json?.requires || {};
    const platform = requires.platform || {};
    const phpExt = Object.keys(platform).filter(k => /^ext-/.test(k));
    return {
        name: typeof json?.name === 'string' ? json.name : repo,
        repo, kind, requested, usedBranch, branchMissing, source, rawUrl,
        version: typeof json?.version === 'string' ? json.version : null,
        requires: {
            MediaWiki: typeof requires.MediaWiki === 'string' ? requires.MediaWiki : null,
            php: typeof platform.php === 'string' ? platform.php : null,
            phpExt,
            extensions: { ...(requires.extensions || {}) },
            skins: { ...(requires.skins || {}) }
        }
    };
}

async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.status === 404) return { status: 404 };
        if (!res.ok) return { status: res.status };
        return { status: 200, text: await res.text() };
    } catch (e) {
        return { status: 0 };
    } finally {
        clearTimeout(timer);
    }
}

export function manualManifests() {
    return storage.get(MANUAL_KEY) || {};
}

/** Lets the user supply a manifest that couldn't be fetched (pasted JSON). Keyed by item name. */
export function setManualManifest(name, json, repo = null) {
    const all = manualManifests();
    all[name] = normalizeManifest(json, { repo: repo || name.replace(/\s+/g, ''), source: 'paste' });
    storage.set(MANUAL_KEY, all);
    return all[name];
}

/**
 * Loads a manifest from a URL the user supplies (e.g. a raw GitHub link) and stores it for `name`.
 * @throws {Error} with a user-facing message.
 */
export async function setManualManifestFromUrl(name, rawUrl) {
    let url;
    try {
        url = new URL(rawUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    } catch (e) {
        throw new Error(t('manual.badUrl'));
    }
    const res = await fetchText(url.href);
    if (res.status !== 200) {
        throw new Error(res.status === 0 ? t('manual.unreachable') : t('manual.http', { status: res.status }));
    }
    let json;
    try { json = JSON.parse(res.text); } catch (e) { throw new Error(t('manual.notJson')); }
    return setManualManifest(name, json);
}

/** Fetches (or recalls) one manifest. Resolves to a Manifest or null. Never throws. */
export async function getManifest(item, branch) {
    const manual = manualManifests()[item.name];
    if (manual) return manual;

    const { repo, kind, urls } = manifestCandidates(item, branch);
    for (const c of urls) {
        const key = `${CACHE_PREFIX}${c.url}`;
        const cached = storage.get(key);
        if (cached && Date.now() - cached.at < (cached.miss ? MISS_TTL_MS : TTL_MS)) {
            if (cached.miss) continue;
            return cached.manifest;
        }
        const res = await fetchText(c.url);
        if (res.status !== 200) {
            if (res.status === 404) storage.set(key, { at: Date.now(), miss: true });
            continue;
        }
        try {
            const manifest = normalizeManifest(JSON.parse(res.text), {
                repo, kind, requested: branch, usedBranch: c.branch, branchMissing: c.branchMissing, rawUrl: c.url
            });
            storage.set(key, { at: Date.now(), manifest });
            return manifest;
        } catch (e) {
            continue; // not JSON (e.g. an HTML error page): try the next candidate
        }
    }
    return null;
}

/**
 * Fetches manifests for `items` (each { name, kind, url, vcsUrl, vcsVersion, type }) concurrently.
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<Object<string, object|null>>} name → manifest|null
 */
export async function getManifests(items, branch, onProgress) {
    const out = {};
    let done = 0;
    await mapLimit(items, CONCURRENCY, async item => {
        out[item.name] = await getManifest(item, branch);
        onProgress?.(++done, items.length);
    });
    return out;
}
