// This module implements all the persistence management that the server has do keep.
// It can be initialized with an object that specifies a set of keys (with default values)
// that have to be cached. Usually that can be used to retrieve the server configuration.
// The object created will be a promise instance that will be resolved when the requested
// initial set of data is available. The fulfilled value of the promise will hold both
// the requested cached data and the methods needed to process the rest of the persistent
// data.

// We'll use whatever is defined in aModules.PersistenceProvider (or ioredis by default)
// to store the persistent information. The PersistenceProvider must implement a subset
// of the ioredis interface. Specifically:
//  - Constructor
//  - It should emit the 'ready' event (set with provider.on('ready', callback)
//  - get(aKey) => Promise
//  - set(aKey) => Promise
//  - pipeline()
//  -   - pipepine.get
//  -   - pipeline.exec
function ServerPersistence(aCachedEntries, aConnectParameters, aLogLevel, aModules, aPrefix) {
  'use strict';

  const PREFIX = aPrefix || '';
  var PersistenceProvider = aModules && aModules.PersistenceProvider || require('ioredis');

  var Utils = require('./shared/utils');
  var Logger = Utils.MultiLevelLogger;
  var logger = new Logger('ServerPersistence', aLogLevel);
  logger.trace('Connecting to:', aConnectParameters, 'Provider:',
               aModules.PersistenceProvider || 'Redis');

  const CONNECT_TIMEOUT = 5000;

  function getKey(aKey) {
    return PREFIX + aKey;
  }

  function connectToPersistenceProvider() {
    var storage = new PersistenceProvider(aConnectParameters,
                                          { connectTimeout: CONNECT_TIMEOUT, logLevel: aLogLevel });
    var watchdog = setInterval(function() {
      logger.warn('Timeout while connecting to the Persistence Provider! Is Redis running?');
    }, CONNECT_TIMEOUT);
    storage.on('ready', function() {
      logger.trace('Successfully connected to Redis and DB is ready.');
      clearInterval(watchdog);
    });
    return storage;
  }

  function getPipelineForArrayOps(aProviderInst, aKeyArray, aOp) {
    var pipeline = aProviderInst.pipeline();
    for (var i = 0, l = aKeyArray.length; i < l ; i++) {
      pipeline = pipeline[aOp](aKeyArray[i]);
    }
    return pipeline;
  }

  function loadCache(aProvider) {
    var pipeline = getPipelineForArrayOps(aProvider, aCachedEntries.map(elem => getKey(elem.key)),
                                          'get');
    return pipeline.exec().then(results => {
      var cachedItems = {};
      // Results should be a n row array of two row arrays...
      // Just so we don't have to C&P a bunch of validations...
      for (var i = 0, l = aCachedEntries.length; i < l; i++) {
        var keyValue = results[i][1] || aCachedEntries[i].defaultValue;
        // Since we set null as default for mandatory items...
        if (keyValue === null) {
          var message = 'Missing required redis key: ' + getKey(aCachedEntries[i].key) +
            '. Please check the installation instructions';
          logger.error(message);
          throw new Error(message);
        }
        cachedItems[aCachedEntries[i].key] = keyValue;
        logger.trace('cachedItems[', aCachedEntries[i].key, '] =', keyValue);
      }
      return cachedItems;
    });
  }

  var provider = connectToPersistenceProvider();
  return {
    cached: null,
    /**
     * filter can either be a wildcard like expression 'whatever*' or an array of keys we want
     * to get
     */
    getKeysValues: function(filter, aAsObject) {
      var keyPromise =
        Array.isArray(filter) && Promise.resolve(filter.map(getKey)) ||
          provider.keys(getKey(filter));

      return keyPromise.then(aKeys => {
        var pipeline = getPipelineForArrayOps(provider, aKeys, 'get');
        return pipeline.
          exec().
          then(aResults => aResults.
            map(e => aAsObject && e[1] && e[1].startsWith('{') && JSON.parse(e[1]) || e[1])
          );
      });
    },
    getKey: function(aKeyName, aAsObject) {
      if (!aKeyName) {
        return Promise.resolve(null);
      }
      aKeyName = getKey(aKeyName);
      if (this.cached && this.cached[aKeyName]) {
        return Promise.resolve(this.cached[aKeyName]);
      }

      return provider.get(aKeyName).then(aValue => {
        try {
          return aAsObject && aValue && JSON.parse(aValue) || aValue;
        } catch(e) {
          return aValue;
        }
      });
    },
    getKeyArray: function(aKeyName, aAsObjects) {
      var key = getKey(aKeyName);
      return provider.llen(key).then(length => provider.lrange(getKey(aKeyName), 0, length)).
        then(stringArray =>
          !aAsObjects && stringArray || stringArray.map(elem => JSON.parse(elem)));
    },
    pushToKey: function(aKeyName, aKeyValue, expirationTime) {
      if (typeof aKeyValue === 'object') {
        aKeyValue = JSON.stringify(aKeyValue);
      }
      var key = getKey(aKeyName);
      return provider.rpush(key, aKeyValue).then(v => {
       (expirationTime !== undefined) && provider.expire(key, expirationTime);
        return v;
      });
    },
    delArrayElement: function(aKeyName, aIndex) {
      if (aIndex < 0) {
        return Promise.resolve(null);
      }
      var key = getKey(aKeyName);
      return provider.lindex(key, aIndex).
        then(provider.lrem.bind(provider, key, 1));
    },
    setKey: function(aKeyName, aKeyValue) {
      if (typeof aKeyValue === 'object') {
        aKeyValue = JSON.stringify(aKeyValue);
      }
      return provider.set(getKey(aKeyName), aKeyValue);
    },
    setKeyEx: function(aExpiration, aKeyName, aKeyValue) {
      if (typeof aKeyValue === 'object') {
        aKeyValue = JSON.stringify(aKeyValue);
      }
      return provider.setex(getKey(aKeyName), aExpiration, aKeyValue);
    },
    delKey: function(aKeyName) {
      return provider.del(getKey(aKeyName));
    },
    updateCache() {
      return loadCache(provider).then(cachedItems => {
        this.cached = cachedItems;
        return cachedItems;
      });
    }
  };

}

module.exports = ServerPersistence;
