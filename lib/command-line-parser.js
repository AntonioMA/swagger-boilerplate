'use strict';
var currentUid = typeof process.getuid === 'function' && process.getuid() || null;
var Utils = require('./shared/utils');

const DEFAULTS = {
  daemon: false,
  logFile: undefined,
  logLevel: 'error,warn,log',
  user: currentUid,
  serverPort: process.env.PORT || 8123,
  staticPath: './web',
  certDir: 'serverCerts',
  serverLibs: '',
  secure: false
};

const OPTIONS_HELP = [
  ['h', 'help', 'Displays this help.'],
  ['d', 'daemon', 'Starts as a daemon.'],
  ['l', 'logFile=ARG', 'Logs output to this file, only if started as a daemon.'],
  ['L', 'logLevel=ARG', 'Desired log level, expressed as a string such as "warn,error"'],
  ['u', 'user=ARG', 'UID (name or number) to fork to after binding the port.'],
  ['p',
      'serverPort=ARG',
      'Server listening port. If not present it uses either the PORT env variable or' +
      ' the 8123 port'],
   ['s', 'staticPath=ARG', 'Directory that holds the static files.'],
   ['C', 'certDir=ARG', 'Directory that holds the cert.pem and key.pem files.'],
   ['S', 'secure', 'Starts as a secure server (HTTPS).'],
   ['o', 'allowedCORSOrigins', 'Comma separated list of allowed CORS origins']
];


function parseCommandLine(aDefaultValues) {
  aDefaultValues = aDefaultValues || {};
  var disabledOptions = [];

  if (currentUid === null) {
    disabledOptions.push('u');
  }

  // node-getopt oneline example.
  var optionsHelp = OPTIONS_HELP.filter(e => disabledOptions.indexOf(e[0]) === -1);

  var commandOpts =
    require('node-getopt').create(optionsHelp).
    bindHelp().
    parseSystem();
  var options = Utils.extendCopy(DEFAULTS, aDefaultValues);
  options = Utils.extendCopy(options, commandOpts.options);

  // We will only try to change the uid if it's different from the current one. And we'll refuse
  // if we're not root...
  // We fail on this as soon as possible. No need initializing the rest only to die.
  if ((options.user !== currentUid) && (currentUid !== 0)) {
    throw new Error('Cannot set -u if not running as root!');
  }
  return options;
}

module.exports = parseCommandLine;
