import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsv, toCsv, escapeWiki, toWikitable, toMarkdownTable } from '../js/core/export.js';

test('escapeCsv quotes, doubles quotes and neutralises formulas', () => {
    assert.equal(escapeCsv('plain'), 'plain');
    assert.equal(escapeCsv('a,b'), '"a,b"');
    assert.equal(escapeCsv('say "hi"'), '"say ""hi"""');
    assert.equal(escapeCsv('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(escapeCsv('-5'), '-5'); // real numbers stay numbers
    assert.equal(escapeCsv(null), '');
});

test('toCsv uses link href for link cells', () => {
    const csv = toCsv({ headers: ['N', 'U'], rows: [['x', { text: 'Link', href: 'https://e.org/a,b' }]] });
    assert.equal(csv, 'N,U\r\nx,"https://e.org/a,b"');
});

test('escapeWiki wraps markup-significant text in nowiki', () => {
    assert.equal(escapeWiki('Cite'), 'Cite');
    assert.equal(escapeWiki('1.43.0'), '1.43.0');
    assert.equal(escapeWiki('a | b'), '<nowiki>a | b</nowiki>');
    assert.equal(escapeWiki('{{template}}'), '<nowiki>{{template}}</nowiki>');
    assert.equal(escapeWiki('[[link]]'), '<nowiki>[[link]]</nowiki>');
    assert.equal(escapeWiki('* bullet'), '<nowiki>* bullet</nowiki>');
    assert.equal(escapeWiki('x</nowiki>y'), '<nowiki>x&lt;/nowiki&gt;y</nowiki>');
    assert.equal(escapeWiki(null), '');
});

test('toWikitable output', () => {
    const out = toWikitable({
        headers: ['Name', 'Version', 'URL'],
        rows: [['Cite', '1.0', { text: 'Link', href: 'https://www.mediawiki.org/wiki/Extension:Cite' }], ['A|B', null, null]]
    }, 'Extensions');
    assert.equal(out, [
        '{| class="wikitable sortable"',
        '|+ Extensions',
        '! Name !! Version !! URL',
        '|-',
        '| Cite || 1.0 || [https://www.mediawiki.org/wiki/Extension:Cite Link]',
        '|-',
        '| <nowiki>A|B</nowiki> ||  || ',
        '|}'
    ].join('\n'));
});

test('wikitable link cells cannot break out of the link syntax', () => {
    const out = toWikitable({ headers: ['U'], rows: [[{ text: 'a]b|c', href: 'https://e.org/x y]z' }]] });
    assert.ok(out.includes('[https://e.org/x%20y%5Dz a b c]'));
});

test('toMarkdownTable escapes pipes', () => {
    const out = toMarkdownTable({ headers: ['A', 'B'], rows: [['x|y', 'z']] });
    assert.equal(out, '| A | B |\n| --- | --- |\n| x\\|y | z |');
});
