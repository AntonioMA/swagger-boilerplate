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
  const aApiFile = aOptions.apiFile || './api.json';
  const aAppName = aOptions.appName;
  const aModulePath = aOptions.modulePath;

  const parseCommandLine = require('./command-line-parser');
  const setupProcess = require('./setup-process');
  const APP_NAME = aAppName || 'Swagger API implementation';
  const Utils = require('./shared/utils');
  const Logger = Utils.MultiLevelLogger;
  const fs = require('fs');
  const readFile = Utils.promisify(fs.readFile);

  // At this moment reads the cert and key as serverKey and serverCert, without password, from
  // aCertDir.
  function getServerConfig(aCertDir) {
    const certFileRead = readFile(aCertDir + '/serverCert.pem');
    const keyFileRead = readFile(aCertDir + '/serverKey.pem');
    return Promise.all([certFileRead, keyFileRead]).
      then(files => [{ cert: files[0], key: files[1] }]);
  }

  const options = parseCommandLine(aOptions);
  const logLevel = options.logLevel.
    split(',').
    reduce((aPrevious, aElem) => aPrevious | Logger.DEFAULT_LEVELS[aElem], 0);
  const logger = new Logger(APP_NAME, logLevel);
  const {
    staticPath,
    serverPort,
  } = options;
  const staticOptions = options.staticOptions || {};
  const allowedCORSOrigins = options.allowedCORSOrigins.split(',');

  let serverType;
  let loadServerConfig;
  let processSetup;

  try {
    processSetup = setupProcess(logger, options.daemon, options.logFile);

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
    const YAML = require('yamljs');
    // Sadly YAML.load doesn't comply with the usual scheme of returning the error as first
    // parameter, so we can't use promisify
    const loadYAML =
     apiFile => new Promise((resolve, reject) => {
       try {
         YAML.load(apiFile, result => resolve(result));
       } catch (e) {
         reject(e);
       }
     });

    // The API definition is on the api.yml file...
    Promise.all([loadServerConfig, loadYAML(aApiFile), processSetup]).then((requisites) => {
      const serverParams = requisites[0];
      const apiDef = requisites[1];
      logger.log('api.yml file read');

      const app = require('./app')({
        staticPath,
        staticOptions,
        apiDef,
        allowedCORSOrigins,
        logLevel,
        modulePath: aModulePath,
      });

      logger.log(
        'Starting', options.secure ? 'secure' : '', 'server at', serverPort,
        ', static path: ', staticPath);

      if (app.reloadConfig) {
        setupProcess.SIGHUP.handler = app.reloadConfig;
        logger.log('Configuration handler set! To reload the configuration just do a kill -SIGHUP');
      }

      serverParams.push(app);
      serverType.createServer.apply(serverType, serverParams).
        listen(serverPort);

      // Azure App Service ports are actually pipes like "\\.\pipe\3212d91e-bc1a-4720-8792-49cf5f9eba86"
      let serverPortRaw = String.raw`${options.serverPort}`;
      let pidStreamId = serverPortRaw.replace("\\\\.\\pipe\\", '');

      logger.log('serverPort is ', serverPortRaw);
      logger.log('pidStreamId is ', pidStreamId);
      
      // We're going to write the process PID at ./otrtc_{port}.pid. We could do that after
      // changing the user but it seems better just doing it here.
      const pidStream = fs.createWriteStream('./otrtc_' + pidStreamId + '.pid');
      pidStream.on('open', () => pidStream.end(process.pid + '\n'));

      // We will only try to change the uid if it's different from the current one.
      const currentUid = typeof process.getuid === 'function' && process.getuid() || null;

      if (options.user !== currentUid) {
        process.setuid(options.user); // And we'll hope for the best...
      }


    }).catch((error) => {
      logger.error('Error starting server: ', error, error.stack);
      process.exit(1);
    });
  }

  return {
    start,
  };
};

