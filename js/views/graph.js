// Dependency tab: fetch manifests for a site, then show its dependency graph (SVG or Cytoscape) and a list.

import { escapeHtml } from '../util.js';
import { siteItems } from '../core/compare.js';
import { buildGraph, analyzeGraph, transitiveDeps } from '../core/graph.js';
import { getManifests } from '../api/manifest.js';
import { renderSvgGraph } from './graph-svg.js';
import { renderCytoscapeGraph } from './graph-cy.js';
import { t } from '../i18n.js';

export function createGraphView(container, { onManifestsFetched = () => {}, announce = () => {} } = {}) {
    const state = {
        // Isolated nodes (often most of a wiki's extensions) say nothing about dependencies, so they start hidden.
        sites: [], index: 0, mode: 'svg', onlyUnmet: false, hideIsolated: true, query: '', selected: null,
        fetching: false, progress: null, handle: null, message: null
    };

    const site = () => state.sites[state.index];
    const hasManifests = s => s && Object.keys(s.manifests || {}).length > 0;
    const progressText = p => t('graph.progressText', { done: p.done, total: p.total });

    /* ---------- node selection per filters ---------- */

    function visibleNames(graph) {
        let names = new Set(graph.keys());
        if (state.hideIsolated) {
            names = new Set([...names].filter(n => {
                const node = graph.get(n);
                return !node.installed || node.requires.length || node.requiredBy.length;
            }));
        }
        if (state.onlyUnmet) {
            const keep = new Set();
            for (const [n, node] of graph) {
                if (!node.installed) {
                    keep.add(n);
                    const stack = [n];
                    while (stack.length) for (const u of graph.get(stack.pop())?.requiredBy || []) {
                        if (!keep.has(u)) { keep.add(u); stack.push(u); }
                    }
                }
            }
            names = new Set([...names].filter(n => keep.has(n)));
        }
        const q = state.query.trim().toLowerCase();
        if (q) {
            const hit = [...names].filter(n => n.toLowerCase().includes(q));
            const keep = new Set(hit);
            for (const n of hit) {
                const node = graph.get(n);
                node.requires.forEach(d => keep.add(d));
                node.requiredBy.forEach(u => keep.add(u));
            }
            names = new Set([...names].filter(n => keep.has(n)));
        }
        return [...names].sort((a, b) => a.localeCompare(b));
    }

    /* ---------- rendering ---------- */

    function shell() {
        const s = site();
        if (!s) { container.innerHTML = ''; return; }
        const siteSelect = state.sites.length > 1 ? `
            <div class="cdx-field">
                <div class="cdx-label"><label class="cdx-label__label" for="g-site"><span class="cdx-label__label__text">${escapeHtml(t('graph.targetSite'))}</span></label></div>
                <select id="g-site" class="select">${state.sites.map((x, i) => `<option value="${i}"${i === state.index ? ' selected' : ''}>${escapeHtml(x.label)}</option>`).join('')}</select>
            </div>` : '';
        const have = hasManifests(s);
        const total = siteItems(s).length;
        const progress = state.progress
            ? `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${state.progress.total}" aria-valuenow="${state.progress.done}"><span style="width:${(100 * state.progress.done / state.progress.total).toFixed(0)}%"></span></div>
               <div class="note">${escapeHtml(progressText(state.progress))}</div>` : '';

        container.innerHTML = `
            <div class="panel">
                <div class="toolbar">
                    ${siteSelect}
                    <div class="cdx-field">
                        <button type="button" id="g-fetch" class="cdx-button ${have ? '' : 'cdx-button--action-progressive cdx-button--weight-primary'}"${state.fetching ? ' disabled' : ''}>
                            ${escapeHtml(t(have ? 'graph.refetch' : 'graph.fetch'))}</button>
                    </div>
                </div>
                <p class="cdx-field__help-text">${escapeHtml(t('graph.help', { branch: s.branch || 'master', total }))}</p>
                ${progress}
                ${state.message ? `<div class="cdx-message cdx-message--error" role="alert"><span class="cdx-message__icon" aria-hidden="true"></span><div class="cdx-message__content">${escapeHtml(state.message)}</div></div>` : ''}
            </div>
            <div id="g-body"></div>`;
        body();
    }

    function body() {
        const el = container.querySelector('#g-body');
        if (!el) return;
        const s = site();
        if (!hasManifests(s)) {
            el.innerHTML = state.fetching ? '' : `<div class="cdx-message"><span class="cdx-message__icon" aria-hidden="true"></span><div class="cdx-message__content">${escapeHtml(t('graph.prompt'))}</div></div>`;
            return;
        }
        const graph = buildGraph(s, s.manifests);
        const info = analyzeGraph(graph);
        const missingManifests = siteItems(s).filter(i => !s.manifests[i.name]).length;
        const chip = (text, cls = '') => `<span class="cdx-info-chip${cls}"><span class="cdx-info-chip__text">${escapeHtml(text)}</span></span>`;

        el.innerHTML = `
            <div class="panel">
                <div class="stat-row">
                    ${chip(t('graph.statNodes', { n: info.total }))}
                    ${chip(t('graph.statUnmet', { n: info.unmet.length }), info.unmet.length ? ' cdx-info-chip--error' : '')}
                    ${chip(t('graph.statCycles', { n: info.cycles.length }), info.cycles.length ? ' cdx-info-chip--error' : '')}
                    ${chip(t('graph.statIsolated', { n: info.isolated.length }))}
                    ${chip(t('graph.statNoManifest', { n: missingManifests }), missingManifests ? ' cdx-info-chip--progressive' : '')}
                </div>
                ${info.unmet.length ? `<p class="note">${escapeHtml(t('graph.unmetNote', {
                    names: info.unmet.map(n => n.name).join(', '),
                    users: [...new Set(info.unmet.flatMap(n => n.requiredBy))].join(', ')
                }))}</p>` : ''}
                ${info.cycles.length ? `<p class="note">${escapeHtml(t('graph.cycleNote', { cycles: info.cycles.map(c => c.join(' ⇄ ')).join(' / ') }))}</p>` : ''}
                <div class="toolbar" style="margin-top:12px">
                    <div class="cdx-field" role="group" aria-labelledby="g-mode-label">
                        <div class="cdx-label"><span id="g-mode-label" class="cdx-label__label__text">${escapeHtml(t('graph.render'))}</span></div>
                        <div class="cdx-toggle-button-group">
                            <button type="button" class="cdx-toggle-button cdx-toggle-button--framed${state.mode === 'svg' ? ' cdx-toggle-button--toggled-on' : ''}" data-mode="svg" aria-pressed="${state.mode === 'svg'}">${escapeHtml(t('graph.modeSvg'))}</button>
                            <button type="button" class="cdx-toggle-button cdx-toggle-button--framed${state.mode === 'cy' ? ' cdx-toggle-button--toggled-on' : ''}" data-mode="cy" aria-pressed="${state.mode === 'cy'}">Cytoscape.js</button>
                        </div>
                    </div>
                    <div class="cdx-field">
                        <div class="cdx-label"><label class="cdx-label__label" for="g-search"><span class="cdx-label__label__text">${escapeHtml(t('common.search'))}</span></label></div>
                        <div class="cdx-text-input cdx-text-input--search"><input id="g-search" class="cdx-text-input__input" type="search" autocomplete="off" placeholder="${escapeHtml(t('graph.searchPlaceholder'))}" value="${escapeHtml(state.query)}"></div>
                    </div>
                    <div class="checkbox-group">
                        ${checkbox('g-unmet', t('graph.onlyUnmet'), state.onlyUnmet)}
                        ${checkbox('g-isolated', t('graph.hideIsolated'), state.hideIsolated)}
                    </div>
                </div>
            </div>
            <div class="graph-wrap">
                <div class="graph-controls">
                    <button type="button" class="cdx-button cdx-button--icon-only" data-zoom="in" aria-label="${escapeHtml(t('graph.zoomIn'))}" title="${escapeHtml(t('graph.zoomIn'))}">＋</button>
                    <button type="button" class="cdx-button cdx-button--icon-only" data-zoom="out" aria-label="${escapeHtml(t('graph.zoomOut'))}" title="${escapeHtml(t('graph.zoomOut'))}">－</button>
                    <button type="button" class="cdx-button" data-zoom="fit">${escapeHtml(t('graph.fit'))}</button>
                </div>
                <div id="g-viewport" class="graph-viewport"></div>
                <div class="graph-legend">
                    <span><span class="legend-swatch" style="background:var(--background-color-base)"></span>${escapeHtml(t('graph.legendInstalled'))}</span>
                    <span><span class="legend-swatch" style="background:var(--background-color-error-subtle);border-color:var(--border-color-error)"></span>${escapeHtml(t('graph.legendUnmet'))}</span>
                    <span><span class="legend-swatch" style="background:var(--background-color-neutral-subtle)"></span>${escapeHtml(t('graph.legendUnknown'))}</span>
                    <span><span class="legend-swatch" style="border-style:dashed"></span>${escapeHtml(t('graph.legendSkin'))}</span>
                    <span>${escapeHtml(t('graph.legendArrows'))}: <span style="color:var(--graph-dep)">${escapeHtml(t('graph.legendDeps'))}</span> / <span style="color:var(--graph-user)">${escapeHtml(t('graph.legendUsers'))}</span></span>
                </div>
            </div>
            <div id="g-list"></div>`;
        drawGraph(graph);
        drawList(graph);
    }

    const checkbox = (id, label, checked) => `
        <div class="cdx-checkbox"><div class="cdx-checkbox__wrapper">
            <input id="${id}" class="cdx-checkbox__input" type="checkbox"${checked ? ' checked' : ''}>
            <span class="cdx-checkbox__icon"></span>
            <div class="cdx-checkbox__label cdx-label"><label class="cdx-label__label" for="${id}"><span class="cdx-label__label__text">${escapeHtml(label)}</span></label></div>
        </div></div>`;

    async function drawGraph(graph) {
        const viewport = container.querySelector('#g-viewport');
        if (!viewport) return;
        state.handle?.destroy();
        state.handle = null;
        const names = visibleNames(graph);
        if (!names.length) {
            viewport.innerHTML = `<p class="cdx-table__table__empty-state-content" style="padding:32px;text-align:center">${escapeHtml(t('graph.noNodes'))}</p>`;
            return;
        }
        const opts = { graph, names, onSelect: name => { state.selected = name; drawList(graph); } };
        try {
            if (state.mode === 'cy') {
                viewport.innerHTML = `<p class="note" style="padding:16px">${escapeHtml(t('graph.cyLoading'))}</p>`;
                state.handle = await renderCytoscapeGraph(viewport, opts);
            } else {
                state.handle = renderSvgGraph(viewport, opts);
            }
            if (state.selected) state.handle.select(state.selected);
        } catch (err) {
            console.warn(err);
            if (state.mode === 'cy') {
                // CDN blocked or offline: fall back to the built-in renderer.
                state.mode = 'svg';
                state.message = t('graph.cyFallback', { error: err.message });
                shell();
            }
        }
    }

    function drawList(graph) {
        const el = container.querySelector('#g-list');
        if (!el) return;
        const names = visibleNames(graph);
        const link = n => `<button type="button" class="cdx-button cdx-button--quiet cdx-button--small" data-pick="${escapeHtml(n)}">${escapeHtml(n)}</button>`;
        const sel = state.selected && graph.has(state.selected) ? state.selected : null;
        const deps = sel ? transitiveDeps(graph, [sel]) : null;
        el.innerHTML = `
            ${sel ? `<div class="panel">${t('graph.transitive', { name: `<strong>${escapeHtml(sel)}</strong>` })}: ${deps.size ? [...deps].sort().map(link).join(' ') : escapeHtml(t('common.none'))}</div>` : ''}
            <div class="cdx-table">
                <div class="cdx-table__header"><div class="cdx-table__header__title"><h2>${escapeHtml(t('graph.listTitle'))}</h2><span class="cdx-table__header__count">${escapeHtml(t('common.count', { n: names.length }))}</span></div></div>
                <div class="cdx-table__table-wrapper">
                    <table class="cdx-table__table cdx-table__table--compact">
                        <caption>${escapeHtml(t('graph.listCaption'))}</caption>
                        <thead><tr><th scope="col">${escapeHtml(t('col.name'))}</th><th scope="col">${escapeHtml(t('graph.colState'))}</th><th scope="col">${escapeHtml(t('graph.colRequires'))}</th><th scope="col">${escapeHtml(t('graph.colRequiredBy'))}</th></tr></thead>
                        <tbody>${names.map(n => {
                            const node = graph.get(n);
                            const state_ = !node.installed ? `<span class="cdx-info-chip cdx-info-chip--error"><span class="cdx-info-chip__text">${escapeHtml(t('graph.stateUnmet'))}</span></span>`
                                : (!node.known ? `<span class="cdx-info-chip"><span class="cdx-info-chip__text">${escapeHtml(t('graph.stateUnknown'))}</span></span>` : '');
                            return `<tr${n === sel ? ' style="background:var(--background-color-progressive-subtle)"' : ''}>
                                <td>${link(n)}${node.kind === 'skin' ? ` <span class="cell-muted">(${escapeHtml(t('kind.skin'))})</span>` : ''}</td>
                                <td>${state_}</td>
                                <td>${node.requires.map(link).join(' ') || '<span class="cell-muted">-</span>'}</td>
                                <td>${node.requiredBy.map(link).join(' ') || '<span class="cell-muted">-</span>'}</td>
                            </tr>`;
                        }).join('')}</tbody>
                    </table>
                </div>
            </div>`;
    }

    /* ---------- events ---------- */

    async function fetchManifestsForSite() {
        const s = site();
        if (!s || state.fetching) return;
        state.fetching = true;
        state.message = null;
        const items = siteItems(s);
        state.progress = { done: 0, total: items.length };
        shell();
        try {
            const result = await getManifests(items, s.branch || 'master', (done, total) => {
                state.progress = { done, total };
                const bar = container.querySelector('.progress');
                if (bar) {
                    bar.setAttribute('aria-valuenow', done);
                    bar.firstElementChild.style.width = `${(100 * done / total).toFixed(0)}%`;
                    bar.nextElementSibling.textContent = progressText(state.progress);
                }
            });
            s.manifests = result;
            onManifestsFetched(s);
            const ok = Object.values(result).filter(Boolean).length;
            announce(t('graph.fetched', { ok, total: items.length }));
        } catch (err) {
            state.message = t('graph.fetchFailed', { error: err.message });
        } finally {
            state.fetching = false;
            state.progress = null;
            shell();
        }
    }

    container.addEventListener('click', e => {
        const target = e.target;
        if (target.closest('#g-fetch')) return void fetchManifestsForSite();
        const mode = target.closest('[data-mode]');
        if (mode && mode.dataset.mode !== state.mode) { state.mode = mode.dataset.mode; state.message = null; return void body(); }
        const zoom = target.closest('[data-zoom]');
        if (zoom && state.handle) {
            ({ in: state.handle.zoomIn, out: state.handle.zoomOut, fit: state.handle.fit })[zoom.dataset.zoom]();
            return;
        }
        const pick = target.closest('[data-pick]');
        if (pick) {
            state.selected = pick.dataset.pick;
            state.handle?.select(state.selected);
            const s = site();
            drawList(buildGraph(s, s.manifests));
            container.querySelector('#g-viewport')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });

    container.addEventListener('change', e => {
        if (e.target.id === 'g-site') { state.index = Number(e.target.value); state.selected = null; state.message = null; return void shell(); }
        if (e.target.id === 'g-unmet') { state.onlyUnmet = e.target.checked; return void body(); }
        if (e.target.id === 'g-isolated') { state.hideIsolated = e.target.checked; return void body(); }
    });

    let searchTimer = null;
    container.addEventListener('input', e => {
        if (e.target.id !== 'g-search') return;
        state.query = e.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const s = site();
            if (!hasManifests(s)) return;
            const graph = buildGraph(s, s.manifests);
            drawGraph(graph);
            drawList(graph);
        }, 200);
    });

    return {
        update(sites) {
            state.sites = sites;
            state.index = Math.min(state.index, Math.max(0, sites.length - 1));
            state.selected = null;
            state.message = null;
            shell();
        },
        /** Re-render in place (language/theme change); keeps selection and filters. */
        refresh: shell
    };
}
