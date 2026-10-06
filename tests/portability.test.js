import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePortability, neededManifestNames, checkManifest, analyzeContent, diffLibraries, portabilityTable } from '../js/core/portability.js';
import { localSettingsSnippet, gitCloneSnippet, composerNote, planMarkdown } from '../js/core/snippets.js';
import { tr } from '../js/i18n.js';
import { site, ext, manifest } from './fixtures.js';

const A = site('a', {
    mwVersion: '1.43.1',
    extensions: [
        ext('Have', '1.0'), ext('Easy'), ext('NeedsDep'), ext('TooNew'), ext('TooNewPhp'), ext('Mystery'),
        ext('DepOfDep'), ext('BlockedByDep'), ext('Old', '1.0'), ext('Parserish', '1', { type: 'parserhook' })
    ],
    extensiontags: ['<pre>', '<math>', '<poem>'],
    functionhooks: ['ns', 'invoke'],
    namespaces: [{ id: 0, name: '', canonical: '' }, { id: 3000, name: 'Foo', canonical: 'Foo' }, { id: 3002, name: 'Same', canonical: 'Same' }],
    libraries: [{ name: 'a/lib', version: '1' }, { name: 'shared/lib', version: '2' }]
});
const B = site('b', {
    mwVersion: '1.42.0', branch: 'REL1_42', php: '8.1.0',
    extensions: [ext('Have', '1.0'), ext('Base'), ext('Old', '2.0')],
    extensiontags: ['<pre>'], functionhooks: ['ns'],
    namespaces: [{ id: 0, name: '', canonical: '' }, { id: 3000, name: 'Bar', canonical: 'Bar' }, { id: 3001, name: 'Same', canonical: 'Same' }],
    libraries: [{ name: 'shared/lib', version: '2' }]
});

const manifests = {
    Easy: manifest('Easy', { MediaWiki: '>= 1.40' }),
    NeedsDep: manifest('NeedsDep', { extensions: { Base: '*', DepOfDep: '*' } }),
    DepOfDep: manifest('DepOfDep', { extensions: { Easy: '*' } }),
    TooNew: manifest('TooNew', { MediaWiki: '>= 1.43' }),
    TooNewPhp: manifest('TooNewPhp', { php: '>= 8.2.0' }),
    Mystery: null,
    BlockedByDep: manifest('BlockedByDep', { extensions: { TooNew: '*' } }),
    Parserish: manifest('Parserish', {}, { branchMissing: true, usedBranch: 'master' })
};
const meta = { Easy: { status: 'archived' }, Parserish: { bundledIn: '1.35' } };

const result = analyzePortability(A, B, manifests, meta);
const row = n => result.rows.find(r => r.name === n);

test('verdicts', () => {
    assert.equal(row('Have').verdict, 'INSTALLED');
    assert.equal(row('Easy').verdict, 'INSTALLABLE');
    assert.equal(row('NeedsDep').verdict, 'NEEDS_DEPS');
    assert.equal(row('TooNew').verdict, 'INCOMPATIBLE');
    assert.equal(row('TooNewPhp').verdict, 'INCOMPATIBLE');
    assert.equal(row('Mystery').verdict, 'UNKNOWN');
    assert.equal(row('BlockedByDep').verdict, 'INCOMPATIBLE');
});

test('reasons name the unmet constraint and the blocking dependency', () => {
    assert.match(tr(row('TooNew').reasons[0]), />= 1\.43.*1\.42\.0/);
    assert.match(tr(row('TooNewPhp').reasons[0]), /PHP/);
    assert.match(tr(row('BlockedByDep').reasons[0]), /TooNew/);
});

test('missing deps are transitive and exclude what B already has', () => {
    assert.deepEqual([...row('NeedsDep').missingDeps].sort(), ['DepOfDep', 'Easy']);
});

test('installed items report the version relation of B relative to A', () => {
    assert.equal(row('Have').versionRelation, 'same');
    assert.equal(row('Old').versionRelation, 'newer'); // B has 2.0, A has 1.0
});

test('warnings: archived, missing REL branch, bundled', () => {
    assert.ok(row('Easy').warnings.map(tr).some(w => /アーカイブ/.test(w)));
    const p = row('Parserish');
    assert.equal(p.verdict, 'INSTALLABLE');
    assert.ok(p.warnings.map(tr).some(w => /ブランチ/.test(w)));
    assert.ok(p.warnings.map(tr).some(w => /同梱/.test(w)));
});

test('install plan is dependencies-first and flags pulled-in dependencies', () => {
    const names = result.plan.map(p => p.name);
    assert.ok(names.indexOf('Easy') < names.indexOf('DepOfDep'));
    assert.ok(names.indexOf('DepOfDep') < names.indexOf('NeedsDep'));
    assert.ok(!names.includes('TooNew'));
    assert.ok(!names.includes('Have'));
    assert.deepEqual(result.cyclic, []);
});

test('counts', () => {
    assert.equal(result.counts.INSTALLED, 2);
    assert.equal(result.counts.INCOMPATIBLE, 3);
    assert.equal(result.counts.UNKNOWN, 1);
});

test('checkManifest: unparseable constraint is not treated as a failure', () => {
    assert.deepEqual(checkManifest(manifest('X', { MediaWiki: 'weird' }), B), []);
});

test('neededManifestNames walks transitive deps B lacks and skips fetched ones', () => {
    const known = { Easy: manifests.Easy, NeedsDep: manifests.NeedsDep };
    const need = neededManifestNames(A, B, known);
    assert.ok(need.includes('DepOfDep'));
    assert.ok(!need.includes('Easy'));
    assert.ok(!need.includes('Have'));
    assert.ok(!need.includes('Base')); // B already has it
});

test('content analysis: tags, functions, namespaces, provider hints', () => {
    const c = analyzeContent(A, B);
    assert.deepEqual(c.missingTags, ['<math>', '<poem>']);
    assert.deepEqual(c.missingFunctions, ['invoke']);
    assert.deepEqual(c.namespaceConflicts, [{ id: 3000, a: 'Foo', b: 'Bar' }]);
    assert.deepEqual(c.namespacesOnlyInA, []); // 'Same' exists on B (under another id), so it isn't "only in A"
    assert.ok(c.providerCandidates.includes('Parserish'));
});

test('content analysis: skins and user groups (only when both sites reported them)', () => {
    const skin = (code, extra = {}) => ({ code, name: code.toUpperCase(), default: false, unusable: false, ...extra });
    const a = site('a', { skins: [skin('vector', { default: true }), skin('timeless'), skin('fallback', { unusable: true })], usergroups: ['sysop', 'flow-bot', 'bot'] });
    const b = site('b', { skins: [skin('vector'), skin('monobook', { default: true })], usergroups: ['sysop', 'bot'] });
    const c = analyzeContent(a, b);
    assert.deepEqual(c.missingSkins.map(k => k.code), ['timeless']); // 'fallback' is unusable, so ignored
    assert.equal(c.defaultSkinDiffers, true);
    assert.deepEqual(c.missingGroups, ['flow-bot']);

    // An old snapshot without skins/groups must not make everything look "missing".
    const old = site('old', { skins: [], usergroups: [] });
    const c2 = analyzeContent(a, old);
    assert.deepEqual(c2.missingSkins, []);
    assert.deepEqual(c2.missingGroups, []);
    assert.equal(c2.defaultSkinDiffers, false);
});

test('library diff', () => {
    assert.deepEqual(diffLibraries(A, B), [{ name: 'a/lib', version: '1' }]);
});

test('snippets', () => {
    const ls = localSettingsSnippet([
        { name: 'Vector', kind: 'skin', repo: 'Vector' },
        { name: 'Easy', kind: 'extension', repo: 'Easy' },
        { name: "O'Brien", kind: 'extension', repo: "O'Brien", addedAsDependency: true }
    ]);
    assert.ok(ls.includes("wfLoadSkin( 'Vector' );"));
    assert.ok(ls.includes("wfLoadExtension( 'Easy' );"));
    assert.ok(ls.includes("wfLoadExtension( 'O\\'Brien' ); // dependency"));
    const git = gitCloneSnippet([
        { repo: 'Easy', kind: 'extension', branch: 'REL1_42' },
        { repo: 'Vector', kind: 'skin', branch: 'master' },
        { repo: 'Cite', kind: 'extension', bundledIn: '1.21' }
    ], B);
    assert.ok(git.includes('git clone --depth 1 -b REL1_42 https://gerrit.wikimedia.org/r/mediawiki/extensions/Easy.git extensions/Easy'));
    assert.ok(git.includes('skins/Vector'));
    assert.ok(git.includes('# Cite: bundled'));
    assert.equal(composerNote([]), '');
    assert.match(composerNote([{ name: 'a/lib', version: '1' }]), /a\/lib 1/);
    const md = planMarkdown({ siteA: A, siteB: B, result });
    assert.match(md, /## 導入順/);
    assert.match(md, /```php/);
});

test('portabilityTable is sorted worst-first', () => {
    const t = portabilityTable(result);
    assert.equal(t.rows[0][2], 'Incompatible');
    assert.equal(t.headers[0], 'Name');
    assert.equal(t.rows.length, result.rows.length);
});
