import { $, escapeHtml, downloadFile, getTimestamp } from './util.js';
import { discoverApi } from './api/discover.js';
import { fetchSite } from './api/siteinfo.js';
import { toSnapshot, snapshotFilename } from './store/snapshot.js';
import { saveSnapshot } from './store/history.js';
import { createSitesInput } from './views/sites-input.js';
import { createCompareView } from './views/compare.js';
import { createGraphView } from './views/graph.js';
import { createPortabilityView } from './views/portability.js';
import { createHistoryView } from './views/history.js';
import { t, getLang, setLang, detectLang, applyStatic, LANGS } from './i18n.js';
import { storedMode, setMode, applyTheme, watchSystemTheme } from './theme.js';

const DEFAULT_URL = 'https://en.wikipedia.org/w/api.php';
const TABS = ['compare', 'graph', 'port', 'history'];

const LANG_KEY = 'mex:lang';
const state = { sites: [], tab: 'compare', dirty: new Set(TABS) };

function storedLang() {
    try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; }
}

// Language: ?lang=… (shared links) > saved choice > browser language. Set before any view renders.
setLang(detectLang(new URLSearchParams(location.search).get('lang') || storedLang(), navigator.language));

/* ---------- small UI helpers ---------- */

function showError(message) {
    const box = $('error-msg');
    box.querySelector('.cdx-message__content').textContent = message;
    box.hidden = false;
}

function clearError() {
    $('error-msg').hidden = true;
    $('error-msg').querySelector('.cdx-message__content').textContent = '';
}

function setLoading(isLoading, label) {
    $('loading').hidden = !isLoading;
    $('fetch-btn').disabled = isLoading;
    if (label) $('loading-label').textContent = label;
}

function announce(message) {
    const live = $('live-status');
    live.textContent = '';
    // Re-set on next tick so repeated identical messages are still announced.
    setTimeout(() => { live.textContent = message; }, 50);
}

/* ---------- views ---------- */

const sitesInput = createSitesInput($('site-rows'), { onError: showError });
const views = {
    compare: createCompareView($('pane-compare')),
    graph: createGraphView($('pane-graph'), { announce }),
    port: createPortabilityView($('pane-port'), { announce }),
    history: createHistoryView($('pane-history'))
};

function renderTab(name) {
    // History is cheap to re-read and can change underneath us (other tabs, deletions), so it always refreshes.
    if (!state.dirty.has(name) && name !== 'history') return;
    state.dirty.delete(name);
    views[name].update(state.sites);
}

/* ---------- tabs ---------- */

function activateTab(name, { focus = false } = {}) {
    if (!TABS.includes(name)) name = 'compare';
    state.tab = name;
    for (const t of TABS) {
        const tab = $(`tab-${t}`);
        const selected = t === name;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        $(`pane-${t}`).hidden = !selected;
        if (selected && focus) tab.focus();
    }
    renderTab(name);
    syncUrl();
}

document.querySelector('.tabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) activateTab(tab.dataset.tab);
});
document.querySelector('.tabs').addEventListener('keydown', e => {
    const i = TABS.indexOf(state.tab);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) {
        e.preventDefault();
        activateTab(TABS[(i + step + TABS.length) % TABS.length], { focus: true });
    } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        activateTab(e.key === 'Home' ? TABS[0] : TABS[TABS.length - 1], { focus: true });
    }
});

/* ---------- summary (loaded sites + snapshot export) ---------- */

const sourceLabel = source => ({ api: 'API', snapshot: t('sites.sourceSnapshot'), paste: t('sites.sourcePaste') })[source] ?? source;

function renderSummary() {
    $('sites-summary').innerHTML = `<div class="sites-summary">${state.sites.map((s, i) => `
        <div class="sites-summary__item">
            <div>
                <strong>${escapeHtml(s.label)}</strong>
                <div class="sites-summary__meta">${escapeHtml(t('summary.meta', { mw: s.mwVersion ?? t('common.unknown'), php: s.php ?? t('common.unknown'), n: s.extensions.length, source: sourceLabel(s.source) }))}${s.apiUrl ? ` · <span class="mono">${escapeHtml(s.apiUrl)}</span>` : ''}</div>
            </div>
            <button type="button" class="cdx-button cdx-button--small" data-snapshot="${i}" title="${escapeHtml(t('summary.saveTitle'))}">${escapeHtml(t('summary.save'))}</button>
        </div>`).join('')}</div>`;
}

$('sites-summary').addEventListener('click', e => {
    const btn = e.target.closest('[data-snapshot]');
    if (!btn) return;
    const site = state.sites[Number(btn.dataset.snapshot)];
    downloadFile(JSON.stringify(toSnapshot(site), null, 1), snapshotFilename(site, getTimestamp()), 'application/json');
});

/* ---------- shareable URL ---------- */

function syncUrl() {
    // Only API-backed sites can be shared; snapshots/pastes exist only in this browser.
    const params = new URLSearchParams();
    for (const s of state.sites) if (s.source === 'api' && s.apiUrl) params.append('site', s.apiUrl);
    // A link that pinned a language (?lang=en) keeps it, following later language changes.
    const pinnedLang = new URLSearchParams(location.search).has('lang');
    if (!params.has('site')) {
        history.replaceState(null, '', pinnedLang ? `${location.pathname}?lang=${getLang()}` : location.pathname);
        return;
    }
    if (pinnedLang) params.set('lang', getLang());
    if (state.tab !== 'compare') params.set('tab', state.tab);
    // A/B are indices into state.sites; they only line up with the URL's site list when every site is API-backed.
    if (state.tab === 'port' && state.sites.every(s => s.source === 'api')) {
        const { a, b } = views.port.selection;
        params.set('a', a);
        params.set('b', b);
    }
    history.replaceState(null, '', `${location.pathname}?${params}`);
}

/* ---------- fetching ---------- */

/** Sites can share a name (en/ja Wikipedia are both "Wikipedia"): add the hostname, then a counter if still ambiguous. */
function uniqueLabels(sites) {
    const count = label => sites.filter(s => s.label === label).length;
    for (const s of sites) {
        if (count(s.label) > 1 && s.apiUrl) {
            try { s.label = `${s.label} (${new URL(s.apiUrl).hostname})`; } catch (e) { /* keep label */ }
        }
    }
    const seen = new Map();
    for (const s of sites) {
        const n = (seen.get(s.label) || 0) + 1;
        seen.set(s.label, n);
        if (n > 1) s.label = `${s.label} (${n})`;
    }
}

async function resolveRow(row, i) {
    const name = i === 0 ? 'Base' : i === 1 ? 'Target' : t('sites.nameOther', { n: i + 1 });
    if (row.site) return { ...row.site, manifests: row.site.manifests || {} };
    const { apiUrl, discovered } = await discoverApi(row.url).catch(err => { throw new Error(`${name}: ${err.message}`); });
    if (discovered) sitesInput.setUrl(i, apiUrl);
    return fetchSite(apiUrl, name);
}

async function handleFetch(opts = {}) {
    clearError();
    const rows = sitesInput.getRows();
    const active = rows.map((row, i) => ({ row, i })).filter(({ row }) => row.site || row.url.trim());

    if (!active.length) {
        showError(t('err.enterUrl'));
        $('site-url-0')?.focus();
        return;
    }

    setLoading(true, t('fetch.loading'));
    try {
        const settled = await Promise.allSettled(active.map(({ row, i }) => resolveRow(row, i)));
        const failures = settled.filter(r => r.status === 'rejected');
        if (failures.length) {
            failures.forEach(f => console.error(f.reason));
            const hint = failures.some(f => f.reason.code === 'network') ? ` ${t('err.pasteHint')}` : '';
            showError(`${t('err.occurred', { message: failures.map(f => f.reason.message).join(' / ') })}${hint}`);
            return;
        }

        const sites = settled.map(r => r.value);
        uniqueLabels(sites);
        state.sites = sites;
        state.dirty = new Set(TABS);

        if ($('opt-history').checked) {
            // Fire and forget: a storage failure must never block showing results.
            await Promise.all(sites.filter(s => s.source === 'api').map(saveSnapshot));
        }

        $('results').hidden = false;
        renderSummary();
        activateTab(opts.tab || (state.tab === 'compare' ? 'compare' : state.tab));
        if (opts.a !== undefined) views.port.select(opts.a, opts.b);
        syncUrl();
        announce(t('fetch.done', { n: sites.reduce((n, s) => n + s.extensions.length, 0) }));
    } catch (error) {
        console.error(error);
        showError(t('err.occurred', { message: error.message }));
    } finally {
        setLoading(false);
    }
}

/* ---------- events & startup ---------- */

$('fetch-form').addEventListener('submit', e => {
    e.preventDefault();
    handleFetch();
});

['opt-version', 'opt-url', 'opt-desc'].forEach(id => {
    $(id).addEventListener('change', () => { if (state.sites.length) views.compare.refresh(); });
});

/* ---------- language & theme ---------- */

/** Re-renders everything that contains translated or theme-dependent text, without refetching or resetting state. */
function refreshAll() {
    applyStatic();
    sitesInput.refresh();
    if (!state.sites.length) return;
    renderSummary();
    for (const view of Object.values(views)) view.refresh();
}

$('lang-select').value = getLang();
$('lang-select').addEventListener('change', e => {
    if (!LANGS.includes(e.target.value)) return;
    setLang(e.target.value);
    try { localStorage.setItem(LANG_KEY, getLang()); } catch (err) { /* applies for this session only */ }
    refreshAll();
    syncUrl();
});

$('theme-select').value = storedMode();
$('theme-select').addEventListener('change', e => {
    setMode(e.target.value);
    // The Cytoscape renderer bakes theme colours into its stylesheet, so the graph must redraw.
    if (state.sites.length) views.graph.refresh();
});
applyTheme(storedMode());
watchSystemTheme(() => { if (state.sites.length) views.graph.refresh(); });
applyStatic();

(function start() {
    const params = new URLSearchParams(location.search);
    const urls = params.getAll('site');
    if (!urls.length) {
        sitesInput.setRows([{ url: DEFAULT_URL, site: null }, { url: '', site: null }]);
        return;
    }
    sitesInput.setRows(urls.map(url => ({ url, site: null })));
    const tab = params.get('tab');
    const num = k => (params.has(k) && /^\d+$/.test(params.get(k))) ? Number(params.get(k)) : undefined;
    handleFetch({ tab: TABS.includes(tab) ? tab : undefined, a: num('a'), b: num('b') });
})();
