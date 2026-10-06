// Tabular exporters. A table is { headers: string[], rows: Cell[][] } where Cell is a string/number/null
// or { text, href } for a link.

const cellText = c => (c && typeof c === 'object') ? (c.text ?? c.href ?? '') : (c ?? '');

export function escapeCsv(value) {
    if (value === null || value === undefined) return '';
    let str = String(value);
    // Neutralise spreadsheet formula injection (values come from remote wikis)
    if (/^[=+\-@\t\r]/.test(str) && !/^[-+]?\d+(\.\d+)?$/.test(str)) {
        str = "'" + str;
    }
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsv({ headers, rows }) {
    return [
        headers.map(escapeCsv).join(','),
        ...rows.map(r => r.map(c => escapeCsv(c && typeof c === 'object' ? (c.href ?? c.text) : c)).join(','))
    ].join('\r\n');
}

/** Wikitext-safe cell. Anything that could be parsed as markup is wrapped in <nowiki>. */
export function escapeWiki(value) {
    const s = String(value ?? '').replace(/\r?\n/g, ' ');
    if (s === '') return '';
    if (/[|{}[\]<>&~]|^[*#:;=!-]|'{2}|__/.test(s) || /^\s|\s$/.test(s)) {
        return `<nowiki>${s.replace(/<\/nowiki>/gi, '&lt;/nowiki&gt;')}</nowiki>`;
    }
    return s;
}

function wikiCell(c) {
    if (c && typeof c === 'object' && c.href) {
        // External link syntax: whitespace/brackets in the URL would break it.
        const href = String(c.href).replace(/[\s[\]<>"|]/g, encodeURIComponent);
        const label = String(c.text ?? '').replace(/[[\]|]/g, ' ').trim();
        return label ? `[${href} ${label}]` : `[${href}]`;
    }
    return escapeWiki(cellText(c));
}

export function toWikitable({ headers, rows }, caption = '') {
    const lines = ['{| class="wikitable sortable"'];
    if (caption) lines.push(`|+ ${escapeWiki(caption)}`);
    lines.push('! ' + headers.map(escapeWiki).join(' !! '));
    for (const r of rows) {
        lines.push('|-');
        lines.push('| ' + r.map(wikiCell).join(' || '));
    }
    lines.push('|}');
    return lines.join('\n');
}

const escapeMd = v => String(v ?? '').replace(/\r?\n/g, ' ').replace(/([\\|`*_[\]<>])/g, '\\$1');

export function toMarkdownTable({ headers, rows }) {
    const cell = c => (c && typeof c === 'object' && c.href)
        ? `[${escapeMd(c.text ?? 'Link')}](${String(c.href).replace(/[()\s]/g, encodeURIComponent)})`
        : escapeMd(cellText(c));
    return [
        `| ${headers.map(escapeMd).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)
    ].join('\n');
}
