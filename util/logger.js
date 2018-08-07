const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, prettyPrint, printf } = format;
const { log_level } = require('../config');

const myFormat = printf(info => {
  // console.log('INFO', info)
  return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`;
});

const logger = createLogger({
  level: log_level || 0,
  format: combine(
    label({ label: 'vms' }),
    timestamp(),
    prettyPrint(),
    myFormat
  ),
  transports: [new transports.Console()]
})

logger.log({
  level: 'info',
  message: 'Startup'
});

module.exports.logger = logger;
