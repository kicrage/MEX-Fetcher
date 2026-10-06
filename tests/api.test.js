import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenerator, normalizeSiteInfo, siteInfoUrl } from '../js/api/siteinfo.js';
import { apiCandidates } from '../js/api/discover.js';
import { manifestCandidates, normalizeManifest, repoFromGerritUrl, repoFromDocUrl } from '../js/api/manifest.js';
import { parseCategories } from '../js/api/mworg.js';
import { parseSiteJson, toSnapshot } from '../js/store/snapshot.js';

test('parseGenerator', () => {
    assert.deepEqual(parseGenerator('MediaWiki 1.43.1'), { mwVersion: '1.43.1', branch: 'REL1_43' });
    assert.deepEqual(parseGenerator('MediaWiki 1.47.0-wmf.22'), { mwVersion: '1.47.0-wmf.22', branch: 'master' });
    assert.deepEqual(parseGenerator('MediaWiki 1.44.0-alpha'), { mwVersion: '1.44.0-alpha', branch: 'master' });
    assert.deepEqual(parseGenerator('MediaWiki 1.39.0-rc.0'), { mwVersion: '1.39.0-rc.0', branch: 'REL1_39' });
    assert.deepEqual(parseGenerator('something else'), { mwVersion: null, branch: null });
    assert.deepEqual(parseGenerator(undefined), { mwVersion: null, branch: null });
});

const rawQuery = {
    general: { generator: 'MediaWiki 1.43.1', phpversion: '8.2.1', dbtype: 'mysql', sitename: 'Test Wiki' },
    extensions: [
        { type: 'parserhook', name: 'Cite', version: '1.0', url: 'https://www.mediawiki.org/wiki/Extension:Cite', 'vcs-url': 'https://gerrit.wikimedia.org/g/mediawiki/extensions/Cite/+/abc', 'vcs-version': 'abc', descriptionmsg: 'cite-desc' },
        { type: 'skin', name: 'Vector' },
        { name: '' }, null
    ],
    skins: [{ code: 'vector', name: 'Vector', default: true }, { code: 'fallback', name: 'Fallback', unusable: true }],
    usergroups: [{ name: 'sysop', rights: ['block'] }, { name: 'bot', rights: [] }],
    libraries: [{ name: 'a/b', version: '1.2.3' }],
    extensiontags: ['<pre>', '<ref>'],
    functionhooks: ['ns'],
    namespaces: { '0': { id: 0, name: '', canonical: '' }, '3000': { id: 3000, name: 'Foo', canonical: 'Foo' } }
};

test('normalizeSiteInfo', () => {
    const s = normalizeSiteInfo(rawQuery, { apiUrl: 'https://t.example/w/api.php', fetchedAt: 5 });
    assert.equal(s.label, 'Test Wiki');
    assert.equal(s.mwVersion, '1.43.1');
    assert.equal(s.branch, 'REL1_43');
    assert.equal(s.php, '8.2.1');
    assert.equal(s.extensions.length, 2); // blank-name and null entries dropped
    assert.equal(s.extensions[0].vcsVersion, 'abc');
    assert.equal(s.extensions[0].descriptionMsg, 'cite-desc');
    assert.equal(s.extensions[1].version, null);
    assert.deepEqual(s.namespaces.map(n => n.id), [0, 3000]);
    assert.deepEqual(s.extensiontags, ['<pre>', '<ref>']);
    assert.deepEqual(s.skins, [
        { code: 'vector', name: 'Vector', default: true, unusable: false },
        { code: 'fallback', name: 'Fallback', default: false, unusable: true }
    ]);
    assert.deepEqual(s.usergroups, ['sysop', 'bot']);
});

test('normalizeSiteInfo tolerates missing sections', () => {
    const s = normalizeSiteInfo({ extensions: [] });
    assert.equal(s.mwVersion, null);
    assert.deepEqual(s.libraries, []);
    assert.deepEqual(s.namespaces, []);
});

test('siteInfoUrl builds an openable URL', () => {
    const u = new URL(siteInfoUrl('t.example/w/api.php'));
    assert.equal(u.searchParams.get('meta'), 'siteinfo');
    assert.ok(u.searchParams.get('siprop').includes('extensions'));
    assert.equal(u.searchParams.get('origin'), null);
});

test('apiCandidates', () => {
    assert.deepEqual(apiCandidates('https://en.wikipedia.org/w/api.php?x=1'), ['https://en.wikipedia.org/w/api.php']);
    assert.equal(apiCandidates('https://en.wikipedia.org/wiki/Main_Page')[0], 'https://en.wikipedia.org/w/api.php');
    assert.equal(apiCandidates('https://example.org/w/index.php?title=X')[0], 'https://example.org/w/api.php');
    assert.equal(apiCandidates('https://example.org/mw/index.php/Foo')[0], 'https://example.org/mw/api.php');
    assert.equal(apiCandidates('https://example.org/mywiki/wiki/Foo')[0], 'https://example.org/mywiki/w/api.php');
    const bare = apiCandidates('example.org');
    assert.deepEqual(bare.slice(0, 2), ['https://example.org/w/api.php', 'https://example.org/api.php']);
    assert.equal(new Set(bare).size, bare.length);
});

test('repo resolution', () => {
    assert.deepEqual(repoFromGerritUrl('https://gerrit.wikimedia.org/g/mediawiki/extensions/Cite/+/abc'), { kind: 'extension', repo: 'Cite' });
    assert.deepEqual(repoFromGerritUrl('https://gerrit.wikimedia.org/g/mediawiki/skins/Vector/+/abc'), { kind: 'skin', repo: 'Vector' });
    assert.equal(repoFromGerritUrl('https://example.org/'), null);
    assert.deepEqual(repoFromDocUrl('https://www.mediawiki.org/wiki/Extension:Semantic_MediaWiki'), { kind: 'extension', repo: 'SemanticMediaWiki' });
    assert.deepEqual(repoFromDocUrl('https://www.mediawiki.org/wiki/Skin:Timeless'), { kind: 'skin', repo: 'Timeless' });
});

test('manifestCandidates: gerrit vcs-url, branch then master fallback', () => {
    const c = manifestCandidates({ name: 'Cite', kind: 'extension', vcsUrl: 'https://gerrit.wikimedia.org/g/mediawiki/extensions/Cite/+/abc' }, 'REL1_43');
    assert.equal(c.repo, 'Cite');
    assert.deepEqual(c.urls.map(u => [u.url, u.branchMissing]), [
        ['https://raw.githubusercontent.com/wikimedia/mediawiki-extensions-Cite/REL1_43/extension.json', false],
        ['https://raw.githubusercontent.com/wikimedia/mediawiki-extensions-Cite/master/extension.json', true]
    ]);
});

test('manifestCandidates: master wiki has no fallback; skins use skin.json; overrides; spaces', () => {
    assert.equal(manifestCandidates({ name: 'Foo', kind: 'extension' }, 'master').urls.length, 1);
    assert.ok(manifestCandidates({ name: 'Vector', type: 'skin' }, 'master').urls[0].url.endsWith('/mediawiki-skins-Vector/master/skin.json'));
    const wb = manifestCandidates({ name: 'Wikibase Client', kind: 'extension' }, 'master');
    assert.ok(wb.urls[0].url.endsWith('/mediawiki-extensions-Wikibase/master/extension-client.json'));
    assert.equal(manifestCandidates({ name: 'Some Thing', kind: 'extension' }, 'master').repo, 'SomeThing');
});

test('manifestCandidates: third-party GitHub vcs-url is used pinned to its commit', () => {
    const c = manifestCandidates({ name: 'Mine', kind: 'extension', vcsUrl: 'https://github.com/me/Mine', vcsVersion: 'deadbeef' }, 'REL1_43');
    assert.deepEqual(c.urls.map(u => u.url), ['https://raw.githubusercontent.com/me/Mine/deadbeef/extension.json']);
});

test('manifestCandidates: a github.com/wikimedia mirror vcs-url is NOT treated as third-party (use the target branch, not the commit)', () => {
    const c = manifestCandidates({
        name: 'UserMerge', kind: 'extension', type: 'specialpage',
        vcsUrl: 'https://github.com/wikimedia/mediawiki-extensions-UserMerge/commit/43e0f8c6', vcsVersion: '43e0f8c6'
    }, 'REL1_46');
    assert.equal(c.repo, 'UserMerge');
    assert.deepEqual(c.urls.map(u => u.url), [
        'https://raw.githubusercontent.com/wikimedia/mediawiki-extensions-UserMerge/REL1_46/extension.json',
        'https://raw.githubusercontent.com/wikimedia/mediawiki-extensions-UserMerge/master/extension.json'
    ]);
});

test('WikibaseClient (no space) maps to the Wikibase repo and its client manifest', () => {
    const c = manifestCandidates({ name: 'WikibaseClient', kind: 'extension', vcsUrl: 'https://gerrit.wikimedia.org/g/mediawiki/extensions/Wikibase/+/abc' }, 'master');
    assert.equal(c.urls[0].url, 'https://raw.githubusercontent.com/wikimedia/mediawiki-extensions-Wikibase/master/extension-client.json');
});

test('normalizeManifest', () => {
    const m = normalizeManifest({
        name: 'Foo', version: '2.0',
        requires: { MediaWiki: '>= 1.43', platform: { php: '>= 8.1', 'ext-intl': '*' }, extensions: { Bar: '*' }, skins: { Vector: '*' } }
    }, { repo: 'Foo' });
    assert.deepEqual(m.requires, { MediaWiki: '>= 1.43', php: '>= 8.1', phpExt: ['ext-intl'], extensions: { Bar: '*' }, skins: { Vector: '*' } });
    const bare = normalizeManifest({}, { repo: 'Bare' });
    assert.equal(bare.name, 'Bare');
    assert.deepEqual(bare.requires.extensions, {});
});

test('parseCategories', () => {
    assert.deepEqual(parseCategories(['Category:Stable extensions', 'Category:Extensions bundled with MediaWiki 1.40']), { status: 'stable', bundledIn: '1.40' });
    assert.equal(parseCategories(['Category:Unmaintained extensions']).status, 'unmaintained');
    assert.equal(parseCategories(['Category:Stable extensions', 'Category:Archived extensions']).status, 'archived');
    assert.equal(parseCategories(['Category:Archived extensions', 'Category:Obsolete extensions']).status, 'obsolete');
    assert.equal(parseCategories(['Category:Experimental extensions']).status, 'experimental');
    assert.equal(parseCategories(['Category:Unmaintained skins']).status, 'unmaintained');
    // "Beta Feature extensions" is about the BetaFeatures hook, not maintenance status.
    assert.deepEqual(parseCategories(['Category:Beta Feature extensions']), {});
    assert.deepEqual(parseCategories(['Category:Tag extensions']), {});
});

test('snapshot round trip and raw siteinfo paste', () => {
    const site = normalizeSiteInfo(rawQuery, { apiUrl: 'https://t.example/w/api.php', fetchedAt: 5 });
    site.manifests = { Cite: { name: 'Cite' } };
    const back = parseSiteJson(JSON.stringify(toSnapshot(site)));
    assert.equal(back.source, 'snapshot');
    assert.deepEqual(back.extensions, site.extensions);
    assert.deepEqual(back.manifests, site.manifests);

    const pasted = parseSiteJson(JSON.stringify({ query: rawQuery }), { label: 'Pasted' });
    assert.equal(pasted.source, 'paste');
    assert.equal(pasted.label, 'Pasted');
    assert.equal(pasted.extensions.length, 2);
    assert.equal(parseSiteJson(JSON.stringify(rawQuery)).extensions.length, 2); // inner object only
});

test('parseSiteJson rejects junk with a readable message', () => {
    assert.throws(() => parseSiteJson('not json'), /JSON/);
    assert.throws(() => parseSiteJson('{"hello":1}'), /siteinfo/);
    assert.throws(() => parseSiteJson(JSON.stringify({ format: 'mex-snapshot', version: 99, site: {} })), /新しい形式/);
    assert.throws(() => parseSiteJson(JSON.stringify({ format: 'mex-snapshot', version: 1, site: {} })), /不正/);
});
