// Simple wrapping over node-rest-client.Client.
// The constructor requires an object with the structure:
//   name: parametrized URL
// It creates an object with a single method:
//   - call (method, resource, args)
'use strict';
const Client = require('node-rest-client').Client;
const client = new Client();
const Utils = require('./shared/utils');

function RestAPI(aPaths, logger) {

  logger = logger || { trace: () => true };

  function call(method, resource, args) {
    var URL = aPaths[resource] || resource;
    logger.trace('execRequest:', method, 'for', URL, JSON.stringify(args));
    return new Promise((resolve, reject) => {
      client[method](URL, args, (data) => {
        var cData = data;
        if (typeof cData.readInt8  === 'function') {
          cData = data.toString();
        }
        logger.trace(method, resource, ': Got a response:', cData);
        resolve(cData);
      }).on('error', e => (logger.error('execRequest error:', e) || true) && reject(e));
    });
  }

  return call;
}

module.exports = RestAPI;

