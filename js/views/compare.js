// Compare tab: single list, two-site Common/Missing/Extra view, or an N-site matrix. With search, sort, export.

import { $, escapeHtml, safeHref, downloadFile, getTimestamp } from '../util.js';
import { compareSites, matchesQuery } from '../core/compare.js';
import { toCsv, toWikitable, toMarkdownTable } from '../core/export.js';
import { t } from '../i18n.js';

// `csv` values are stable English codes for exported files; on-screen labels come from the dictionary.
const STATUS = {
    COMMON: { chip: '', csv: 'Common' },
    MISSING: { chip: ' cdx-info-chip--error', csv: 'Missing' },
    EXTRA: { chip: ' cdx-info-chip--progressive', csv: 'Extra (Surplus)' },
    PARTIAL: { chip: ' cdx-info-chip--progressive', csv: 'Partial' },
    UNIQUE: { chip: ' cdx-info-chip--error', csv: 'Unique' },
    SINGLE: { chip: '', csv: '' }
};
const statusLabel = status => (status === 'SINGLE' ? '' : t(`status.${status}`));

const FILTERS_2 = ['ALL', 'COMMON', 'MISSING', 'EXTRA'];
const FILTERS_N = ['ALL', 'COMMON', 'PARTIAL', 'UNIQUE', 'MISMATCH'];
const filterLabel = (key, n) => t(n === 2 ? `filter2.${key}` : `filterN.${key}`);

export function createCompareView(container) {
    const state = { sites: [], rows: [], filter: 'ALL', sort: { key: 'name', dir: 'asc' }, query: '', sortApplied: null };

    function opts() {
        return { version: $('opt-version').checked, url: $('opt-url').checked, desc: $('opt-desc').checked };
    }

    function getColumns() {
        const n = state.sites.length;
        const o = opts();
        const cols = [];
        if (n >= 2) cols.push({ key: 'status', label: t('col.status'), sortable: true });
        cols.push({ key: 'name', label: t('col.name'), sortable: true });
        cols.push({ key: 'kind', label: t('col.kind'), sortable: true });
        if (o.version) {
            if (n === 2) {
                cols.push({ key: 'baseVersion', label: t('col.baseVersion'), sortable: true });
                cols.push({ key: 'targetVersion', label: t('col.targetVersion'), sortable: true });
            } else if (n > 2) {
                state.sites.forEach((s, i) => cols.push({ key: `v${i}`, label: s.label, sortable: true, site: i }));
            } else {
                cols.push({ key: 'version', label: t('col.version'), sortable: true });
            }
        }
        if (o.url) cols.push({ key: 'url', label: 'URL', sortable: false });
        if (o.desc) cols.push({ key: 'description', label: t('col.description'), sortable: false });
        return cols;
    }

    const valueOf = (row, key) => /^v\d+$/.test(key) ? row.versions[Number(key.slice(1))] : row[key];

    function visibleRows() {
        let data = state.rows.filter(r => matchesQuery(r, state.query));
        if (state.sites.length >= 2 && state.filter !== 'ALL') {
            data = data.filter(r => state.filter === 'MISMATCH' ? r.mismatch : r.status === state.filter);
        }
        return data;
    }

    function sorted(data, columns) {
        const sort = columns.some(c => c.key === state.sort.key && c.sortable) ? state.sort : { key: 'name', dir: 'asc' };
        const factor = sort.dir === 'asc' ? 1 : -1;
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const out = [...data].sort((a, b) => {
            const x = valueOf(a, sort.key) || '', y = valueOf(b, sort.key) || '';
            if (!x && y) return 1;      // empty values always last
            if (x && !y) return -1;
            return (collator.compare(x, y) * factor) || collator.compare(a.name, b.name);
        });
        return { data: out, sort };
    }

    function cellHtml(row, col) {
        if (col.key === 'status') {
            const s = STATUS[row.status] || STATUS.COMMON;
            return `<span class="cdx-info-chip${s.chip}"><span class="cdx-info-chip__text">${escapeHtml(statusLabel(row.status))}</span></span>`;
        }
        if (col.key === 'kind') return t(row.kind === 'skin' ? 'kind.skin' : 'kind.extension');
        if (col.key === 'url') {
            if (!row.url) return '<span class="cell-muted">-</span>';
            const href = safeHref(row.url);
            return href
                ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(href)}">Link</a>`
                : escapeHtml(row.url);
        }
        if (col.site !== undefined && !row.present[col.site]) return '×';
        const v = valueOf(row, col.key);
        return v ? escapeHtml(v) : '<span class="cell-muted">-</span>';
    }

    function cellClass(row, col) {
        if (col.site === undefined) return '';
        if (!row.present[col.site]) return ' class="matrix-cell--missing"';
        return row.mismatch ? ' class="matrix-cell--mismatch"' : '';
    }

    function headerHtml(col) {
        if (!col.sortable) return `<th scope="col">${escapeHtml(col.label)}</th>`;
        const a = state.sortApplied;
        const active = a && a.key === col.key;
        const ariaSort = active ? (a.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        const icon = active ? `cdx-table__table__sort-icon--${a.dir}` : 'cdx-table__table__sort-icon--unsorted';
        return `<th scope="col" class="cdx-table__table__cell--has-sort" aria-sort="${ariaSort}">
            <button type="button" class="cdx-table__table__sort-button" data-action="sort" data-key="${col.key}" data-focus-id="sort-${col.key}">
                <span>${escapeHtml(col.label)}</span><span class="cdx-table__table__sort-icon ${icon}" aria-hidden="true"></span>
            </button></th>`;
    }

    /* ---------- export ---------- */

    function tableFor(rows, columns) {
        return {
            headers: columns.map(c => c.label),
            rows: rows.map(r => columns.map(c => {
                if (c.key === 'status') return STATUS[r.status].csv;
                if (c.key === 'kind') return r.kind;
                if (c.key === 'url') return r.url ? { text: 'Link', href: r.url } : null;
                if (c.site !== undefined && !r.present[c.site]) return '';
                return valueOf(r, c.key);
            }))
        };
    }

    function doExport(format, scope) {
        if (!state.rows.length) return;
        let rows = visibleRows();
        let prefix = state.sites.length >= 2 ? 'extensions_comparison' : 'extensions_list';
        if (scope === 'MISSING' || scope === 'EXTRA') {
            rows = state.rows.filter(r => r.status === scope);
            prefix = scope === 'MISSING' ? 'extensions_missing' : 'extensions_extra';
        }
        if (!rows.length) return;
        const columns = getColumns();
        const table = tableFor(sorted(rows, columns).data, columns);
        const stamp = getTimestamp();
        if (format === 'csv') downloadFile(toCsv(table), `${prefix}_${stamp}.csv`, 'text/csv', true);
        else if (format === 'wiki') downloadFile(toWikitable(table, state.sites.map(s => s.label).join(' / ')), `${prefix}_${stamp}.wikitext`, 'text/plain');
        else if (format === 'md') downloadFile(toMarkdownTable(table), `${prefix}_${stamp}.md`, 'text/markdown');
    }

    /* ---------- render ---------- */

    function countByStatus() {
        const counts = { ALL: state.rows.length, MISMATCH: 0 };
        for (const r of state.rows) {
            counts[r.status] = (counts[r.status] || 0) + 1;
            if (r.mismatch) counts.MISMATCH++;
        }
        return counts;
    }

    function render() {
        const active = document.activeElement;
        const focusId = active && container.contains(active) ? active.dataset.focusId : null;
        container.innerHTML = build();
        if (focusId) container.querySelector(`[data-focus-id="${focusId}"]`)?.focus();
    }

    function build() {
        const n = state.sites.length;
        if (!n) return '';
        if (!state.rows.length) {
            return `<div class="cdx-message"><span class="cdx-message__icon" aria-hidden="true"></span><div class="cdx-message__content">${escapeHtml(t('compare.noResults'))}</div></div>`;
        }

        const columns = getColumns();
        const { data, sort } = sorted(visibleRows(), columns);
        state.sortApplied = sort;
        const counts = countByStatus();

        const filters = n === 2 ? FILTERS_2 : FILTERS_N;
        const filterHtml = n < 2 ? '' : `
            <div class="cdx-field" role="group" aria-labelledby="filter-label">
                <div class="cdx-label"><span id="filter-label" class="cdx-label__label__text">${escapeHtml(t('compare.filter'))}</span></div>
                <div class="cdx-toggle-button-group">
                    ${filters.map(key => `<button type="button"
                        class="cdx-toggle-button cdx-toggle-button--framed${state.filter === key ? ' cdx-toggle-button--toggled-on' : ''}"
                        aria-pressed="${state.filter === key}" data-action="filter" data-filter="${key}" data-focus-id="filter-${key}">${escapeHtml(filterLabel(key, n))} (${counts[key] || 0})</button>`).join('')}
                </div>
            </div>`;

        const exportBtn = (format, scope, label, disabled = false) =>
            `<button type="button" class="cdx-button" data-action="export" data-format="${format}" data-scope="${scope}"${disabled ? ' disabled' : ''}>${label}</button>`;
        const exportHtml = `
            <div class="cdx-field" role="group" aria-labelledby="export-label">
                <div class="cdx-label"><span id="export-label" class="cdx-label__label__text">${escapeHtml(t('compare.export'))}</span></div>
                <div class="button-row">
                    ${exportBtn('csv', 'VISIBLE', 'CSV')}
                    ${exportBtn('wiki', 'VISIBLE', 'wikitable')}
                    ${exportBtn('md', 'VISIBLE', 'Markdown')}
                    ${n === 2 ? exportBtn('csv', 'MISSING', t('compare.exportMissing'), !counts.MISSING) + exportBtn('csv', 'EXTRA', t('compare.exportExtra'), !counts.EXTRA) : ''}
                </div>
                <div class="cdx-field__help-text">${escapeHtml(t('compare.exportHelp'))}</div>
            </div>`;

        const searchHtml = `
            <div class="cdx-field">
                <div class="cdx-label"><label class="cdx-label__label" for="compare-search"><span class="cdx-label__label__text">${escapeHtml(t('common.search'))}</span></label></div>
                <div class="cdx-text-input cdx-text-input--search"><input id="compare-search" class="cdx-text-input__input" type="search" autocomplete="off"
                    placeholder="${escapeHtml(t('compare.searchPlaceholder'))}" value="${escapeHtml(state.query)}" data-focus-id="search"></div>
            </div>`;

        const rowsHtml = data.length === 0
            ? `<tr><td class="cdx-table__table__empty-state-content" colspan="${columns.length}">${escapeHtml(t('compare.noMatch'))}</td></tr>`
            : data.map(r => `<tr>${columns.map(c => `<td${cellClass(r, c)}>${cellHtml(r, c)}</td>`).join('')}</tr>`).join('');

        return `
            <div class="panel">
                <div class="toolbar">${searchHtml}${filterHtml}</div>
                <div class="toolbar" style="margin-top:16px">${exportHtml}</div>
            </div>
            <div class="cdx-table">
                <div class="cdx-table__header">
                    <div class="cdx-table__header__title">
                        <h2>${escapeHtml(t('compare.results'))}</h2>
                        <span class="cdx-table__header__count">${escapeHtml(t('common.showing', { shown: data.length, total: state.rows.length }))}</span>
                    </div>
                </div>
                <div class="cdx-table__table-wrapper">
                    <table class="cdx-table__table">
                        <caption>${escapeHtml(t('compare.caption'))}</caption>
                        <thead><tr>${columns.map(headerHtml).join('')}</tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>`;
    }

    container.addEventListener('click', e => {
        const button = e.target.closest('button[data-action]');
        if (!button || button.disabled) return;
        switch (button.dataset.action) {
            case 'sort': {
                const key = button.dataset.key;
                const cur = state.sortApplied || state.sort;
                state.sort = cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
                render();
                break;
            }
            case 'filter':
                state.filter = button.dataset.filter;
                render();
                break;
            case 'export':
                doExport(button.dataset.format, button.dataset.scope);
                break;
        }
    });

    container.addEventListener('input', e => {
        if (e.target.id !== 'compare-search') return;
        state.query = e.target.value;
        const pos = e.target.selectionStart;
        render();
        const input = $('compare-search');
        input.focus();
        input.setSelectionRange(pos, pos);
    });

    return {
        update(sites) {
            state.sites = sites;
            state.rows = sites.length ? compareSites(sites) : [];
            state.filter = 'ALL';
            state.sort = { key: 'name', dir: 'asc' };
            render();
        },
        refresh: render
    };
}
