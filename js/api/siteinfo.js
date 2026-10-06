import { normalizeUrl, textOrNull } from '../util.js';
import { t } from '../i18n.js';

export const FETCH_TIMEOUT_MS = 20000;
export const SITEINFO_PROPS = 'general|extensions|skins|libraries|extensiontags|functionhooks|namespaces|usergroups';

/**
 * GETs a MediaWiki API URL as JSON with a timeout and friendly (Japanese) error messages.
 * `params` are merged into the URL. `origin=*` is always added for anonymous CORS.
 */
export async function fetchApiJson(rawUrl, params, label) {
    const url = normalizeUrl(rawUrl);
    url.hash = '';
    for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params, origin: '*' })) {
        url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(t('api.http', { label, status: response.status, text: response.statusText }));
        }
        let data;
        try {
            data = await response.json();
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            throw new Error(t('api.notJson', { label }));
        }
        if (data?.error) {
            throw new Error(t('api.apiError', { label, info: data.error.info || data.error.code || t('common.unknownError') }));
        }
        return data;
    } catch (e) {
        if (e.name === 'AbortError') {
            throw new Error(t('api.timeout', { label, sec: FETCH_TIMEOUT_MS / 1000 }));
        }
        if (e instanceof TypeError) {
            // fetch() rejects with TypeError on network failure / CORS rejection
            const err = new Error(t('api.network', { label }));
            err.code = 'network';
            throw err;
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

/** "MediaWiki 1.43.1" → { mwVersion: '1.43.1', branch: 'REL1_43' }; wmf/alpha builds map to master. */
export function parseGenerator(generator) {
    const m = /MediaWiki\s+(\d+\.\d+(?:\.\d+)?(?:[-.][0-9A-Za-z.-]+)?)/.exec(String(generator || ''));
    if (!m) return { mwVersion: null, branch: null };
    const mwVersion = m[1];
    const [major, minor] = mwVersion.split(/[.-]/);
    const branch = /wmf|alpha/i.test(mwVersion) ? 'master' : `REL${major}_${minor}`;
    return { mwVersion, branch };
}

/** Normalizes a siteinfo `query` object (formatversion=2) into a Site. Pure; used for fetch, paste and tests. */
export function normalizeSiteInfo(query, { apiUrl = null, label = null, source = 'api', fetchedAt = Date.now() } = {}) {
    const general = query?.general || {};
    const { mwVersion, branch } = parseGenerator(general.generator);
    const extensions = (Array.isArray(query?.extensions) ? query.extensions : [])
        .filter(e => e && typeof e.name === 'string' && e.name !== '')
        .map(e => ({
            name: e.name,
            version: textOrNull(e.version),
            url: textOrNull(e.url),
            description: textOrNull(e.description),
            descriptionMsg: textOrNull(e.descriptionmsg),
            type: textOrNull(e.type),
            vcsUrl: textOrNull(e['vcs-url']),
            vcsVersion: textOrNull(e['vcs-version'])
        }));

    const namespaces = Object.values(query?.namespaces || {})
        .filter(n => n && typeof n.id === 'number')
        .map(n => ({ id: n.id, name: n.name ?? '', canonical: n.canonical ?? n.name ?? '' }));

    return {
        id: apiUrl || label || `site-${fetchedAt}`,
        label: label || textOrNull(general.sitename) || apiUrl || '(unnamed)',
        source,
        apiUrl,
        fetchedAt,
        mwVersion,
        branch,
        php: textOrNull(general.phpversion),
        dbtype: textOrNull(general.dbtype),
        lang: textOrNull(general.lang),
        extensions,
        skins: (Array.isArray(query?.skins) ? query.skins : []).map(s => ({
            code: s.code, name: s.name, default: !!s.default, unusable: !!s.unusable
        })),
        usergroups: (Array.isArray(query?.usergroups) ? query.usergroups : []).map(g => g.name).filter(Boolean),
        libraries: (Array.isArray(query?.libraries) ? query.libraries : []).map(l => ({ name: l.name, version: textOrNull(l.version) })),
        extensiontags: Array.isArray(query?.extensiontags) ? query.extensiontags.map(String) : [],
        functionhooks: Array.isArray(query?.functionhooks) ? query.functionhooks.map(String) : [],
        namespaces,
        manifests: {}
    };
}

export async function fetchSite(apiUrl, label = t('site.defaultLabel')) {
    const data = await fetchApiJson(apiUrl, { action: 'query', meta: 'siteinfo', siprop: SITEINFO_PROPS }, label);
    if (!data?.query || !Array.isArray(data.query.extensions)) {
        throw new Error(t('api.unexpected', { label }));
    }
    return normalizeSiteInfo(data.query, { apiUrl: normalizeUrl(apiUrl).href });
}

/** The URL a user can open in their own browser to copy the raw siteinfo JSON (CORS fallback). */
export function siteInfoUrl(apiUrl) {
    const url = normalizeUrl(apiUrl);
    url.hash = '';
    url.search = '';
    for (const [k, v] of Object.entries({ action: 'query', meta: 'siteinfo', siprop: SITEINFO_PROPS, format: 'json', formatversion: '2' })) {
        url.searchParams.set(k, v);
    }
    return url.href;
}
