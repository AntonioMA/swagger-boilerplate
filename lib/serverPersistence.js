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

  const PREFIX = aPrefix || '';
  const LOCK_SUFFIX = '__lock__';

  const PersistenceProvider = aModules && aModules.PersistenceProvider || require('ioredis');

  const Utils = require('./shared/utils');
  const Logger = Utils.MultiLevelLogger;
  const logger = new Logger('ServerPersistence', aLogLevel);
  logger.trace(
    'Connecting to:', aConnectParameters, 'Provider:', aModules.PersistenceProvider || 'Redis');

  const CONNECT_TIMEOUT = 5000;

  const getKey = aKey => PREFIX + aKey;

  const getLockKey = aKey => getKey(aKey) + LOCK_SUFFIX;
  const TIMEOUT_ERROR =
    'Timeout while connecting to the PersistenceProvider. Is it running?';

  function connectToPersistenceProvider() {
    const storage =
     new PersistenceProvider(
       aConnectParameters, {
         connectTimeout: CONNECT_TIMEOUT,
         logLevel: aLogLevel,
         tls: {
           rejectUnauthorized: false,
         },
       });
    const watchdog = setInterval(() => logger.warn(TIMEOUT_ERROR), CONNECT_TIMEOUT);
    storage.on('ready', () => {
      logger.trace('Successfully connected to Redis and DB is ready.');
      clearInterval(watchdog);
    });
    return storage;
  }

  function getPipelineForArrayOps(aProviderInst, aKeyArray, aOp) {
    let pipeline = aProviderInst.pipeline();
    for (let i = 0, l = aKeyArray.length; i < l; i++) {
      pipeline = pipeline[aOp](aKeyArray[i]);
    }
    return pipeline;
  }

  function loadCache(aProvider) {
    const pipeline =
     getPipelineForArrayOps(aProvider, aCachedEntries.map(elem => getKey(elem.key)), 'get');
    return pipeline.exec().then((results) => {
      const cachedItems = {};
      // Results should be a n row array of two row arrays...
      // Just so we don't have to C&P a bunch of validations...
      for (let i = 0, l = aCachedEntries.length; i < l; i++) {
        const keyValue = results[i][1] || aCachedEntries[i].defaultValue;
        // Since we set null as default for mandatory items...
        if (keyValue === null) {
          const message = 'Missing required redis key: ' + getKey(aCachedEntries[i].key) +
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

  const provider = connectToPersistenceProvider();
  return {
    cached: null,
    /**
     * filter can either be a wildcard like expression 'whatever*' or an array of keys we want
     * to get
     */
    getKeysValues(filter, aAsObject) {
      const keyPromise =
        Array.isArray(filter) && Promise.resolve(filter.map(getKey)) ||
          provider.keys(getKey(filter));

      return keyPromise.then((aKeys) => {
        const pipeline = getPipelineForArrayOps(provider, aKeys, 'get');
        return pipeline.
          exec().
          then(aResults => aResults.
            map(e => aAsObject && e[1] && e[1].startsWith('{') && JSON.parse(e[1]) || e[1])
          );
      });
    },
    getKey(aKeyName, aAsObject) {
      if (!aKeyName) {
        return Promise.resolve(null);
      }
      aKeyName = getKey(aKeyName);
      if (this.cached && this.cached[aKeyName]) {
        return Promise.resolve(this.cached[aKeyName]);
      }

      return provider.get(aKeyName).then((aValue) => {
        try {
          return aAsObject && aValue && JSON.parse(aValue) || aValue;
        } catch (e) {
          return aValue;
        }
      });
    },
    getKeyArray(aKeyName, aAsObjects) {
      const key = getKey(aKeyName);
      return provider.llen(key).then(length => provider.lrange(getKey(aKeyName), 0, length)).
        then(stringArray =>
          !aAsObjects && stringArray || stringArray.map(elem => JSON.parse(elem)));
    },
    pushToKey(aKeyName, aKeyValue, expirationTime) {
      if (typeof aKeyValue === 'object') {
        aKeyValue = JSON.stringify(aKeyValue);
      }
      const key = getKey(aKeyName);
      return provider.rpush(key, aKeyValue).then((v) => {
        (expirationTime !== undefined) && provider.expire(key, expirationTime);
        return v;
      });
    },
    delArrayElement(aKeyName, aIndex) {
      if (aIndex < 0) {
        return Promise.resolve(null);
      }
      const key = getKey(aKeyName);
      return provider.lindex(key, aIndex).
        then(provider.lrem.bind(provider, key, 1));
    },
    setKey(aKeyName, aKeyValue) {
      if (typeof aKeyValue === 'object') {
        aKeyValue = JSON.stringify(aKeyValue);
      }
      return provider.set(getKey(aKeyName), aKeyValue);
    },
    setKeyEx(aExpiration, aKeyName, aKeyValue) {
      if (typeof aKeyValue === 'object') {
        aKeyValue = JSON.stringify(aKeyValue);
      }
      return provider.setex(getKey(aKeyName), aExpiration, aKeyValue);
    },
    delKey(aKeyName) {
      return provider.del(getKey(aKeyName));
    },
    updateCache() {
      return loadCache(provider).then((cachedItems) => {
        this.cached = cachedItems;
        return cachedItems;
      });
    },
    // Gets a key in an 'exclusive' way. Exclusive meaning it tries to get a lock for up
    // to timeout milliseconds. If it cannot it will consider the lock borked, lock it and
    // return the key value anyway. Note that the waiting is a semi-active wait (it's actually an
    // active wait with delays) since locking on a single thread app is not going to work very well.
    async getAndLockKey(aKeyName, aAsObject, aTimeout) {
      aTimeout = aTimeout || 1000; // By default, try up to one second...
      const delay = Math.trunc(aTimeout / 20); // And by design, try 20 times max.
      const lockKey = getLockKey(aKeyName);
      let globalTimeout = 0;
      while (globalTimeout <= aTimeout && await provider.getset(lockKey, 1)) {
        await new Promise(resolve => setTimeout(resolve, delay));
        globalTimeout += delay;
      }
      provider.psetex(lockKey, aTimeout, 1); // In case we don't call release...
      return this.getKey(aKeyName, aAsObject);
    },
    releaseLock: aKeyName => provider.del(getLockKey(aKeyName)),
  };

}

module.exports = ServerPersistence;
