// Returns a configured Express app that implements a basic server based on a Swagger API
// definition. The Swagger dictionary is expanded with the following keys:
// x-implementation-module: Module that holds the implementation of all the defined methods.
//   It must be a string resolvable by require(), so either a local path or a module name. All the
//   rest of the names must be exposed in this module.
// x-implementation-middleware: Array of methods that will be invoked for all the paths
// x-implementation-configuration: Method that will be called *once* before starting the app, to
//   allow any pre-configuration needed. It must return a promise.
// x-implemented-in: For any given exposed API, the method that implements it. Must conform to the
//   express method definition. If the key is used on a Security Definition, it's the module (also
//   as a express Middleware) that implements the authentication.
// x-implementation-final-middleware: Array of last middleware on the chain (usually error handlers)
// The app also exposes the Util file as /shared/js/Utils.js in case you want to use it.
//
// Also, if you tag some API with CORS, then it will be CORS promiscuous (at this moment, its an
// all or nothing sorry)
module.exports = function App(aOptions, aModules) {
  'use strict';

  var aStaticPath = aOptions.staticPath;
  var api = aOptions.apiDef;
  var aLogLevel = aOptions.logLevel;
  var aModulePath = aOptions.modulePath;

  var Utils = require('./shared/utils');
  var Logger = Utils.MultiLevelLogger;
  var logger = new Logger('HTTP Server App', aLogLevel);

  var corsTemplate = function(aAllowedOrigins, aAllowedHeaders, aMethod, aReq, aRes, aNext) {
    logger.log('Enabling CORS for:', aReq.path);
    aRes.header('Access-Control-Allow-Origin', aAllowedOrigins);
    aRes.header('Access-Control-Allow-Headers', aAllowedHeaders);
    aRes.header('Access-Control-Allow-Methods', [aMethod, 'OPTIONS'].join(','));
    aNext();
  };

  var enableCORS = ['put', 'get', 'post', 'delete'].reduce((aPrevious, aVerb) => {
    aPrevious[aVerb] = corsTemplate.bind(undefined, '*', 'Content-Type', aVerb.toUpperCase());
    return aPrevious;
  }, {});

  var doOptions = (aReq, aRes) => {
    // Not much to do here really since CORS is already taken care of
    logger.log('Accepting preflight for:', aReq.path);
    aRes.send('{}');
  };

  logger.log('Starting process');

  var paths = api.paths;

  // This holds the module that implements the methods...
  var implModule = api['x-implementation-module'];
  logger.log('Loading implementation module:', implModule);

  var serverImpl = new (require((aModulePath || '') + implModule))(aLogLevel, aModules);

  logger.log('Implementation module (', implModule, ') read!');

  var express = require('express');
  var app = express();

  logger.log('Setting shared directory /shared/js handler to', __dirname + '/shared');
  app.use('/shared/js', express.static(__dirname + '/shared'));
  app.use(express.static(aStaticPath));

  // Use body-parse to fetch the parameters
  var bodyParser = require('body-parser');
  var urlencodedParser = bodyParser.urlencoded({extended: false});
  // create application/json parser
  var jsonParser = bodyParser.json();

  // This is required by passport OAuth modules...
  if (process.env.SESSION_SECRET) {
    logger.log('Enabling session management');
    var sessionMiddleware = require('express-session');
    app.use(sessionMiddleware({ secret: process.env.SESSION_SECRET }));
  }

  app.enable('trust proxy');
  // And use EJS as a view engine
  app.set('view engine', 'ejs');

  // Add the middleware, if needed
  var middleware = api['x-implementation-middleware'];
  if (middleware) {
    middleware = Array.isArray(middleware) ? middleware : [ middleware ];
    middleware.forEach(aMiddleware => {
      logger.log('Using middleware: ', aMiddleware, !!serverImpl[aMiddleware]);
      serverImpl[aMiddleware] && app.use(serverImpl[aMiddleware]);
    });
  }

  var securityDefinitions = api.securityDefinitions;
  var securityImpl = {};
  securityDefinitions && Object.keys(securityDefinitions).forEach(authType => {
    securityImpl[authType] = serverImpl[securityDefinitions[authType]['x-implemented-in']];
  });

  // Does the implementation require configuration?
  var configureApp = serverImpl[api['x-implementation-configuration']];

  // And add the implementation functions for each paths
  Object.keys(paths).forEach(path => {
    Object.keys(paths[path]).forEach(verb => {
      var expressifiedPath = path.replace(/{/g, ':').replace(/}/g,'');
      var apiInfo = paths[path][verb];
      var implementation = apiInfo['x-implemented-in'];
      if (!serverImpl[implementation]) {
        throw new Error(implementation + ' is not defined (' + verb + ' ' + path + ')');
      }
      logger.log('Adding ' + verb + ': ' + expressifiedPath + ' => ' + implementation);
      if (apiInfo.security && Array.isArray(apiInfo.security)) {
        apiInfo.security.forEach(secInfo => {
          Object.keys(secInfo).forEach(authType => {
            if (!securityImpl[authType]) {
              logger.error('Incorrect authentication for: ', authType);
              throw "INCORRECT_AUTHENTICATION";
            }
            logger.log(expressifiedPath, '=> Setting auth:', authType);
            app.use(expressifiedPath, securityImpl[authType].bind(undefined, expressifiedPath));
          });
        });
      }
      if (apiInfo.tags && Array.isArray(apiInfo.tags) && apiInfo.tags.indexOf('CORS') >= 0) {
        app[verb](expressifiedPath, enableCORS[verb]);
        app.options(expressifiedPath, enableCORS[verb], doOptions);
      }
      if (verb === 'post' || verb === 'delete' || verb === 'put') {
        var parameters = apiInfo.parameters;
        // If there is any parameter that is in form format use the urlencoded parser, otherwise
        // use the json parser. Note that according to the spec body and formData are exclusive!
        var parser =
          (parameters.some(spec => spec.in === 'formData') && urlencodedParser) || jsonParser;
        app[verb](expressifiedPath, parser, serverImpl[implementation]);
      } else {
        app[verb](expressifiedPath, serverImpl[implementation]);
      }
    });
  });

  // Add the post middleware (usually error handlers), if needed
  var postmiddleware = api['x-implementation-final-middleware'];
  if (postmiddleware) {
    postmiddleware = Array.isArray(postmiddleware) ? postmiddleware : [postmiddleware];
    postmiddleware.forEach(aMiddleware => {
      logger.log('Using final middleware: ', aMiddleware, !!serverImpl[aMiddleware]);
      serverImpl[aMiddleware] && app.use(serverImpl[aMiddleware]);
    });
  }


  // I don't need this anymore.
  api = null;
  if (configureApp) {
    configureApp().catch(e => {
      logger.error('Error configuring: ', e);
      // If there's an error while (re)configuring, we should just exit.
      throw new Error('FATAL: Error configuring app!');
    });
    app.reloadConfig = configureApp;
  }
  return app;
};
