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

  const ALLOWED_ORIGINS = aOptions.allowedCORSOrigins;
  const MUST_PARSE_ORIGIN =
   Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.indexOf('*') === -1;
  const getOriginHeader = (aReq) => {
    if (!MUST_PARSE_ORIGIN) {
      return '*';
    }
    return (ALLOWED_ORIGINS.indexOf(aReq.headers.origin) !== -1 && aReq.headers.origin) || null;
  };

  const aStaticPath = aOptions.staticPath;
  let api = aOptions.apiDef;
  const aLogLevel = aOptions.logLevel;
  const aModulePath = aOptions.modulePath;
  const aStaticOptions = aOptions.staticOptions || {};

  const Utils = require('./shared/utils');
  const Logger = Utils.MultiLevelLogger;
  const logger = new Logger('HTTP Server App', aLogLevel);

  const corsTemplate = function(aAllowedHeaders, aMethod, aReq, aRes, aNext) {
    logger.log('Enabling CORS for:', aReq.path);
    const origin = getOriginHeader(aReq);
    if (!origin) {
      return aNext();
    }
    aRes.header('Access-Control-Allow-Origin', origin);
    aRes.header('Access-Control-Allow-Headers', aAllowedHeaders);
    aRes.header('Access-Control-Allow-Methods', [aMethod, 'OPTIONS'].join(','));
    if (origin !== '*') {
      aRes.header('Vary', 'Origin');
    }
    return aNext();
  };

  const enableCORS = ['put', 'get', 'post', 'delete', 'patch'].reduce((aPrevious, aVerb) => {
    aPrevious[aVerb] = corsTemplate.bind(undefined, 'Content-Type', aVerb.toUpperCase());
    return aPrevious;
  }, {});

  const doOptions = (aReq, aRes) => {
    // Not much to do here really since CORS is already taken care of
    logger.log('Accepting preflight for:', aReq.path);
    aRes.send('{}');
  };

  logger.log('Starting process');

  const { paths, securityDefinitions } = api;

  // This holds the module that implements the methods...
  const implModule = api['x-implementation-module'];
  logger.log('Loading implementation module:', implModule);

  const serverImpl = new (require((aModulePath || '') + implModule))(aLogLevel, aModules);

  logger.log('Implementation module (', implModule, ') read!');

  const express = require('express');
  const app = express();
  const Path = require('path');
  const sharedStaticPath = Path.join(__dirname, 'shared');

  logger.log('Setting shared directory /shared/js handler to', sharedStaticPath);
  app.use('/shared/js', express.static(sharedStaticPath));
  app.use(express.static(aStaticPath, aStaticOptions));

  // Use body-parse to fetch the parameters
  const bodyParser = require('body-parser');
  const urlencodedParser = bodyParser.urlencoded({ extended: false });
  // create application/json parser
  const jsonParser = bodyParser.json();

  // This is required by passport OAuth modules...
  if (process.env.SESSION_SECRET) {
    logger.log('Enabling session management');
    const sessionMiddleware = require('express-session');
    app.use(sessionMiddleware({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }));
  }

  app.enable('trust proxy');
  // And use EJS as a view engine
  app.set('view engine', 'ejs');

  // Add the middleware, if needed
  let middleware = api['x-implementation-middleware'];
  if (middleware) {
    middleware = Array.isArray(middleware) ? middleware : [middleware];
    middleware.forEach((aMiddleware) => {
      logger.log('Using middleware: ', aMiddleware, !!serverImpl[aMiddleware]);
      serverImpl[aMiddleware] && app.use(serverImpl[aMiddleware]);
    });
  }

  const securityImpl = {};
  securityDefinitions && Object.keys(securityDefinitions).forEach((authType) => {
    securityImpl[authType] = serverImpl[securityDefinitions[authType]['x-implemented-in']];
  });


  let multipartParser;
  // Does the implementation require configuration?
  const configureApp = serverImpl[api['x-implementation-configuration']];
  let appConfigured = Promise.resolve();
  if (configureApp) {
    appConfigured = configureApp().
      then((config) => {
      // Create a multer middleware for multipart/form-data files. Note that this has to
      // be done *after* the app configuration
        const multer = require('multer');

        let getStorageOptions = api['x-multipart-options'];
        getStorageOptions = getStorageOptions && serverImpl[getStorageOptions];
        const multipartOptions = getStorageOptions && getStorageOptions(config, multer);
        multipartParser = multer(multipartOptions);

        // We can also check if there is some extra static paths to be added
        let getStaticPaths = api['x-static-paths'];
        getStaticPaths = getStaticPaths && serverImpl[getStaticPaths];
        const staticPaths = getStaticPaths && getStaticPaths(config) || [];
        staticPaths.forEach((aStaticPathInfo) => {
          logger.log('Adding static path:', aStaticPathInfo.path, 'as', aStaticPathInfo.url);
          app.use(aStaticPathInfo.url, express.static(aStaticPathInfo.path));
        });
      }).
      catch((e) => {
        logger.error('Error configuring: ', e);
        // If there's an error while (re)configuring, we should just exit.
        throw new Error('FATAL: Error configuring app!');
      });
    app.reloadConfig = configureApp;
  }

  // And add the implementation functions for each paths
  appConfigured.then(() => {
    Object.keys(paths).forEach((path) => {
      Object.keys(paths[path]).forEach((verb) => {
        const expressifiedPath = path.replace(/{/g, ':').replace(/}/g, '');
        const apiInfo = paths[path][verb];
        const implementation = apiInfo['x-implemented-in'];
        if (!serverImpl[implementation]) {
          throw new Error(implementation + ' is not defined (' + verb + ' ' + path + ')');
        }
        logger.trace('Adding', verb + ': ', expressifiedPath, '=>', implementation);
        const securityMW = [];
        if (apiInfo.security && Array.isArray(apiInfo.security)) {
          apiInfo.security.forEach((secInfo) => {
            Object.keys(secInfo).forEach((authType) => {
              if (!securityImpl[authType]) {
                logger.error('Incorrect authentication for: ', authType);
                throw new Error('INCORRECT_AUTHENTICATION');
              }
              logger.trace(' ', expressifiedPath, '=> Setting auth:', authType);
              securityMW.push(securityImpl[authType].bind(undefined, expressifiedPath));
            });
          });
        }
        if (apiInfo.tags && Array.isArray(apiInfo.tags) && apiInfo.tags.indexOf('CORS') >= 0) {
          app[verb](expressifiedPath, enableCORS[verb]);
          app.options(expressifiedPath, enableCORS[verb], doOptions);
        }
        if (verb === 'post' || verb === 'delete' || verb === 'put' || verb === 'patch') {
          const { parameters } = apiInfo;

          const formFields = parameters.filter(spec => spec.in === 'formData');
          const fileFields = formFields.filter(spec => spec.type === 'file');
          logger.trace(
            ' ', verb, expressifiedPath, 'Parameters => Total:', parameters.length,
            'FormData:', formFields.length, 'File:', fileFields.length);

          let parser = formFields.length > 0 && urlencodedParser || jsonParser;
          if (fileFields.length) {
            // The multipart parser requires extra configuration
            logger.trace('  Adding Multipart parser for', verb, expressifiedPath);
            parser =
              fileFields.length === 1 && multipartParser.single(fileFields[0].name) ||
              multipartParser.fields(fileFields.map(field => ({ name: field.name })));
          }
          app[verb](expressifiedPath, securityMW, parser, serverImpl[implementation]);
        } else {
          app[verb](expressifiedPath, securityMW, serverImpl[implementation]);
        }
      });
    });
    // Add the post middleware (usually error handlers), if needed
    let postmiddleware = api['x-implementation-final-middleware'];
    if (postmiddleware) {
      postmiddleware = Array.isArray(postmiddleware) ? postmiddleware : [postmiddleware];
      postmiddleware.forEach((aMiddleware) => {
        logger.log('Using final middleware: ', aMiddleware, !!serverImpl[aMiddleware]);
        serverImpl[aMiddleware] && app.use(serverImpl[aMiddleware]);
      });
    }

    // I don't need this anymore.
    api = null;
  });

  return app;
};
