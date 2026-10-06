import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../js/views/graph-svg.js';
import { buildGraph } from '../js/core/graph.js';
import { site, ext, manifest } from './fixtures.js';

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('dependencies sit left of their dependents', () => {
    const s = site('s', { extensions: [ext('A'), ext('B'), ext('C')] });
    const g = buildGraph(s, { A: manifest('A', { extensions: { B: '*' } }), B: manifest('B', { extensions: { C: '*' } }), C: manifest('C') });
    const { positions } = layoutGraph(g, ['A', 'B', 'C']);
    assert.ok(positions.get('C').x < positions.get('B').x);
    assert.ok(positions.get('B').x < positions.get('A').x);
});

test('isolated nodes are wrapped into a grid instead of one tall column', () => {
    const names = Array.from({ length: 100 }, (_, i) => `Ext${String(i).padStart(3, '0')}`);
    const g = buildGraph(site('s', { extensions: [ext('Dep'), ext('User'), ...names.map(n => ext(n))] }), {
        User: manifest('User', { extensions: { Dep: '*' } })
    });
    const all = ['Dep', 'User', ...names];
    const { positions, width, height } = layoutGraph(g, all);

    assert.equal(positions.size, all.length);
    assert.ok(height < 1200, `height ${height} should be far below a 100-row column (~4000)`);
    assert.ok(width > 700 && width <= 1000, `width ${width}: a grid roughly 900px wide (quantized to whole columns)`);
    // Isolated nodes sit below the connected part
    const connectedBottom = Math.max(positions.get('Dep').y, positions.get('User').y) + 26;
    assert.ok(names.every(n => positions.get(n).y >= connectedBottom));
});

test('no two nodes overlap', () => {
    const names = Array.from({ length: 40 }, (_, i) => `N${i}`);
    const exts = names.map(n => ext(n));
    const manifests = {};
    for (let i = 1; i < 15; i++) manifests[names[i]] = manifest(names[i], { extensions: { [names[i - 1]]: '*', [names[(i * 7) % 15]]: '*' } });
    const g = buildGraph(site('s', { extensions: exts }), manifests);
    const { positions } = layoutGraph(g, names);
    const boxes = [...positions.values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        assert.ok(!overlaps(boxes[i], boxes[j]), `nodes ${i} and ${j} overlap`);
    }
});

test('empty and all-isolated inputs do not throw', () => {
    const g = buildGraph(site('s', { extensions: [ext('Solo')] }), {});
    assert.equal(layoutGraph(g, []).positions.size, 0);
    assert.equal(layoutGraph(g, ['Solo']).positions.size, 1);
});
