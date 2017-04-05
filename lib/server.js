// This app serves some static content from a static path and serves a REST API that's
// defined on the api.json file (derived from a swagger 2.0 yml file)
// Usage:
// node server -h
// aApiFile, aModulePath, aAppName, aDefaultValues
// aOptions can have, beside a default value for any of the possible parameters:
//  - apiFile: The api file to load. By default './api.json'
//  - appName: (String) name of the app for the logs
//  - modulePath: Absolute Path where the api module implementation lives. Not needed if the
//    module is a node_modules module.
module.exports = function(aOptions) {
  'use strict';
  var aApiFile = aOptions.apiFile || './api.json';
  var aAppName = aOptions.appName;
  var aModulePath = aOptions.modulePath;

  var currentUid = process.getuid();
  var parseCommandLine = require('./command-line-parser');
  var setupProcess = require('./setup-process');
  const APP_NAME = aAppName || 'Swagger API implementation';

  // At this moment reads the cert and key as serverKey and serverCert, without password, from
  // aCertDir.
  function getServerConfig(aCertDir) {
    var certFileRead = readFile(aCertDir + '/serverCert.pem');
    var keyFileRead = readFile(aCertDir + '/serverKey.pem');
    return Promise.all([certFileRead, keyFileRead]).
      then(files => [{ cert: files[0], key: files[1] }]);
  }

  try {
    var options = parseCommandLine(aOptions);
    var Utils = require('./shared/utils');
    var fs = require('fs');
    var readFile = Utils.promisify(fs.readFile);

    var Logger = Utils.MultiLevelLogger;
    var logLevel =  options.logLevel.
      split(',').
      reduce((aPrevious, aElem) => aPrevious | Logger.DEFAULT_LEVELS[aElem], 0);
    var logger = new Logger(APP_NAME, logLevel);
    var staticPath = options.staticPath;
    var serverPort = options.serverPort;
    var serverType;
    var loadServerConfig;

    setupProcess(logger, options.daemon, options.logFile);

    if (options.secure) {
      serverType = require('https');
      loadServerConfig = getServerConfig(options.certDir);
    } else {
      serverType = require('http');
      loadServerConfig = Promise.resolve([]);
    }
  } catch (error) {
    console.error('Error configuring server: ', error.stack);
    process.exit(1);
  }

  function start() {

    // The API definition is on the api.json file...
    Promise.all([loadServerConfig, readFile(aApiFile)]).then(requisites => {
      var serverParams = requisites[0];
      var apiDef = requisites[1];
      logger.log('api.json file read');

      var app = require('./app')({
        staticPath: staticPath,
        apiDef: apiDef,
        modulePath: aModulePath,
        logLevel: logLevel
      });

      logger.log('Starting', options.secure ? 'secure' : '', 'server at', serverPort,
                ', static path: ', staticPath);

      if (app.reloadConfig) {
        setupProcess.SIGHUP.handler = app.reloadConfig;
        logger.log('Configuration handler set! To reload the configuration just do a kill -SIGHUP');
      }

      serverParams.push(app);
      serverType.createServer.apply(serverType, serverParams).
        listen(serverPort);

      // We're going to write the process PID at ./otrtc_{port}.pid. We could do that after
      // changing the user but it seems better just doing it here.
      var pidStream = fs.createWriteStream('./otrtc_' + serverPort + '.pid');
      pidStream.on('open', function() {
        pidStream.end(process.pid + '\n');
      });

      // We will only try to change the uid if it's different from the current one.
      if (options.user !== currentUid) {
        process.setuid(options.user); // And we'll hope for the best...
      }


    }).catch(error => {
      logger.error('Error starting server: ', error, error.stack);
      process.exit(1);
    });
  }

  return {
    start: start
  };
};

