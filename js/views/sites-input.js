// The list of site rows (URL text, or a site loaded from a snapshot / pasted JSON).

import { $, escapeHtml, normalizeUrl } from '../util.js';
import { parseSiteJson } from '../store/snapshot.js';
import { siteInfoUrl } from '../api/siteinfo.js';
import { t } from '../i18n.js';

const ICON_EXTERNAL = 'var(--icon-link-external)';

const roleLabel = i => i === 0 ? t('sites.roleBase') : i === 1 ? t('sites.roleTarget') : t('sites.roleOther', { n: i + 1 });

/**
 * @param {HTMLElement} container
 * @param {{ onError: (message: string) => void }} hooks
 * @returns {{ getRows(): {url: string, site: object|null}[], setRows(rows): void, setUrl(i, url): void, refresh(): void }}
 */
export function createSitesInput(container, { onError }) {
    /** @type {{url: string, site: object|null}[]} */
    let rows = [];
    let pasteIndex = null;
    let loadIndex = null;

    const dialog = $('paste-dialog');
    const fileInput = $('file-input');

    function render() {
        container.innerHTML = rows.map((row, i) => {
            const pinned = !!row.site;
            const source = pinned ? (row.site.source === 'snapshot' ? t('sites.sourceSnapshot') : t('sites.sourcePaste')) : '';
            const status = pinned
                ? t('sites.loaded', { label: escapeHtml(row.site.label), source, n: row.site.extensions.length })
                : (i === 1 && !row.url ? t('sites.compareHint') : '');
            return `
            <div class="site-row cdx-field" data-index="${i}">
                <div class="cdx-label">
                    <label class="cdx-label__label" for="site-url-${i}"><span class="cdx-label__label__text">${escapeHtml(roleLabel(i))}</span>${i > 0 ? `<span class="cdx-label__label__optional-flag"> ${escapeHtml(t('sites.optional'))}</span>` : ''}</label>
                </div>
                <div class="input-group">
                    <div class="cdx-text-input">
                        <input id="site-url-${i}" class="cdx-text-input__input" type="text" inputmode="url" autocomplete="off" spellcheck="false"
                            placeholder="${escapeHtml(i === 0 ? t('sites.placeholderBase') : t('sites.placeholderTarget'))}"
                            value="${escapeHtml(pinned ? `(${row.site.label})` : row.url)}" ${pinned ? 'readonly' : ''} data-input="${i}">
                    </div>
                    <button class="cdx-button cdx-button--icon-only" type="button" data-act="open" data-i="${i}" aria-label="${escapeHtml(t('sites.openUrl'))}" title="${escapeHtml(t('sites.openUrl'))}" ${(!row.url && !pinned) || pinned ? 'disabled' : ''}>
                        <span class="cdx-icon-mask" style="--icon: ${ICON_EXTERNAL}" aria-hidden="true"></span>
                    </button>
                </div>
                <div class="site-row__actions">
                    <button type="button" class="cdx-button cdx-button--small" data-act="load" data-i="${i}">${escapeHtml(t('sites.loadSnapshot'))}</button>
                    <button type="button" class="cdx-button cdx-button--small" data-act="paste" data-i="${i}">${escapeHtml(t('sites.pasteJson'))}</button>
                    ${pinned ? `<button type="button" class="cdx-button cdx-button--small" data-act="unpin" data-i="${i}">${escapeHtml(t('sites.backToUrl'))}</button>` : ''}
                    ${rows.length > 1 ? `<button type="button" class="cdx-button cdx-button--small cdx-button--quiet" data-act="remove" data-i="${i}">${escapeHtml(t('sites.remove'))}</button>` : ''}
                </div>
                ${status ? `<div class="cdx-field__help-text">${status}</div>` : ''}
            </div>`;
        }).join('');
    }

    container.addEventListener('input', e => {
        const input = e.target.closest('input[data-input]');
        if (!input) return;
        const i = Number(input.dataset.input);
        rows[i].url = input.value;
        const open = container.querySelector(`button[data-act="open"][data-i="${i}"]`);
        if (open) open.disabled = !input.value.trim();
    });

    container.addEventListener('click', e => {
        const btn = e.target.closest('button[data-act]');
        if (!btn || btn.disabled) return;
        const i = Number(btn.dataset.i);
        switch (btn.dataset.act) {
            case 'open':
                try {
                    window.open(normalizeUrl(rows[i].url).href, '_blank', 'noopener,noreferrer');
                } catch (err) {
                    onError(err.message);
                }
                break;
            case 'remove':
                rows.splice(i, 1);
                render();
                break;
            case 'unpin':
                rows[i] = { url: rows[i].site.apiUrl || '', site: null };
                render();
                break;
            case 'load':
                loadIndex = i;
                fileInput.value = '';
                fileInput.click();
                break;
            case 'paste':
                openPaste(i);
                break;
        }
    });

    $('add-site').addEventListener('click', () => {
        rows.push({ url: '', site: null });
        render();
        container.querySelector(`#site-url-${rows.length - 1}`)?.focus();
    });

    /* ---------- snapshot file ---------- */

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file || loadIndex === null) return;
        try {
            const site = parseSiteJson(await file.text());
            rows[loadIndex] = { url: site.apiUrl || '', site };
            render();
        } catch (err) {
            onError(`${file.name}: ${err.message}`);
        }
        loadIndex = null;
    });

    // Drag & drop a snapshot onto a row.
    container.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    container.addEventListener('drop', async e => {
        const file = e.dataTransfer?.files?.[0];
        const row = e.target.closest('.site-row');
        if (!file || !row) return;
        e.preventDefault();
        const i = Number(row.dataset.index);
        try {
            const site = parseSiteJson(await file.text());
            rows[i] = { url: site.apiUrl || '', site };
            render();
        } catch (err) {
            onError(`${file.name}: ${err.message}`);
        }
    });

    /* ---------- paste dialog ---------- */

    function openPaste(i) {
        pasteIndex = i;
        $('paste-text').value = '';
        $('paste-label').value = '';
        $('paste-error').hidden = true;
        const link = $('paste-open');
        try {
            const url = rows[i].url.trim() ? siteInfoUrl(rows[i].url) : null;
            link.hidden = !url;
            link.href = url || '#';
            link.textContent = url ? t('paste.openLink') : '';
        } catch (e) {
            link.hidden = true;
        }
        dialog.showModal();
        $('paste-text').focus();
    }

    $('paste-form').addEventListener('submit', e => {
        e.preventDefault();
        try {
            const site = parseSiteJson($('paste-text').value, { label: $('paste-label').value.trim() || null });
            if (!site.apiUrl && rows[pasteIndex].url.trim()) {
                try { site.apiUrl = normalizeUrl(rows[pasteIndex].url).href; } catch (err) { /* keep null */ }
            }
            rows[pasteIndex] = { url: site.apiUrl || rows[pasteIndex].url, site };
            dialog.close();
            render();
        } catch (err) {
            const box = $('paste-error');
            box.querySelector('.cdx-message__content').textContent = err.message;
            box.hidden = false;
        }
    });
    $('paste-cancel').addEventListener('click', () => dialog.close());

    return {
        getRows: () => rows,
        setRows(next) { rows = next.length ? next : [{ url: '', site: null }]; render(); },
        setUrl(i, url) {
            if (rows[i] && !rows[i].site) {
                rows[i].url = url;
                const input = container.querySelector(`#site-url-${i}`);
                if (input) input.value = url;
            }
        },
        /** Re-render (e.g. after a language change); keeps the typed URLs. */
        refresh: render
    };
}
