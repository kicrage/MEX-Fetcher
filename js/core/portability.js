// Site A → Site B portability analysis. Pure functions: callers supply already-fetched manifests/metadata.
//
// manifests: { [name]: Manifest | null }     (null = tried and failed)
// meta:      { [name]: { status?: 'archived'|'unmaintained'|'experimental'|'stable', bundledIn?: '1.40' } }

import { satisfies, compare } from './semver.js';
import { buildGraph, topoOrder } from './graph.js';
import { siteItems, versionRelation } from './compare.js';
import { msg, t, tr } from '../i18n.js';

// `label` is looked up with verdictLabel() so it follows the current language.
export const VERDICT = {
    INSTALLED: { icon: '✅', csv: 'Installed', order: 4 },
    INSTALLABLE: { icon: '🟢', csv: 'Installable', order: 2 },
    NEEDS_DEPS: { icon: '⚠', csv: 'Needs dependencies', order: 1 },
    INCOMPATIBLE: { icon: '❌', csv: 'Incompatible', order: 0 },
    UNKNOWN: { icon: '❓', csv: 'Unknown', order: 3 }
};

export const verdictLabel = verdict => t(`verdict.${verdict}`);

/**
 * Checks one manifest against the destination site.
 * @returns {object[]} problems as msg() objects (empty = compatible)
 */
export function checkManifest(manifest, siteB) {
    const problems = [];
    const req = manifest.requires || {};
    if (req.MediaWiki && siteB.mwVersion) {
        const ok = satisfies(siteB.mwVersion, req.MediaWiki);
        if (ok === false) problems.push(msg('reason.mw', { req: req.MediaWiki, have: siteB.mwVersion }));
    }
    if (req.php && siteB.php) {
        const ok = satisfies(siteB.php, req.php);
        if (ok === false) problems.push(msg('reason.php', { req: req.php, have: siteB.php }));
    }
    return problems;
}

/**
 * Names whose manifests are still needed to finish the analysis: every item of A that B lacks,
 * plus (transitively) their dependencies that B also lacks. Call repeatedly while fetching.
 */
export function neededManifestNames(siteA, siteB, manifests) {
    const inB = new Set(siteItems(siteB).map(i => i.name));
    const need = new Set();
    const queue = siteItems(siteA).map(i => i.name).filter(n => !inB.has(n));
    while (queue.length) {
        const name = queue.pop();
        if (need.has(name)) continue;
        need.add(name);
        const m = manifests[name];
        if (!m) continue;
        for (const dep of [...Object.keys(m.requires?.extensions || {}), ...Object.keys(m.requires?.skins || {})]) {
            if (!inB.has(dep) && !need.has(dep)) queue.push(dep);
        }
    }
    return [...need].filter(n => !(n in manifests));
}

/** Items from the site that have no manifest entry yet (regardless of whether B has them). */
export function analyzePortability(siteA, siteB, manifests = {}, meta = {}) {
    const itemsA = siteItems(siteA);
    const itemsB = new Map(siteItems(siteB).map(i => [i.name, i]));
    const inB = name => itemsB.has(name);

    // Dependency graph over everything we know about (A's items + deps), for ordering.
    const graph = buildGraph(siteA, manifests);
    // buildGraph only expands manifests of A's installed items; pull in manifests of dependencies too.
    for (const n of [...graph.values()]) expandDeps(graph, n.name, manifests);

    const depsMissingFor = (name, seen = new Set()) => {
        // Transitive deps not present in B (excluding itself).
        const out = [];
        const walk = n => {
            for (const d of graph.get(n)?.requires || []) {
                if (seen.has(d)) continue;
                seen.add(d);
                if (!inB(d)) { out.push(d); }
                walk(d);
            }
        };
        walk(name);
        return out;
    };

    const rows = itemsA.map(item => {
        const row = {
            name: item.name, kind: item.kind, versionA: item.version, versionB: null,
            verdict: 'UNKNOWN', reasons: [], warnings: [], missingDeps: [], versionRelation: 'unknown',
            meta: meta[item.name] || null, manifest: manifests[item.name] || null
        };
        const m = meta[item.name];
        if (['obsolete', 'archived', 'unmaintained', 'experimental'].includes(m?.status)) row.warnings.push(msg(`warn.${m.status}`));

        if (inB(item.name)) {
            row.verdict = 'INSTALLED';
            row.versionB = itemsB.get(item.name).version;
            row.versionRelation = versionRelation(item.version, row.versionB); // how B relates to A
            return row;
        }

        const manifest = manifests[item.name];
        if (!manifest) {
            row.reasons.push(msg('reason.noManifest'));
            return row;
        }
        if (manifest.branchMissing) {
            row.warnings.push(msg('warn.noRelBranch', { branch: manifest.usedBranch || 'master' }));
        }
        const bundledCmp = (m?.bundledIn && siteB.mwVersion) ? compare(m.bundledIn, siteB.mwVersion) : null;
        if (bundledCmp !== null && bundledCmp <= 0) row.warnings.push(msg('warn.bundled', { version: m.bundledIn }));

        const problems = checkManifest(manifest, siteB);
        if (problems.length) {
            row.verdict = 'INCOMPATIBLE';
            row.reasons.push(...problems);
            return row;
        }

        // Dependencies B lacks
        const missing = depsMissingFor(item.name);
        const blocked = [];
        const unknownDeps = [];
        for (const d of missing) {
            const dm = manifests[d];
            if (!dm) { unknownDeps.push(d); continue; }
            const dp = checkManifest(dm, siteB);
            if (dp.length) blocked.push(msg('reason.depBlocked', { dep: d, problems: dp }));
        }
        row.missingDeps = missing;
        if (blocked.length) {
            row.verdict = 'INCOMPATIBLE';
            row.reasons.push(...blocked);
            return row;
        }
        if (unknownDeps.length) row.warnings.push(msg('warn.unknownDeps', { names: unknownDeps.join(', ') }));
        row.verdict = missing.length ? 'NEEDS_DEPS' : 'INSTALLABLE';
        return row;
    });

    // Installation plan: all installable items + their missing deps, dependencies first.
    const toInstall = new Set();
    for (const r of rows) {
        if (r.verdict === 'INSTALLABLE' || r.verdict === 'NEEDS_DEPS') {
            toInstall.add(r.name);
            r.missingDeps.forEach(d => toInstall.add(d));
        }
    }
    const { order, cyclic } = topoOrder(graph, [...toInstall]);
    const kindOf = name => graph.get(name)?.kind || (manifests[name]?.kind) || 'extension';
    const plan = order.map(name => ({
        name,
        kind: kindOf(name),
        repo: manifests[name]?.repo || name.replace(/\s+/g, ''),
        branch: manifests[name]?.usedBranch || siteB.branch,
        addedAsDependency: !itemsA.some(i => i.name === name),
        bundledIn: meta[name]?.bundledIn || null
    }));

    return {
        rows,
        plan,
        cyclic,
        content: analyzeContent(siteA, siteB),
        counts: Object.fromEntries(Object.keys(VERDICT).map(k => [k, rows.filter(r => r.verdict === k).length])),
        libraries: diffLibraries(siteA, siteB)
    };
}

function expandDeps(graph, name, manifests, seen = new Set()) {
    if (seen.has(name)) return;
    seen.add(name);
    const node = graph.get(name);
    if (!node) return;
    const m = manifests[name];
    if (m && !node.known) {
        node.known = true;
        const deps = [
            ...Object.keys(m.requires?.extensions || {}).map(d => [d, 'extension']),
            ...Object.keys(m.requires?.skins || {}).map(d => [d, 'skin'])
        ];
        for (const [d, kind] of deps) {
            let t = graph.get(d);
            if (!t) { t = { name: d, kind, installed: false, version: null, known: false, requires: [], requiredBy: [] }; graph.set(d, t); }
            if (!node.requires.includes(d)) node.requires.push(d);
            if (!t.requiredBy.includes(name)) t.requiredBy.push(name);
        }
    }
    for (const d of node.requires) expandDeps(graph, d, manifests, seen);
}

/** Parser tags / functions / namespaces that exist on A but would be missing or clash on B. */
export function analyzeContent(siteA, siteB) {
    const lower = arr => new Set((arr || []).map(s => String(s).toLowerCase()));
    const tagsB = lower(siteB.extensiontags), fnsB = lower(siteB.functionhooks);
    // Heuristic: parser-hook extensions that B lacks are the likely providers.
    const providerHint = (siteA.extensions || [])
        .filter(e => /parser/i.test(e.type || '') && !(siteB.extensions || []).some(b => b.name === e.name))
        .map(e => e.name);

    const missingTags = (siteA.extensiontags || []).filter(t => !tagsB.has(String(t).toLowerCase()));
    const missingFunctions = (siteA.functionhooks || []).filter(f => !fnsB.has(String(f).toLowerCase()));

    const nsB = new Map((siteB.namespaces || []).map(n => [n.id, n]));
    const canonB = new Set((siteB.namespaces || []).map(n => (n.canonical || '').toLowerCase()).filter(Boolean));
    const conflicts = [], onlyInA = [];
    for (const ns of siteA.namespaces || []) {
        if (ns.id < 100) continue;
        const b = nsB.get(ns.id);
        const ca = (ns.canonical || ns.name || '').toLowerCase();
        if (b && (b.canonical || b.name || '').toLowerCase() !== ca) {
            conflicts.push({ id: ns.id, a: ns.canonical || ns.name, b: b.canonical || b.name });
        } else if (!b && !canonB.has(ca)) {
            onlyInA.push({ id: ns.id, name: ns.canonical || ns.name });
        }
    }
    // Skins and user groups: compare only when both sites actually reported them (older snapshots may not have).
    const usable = s => (s.skins || []).filter(k => !k.unusable);
    const skinsB = new Set(usable(siteB).map(k => k.code));
    const missingSkins = usable(siteB).length && usable(siteA).length
        ? usable(siteA).filter(k => !skinsB.has(k.code)).map(k => ({ code: k.code, name: k.name })) : [];
    const defaultA = usable(siteA).find(k => k.default), defaultB = usable(siteB).find(k => k.default);
    const defaultSkinDiffers = !!(defaultA && defaultB && defaultA.code !== defaultB.code);
    const groupsB = new Set(siteB.usergroups || []);
    const missingGroups = (siteB.usergroups || []).length && (siteA.usergroups || []).length
        ? siteA.usergroups.filter(g => !groupsB.has(g)) : [];

    return {
        missingSkins, defaultSkinDiffers,
        defaultSkins: { a: defaultA?.name ?? null, b: defaultB?.name ?? null },
        missingGroups,
        missingTags, missingFunctions,
        providerCandidates: [...new Set(providerHint)].sort(),
        namespaceConflicts: conflicts, namespacesOnlyInA: onlyInA
    };
}

/** Composer libraries: present on A but missing/older on B. */
export function diffLibraries(siteA, siteB) {
    const b = new Map((siteB.libraries || []).map(l => [l.name, l.version]));
    return (siteA.libraries || [])
        .filter(l => !b.has(l.name))
        .map(l => ({ name: l.name, version: l.version }));
}

/**
 * Rows as an exportable table (CSV / wikitable / Markdown). Headers and verdict codes are stable English
 * (it is a data file); free-text reasons/warnings follow the current UI language.
 */
export function portabilityTable(result) {
    return {
        headers: ['Name', 'Kind', 'Verdict', 'Version (A)', 'Version (B)', 'Missing dependencies', 'Reasons', 'Warnings'],
        rows: [...result.rows]
            .sort((x, y) => VERDICT[x.verdict].order - VERDICT[y.verdict].order || x.name.localeCompare(y.name))
            .map(r => [r.name, r.kind, VERDICT[r.verdict].csv, r.versionA, r.versionB,
                r.missingDeps.join('; '), r.reasons.map(tr).join('; '), r.warnings.map(tr).join('; ')])
    };
}
