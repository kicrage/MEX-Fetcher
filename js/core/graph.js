// Dependency graph over extensions/skins. Pure functions, no DOM.

import { siteItems } from './compare.js';
//
// Manifest shape (see api/manifest.js): { name, requires: { extensions: {name: constraint}, skins: {...},
// MediaWiki, php, phpExt }, ... }. `manifests` maps item name → manifest or null (unknown).

/**
 * Builds the graph for a site. Nodes include installed items plus any dependency target
 * that isn't installed (installed:false) so unmet dependencies are visible.
 * @returns {Map<string, {name, kind, installed, version, known, requires: string[], requiredBy: string[]}>}
 */
export function buildGraph(site, manifests = {}) {
    const nodes = new Map();
    const ensure = (name, kind, installed, version = null) => {
        let n = nodes.get(name);
        if (!n) {
            n = { name, kind, installed, version, known: false, requires: [], requiredBy: [] };
            nodes.set(name, n);
        } else if (installed) {
            n.installed = true;
            n.kind = kind;
            n.version = version;
        }
        return n;
    };
    for (const i of siteItems(site)) ensure(i.name, i.kind, true, i.version);

    for (const n of [...nodes.values()]) {
        const m = manifests[n.name];
        if (!m) continue;
        n.known = true;
        const deps = [
            ...Object.keys(m.requires?.extensions || {}).map(d => [d, 'extension']),
            ...Object.keys(m.requires?.skins || {}).map(d => [d, 'skin'])
        ];
        for (const [dep, kind] of deps) {
            const target = ensure(dep, kind, false);
            if (!n.requires.includes(dep)) n.requires.push(dep);
            if (!target.requiredBy.includes(n.name)) target.requiredBy.push(n.name);
        }
    }
    return nodes;
}

/** All transitive dependencies of `names` (excluding the names themselves unless reached via a cycle). */
export function transitiveDeps(graph, names) {
    const seen = new Set();
    const stack = [...names];
    while (stack.length) {
        const n = graph.get(stack.pop());
        if (!n) continue;
        for (const d of n.requires) {
            if (!seen.has(d)) { seen.add(d); stack.push(d); }
        }
    }
    return seen;
}

/** Strongly connected components with more than one node (or a self loop) = dependency cycles. */
export function findCycles(graph) {
    let index = 0;
    const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], cycles = [];
    function visit(v) {
        idx.set(v, index); low.set(v, index); index++;
        stack.push(v); onStack.add(v);
        for (const w of graph.get(v)?.requires || []) {
            if (!graph.has(w)) continue;
            if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
            else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
        }
        if (low.get(v) === idx.get(v)) {
            const comp = [];
            let w;
            do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
            if (comp.length > 1 || graph.get(v).requires.includes(v)) cycles.push(comp.reverse());
        }
    }
    for (const v of graph.keys()) if (!idx.has(v)) visit(v);
    return cycles;
}

/**
 * Dependencies-first ordering of `names` (Kahn's algorithm, ties broken alphabetically for stable output).
 * Edges to nodes outside `names` are ignored. Nodes stuck in a cycle are appended and reported.
 * @returns {{order: string[], cyclic: string[]}}
 */
export function topoOrder(graph, names) {
    const set = new Set(names);
    const indeg = new Map();
    for (const n of set) {
        indeg.set(n, (graph.get(n)?.requires || []).filter(d => set.has(d) && d !== n).length);
    }
    const ready = [...set].filter(n => indeg.get(n) === 0).sort();
    const order = [];
    while (ready.length) {
        const n = ready.shift();
        order.push(n);
        for (const user of graph.get(n)?.requiredBy || []) {
            if (!set.has(user) || !indeg.has(user)) continue;
            indeg.set(user, indeg.get(user) - 1);
            if (indeg.get(user) === 0) {
                ready.push(user);
                ready.sort();
            }
        }
    }
    const cyclic = [...set].filter(n => !order.includes(n)).sort();
    return { order: [...order, ...cyclic], cyclic };
}

/** Longest-path layering: layer 0 = no dependencies; each node sits one layer above its deepest dependency. */
export function computeLayers(graph, names = [...graph.keys()]) {
    const set = new Set(names);
    const memo = new Map();
    const visiting = new Set();
    const depth = n => {
        if (memo.has(n)) return memo.get(n);
        if (visiting.has(n)) return 0; // cycle: break it
        visiting.add(n);
        let d = 0;
        for (const dep of graph.get(n)?.requires || []) {
            if (set.has(dep)) d = Math.max(d, depth(dep) + 1);
        }
        visiting.delete(n);
        memo.set(n, d);
        return d;
    };
    const layers = [];
    for (const n of [...set].sort()) {
        const d = depth(n);
        (layers[d] ||= []).push(n);
    }
    return layers.map(l => l || []);
}

/** Summary used by the graph view's filters and header. */
export function analyzeGraph(graph) {
    const nodes = [...graph.values()];
    return {
        total: nodes.length,
        unmet: nodes.filter(n => !n.installed),
        isolated: nodes.filter(n => n.installed && n.requires.length === 0 && n.requiredBy.length === 0),
        unknown: nodes.filter(n => n.installed && !n.known),
        cycles: findCycles(graph)
    };
}
