import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, transitiveDeps, findCycles, topoOrder, computeLayers, analyzeGraph } from '../js/core/graph.js';
import { site, ext, manifest } from './fixtures.js';

const s = site('a', { extensions: [ext('A'), ext('B'), ext('C'), ext('Lonely')] });
const manifests = {
    A: manifest('A', { extensions: { B: '*' } }),
    B: manifest('B', { extensions: { C: '*', Ghost: '*' } }),
    C: manifest('C'),
    Lonely: manifest('Lonely')
};

test('buildGraph links requires/requiredBy and adds uninstalled targets', () => {
    const g = buildGraph(s, manifests);
    assert.deepEqual(g.get('A').requires, ['B']);
    assert.deepEqual(g.get('B').requiredBy, ['A']);
    assert.equal(g.get('Ghost').installed, false);
    assert.deepEqual(g.get('Ghost').requiredBy, ['B']);
});

test('transitiveDeps', () => {
    const g = buildGraph(s, manifests);
    assert.deepEqual([...transitiveDeps(g, ['A'])].sort(), ['B', 'C', 'Ghost']);
    assert.deepEqual([...transitiveDeps(g, ['C'])], []);
});

test('topoOrder puts dependencies first, stable alphabetical ties', () => {
    const g = buildGraph(s, manifests);
    const { order, cyclic } = topoOrder(g, ['A', 'B', 'C', 'Ghost']);
    assert.deepEqual(cyclic, []);
    assert.ok(order.indexOf('C') < order.indexOf('B'));
    assert.ok(order.indexOf('Ghost') < order.indexOf('B'));
    assert.ok(order.indexOf('B') < order.indexOf('A'));
    // Ties are broken alphabetically among nodes that are ready at each step.
    assert.deepEqual(topoOrder(g, ['C', 'Lonely', 'A', 'B']).order, ['C', 'B', 'A', 'Lonely']);
    assert.deepEqual(topoOrder(g, ['C', 'Lonely', 'A', 'B']).order, topoOrder(g, ['Lonely', 'B', 'A', 'C']).order);
});

test('cycles are detected and do not hang topoOrder', () => {
    const cs = site('c', { extensions: [ext('X'), ext('Y'), ext('Z')] });
    const g = buildGraph(cs, {
        X: manifest('X', { extensions: { Y: '*' } }),
        Y: manifest('Y', { extensions: { X: '*' } }),
        Z: manifest('Z')
    });
    const cycles = findCycles(g);
    assert.equal(cycles.length, 1);
    assert.deepEqual([...cycles[0]].sort(), ['X', 'Y']);
    const { order, cyclic } = topoOrder(g, ['X', 'Y', 'Z']);
    assert.deepEqual(cyclic, ['X', 'Y']);
    assert.equal(order.length, 3);
    assert.equal(order[0], 'Z');
});

test('computeLayers: longest path', () => {
    const g = buildGraph(s, manifests);
    const layers = computeLayers(g);
    const layerOf = n => layers.findIndex(l => l.includes(n));
    assert.equal(layerOf('C'), 0);
    assert.equal(layerOf('Ghost'), 0);
    assert.equal(layerOf('B'), 1);
    assert.equal(layerOf('A'), 2);
});

test('analyzeGraph reports unmet, isolated, unknown', () => {
    const partial = { A: manifests.A, B: manifests.B }; // C and Lonely have no manifests
    const g = buildGraph(s, partial);
    const r = analyzeGraph(g);
    assert.deepEqual(r.unmet.map(n => n.name).sort(), ['Ghost']);
    assert.deepEqual(r.unknown.map(n => n.name).sort(), ['C', 'Lonely']);
    assert.deepEqual(r.isolated.map(n => n.name), ['Lonely']);
});

test('skins (type: skin) are graph nodes of kind skin', () => {
    const ss = site('s', { extensions: [ext('Vector', '1.0', { type: 'skin' }), ext('Foo')] });
    const g = buildGraph(ss, { Foo: manifest('Foo', { skins: { Vector: '*' } }) });
    assert.equal(g.get('Vector').kind, 'skin');
    assert.deepEqual(g.get('Foo').requires, ['Vector']);
});
