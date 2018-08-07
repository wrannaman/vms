/* ====================== VMS  Runner ====================== */
const { node } = require('./connection/ipfs');
const { initialize } = require('./controller/init');
const { logger } = require('./util/logger'); // eslint-disable-line
const { discover } = require('./util/discovery'); // eslint-disable-line
const { db } = require('./connection/lowdb'); // eslint-disable-line

node.on('ready', initialize);
