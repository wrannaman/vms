const IPFS = require('ipfs')
const { ipfs_root } = require('../config.json');
const node = new IPFS({
  repo: ipfs_root,
  log: null,
});

module.exports.node = node;
