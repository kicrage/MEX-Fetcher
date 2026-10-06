import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfies, compare, parseVersion } from '../js/core/semver.js';

test('parseVersion', () => {
    assert.deepEqual(parseVersion('1.43.1'), { major: 1, minor: 43, patch: 1, pre: [] });
    assert.deepEqual(parseVersion('1.47.0-wmf.22'), { major: 1, minor: 47, patch: 0, pre: ['wmf', 22] });
    assert.equal(parseVersion('banana'), null);
    assert.equal(parseVersion(null), null);
});

test('compare', () => {
    assert.equal(compare('1.43.0', '1.43.0'), 0);
    assert.equal(compare('1.43.0', '1.43.1'), -1);
    assert.equal(compare('1.44.0', '1.43.9'), 1);
    assert.equal(compare('1.10.0', '1.9.0'), 1); // numeric, not lexical
    assert.equal(compare('1.43.0-wmf.5', '1.43.0'), -1); // prerelease < release
    assert.equal(compare('1.43.0-wmf.5', '1.43.0-wmf.12'), -1);
    assert.equal(compare('x', '1.0.0'), null);
});

test('satisfies: comparison operators', () => {
    assert.equal(satisfies('1.43.0', '>= 1.43'), true);
    assert.equal(satisfies('1.42.9', '>= 1.43'), false);
    assert.equal(satisfies('1.43.0', '> 1.43.0'), false);
    assert.equal(satisfies('1.43.0', '<= 1.43.0'), true);
    assert.equal(satisfies('1.43.0', '< 1.43.0'), false);
    assert.equal(satisfies('1.43.0', '= 1.43.0'), true);
    assert.equal(satisfies('1.43.1', '!= 1.43.0'), true);
});

test('satisfies: AND / OR', () => {
    assert.equal(satisfies('1.40.0', '>= 1.39 < 1.42'), true);
    assert.equal(satisfies('1.42.0', '>= 1.39, < 1.42'), false);
    assert.equal(satisfies('1.35.0', '>= 1.39 || 1.35.*'), true);
    assert.equal(satisfies('1.36.0', '>= 1.39 || 1.35.*'), false);
});

test('satisfies: caret and tilde', () => {
    assert.equal(satisfies('1.9.0', '^1.2.3'), true);
    assert.equal(satisfies('2.0.0', '^1.2.3'), false);
    assert.equal(satisfies('1.2.2', '^1.2.3'), false);
    assert.equal(satisfies('0.2.9', '^0.2.3'), true);
    assert.equal(satisfies('0.3.0', '^0.2.3'), false);
    assert.equal(satisfies('0.0.3', '^0.0.3'), true);
    assert.equal(satisfies('0.0.4', '^0.0.3'), false);
    assert.equal(satisfies('1.2.9', '~1.2.3'), true);
    assert.equal(satisfies('1.3.0', '~1.2.3'), false);
    assert.equal(satisfies('1.9.0', '~1'), true);
    assert.equal(satisfies('2.0.0', '~1'), false);
});

test('satisfies: wildcards', () => {
    assert.equal(satisfies('1.43.7', '1.43.*'), true);
    assert.equal(satisfies('1.44.0', '1.43.*'), false);
    assert.equal(satisfies('9.9.9', '*'), true);
});

test('satisfies: wmf/alpha MediaWiki satisfies its own base version', () => {
    assert.equal(satisfies('1.47.0-wmf.22', '>= 1.47.0'), true);
    assert.equal(satisfies('1.47.0-wmf.22', '>= 1.48'), false);
});

test('satisfies: unparseable → null (unknown, not "no")', () => {
    assert.equal(satisfies('1.43.0', '>= banana'), null);
    assert.equal(satisfies('banana', '>= 1.0'), null);
    assert.equal(satisfies('8.3.35', '>= 8.1.0'), true);
});
