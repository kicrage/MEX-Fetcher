// Text generators for the migration plan (LocalSettings.php, git clone, Composer notes, Markdown report).

import { verdictLabel } from './portability.js';
import { t, joinList } from '../i18n.js';

const phpString =s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function localSettingsSnippet(plan) {
    const exts = plan.filter(p => p.kind !== 'skin');
    const skins = plan.filter(p => p.kind === 'skin');
    const lines = ['// Extensions / skins to enable, dependencies first'];
    for (const s of skins) lines.push(`wfLoadSkin( ${phpString(s.repo)} );`);
    for (const e of exts) {
        lines.push(`wfLoadExtension( ${phpString(e.repo)} );${e.addedAsDependency ? ' // dependency' : ''}`);
    }
    return lines.join('\n');
}

export function gitCloneSnippet(plan, siteB) {
    const lines = [];
    for (const p of plan) {
        if (p.bundledIn) { lines.push(`# ${p.repo}: bundled with MediaWiki ${p.bundledIn}+ (already in the release tarball)`); continue; }
        const dir = p.kind === 'skin' ? 'skins' : 'extensions';
        const branch = p.branch || siteB.branch || 'master';
        lines.push(`git clone --depth 1 -b ${branch} https://gerrit.wikimedia.org/r/mediawiki/${dir}/${p.repo}.git ${dir}/${p.repo}`);
    }
    return lines.join('\n');
}

export function composerNote(libraries) {
    if (!libraries.length) return '';
    return [
        '// Composer libraries present on Site A but not on Site B (some are pulled in by the extensions themselves):',
        ...libraries.map(l => `//   ${l.name} ${l.version ?? ''}`.trimEnd()),
        '// Run `composer update --no-dev` after adding extensions that ship a composer.json.'
    ].join('\n');
}

export function planMarkdown({ siteA, siteB, result }) {
    const none = t('common.none');
    const lines = [
        `# ${t('md.title', { a: siteA.label || siteA.apiUrl, b: siteB.label || siteB.apiUrl })}`,
        '',
        `- ${t('md.dest', { mw: siteB.mwVersion ?? '?', php: siteB.php ?? '?', branch: siteB.branch ?? '?' })}`,
        `- ${t('md.verdicts')}: ` + joinList(Object.entries(result.counts).map(([k, v]) => `${verdictLabel(k)} ${v}`)),
        '',
        `## ${t('md.order')}`,
        ...(result.plan.length
            ? result.plan.map((p, i) => `${i + 1}. ${p.name}${p.addedAsDependency ? t('md.asDependency') : ''}${p.bundledIn ? t('md.bundled') : ''}`)
            : [t('md.nothingToInstall')]),
        '',
        '## LocalSettings.php', '```php', localSettingsSnippet(result.plan), '```',
        '',
        '## git', '```sh', gitCloneSnippet(result.plan, siteB), '```'
    ];
    const c = result.content;
    if (c) {
        const list = (title, items) => `- ${title}: ${items.length ? joinList(items) : none}`;
        lines.push('', `## ${t('md.content')}`,
            list(t('content.missingTags'), c.missingTags),
            list(t('content.missingFunctions'), c.missingFunctions),
            list(t('content.missingSkins'), c.missingSkins.map(k => k.name)),
            list(t('content.missingGroups'), c.missingGroups),
            list(t('content.nsConflicts'), c.namespaceConflicts.map(n => `${n.id}: ${n.a} / ${n.b}`)),
            list(t('content.nsOnlyA'), c.namespacesOnlyInA.map(n => `${n.id} ${n.name}`)));
    }
    const note = composerNote(result.libraries);
    if (note) lines.push('', '## Composer', '```php', note, '```');
    if (result.cyclic.length) lines.push('', `> ⚠ ${t('md.cycle', { names: result.cyclic.join(', ') })}`);
    lines.push('', `> ${t('md.limits')}`);
    return lines.join('\n');
}
