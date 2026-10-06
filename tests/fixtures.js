// Small hand-built sites/manifests shared by tests.

export const ext = (name, version = '1.0', extra = {}) => ({
    name, version, url: null, description: null, type: 'other', vcsUrl: null, vcsVersion: null, ...extra
});

export const site = (label, over = {}) => ({
    id: label, label, source: 'api', apiUrl: `https://${label}.example/w/api.php`, fetchedAt: 0,
    mwVersion: '1.43.1', branch: 'REL1_43', php: '8.2.0', dbtype: 'mysql',
    extensions: [], skins: [], libraries: [], extensiontags: [], functionhooks: [], namespaces: [], manifests: {},
    ...over
});

export const manifest = (name, requires = {}, over = {}) => ({
    name, repo: name.replace(/\s+/g, ''), kind: 'extension', requested: 'REL1_43', usedBranch: 'REL1_43',
    branchMissing: false, version: '1.0', source: 'github',
    requires: { MediaWiki: null, php: null, phpExt: [], extensions: {}, skins: {}, ...requires },
    ...over
});
