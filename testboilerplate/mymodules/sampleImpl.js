'use strict';


module.exports = function(logLevel) {

  var Utils = require('swagger-boilerplate').Utils;
  var logger = new Utils.MultiLevelLogger('test implementation', logLevel);

  function dumpReq(req) {
    logger.log('req.path:', req.path, 'params:', req.params, 'body:', req.body);
    logger.log('req.user:', req.user, 'req.someData:', req.someData);
  }

  return {
    configReady: function(req, res, next) {
      // x-implementation-middleware. Invoked before anything else...
      req.someData = { someKey: 'someValue' };
      next();
    },
    errorHandler: function(err, req, res, next) { /* jshint ignore: line */
      // x-implementation-final-middleware. Error handler usually...
      logger.error('Error:', err);
      dumpReq(req);
      res.status(500).send('Error: ' + JSON.stringify(err));
    },
    loadConfig: function() {
      // x-implementation-configuration. This method doesn't use parameters and returns a promise...
      logger.log('loadConfig invoked');
      return Promise.resolve();
    },
    tokenAuth: function(req, res, next) {
      // Authentication middleware. Check whatever we want here...
      req.user = {
        id: 'fakeTokenUser'
      };
      next();
    },
    otherAuth: function(req, res, next) {
      // We can have several authentication policies...
      req.user = {
        id: 'fakeOtherUser'
      };
      next();
    },
    getSomeResource: function(req, res) {
      // method implementation!
      dumpReq(req);
      res.status(200).send('<html><body>All done!</body></html');
    },
    putSomeResource: function(req, res) {
      dumpReq(req);
      res.status(200).send('<html><body>All done!</body></html');
    },
    doAwesomeResource: function(req, res) {
      dumpReq(req);
      res.status(200).send({});
    }
  };
}
/*
x-implementation-module: ./mymodules/sampleImpl.js
x-implementation-middleware:
x-implementation-final-middleware:
x-implementation-configuration: loadConfig
    x-implemented-in: tokenAuth
    x-implemented-in: tokenAuth
      x-implemented-in: getSomeResource
      x-implemented-in: putSomeResource
      x-implemented-in: doAwesomeResource
      x-implemented-in: doAwesomeResource
      */