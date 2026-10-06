// Composer-style version constraints (the subset MediaWiki's extension.json uses).

const VERSION_RE = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:\.\d+)?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/;

/** Parses "1.43.0-wmf.5" → { major, minor, patch, pre: ['wmf', 5] } or null. */
export function parseVersion(text) {
    const m = VERSION_RE.exec(String(text ?? '').trim());
    if (!m) return null;
    const num = s => (s === undefined || /[xX*]/.test(s)) ? 0 : Number(s);
    return {
        major: Number(m[1]),
        minor: num(m[2]),
        patch: num(m[3]),
        pre: m[4] ? m[4].split('.').map(p => /^\d+$/.test(p) ? Number(p) : p) : []
    };
}

function comparePre(a, b) {
    // A version without a prerelease is newer than one with.
    if (!a.length && !b.length) return 0;
    if (!a.length) return 1;
    if (!b.length) return -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === undefined) return -1;
        if (b[i] === undefined) return 1;
        if (a[i] === b[i]) continue;
        const an = typeof a[i] === 'number', bn = typeof b[i] === 'number';
        if (an && bn) return a[i] < b[i] ? -1 : 1;
        if (an) return -1;
        if (bn) return 1;
        return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

/** Compares two version strings. Returns -1/0/1, or null when either is unparseable. */
export function compare(a, b) {
    const x = typeof a === 'string' ? parseVersion(a) : a;
    const y = typeof b === 'string' ? parseVersion(b) : b;
    if (!x || !y) return null;
    for (const k of ['major', 'minor', 'patch']) {
        if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
    }
    return comparePre(x.pre, y.pre);
}

/** Expands one comparator token into [op, versionObj] pairs (AND-ed). */
function expandToken(token) {
    if (token === '*' || token === '' ) return [];
    const m = /^(\^|~>?|>=|<=|!=|<>|>|<|=)?\s*(.+)$/.exec(token);
    if (!m) return null;
    const op = m[1] || '=';
    const raw = m[2].trim();
    const parts = raw.replace(/^v/, '').split('.');
    const wild = parts.findIndex(p => /^[xX*]$/.test(p));
    const v = parseVersion(raw);
    if (!v) return null;
    const precision = wild >= 0 ? wild : Math.min(parts.filter(p => p !== '').length, 3);
    const bump = (obj, level) => {
        const r = { major: obj.major, minor: obj.minor, patch: obj.patch, pre: [] };
        if (level <= 1) { r.major++; r.minor = 0; r.patch = 0; }
        else if (level === 2) { r.minor++; r.patch = 0; }
        else { r.patch++; }
        return r;
    };
    const zero = o => ({ ...o, pre: o.pre });

    if (op === '^') {
        // ^1.2.3 → >=1.2.3 <2.0.0 ; ^0.2.3 → >=0.2.3 <0.3.0 ; ^0.0.3 → <0.0.4
        let level;
        if (v.major > 0 || precision <= 1) level = 1;
        else if (v.minor > 0 || precision === 2) level = 2;
        else level = 3;
        return [['>=', zero(v)], ['<', bump(v, level)]];
    }
    if (op === '~' || op === '~>') {
        // ~1.2.3 → <1.3.0 ; ~1.2 → <1.3.0 ; ~1 → <2.0.0
        const level = precision >= 2 ? 2 : 1;
        return [['>=', zero(v)], ['<', bump(v, level)]];
    }
    if (op === '=' && precision < 3) {
        // 1.43.* / 1.43 / 1 → range
        return [['>=', zero(v)], ['<', bump(v, precision || 1)]];
    }
    return [[op === '<>' ? '!=' : op, v]];
}

function testPair(version, [op, v]) {
    const c = compare(version, v);
    if (c === null) return false;
    switch (op) {
        case '>=': return c >= 0;
        case '>': return c > 0;
        case '<=': return c <= 0;
        case '<': return c < 0;
        case '!=': return c !== 0;
        default: return c === 0;
    }
}

/**
 * Does `version` satisfy `constraint`? Returns true/false, or null when either side can't be parsed
 * (callers should treat null as "unknown" rather than "no").
 */
export function satisfies(version, constraint) {
    const v = parseVersion(version);
    if (!v || typeof constraint !== 'string') return null;
    // MediaWiki wmf/alpha builds are always ≥ the stated base version; compare on major.minor.patch only.
    const probe = { ...v, pre: [] };
    const ors = constraint.split(/\s*\|\|?\s*/);
    let parsedAny = false;
    for (const group of ors) {
        const tokens = group.replace(/(>=|<=|!=|<>|>|<|=|\^|~>?)\s+/g, '$1').split(/[\s,]+/).filter(Boolean);
        const pairs = [];
        let ok = true;
        for (const t of (tokens.length ? tokens : ['*'])) {
            const e = expandToken(t);
            if (e === null) { ok = false; break; }
            pairs.push(...e);
        }
        if (!ok) continue;
        parsedAny = true;
        if (pairs.every(p => testPair(probe, p))) return true;
    }
    return parsedAny ? false : null;
}
