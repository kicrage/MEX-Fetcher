// History tab: snapshots saved on each fetch (IndexedDB), and a diff between any two points in time.

import { escapeHtml } from '../util.js';
import { listSnapshots, deleteSnapshot, clearSnapshots } from '../store/history.js';
import { diffSites } from '../core/compare.js';
import { t, locale } from '../i18n.js';

const fmt = ms => new Date(ms).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'medium' });

export function createHistoryView(container) {
    const state = { all: [], current: [], apiUrl: null, from: null, to: null };

    async function load() {
        state.all = await listSnapshots();
        const urls = distinctUrls();
        if (!urls.includes(state.apiUrl)) state.apiUrl = urls[0] ?? null;
        pickDefaults();
        render();
    }

    function distinctUrls() {
        return [...new Set([...state.current.map(s => s.apiUrl).filter(Boolean), ...state.all.map(s => s.apiUrl)])];
    }

    /** Entries selectable as a point in time for the chosen site: saved snapshots plus the live result. */
    function entries() {
        const snaps = state.all.filter(s => s.apiUrl === state.apiUrl).map(s => ({ key: `s${s.id}`, id: s.id, time: s.savedAt, site: s.site, kind: 'snapshot' }));
        let live = state.current.find(s => s.apiUrl === state.apiUrl);
        // A fetch that was saved to history already appears as a snapshot; listing it twice would make the default diff empty.
        if (live && state.all.some(s => s.apiUrl === live.apiUrl && s.site.fetchedAt === live.fetchedAt)) live = null;
        const out = live ? [{ key: 'live', time: live.fetchedAt, site: live, kind: 'live' }, ...snaps] : snaps;
        return out.sort((a, b) => b.time - a.time);
    }

    function pickDefaults() {
        const list = entries();
        state.to = list[0]?.key ?? null;
        state.from = list[1]?.key ?? null;
    }

    const entryLabel = e => t('history.entry', {
        time: fmt(e.time), live: e.kind === 'live' ? t('history.liveMark') : '', mw: e.site.mwVersion ?? '?', n: e.site.extensions.length
    });

    function render() {
        const urls = distinctUrls();
        if (!urls.length) {
            container.innerHTML = `<div class="cdx-message"><span class="cdx-message__icon" aria-hidden="true"></span><div class="cdx-message__content">${escapeHtml(t('history.empty'))}</div></div>`;
            return;
        }
        const list = entries();
        const opt = sel => list.map(e => `<option value="${e.key}"${e.key === sel ? ' selected' : ''}>${escapeHtml(entryLabel(e))}</option>`).join('');
        const a = list.find(e => e.key === state.from), b = list.find(e => e.key === state.to);

        let diffHtml = '';
        if (list.length < 2) {
            diffHtml = `<p class="note">${escapeHtml(t('history.needTwo'))}</p>`;
        } else if (a && b) {
            // Always diff older → newer regardless of selection order.
            const [older, newer] = a.time <= b.time ? [a, b] : [b, a];
            diffHtml = diffView(diffSites(older.site, newer.site), older, newer);
        }

        container.innerHTML = `
            <div class="panel">
                <div class="toolbar">
                    <div class="cdx-field"><div class="cdx-label"><label class="cdx-label__label" for="h-site"><span class="cdx-label__label__text">${escapeHtml(t('history.site'))}</span></label></div>
                        <select id="h-site" class="select">${urls.map(u => `<option${u === state.apiUrl ? ' selected' : ''}>${escapeHtml(u)}</option>`).join('')}</select></div>
                    <div class="cdx-field"><div class="cdx-label"><label class="cdx-label__label" for="h-from"><span class="cdx-label__label__text">${escapeHtml(t('history.from'))}</span></label></div>
                        <select id="h-from" class="select">${opt(state.from)}</select></div>
                    <div class="cdx-field"><div class="cdx-label"><label class="cdx-label__label" for="h-to"><span class="cdx-label__label__text">${escapeHtml(t('history.to'))}</span></label></div>
                        <select id="h-to" class="select">${opt(state.to)}</select></div>
                </div>
                <div class="button-row" style="margin-top:12px">
                    <button type="button" class="cdx-button cdx-button--small" data-h="delete-selected">${escapeHtml(t('history.deleteSite'))}</button>
                    <button type="button" class="cdx-button cdx-button--small" data-h="clear">${escapeHtml(t('history.deleteAll'))}</button>
                </div>
            </div>
            ${diffHtml}`;
    }

    function diffView(d, older, newer) {
        const none = d.added.length + d.removed.length + d.updated.length === 0 && !d.core;
        const section = (title, items, cols, rowFn) => items.length ? `
            <div class="cdx-table">
                <div class="cdx-table__header"><div class="cdx-table__header__title"><h2>${escapeHtml(title)}</h2><span class="cdx-table__header__count">${escapeHtml(t('common.count', { n: items.length }))}</span></div></div>
                <div class="cdx-table__table-wrapper"><table class="cdx-table__table cdx-table__table--compact">
                    <caption>${escapeHtml(title)}</caption>
                    <thead><tr>${cols.map(c => `<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr></thead>
                    <tbody>${items.map(rowFn).join('')}</tbody></table></div>
            </div>` : '';
        const chip = (text, cls = '') => `<span class="cdx-info-chip${cls}"><span class="cdx-info-chip__text">${escapeHtml(text)}</span></span>`;
        const nameVersion = x => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.version ?? '-')}</td></tr>`;
        return `
            <div class="panel">
                <div class="stat-row">
                    ${chip(t('history.added', { n: d.added.length }), ' cdx-info-chip--progressive')}
                    ${chip(t('history.removed', { n: d.removed.length }), ' cdx-info-chip--error')}
                    ${chip(t('history.updated', { n: d.updated.length }))}
                    ${chip(t('history.unchanged', { n: d.unchanged.length }))}
                </div>
                <p class="note">${escapeHtml(fmt(older.time))} → ${escapeHtml(fmt(newer.time))}</p>
                ${d.core ? `<p><strong>${escapeHtml(t('history.core'))}:</strong> ${escapeHtml(d.core.from ?? '?')} → ${escapeHtml(d.core.to ?? '?')}</p>` : ''}
                ${none ? `<p>${escapeHtml(t('history.noDiff'))}</p>` : ''}
            </div>
            ${section(t('history.addedTitle'), d.added, [t('col.name'), t('col.version')], nameVersion)}
            ${section(t('history.removedTitle'), d.removed, [t('col.name'), t('col.version')], nameVersion)}
            ${section(t('history.updatedTitle'), d.updated, [t('col.name'), t('history.before'), t('history.after'), t('history.change')],
                x => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.from ?? '-')}</td><td>${escapeHtml(x.to ?? '-')}</td><td>${escapeHtml(t(`history.rel.${x.relation}`))}</td></tr>`)}`;
    }

    container.addEventListener('change', e => {
        if (e.target.id === 'h-site') { state.apiUrl = e.target.value; pickDefaults(); render(); }
        if (e.target.id === 'h-from') { state.from = e.target.value; render(); }
        if (e.target.id === 'h-to') { state.to = e.target.value; render(); }
    });

    container.addEventListener('click', async e => {
        const btn = e.target.closest('[data-h]');
        if (!btn) return;
        if (btn.dataset.h === 'clear') {
            if (!confirm(t('history.confirmAll'))) return;
            await clearSnapshots();
            await load();
        } else if (btn.dataset.h === 'delete-selected') {
            const targets = state.all.filter(s => s.apiUrl === state.apiUrl);
            if (!targets.length || !confirm(t('history.confirmSite', { url: state.apiUrl, n: targets.length }))) return;
            for (const s of targets) await deleteSnapshot(s.id);
            await load();
        }
    });

    return {
        /** Call after each successful fetch (history already saved) or when the tab opens. */
        async update(currentSites) {
            state.current = currentSites;
            if (currentSites[0]?.apiUrl) state.apiUrl = currentSites[0].apiUrl;
            await load();
        },
        /** Re-render in place (language change) without resetting the chosen points in time. */
        refresh: render
    };
}
