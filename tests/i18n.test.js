import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ja from '../js/i18n/ja.js';
import en from '../js/i18n/en.js';
import { t, msg, tr, setLang, getLang, detectLang, joinList } from '../js/i18n.js';
import { analyzePortability, checkManifest } from '../js/core/portability.js';
import { planMarkdown } from '../js/core/snippets.js';
import { site, ext, manifest } from './fixtures.js';

const root = path.resolve(import.meta.dirname, '..');

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'i18n' ? [] : sourceFiles(p);
        return e.name.endsWith('.js') ? [p] : [];
    });
}

/** Keys referenced literally: t('x'), msg('x'), data-i18n="x", data-i18n-attr="attr:x". */
function usedKeys() {
    const keys = new Map(); // key → where
    for (const file of sourceFiles(path.join(root, 'js'))) {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/\b(?:t|msg)\(\s*'([\w.]+)'/g)) keys.set(m[1], path.relative(root, file));
    }
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const m of html.matchAll(/data-i18n="([\w.]+)"/g)) keys.set(m[1], 'index.html');
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
        for (const pair of m[1].split(';')) keys.set(pair.split(':')[1].trim(), 'index.html');
    }
    return keys;
}

// Keys built at runtime (`status.${x}`), chosen by a conditional, or passed as data (`progress.key`).
const DYNAMIC = [
    ...['COMMON', 'MISSING', 'EXTRA', 'PARTIAL', 'UNIQUE'].map(k => `status.${k}`),
    ...['ALL', 'COMMON', 'MISSING', 'EXTRA'].map(k => `filter2.${k}`),
    ...['ALL', 'COMMON', 'PARTIAL', 'UNIQUE', 'MISMATCH'].map(k => `filterN.${k}`),
    ...['INSTALLED', 'INSTALLABLE', 'NEEDS_DEPS', 'INCOMPATIBLE', 'UNKNOWN'].map(k => `verdict.${k}`),
    ...['obsolete', 'archived', 'unmaintained', 'experimental'].map(k => `warn.${k}`),
    ...['newer', 'older', 'same', 'unknown'].map(k => `history.rel.${k}`),
    'kind.extension', 'kind.skin', 'graph.fetch', 'graph.refetch', 'port.run', 'port.rerun', 'port.bNewer', 'port.bOlder',
    'port.progressManifests', 'port.progressMeta'
];

const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('ja and en define exactly the same keys', () => {
    const onlyJa = Object.keys(ja).filter(k => !(k in en));
    const onlyEn = Object.keys(en).filter(k => !(k in ja));
    assert.deepEqual(onlyJa, [], 'keys missing from en.js');
    assert.deepEqual(onlyEn, [], 'keys missing from ja.js');
});

test('every key the code uses exists in both dictionaries', () => {
    const missing = [];
    for (const [key, where] of usedKeys()) {
        if (!(key in ja) || !(key in en)) missing.push(`${key} (${where})`);
    }
    for (const key of DYNAMIC) if (!(key in ja) || !(key in en)) missing.push(`${key} (dynamic)`);
    assert.deepEqual(missing, []);
});

test('no unused dictionary entries (keeps the dictionaries from rotting)', () => {
    const used = new Set([...usedKeys().keys(), ...DYNAMIC]);
    const unused = Object.keys(ja).filter(k => !used.has(k));
    assert.deepEqual(unused, []);
});

test('placeholders match between languages', () => {
    for (const key of Object.keys(ja)) {
        assert.deepEqual(placeholders(en[key]), placeholders(ja[key]), `placeholders differ for ${key}`);
    }
});

test('the English dictionary contains no Japanese text', () => {
    const bad = Object.entries(en).filter(([, v]) => /[぀-ヿ一-鿿]/.test(v)).map(([k]) => k);
    assert.deepEqual(bad, []);
});

test('t(): params, fallback to Japanese, then to the key', () => {
    setLang('en');
    try {
        assert.equal(t('fetch.done', { n: 3 }), 'Fetched 3 extensions.');
        assert.equal(t('no.such.key'), 'no.such.key');
        assert.equal(t('common.showing', { shown: 2, total: 9 }), 'Showing 2 of 9');
        assert.equal(t('url.invalid', {}), 'Invalid URL: {raw}'); // unspecified placeholders stay visible
    } finally {
        setLang('ja');
    }
    assert.equal(t('fetch.done', { n: 3 }), '3件の拡張機能を取得しました。');
});

test('detectLang: stored choice wins, otherwise browser language', () => {
    assert.equal(detectLang('en', 'ja-JP'), 'en');
    assert.equal(detectLang('ja', 'en-US'), 'ja');
    assert.equal(detectLang(null, 'ja-JP'), 'ja');
    assert.equal(detectLang(null, 'ja'), 'ja');
    assert.equal(detectLang(null, 'en-GB'), 'en');
    assert.equal(detectLang(null, 'fr'), 'en');
    assert.equal(detectLang('xx', 'ja-JP'), 'ja'); // unknown stored value is ignored
    assert.equal(detectLang(null, undefined), 'en');
});

test('setLang ignores unknown languages; joinList follows the language', () => {
    setLang('fr');
    assert.equal(getLang(), 'ja');
    assert.equal(joinList(['a', 'b']), 'a、b');
    setLang('en');
    assert.equal(joinList(['a', 'b']), 'a, b');
    setLang('ja');
});

test('msg()/tr(): nested messages and arrays translate with the current language', () => {
    const m = msg('reason.depBlocked', { dep: 'X', problems: [msg('reason.mw', { req: '>= 2', have: '1.0' }), msg('reason.php', { req: '>= 9', have: '8' })] });
    assert.equal(tr(m), '依存先 X: MediaWiki >= 2 が必要（移植先: 1.0） / PHP >= 9 が必要（移植先: 8）');
    setLang('en');
    try {
        assert.equal(tr(m), 'Dependency X: Requires MediaWiki >= 2 (destination: 1.0) / Requires PHP >= 9 (destination: 8)');
        assert.equal(tr('plain text'), 'plain text');
        assert.equal(tr(null), '');
    } finally {
        setLang('ja');
    }
});

test('portability results stay translatable: switching language re-renders the same analysis', () => {
    const A = site('a', { extensions: [ext('TooNew'), ext('Old')] });
    const B = site('b', { mwVersion: '1.42.0', extensions: [] });
    const result = analyzePortability(A, B, {
        TooNew: manifest('TooNew', { MediaWiki: '>= 1.43' }),
        Old: manifest('Old', {}, { branchMissing: true, usedBranch: 'master' })
    }, { Old: { status: 'archived' } });
    const tooNew = result.rows.find(r => r.name === 'TooNew');
    const old = result.rows.find(r => r.name === 'Old');

    assert.match(tr(tooNew.reasons[0]), /MediaWiki >= 1\.43 が必要/);
    assert.ok(old.warnings.map(tr).some(w => /アーカイブ/.test(w)));
    setLang('en');
    try {
        assert.match(tr(tooNew.reasons[0]), /Requires MediaWiki >= 1\.43 \(destination: 1\.42\.0\)/);
        assert.ok(old.warnings.map(tr).some(w => /Archived/.test(w)));
        assert.ok(old.warnings.map(tr).some(w => /No REL branch; using master/.test(w)));
        assert.deepEqual(checkManifest(manifest('X', { php: '>= 99' }), site('b', { php: '8.1.0' })).map(tr), ['Requires PHP >= 99 (destination: 8.1.0)']);
        const md = planMarkdown({ siteA: A, siteB: B, result });
        assert.match(md, /^# MediaWiki migration plan: a → b/);
        assert.match(md, /## Install order/);
        assert.match(md, /Incompatible 1/);
    } finally {
        setLang('ja');
    }
});
