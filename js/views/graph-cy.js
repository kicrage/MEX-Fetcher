// Cytoscape.js (+ dagre layout) renderer. Libraries are loaded from a CDN on first use, with SRI.

import { transitiveDeps } from '../core/graph.js';
import { t } from '../i18n.js';

const LIBS = [
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.2/cytoscape.min.js', integrity: 'sha384-IWROdLKRsN1UuJywMlWl7/blXQ8GEooN2n7dzTxfEPd7ybYIKCUJ2Ol/1Gpf3YV4', global: 'cytoscape' },
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js', integrity: 'sha384-2IH3T69EIKYC4c+RXZifZRvaH5SRUdacJW7j6HtE5rQbvLhKKdawxq6vpIzJ7j9M', global: 'dagre' },
    // cytoscape-dagre is not on cdnjs; jsDelivr serves the npm package.
    { src: 'https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.js', integrity: 'sha384-u69h9ebXeSjlg6q/rb1zKTRAGu/h8deCl0409xpS/QJctMKnc4M9Fzkm01VOQdeF', global: null }
];

let loading = null;

function loadScript({ src, integrity }) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.integrity = integrity;
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve();
        el.onerror = () => reject(new Error(t('graph.cyLibFailed', { src })));
        document.head.appendChild(el);
    });
}

/** Loads cytoscape + dagre once (in order). Rejects if the CDN is unreachable/blocked. */
export function loadCytoscape() {
    if (window.cytoscape && window.cytoscapeDagreLoaded) return Promise.resolve(window.cytoscape);
    loading ||= (async () => {
        for (const lib of LIBS) {
            if (lib.global && window[lib.global]) continue;
            await loadScript(lib);
        }
        if (!window.cytoscape) throw new Error(t('graph.cyInitFailed'));
        window.cytoscapeDagreLoaded = true;
        return window.cytoscape;
    })().catch(err => { loading = null; throw err; });
    return loading;
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export async function renderCytoscapeGraph(viewport, { graph, names, onSelect }) {
    const cytoscape = await loadCytoscape();
    const set = new Set(names);
    const elements = [
        ...names.map(n => {
            const node = graph.get(n);
            return { data: { id: n, label: n, skin: node.kind === 'skin', unmet: !node.installed, unknown: node.installed && !node.known } };
        }),
        ...names.flatMap(n => (graph.get(n)?.requires || []).filter(d => set.has(d)).map(d => ({ data: { id: `${n}→${d}`, source: n, target: d } })))
    ];

    viewport.innerHTML = '';
    viewport.classList.add('graph-viewport--cy');
    const dep = css('--graph-dep') || '#36c', user = css('--graph-user') || '#b32424';
    const cy = cytoscape({
        container: viewport,
        elements,
        wheelSensitivity: 0.3,
        layout: { name: 'dagre', rankDir: 'RL', nodeSep: 12, rankSep: 70, edgeSep: 6, animate: false },
        style: [
            { selector: 'node', style: {
                label: 'data(label)', 'font-size': 11, 'text-valign': 'center', 'text-halign': 'center', shape: 'round-rectangle',
                width: 'label', height: 24, padding: '8px', 'background-color': css('--background-color-base') || '#fff',
                'border-width': 1, 'border-color': css('--border-color-interactive') || '#72777d', color: css('--color-base') || '#202122'
            } },
            { selector: 'node[?skin]', style: { 'border-style': 'dashed' } },
            { selector: 'node[?unknown]', style: { 'background-color': css('--background-color-neutral-subtle') || '#f8f9fa', 'border-color': css('--graph-unknown-border') || '#c8ccd1' } },
            { selector: 'node[?unmet]', style: { 'background-color': css('--background-color-error-subtle') || '#ffe9e5', 'border-color': css('--border-color-error') || '#f54739' } },
            { selector: 'edge', style: {
                width: 1, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8,
                'line-color': css('--border-color-interactive') || '#72777d', 'target-arrow-color': css('--border-color-interactive') || '#72777d', opacity: 0.7
            } },
            { selector: '.dim', style: { opacity: 0.12 } },
            { selector: 'node.sel', style: { 'background-color': css('--background-color-progressive-subtle') || '#e8eeff', 'border-color': dep, 'border-width': 2 } },
            { selector: 'edge.hot', style: { width: 2, 'line-color': dep, 'target-arrow-color': dep, opacity: 1 } },
            { selector: 'edge.hot-user', style: { width: 2, 'line-color': user, 'target-arrow-color': user, opacity: 1 } }
        ]
    });

    function select(name) {
        cy.elements().removeClass('dim sel hot hot-user');
        if (!name || !cy.getElementById(name).length) return;
        const deps = new Set([name, ...transitiveDeps(graph, [name])]);
        const users = new Set([name]);
        const stack = [name];
        while (stack.length) {
            for (const u of graph.get(stack.pop())?.requiredBy || []) {
                if (set.has(u) && !users.has(u)) { users.add(u); stack.push(u); }
            }
        }
        cy.elements().addClass('dim');
        cy.nodes().filter(n => deps.has(n.id()) || users.has(n.id())).removeClass('dim');
        cy.edges().forEach(e => {
            const s = e.source().id(), t = e.target().id();
            if (deps.has(s) && deps.has(t)) e.removeClass('dim').addClass('hot');
            else if (users.has(s) && users.has(t)) e.removeClass('dim').addClass('hot-user');
        });
        cy.getElementById(name).removeClass('dim').addClass('sel');
    }

    let selected = null;
    cy.on('tap', 'node', e => {
        const id = e.target.id();
        selected = id === selected ? null : id;
        select(selected);
        onSelect(selected);
    });
    cy.on('tap', e => {
        if (e.target === cy && selected) { selected = null; select(null); onSelect(null); }
    });

    return {
        select(name) { selected = name; select(name); },
        zoomIn: () => cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 } }),
        zoomOut: () => cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 } }),
        fit: () => cy.fit(undefined, 24),
        destroy() { cy.destroy(); viewport.classList.remove('graph-viewport--cy'); viewport.innerHTML = ''; }
    };
}
