// Portability tab: can Site A's configuration be moved to Site B? Fetches manifests/metadata, then analyzes.

import { escapeHtml, downloadFile, getTimestamp } from '../util.js';
import { siteItems, matchesQuery } from '../core/compare.js';
import { analyzePortability, neededManifestNames, portabilityTable, VERDICT, verdictLabel } from '../core/portability.js';
import { localSettingsSnippet, gitCloneSnippet, composerNote, planMarkdown } from '../core/snippets.js';
import { toCsv, toWikitable } from '../core/export.js';
import { getManifests, setManualManifest, setManualManifestFromUrl } from '../api/manifest.js';
import { fetchMeta } from '../api/mworg.js';
import { t, tr, joinList } from '../i18n.js';

function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { throw new Error(t('manual.badJson', { error: e.message })); }
}

const VERDICT_FILTERS = ['ALL', 'INCOMPATIBLE', 'NEEDS_DEPS', 'INSTALLABLE', 'UNKNOWN', 'INSTALLED'];
const MAX_ROUNDS = 8;

export function createPortabilityView(container, { announce = () => {} } = {}) {
    const state = {
        sites: [], a: 0, b: 1, running: false, progress: null, error: null,
        result: null, ctx: null, filter: 'ALL', query: ''
    };
    // In-memory cache so re-running (or adding a manual manifest) doesn't refetch: key = `${branch}`
    const manifestCache = new Map();

    const siteA = () => state.sites[state.a];
    const siteB = () => state.sites[state.b];

    /* ---------- analysis pipeline ---------- */

    async function run() {
        const A = siteA(), B = siteB();
        if (!A || !B || state.running) return;
        state.running = true;
        state.error = null;
        state.result = null;
        const branch = B.branch || 'master';
        state.progress = { key: 'port.progressManifests', branch, done: 0, total: 1 };
        shell();

        try {
            const manifests = manifestCache.get(branch) || {};
            manifestCache.set(branch, manifests);
            const kinds = new Map(siteItems(A).map(i => [i.name, i]));

            for (let round = 0; round < MAX_ROUNDS; round++) {
                const names = neededManifestNames(A, B, manifests);
                if (!names.length) break;
                const items = names.map(n => kinds.get(n) || { name: n, kind: 'extension' });
                state.progress = { key: 'port.progressManifests', branch, done: 0, total: items.length };
                updateProgress();
                const fetched = await getManifests(items, branch, (done, total) => {
                    state.progress = { ...state.progress, done, total };
                    updateProgress();
                });
                for (const [name, m] of Object.entries(fetched)) {
                    manifests[name] = m;
                    if (!m) continue;
                    for (const d of Object.keys(m.requires.extensions)) if (!kinds.has(d)) kinds.set(d, { name: d, kind: 'extension' });
                    for (const d of Object.keys(m.requires.skins)) if (!kinds.has(d)) kinds.set(d, { name: d, kind: 'skin' });
                }
            }

            state.progress = { key: 'port.progressMeta', done: 0, total: 1 };
            updateProgress();
            const meta = await fetchMeta(Object.keys(manifests).map(n => kinds.get(n)).filter(Boolean));

            state.ctx = { manifests, meta };
            state.filter = 'ALL';
            state.result = analyzePortability(A, B, manifests, meta);
            announce(t('port.done', { bad: state.result.counts.INCOMPATIBLE, ok: state.result.counts.INSTALLABLE + state.result.counts.NEEDS_DEPS }));
        } catch (err) {
            console.error(err);
            state.error = t('port.failed', { error: err.message });
        } finally {
            state.running = false;
            state.progress = null;
            shell();
        }
    }

    function reanalyze() {
        state.result = analyzePortability(siteA(), siteB(), state.ctx.manifests, state.ctx.meta);
        shell();
    }

    const progressText = p => `${t(p.key, { branch: p.branch })} ${p.done} / ${p.total}`;

    function updateProgress() {
        const p = state.progress;
        const bar = container.querySelector('.progress');
        if (!p || !bar) return;
        bar.setAttribute('aria-valuenow', p.done);
        bar.setAttribute('aria-valuemax', p.total);
        bar.firstElementChild.style.width = `${(100 * p.done / Math.max(1, p.total)).toFixed(0)}%`;
        bar.nextElementSibling.textContent = progressText(p);
    }

    /* ---------- rendering ---------- */

    const unknown = t0 => t0 ?? t('common.unknown');
    const siteLine = s => escapeHtml(t('port.siteLine', { label: s.label, mw: unknown(s.mwVersion), php: unknown(s.php), branch: unknown(s.branch) }));
    const errorBox = text => `<div class="cdx-message cdx-message--error" role="alert"><span class="cdx-message__icon" aria-hidden="true"></span><div class="cdx-message__content">${escapeHtml(text)}</div></div>`;

    function shell() {
        if (state.sites.length < 2) {
            container.innerHTML = `<div class="cdx-message"><span class="cdx-message__icon" aria-hidden="true"></span><div class="cdx-message__content">${escapeHtml(t('port.needTwo'))}</div></div>`;
            return;
        }
        const options = sel => state.sites.map((s, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
        const A = siteA(), B = siteB();

        container.innerHTML = `
            <div class="panel">
                <div class="toolbar">
                    <div class="cdx-field"><div class="cdx-label"><label class="cdx-label__label" for="p-a"><span class="cdx-label__label__text">${escapeHtml(t('port.source'))}</span></label></div><select id="p-a" class="select">${options(state.a)}</select></div>
                    <div class="cdx-field" aria-hidden="true" style="align-self:flex-end;padding-bottom:4px">→</div>
                    <div class="cdx-field"><div class="cdx-label"><label class="cdx-label__label" for="p-b"><span class="cdx-label__label__text">${escapeHtml(t('port.dest'))}</span></label></div><select id="p-b" class="select">${options(state.b)}</select></div>
                    <div class="cdx-field"><button type="button" id="p-run" class="cdx-button cdx-button--action-progressive cdx-button--weight-primary"${state.running || state.a === state.b ? ' disabled' : ''}>${escapeHtml(t(state.result ? 'port.rerun' : 'port.run'))}</button></div>
                </div>
                <p class="cdx-field__help-text">A: ${siteLine(A)}<br>B: ${siteLine(B)}</p>
                <p class="cdx-field__help-text">${escapeHtml(t('port.help', { branch: B.branch || 'master' }))}</p>
                ${state.a === state.b ? `<p class="note">${escapeHtml(t('port.sameSite'))}</p>` : ''}
                ${!B.mwVersion ? errorBox(t('port.noVersion')) : ''}
                ${state.running && state.progress ? `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${state.progress.total}" aria-valuenow="${state.progress.done}"><span style="width:0%"></span></div><div class="note">${escapeHtml(progressText(state.progress))}</div>` : ''}
                ${state.error ? errorBox(state.error) : ''}
            </div>
            <div id="p-result"></div>`;
        if (state.result) result();
    }

    function filteredRows() {
        return [...state.result.rows]
            .filter(r => (state.filter === 'ALL' || r.verdict === state.filter) && matchesQuery({ name: r.name, description: '' }, state.query))
            .sort((x, y) => VERDICT[x.verdict].order - VERDICT[y.verdict].order || x.name.localeCompare(y.name));
    }

    function result() {
        const r = state.result, B = siteB();
        const el = container.querySelector('#p-result');
        const none = escapeHtml(t('common.none'));
        const code = (title, id, text) => `
            <div>
                <div class="code-block__head"><h3>${escapeHtml(title)}</h3><button type="button" class="cdx-button cdx-button--small" data-copy="${id}">${escapeHtml(t('port.copy'))}</button></div>
                <pre class="code" id="${id}">${escapeHtml(text)}</pre>
            </div>`;
        const mono = items => `<span class="mono">${items.map(escapeHtml).join(' ')}</span>`;
        const c = r.content;
        const unknownNames = r.rows.filter(x => x.verdict === 'UNKNOWN').map(x => x.name);
        const providerNote = (c.missingTags.length || c.missingFunctions.length)
            ? `<p class="note">${escapeHtml(t('content.note'))}${c.providerCandidates.length ? `<br>${escapeHtml(t('content.providers', { names: c.providerCandidates.join(', ') }))}` : ''}</p>` : '';
        const skinLine = c.missingSkins.length ? joinList(c.missingSkins.map(k => escapeHtml(k.name))) : none;
        const defaultSkin = c.defaultSkinDiffers ? escapeHtml(t('content.defaultSkin', { a: c.defaultSkins.a, b: c.defaultSkins.b })) : '';
        const chip = (text, cls = '') => `<span class="cdx-info-chip${cls}"><span class="cdx-info-chip__text">${escapeHtml(text)}</span></span>`;

        el.innerHTML = `
            <div class="panel">
                <div class="stat-row">
                    ${Object.keys(VERDICT).map(k => chip(`${VERDICT[k].icon} ${verdictLabel(k)} ${r.counts[k]}`, k === 'INCOMPATIBLE' && r.counts[k] ? ' cdx-info-chip--error' : '')).join('')}
                </div>
                <div class="toolbar" style="margin-top:12px">
                    <div class="cdx-field" role="group" aria-labelledby="p-filter-label">
                        <div class="cdx-label"><span id="p-filter-label" class="cdx-label__label__text">${escapeHtml(t('port.filter'))}</span></div>
                        <div class="cdx-toggle-button-group">${VERDICT_FILTERS.map(k => `<button type="button" class="cdx-toggle-button cdx-toggle-button--framed${state.filter === k ? ' cdx-toggle-button--toggled-on' : ''}" aria-pressed="${state.filter === k}" data-pfilter="${k}">${escapeHtml(k === 'ALL' ? t('filter2.ALL') : `${verdictLabel(k)} (${r.counts[k]})`)}</button>`).join('')}</div>
                    </div>
                    <div class="cdx-field">
                        <div class="cdx-label"><label class="cdx-label__label" for="p-search"><span class="cdx-label__label__text">${escapeHtml(t('common.search'))}</span></label></div>
                        <div class="cdx-text-input cdx-text-input--search"><input id="p-search" class="cdx-text-input__input" type="search" autocomplete="off" placeholder="${escapeHtml(t('port.searchPlaceholder'))}" value="${escapeHtml(state.query)}"></div>
                    </div>
                </div>
            </div>
            <div class="cdx-table">
                <div class="cdx-table__header"><div class="cdx-table__header__title"><h2>${escapeHtml(t('port.tableTitle'))}</h2><span class="cdx-table__header__count" id="p-count"></span></div></div>
                <div class="cdx-table__table-wrapper"><table class="cdx-table__table cdx-table__table--compact">
                    <caption>${escapeHtml(t('port.tableCaption'))}</caption>
                    <thead><tr><th scope="col">${escapeHtml(t('port.colVerdict'))}</th><th scope="col">${escapeHtml(t('col.name'))}</th><th scope="col">A</th><th scope="col">B</th><th scope="col">${escapeHtml(t('port.colDetails'))}</th></tr></thead>
                    <tbody id="p-rows"></tbody>
                </table></div>
            </div>
            <div class="panel">
                <h3 class="section-title">${escapeHtml(t('port.planTitle', { n: r.plan.length }))}</h3>
                ${r.plan.length ? `<ol class="steps">${r.plan.map(p => `<li>${escapeHtml(p.name)}${p.addedAsDependency ? ` <span class="cell-muted">${escapeHtml(t('port.planDep'))}</span>` : ''}${p.bundledIn ? ` <span class="cell-muted">${escapeHtml(t('port.planBundled', { version: p.bundledIn }))}</span>` : ''}</li>`).join('')}</ol>` : `<p>${escapeHtml(t('port.planNone'))}</p>`}
                ${r.cyclic.length ? errorBox(t('port.cycle', { names: r.cyclic.join(', ') })) : ''}
            </div>
            <div class="panel">
                <h3 class="section-title">${escapeHtml(t('content.title'))}</h3>
                <p><strong>${escapeHtml(t('content.missingTagsN', { n: c.missingTags.length }))}</strong>: ${c.missingTags.length ? mono(c.missingTags) : none}</p>
                <p><strong>${escapeHtml(t('content.missingFunctionsN', { n: c.missingFunctions.length }))}</strong>: ${c.missingFunctions.length ? mono(c.missingFunctions) : none}</p>
                ${providerNote}
                <p><strong>${escapeHtml(t('content.missingSkinsN', { n: c.missingSkins.length }))}</strong>: ${skinLine}${defaultSkin}</p>
                <p><strong>${escapeHtml(t('content.missingGroupsN', { n: c.missingGroups.length }))}</strong>: ${c.missingGroups.length ? mono(c.missingGroups) : none}</p>
                <p><strong>${escapeHtml(t('content.nsConflictsN', { n: c.namespaceConflicts.length }))}</strong>: ${c.namespaceConflicts.length ? joinList(c.namespaceConflicts.map(n => escapeHtml(t('content.nsConflict', { id: n.id, a: n.a, b: n.b })))) : none}</p>
                <p><strong>${escapeHtml(t('content.nsOnlyAN', { n: c.namespacesOnlyInA.length }))}</strong>: ${c.namespacesOnlyInA.length ? joinList(c.namespacesOnlyInA.map(n => `${n.id} ${escapeHtml(n.name)}`)) : none} <span class="note">${escapeHtml(t('content.nsOnlyAHint'))}</span></p>
            </div>
            <div class="panel">
                <h3 class="section-title">${escapeHtml(t('port.snippets'))}</h3>
                ${code('LocalSettings.php', 'snip-ls', localSettingsSnippet(r.plan) + (composerNote(r.libraries) ? '\n\n' + composerNote(r.libraries) : ''))}
                <div style="margin-top:16px">${code('git', 'snip-git', gitCloneSnippet(r.plan, B))}</div>
                <p class="note">${escapeHtml(t('port.snippetsNote'))}</p>
            </div>
            <div class="panel">
                <h3 class="section-title">${escapeHtml(t('compare.export'))}</h3>
                <div class="button-row">
                    <button type="button" class="cdx-button" data-pexport="csv">${escapeHtml(t('port.exportCsv'))}</button>
                    <button type="button" class="cdx-button" data-pexport="wiki">${escapeHtml(t('port.exportWiki'))}</button>
                    <button type="button" class="cdx-button" data-pexport="md">${escapeHtml(t('port.exportMd'))}</button>
                </div>
            </div>
            ${unknownNames.length ? `
            <details class="section panel">
                <summary>${escapeHtml(t('manual.summary', { n: unknownNames.length }))}</summary>
                <p class="cdx-field__help-text">${escapeHtml(t('manual.help'))}</p>
                <div class="cdx-field"><label class="cdx-label__label__text" for="p-manual-name">${escapeHtml(t('manual.target'))}</label>
                    <select id="p-manual-name" class="select">${unknownNames.map(n => `<option>${escapeHtml(n)}</option>`).join('')}</select></div>
                <div class="cdx-field"><label class="cdx-label__label__text" for="p-manual-url">${escapeHtml(t('manual.fromUrl'))}</label>
                    <div class="input-group"><div class="cdx-text-input"><input id="p-manual-url" class="cdx-text-input__input" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://raw.githubusercontent.com/…/extension.json"></div>
                    <button type="button" id="p-manual-fetch" class="cdx-button">${escapeHtml(t('manual.fetch'))}</button></div></div>
                <div class="cdx-field"><label class="cdx-label__label__text" for="p-manual-json">${escapeHtml(t('manual.orPaste'))}</label>
                    <textarea id="p-manual-json" class="dialog__textarea" rows="6" spellcheck="false"></textarea></div>
                <div id="p-manual-error" class="cdx-message cdx-message--error" role="alert" hidden><span class="cdx-message__icon" aria-hidden="true"></span><div class="cdx-message__content"></div></div>
                <button type="button" id="p-manual-add" class="cdx-button" style="margin-top:8px">${escapeHtml(t('manual.add'))}</button>
            </details>` : ''}
            <p class="note">${escapeHtml(t('port.limits'))}</p>`;

        rows();
    }

    function rows() {
        const tbody = container.querySelector('#p-rows');
        if (!tbody || !state.result) return;
        const list = filteredRows();
        container.querySelector('#p-count').textContent = t('common.showing', { shown: list.length, total: state.result.rows.length });
        const verdictChip = v => `<span class="verdict verdict--${v}"><span class="cdx-info-chip"><span class="cdx-info-chip__text">${VERDICT[v].icon} ${escapeHtml(verdictLabel(v))}</span></span></span>`;
        tbody.innerHTML = list.length ? list.map(row => {
            const notes = [
                row.reasons.length ? `<ul class="reason-list">${row.reasons.map(x => `<li>${escapeHtml(tr(x))}</li>`).join('')}</ul>` : '',
                row.missingDeps.length ? `<div>${escapeHtml(t('port.needsExtra', { names: row.missingDeps.join(', ') }))}</div>` : '',
                row.warnings.length ? `<ul class="reason-list reason-list--warn">${row.warnings.map(x => `<li>⚠ ${escapeHtml(tr(x))}</li>`).join('')}</ul>` : '',
                row.verdict === 'INSTALLED' && row.versionRelation !== 'same' && row.versionRelation !== 'unknown'
                    ? `<div class="note">${escapeHtml(t(row.versionRelation === 'newer' ? 'port.bNewer' : 'port.bOlder'))}</div>` : ''
            ].join('');
            return `<tr>
                <td>${verdictChip(row.verdict)}</td>
                <td>${escapeHtml(row.name)}${row.kind === 'skin' ? ` <span class="cell-muted">(${escapeHtml(t('kind.skin'))})</span>` : ''}</td>
                <td class="num">${escapeHtml(row.versionA ?? '-')}</td>
                <td class="num">${escapeHtml(row.versionB ?? '-')}</td>
                <td>${notes || '<span class="cell-muted">-</span>'}</td>
            </tr>`;
        }).join('') : `<tr><td class="cdx-table__table__empty-state-content" colspan="5">${escapeHtml(t('compare.noMatch'))}</td></tr>`;
    }

    /* ---------- exports / events ---------- */

    function doExport(format) {
        const r = state.result;
        if (!r) return;
        const stamp = getTimestamp();
        const table = portabilityTable(r);
        if (format === 'csv') downloadFile(toCsv(table), `portability_${stamp}.csv`, 'text/csv', true);
        else if (format === 'wiki') downloadFile(toWikitable(table, `${siteA().label} → ${siteB().label}`), `portability_${stamp}.wikitext`, 'text/plain');
        else if (format === 'md') downloadFile(planMarkdown({ siteA: siteA(), siteB: siteB(), result: r }), `portability_plan_${stamp}.md`, 'text/markdown');
    }

    async function copy(id, button) {
        const text = container.querySelector(`#${id}`)?.textContent ?? '';
        try {
            await navigator.clipboard.writeText(text);
            button.textContent = t('port.copied');
        } catch (e) {
            // Clipboard API unavailable (insecure context / denied): select the text so Ctrl+C works.
            const range = document.createRange();
            range.selectNodeContents(container.querySelector(`#${id}`));
            const sel = getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            button.textContent = t('port.selected');
        }
        setTimeout(() => { button.textContent = t('port.copy'); }, 1800);
    }

    container.addEventListener('click', e => {
        const target = e.target;
        if (target.closest('#p-run')) return void run();
        const f = target.closest('[data-pfilter]');
        if (f) { state.filter = f.dataset.pfilter; return void result(); }
        const x = target.closest('[data-pexport]');
        if (x) return void doExport(x.dataset.pexport);
        const c = target.closest('[data-copy]');
        if (c) return void copy(c.dataset.copy, c);
        const addBtn = target.closest('#p-manual-add, #p-manual-fetch');
        if (addBtn) {
            const name = container.querySelector('#p-manual-name').value;
            const box = container.querySelector('#p-manual-error');
            (async () => {
                try {
                    const m = addBtn.id === 'p-manual-fetch'
                        ? await setManualManifestFromUrl(name, container.querySelector('#p-manual-url').value.trim())
                        : setManualManifest(name, parseJson(container.querySelector('#p-manual-json').value));
                    state.ctx.manifests[name] = m;
                    for (const cache of manifestCache.values()) cache[name] = m;
                    reanalyze();
                } catch (err) {
                    box.querySelector('.cdx-message__content').textContent = err.message;
                    box.hidden = false;
                }
            })();
        }
    });

    container.addEventListener('change', e => {
        if (e.target.id === 'p-a') { state.a = Number(e.target.value); state.result = null; shell(); }
        if (e.target.id === 'p-b') { state.b = Number(e.target.value); state.result = null; shell(); }
    });

    container.addEventListener('input', e => {
        if (e.target.id !== 'p-search') return;
        state.query = e.target.value;
        rows();
    });

    return {
        update(sites) {
            state.sites = sites;
            state.a = 0;
            state.b = Math.min(1, Math.max(0, sites.length - 1));
            state.result = null;
            state.error = null;
            shell();
        },
        /** Pre-select A/B (used by shareable URLs). */
        select(a, b) {
            if (state.sites[a]) state.a = a;
            if (state.sites[b]) state.b = b;
            shell();
        },
        get selection() { return { a: state.a, b: state.b }; },
        /** Re-render in place (language/theme change); the analysis result is kept and re-translated. */
        refresh: shell
    };
}
