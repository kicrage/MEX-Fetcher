import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSites, diffSites, matchesQuery, versionRelation } from '../js/core/compare.js';
import { site, ext } from './fixtures.js';

const A = site('a', { extensions: [ext('Both', '1.0'), ext('OnlyA', '2.0'), ext('Skinny', '1', { type: 'skin' })] });
const B = site('b', { extensions: [ext('Both', '1.1'), ext('OnlyB', '3.0')] });
const C = site('c', { extensions: [ext('Both', '1.0'), ext('OnlyA', '2.0')] });
const byName = rows => Object.fromEntries(rows.map(r => [r.name, r]));

test('single site → SINGLE', () => {
    const rows = compareSites([A]);
    assert.ok(rows.every(r => r.status === 'SINGLE'));
    assert.equal(rows.length, 3);
});

test('two sites keep the legacy COMMON / EXTRA / MISSING semantics', () => {
    const r = byName(compareSites([A, B]));
    assert.equal(r.Both.status, 'COMMON');
    assert.equal(r.OnlyA.status, 'EXTRA');     // Base only
    assert.equal(r.OnlyB.status, 'MISSING');   // Target only
    assert.equal(r.Both.baseVersion, '1.0');
    assert.equal(r.Both.targetVersion, '1.1');
    assert.equal(r.Both.mismatch, true);
    assert.equal(r.OnlyA.mismatch, false);
    assert.equal(r.Skinny.kind, 'skin');
});

test('three sites → COMMON / PARTIAL / UNIQUE with per-site versions', () => {
    const r = byName(compareSites([A, B, C]));
    assert.equal(r.Both.status, 'COMMON');
    assert.deepEqual(r.Both.versions, ['1.0', '1.1', '1.0']);
    assert.equal(r.Both.mismatch, true);
    assert.equal(r.OnlyA.status, 'PARTIAL');
    assert.deepEqual(r.OnlyA.present, [true, false, true]);
    assert.equal(r.OnlyB.status, 'UNIQUE');
});

test('matchesQuery searches name and description, case-insensitively', () => {
    assert.equal(matchesQuery({ name: 'VisualEditor', description: null }, 'visual'), true);
    assert.equal(matchesQuery({ name: 'X', description: 'Adds a Parser tag' }, 'PARSER'), true);
    assert.equal(matchesQuery({ name: 'X', description: null }, 'nope'), false);
    assert.equal(matchesQuery({ name: 'X', description: null }, '  '), true);
});

test('versionRelation', () => {
    assert.equal(versionRelation('1.0', '1.0'), 'same');
    assert.equal(versionRelation('1.0', '1.1'), 'newer');
    assert.equal(versionRelation('1.1', '1.0'), 'older');
    assert.equal(versionRelation(null, '1.0'), 'unknown');
    assert.equal(versionRelation('abc', 'def'), 'unknown');
});

test('diffSites: added / removed / updated / unchanged + core change', () => {
    const old = site('x', { mwVersion: '1.42.0', extensions: [ext('Keep', '1'), ext('Gone', '1'), ext('Bump', '1.0')] });
    const now = site('x', { mwVersion: '1.43.0', extensions: [ext('Keep', '1'), ext('New', '1'), ext('Bump', '1.2')] });
    const d = diffSites(old, now);
    assert.deepEqual(d.added.map(x => x.name), ['New']);
    assert.deepEqual(d.removed.map(x => x.name), ['Gone']);
    assert.deepEqual(d.updated.map(x => [x.name, x.from, x.to, x.relation]), [['Bump', '1.0', '1.2', 'newer']]);
    assert.deepEqual(d.unchanged.map(x => x.name), ['Keep']);
    assert.deepEqual(d.core, { from: '1.42.0', to: '1.43.0' });
    assert.equal(diffSites(old, old).core, null);
});

test('identical snapshots produce an empty diff', () => {
    const d = diffSites(A, A);
    assert.equal(d.added.length + d.removed.length + d.updated.length, 0);
    assert.equal(d.unchanged.length, 3);
});
