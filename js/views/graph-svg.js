// Dependency-free layered SVG graph with pan/zoom, selection highlight and keyboard access.

import { escapeHtml } from '../util.js';
import { t } from '../i18n.js';
import { computeLayers, transitiveDeps } from '../core/graph.js';

const NODE_H = 26, ROW_GAP = 12, COL_GAP = 90, PAD = 24;
const nodeWidth = name => Math.max(64, Math.min(260, name.length * 7.2 + 24));

/** Barycenter ordering to reduce edge crossings (a few sweeps; good enough for a few hundred nodes). */
function orderLayers(graph, layers) {
    const pos = new Map();
    const reindex = () => layers.forEach(l => l.forEach((n, i) => pos.set(n, i)));
    reindex();
    const bary = (n, neighbors) => {
        const ps = neighbors.filter(x => pos.has(x)).map(x => pos.get(x));
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(n);
    };
    for (let pass = 0; pass < 4; pass++) {
        const forward = pass % 2 === 0;
        const seq = forward ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i);
        for (const li of seq) {
            layers[li].sort((a, b) => {
                const na = graph.get(a), nb = graph.get(b);
                const ba = bary(a, forward ? na.requires : na.requiredBy);
                const bb = bary(b, forward ? nb.requires : nb.requiredBy);
                return ba - bb || a.localeCompare(b);
            });
            layers[li].forEach((n, i) => pos.set(n, i));
        }
    }
}

const MIN_GRID_WIDTH = 900;
const MIN_FIT_SCALE = 0.45;

/**
 * Connected nodes go in dependency layers (left → right); nodes with no edges inside the visible set go in a
 * wrapped grid underneath, so a wiki with 100 independent extensions doesn't produce one 4000px column.
 */
export function layoutGraph(graph, names) {
    const set = new Set(names);
    const connected = names.filter(n => {
        const node = graph.get(n);
        return node.requires.some(d => set.has(d)) || node.requiredBy.some(u => set.has(u));
    });
    const connectedSet = new Set(connected);
    const isolated = names.filter(n => !connectedSet.has(n)).sort((a, b) => a.localeCompare(b));

    const layers = computeLayers(graph, connected).filter(l => l.length);
    orderLayers(graph, layers);
    const positions = new Map();
    let x = PAD;
    let maxH = connected.length ? 0 : PAD;
    for (const layer of layers) {
        const w = Math.max(...layer.map(nodeWidth));
        layer.forEach((name, i) => {
            positions.set(name, { x, y: PAD + i * (NODE_H + ROW_GAP), w: nodeWidth(name), h: NODE_H });
        });
        maxH = Math.max(maxH, PAD + layer.length * (NODE_H + ROW_GAP));
        x += w + COL_GAP;
    }
    let width = layers.length ? x - COL_GAP + PAD : PAD * 2;

    if (isolated.length) {
        const cell = Math.max(...isolated.map(nodeWidth)) + 16;
        const gridWidth = Math.max(width, MIN_GRID_WIDTH);
        const cols = Math.max(1, Math.floor((gridWidth - PAD * 2 + 16) / cell));
        const top = connected.length ? maxH + PAD : PAD;
        isolated.forEach((name, i) => {
            positions.set(name, {
                x: PAD + (i % cols) * cell, y: top + Math.floor(i / cols) * (NODE_H + ROW_GAP), w: nodeWidth(name), h: NODE_H
            });
        });
        maxH = top + Math.ceil(isolated.length / cols) * (NODE_H + ROW_GAP);
        width = Math.max(width, PAD * 2 + Math.min(cols, isolated.length) * cell - 16);
    }
    return { positions, width, height: maxH + PAD };
}

/**
 * @param {HTMLElement} viewport
 * @param {{graph: Map, names: string[], onSelect: (name: string|null) => void, userNames?: Set<string>}} opts
 */
export function renderSvgGraph(viewport, { graph, names, onSelect }) {
    const nameSet = new Set(names);
    const { positions, width, height } = layoutGraph(graph, names);
    const edges = [];
    for (const n of names) {
        for (const d of graph.get(n)?.requires || []) {
            if (nameSet.has(d)) edges.push([n, d]);
        }
    }

    const nodeClass = n => {
        const node = graph.get(n);
        return ['g-node', node.kind === 'skin' ? 'g-node--skin' : '', !node.installed ? 'g-node--unmet' : '',
            node.installed && !node.known ? 'g-node--unknown' : ''].filter(Boolean).join(' ');
    };

    const edgePath = ([from, to]) => {
        const a = positions.get(from), b = positions.get(to);
        // From the dependent's left edge to the dependency's right edge (dependencies sit to the left).
        const x1 = a.x, y1 = a.y + a.h / 2, x2 = b.x + b.w, y2 = b.y + b.h / 2;
        const dx = Math.max(30, Math.abs(x1 - x2) / 2);
        return `M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`;
    };

    viewport.innerHTML = `
        <svg role="group" aria-label="${escapeHtml(t('graph.svgLabel'))}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <marker id="g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" class="g-arrow"/>
                </marker>
            </defs>
            <g class="g-root">
                <g class="g-edges">${edges.map(([f, t], i) => `<path class="g-edge" data-edge="${i}" d="${edgePath([f, t])}" marker-end="url(#g-arrow)"/>`).join('')}</g>
                <g class="g-nodes">${names.map(n => {
                    const p = positions.get(n);
                    return `<g class="${nodeClass(n)}" data-name="${escapeHtml(n)}" tabindex="0" role="button" aria-label="${escapeHtml(n)}" transform="translate(${p.x},${p.y})">
                        <title>${escapeHtml(n)}</title>
                        <rect width="${p.w}" height="${p.h}"/>
                        <text x="${p.w / 2}" y="${p.h / 2 + 4}" text-anchor="middle">${escapeHtml(n.length > 34 ? n.slice(0, 33) + '…' : n)}</text>
                    </g>`;
                }).join('')}</g>
            </g>
        </svg>`;

    const svg = viewport.querySelector('svg');
    const root = svg.querySelector('.g-root');
    const nodeEls = new Map([...svg.querySelectorAll('.g-node')].map(el => [el.dataset.name, el]));
    const edgeEls = [...svg.querySelectorAll('.g-edge')];

    /* ---------- pan / zoom ---------- */
    const view = { k: 1, x: 0, y: 0 };
    let userMoved = false; // once the user pans/zooms, a later resize must not undo it
    const apply = () => root.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    function fit() {
        const r = viewport.getBoundingClientRect();
        if (!r.width || !r.height || !width) return false;
        // Prefer a readable scale over showing everything: a tall graph is panned vertically rather than shrunk to nothing.
        const k = Math.min(1, r.width / width, Math.max(r.height / height, MIN_FIT_SCALE));
        view.k = k;
        view.x = Math.max(0, (r.width - width * k) / 2);
        view.y = 0;
        apply();
        return true;
    }
    function zoomAt(factor, cx, cy) {
        userMoved = true;
        const k = Math.min(3, Math.max(0.1, view.k * factor));
        view.x = cx - (cx - view.x) * (k / view.k);
        view.y = cy - (cy - view.y) * (k / view.k);
        view.k = k;
        apply();
    }
    const center = () => { const r = viewport.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };

    viewport.addEventListener('wheel', e => {
        e.preventDefault();
        const r = viewport.getBoundingClientRect();
        zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    let drag = null;
    viewport.addEventListener('pointerdown', e => {
        if (e.target.closest('.g-node')) return;
        userMoved = true;
        drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        viewport.setPointerCapture(e.pointerId);
        viewport.classList.add('is-panning');
    });
    viewport.addEventListener('pointermove', e => {
        if (!drag) return;
        view.x = drag.vx + e.clientX - drag.x;
        view.y = drag.vy + e.clientY - drag.y;
        apply();
    });
    const endDrag = () => { drag = null; viewport.classList.remove('is-panning'); };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    /* ---------- selection ---------- */
    let selected = null;
    function select(name) {
        selected = name && nodeEls.has(name) ? name : null;
        const deps = selected ? transitiveDeps(graph, [selected]) : new Set();
        const users = new Set();
        if (selected) {
            const stack = [selected];
            while (stack.length) {
                for (const u of graph.get(stack.pop())?.requiredBy || []) {
                    if (!users.has(u)) { users.add(u); stack.push(u); }
                }
            }
        }
        for (const [n, el] of nodeEls) {
            el.classList.toggle('is-selected', n === selected);
            el.classList.toggle('is-dep', deps.has(n));
            el.classList.toggle('is-user', users.has(n));
            el.classList.toggle('is-dim', !!selected && n !== selected && !deps.has(n) && !users.has(n));
        }
        edges.forEach(([f, t], i) => {
            const el = edgeEls[i];
            const down = selected && (f === selected || deps.has(f)) && deps.has(t);
            const up = selected && (t === selected || users.has(t)) && users.has(f);
            el.classList.toggle('is-hot', !!down);
            el.classList.toggle('is-hot-user', !!up);
            el.classList.toggle('is-dim', !!selected && !down && !up);
        });
    }

    svg.addEventListener('click', e => {
        const node = e.target.closest('.g-node');
        const name = node ? node.dataset.name : null;
        const next = name === selected ? null : name;
        select(next);
        onSelect(next);
    });
    svg.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.g-node')) {
            e.preventDefault();
            e.target.closest('.g-node').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    });

    fit();
    // The viewport can have no size yet (drawn while its tab is hidden, or before layout): fit once it does.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (!userMoved) fit(); });
    observer?.observe(viewport);
    return {
        select,
        zoomIn: () => zoomAt(1.25, ...center()),
        zoomOut: () => zoomAt(1 / 1.25, ...center()),
        fit: () => { userMoved = false; fit(); },
        destroy() { observer?.disconnect(); viewport.innerHTML = ''; }
    };
}
