# swagger-boilerplate
Simple implementation of a Node Express server described using a Swagger API, in JSON form.

## Usage:

Just do something like
```
npm install --save swagger-boilerplate

```

as usual to install. Then to use:

``` javascript
var SwaggerServer = require('swagger-boilerplate').Server;

var swaggerServer =
 new SwaggerServer({
   apiDef: './apiDef.yml',
   modulePath: __dirname + '/',
   appName: 'Test Swagger Module Implementation',
   serverPort: 8124
 });

swaggerServer.start();

```
The module exports the following objects:

### SwaggerServer:

SwaggerServer constructs (and returns) an Express App based on a YML file. The way the Express App is constructed is described below.

#### Constructor
```
new SwaggerServer(options);
```

Options can have the following attributes:
* **apiDef**: Path of a YML file that holds the API definition for the server. See the testboilerplate/apiDef.yml file for an example. The API definition is a standard YML API definition, extended with the following keywords:

   * **x-implementation-module**: String. Module that holds the implementation of all the defined methods.
     It must be a string resolvable by require(), so either a local path or a module name. All the
     rest of the methods defined in the file must be exposed in this module. This keyword must appear
     at top level.
   * **x-implementation-middleware**: Array. List of methods that will be invoked as a middleware for
     all the paths defined in the file. The methods will be invoked before the path specific method,
     and they will be called in the order defined. Methods must conform with the express middleware
     definition.
   * **x-implementation-configuration**: Method that will be called *once* before starting the app,
     to allow any pre-configuration needed. It must return a promise, that will fulfill when the
     method has finished whatever process it needs to do.
   * **x-implemented-in**: For any given exposed API, the method that implements it. Must conform to
     the express method definition. If the key is used on a *Security Definition*, it's the module
     (also as a express Middleware) that implements the authentication. It's up to the module
     implementator to decide how to pass the authentication resuls to the actual methods.
   * **x-implementation-final-middleware**: Array of last middleware on the chain (usually error
     handlers). This will be executed after the specific path method, only if the specific call
     method explicitly invoked the next method in the chain.

 * **modulePath**: Path where the x-implementation-module module will be loaded from.
 * **appName**: Name of the Main Module of the application (for the logs)
 * **serverPort**: Port where the server must start by default (if not overriden by a command line
    parameter or by the SERVER_PORT environment variable.
    
This constructor also parses the command line. It accepts the following parameters:

*  -h, --help            Displays this help.
*  -d, --daemon          Starts as a daemon.
*  -l, --logFile=ARG     Logs output to this file, only if started as a daemon.
*  -L, --logLevel=ARG    Desired log level, expressed as a string such as "warn,error". The possible values are (from more detail to less):
	* trace
	* log
	* warn
	* error
 
   by default the value is "error,warn,log". 
*  -p, --serverPort=ARG  Server listening port. If not present it uses either the PORT env variable or the 8123 port
*  -u, --user=ARG        UID (name or number) to fork to after binding the port. **This only works on 
   Unix-like systems, where process.getuid is implemented.**
*  -s, --staticPath=ARG  Directory that holds the static files. By default it's the ./web directory.
*  -C, --certDir=ARG     Directory that holds the cert.pem and key.pem files. Only used if -S is specified also.
*  -S, --secure          Starts as a secure server (HTTPS). Requires -C also to find the certificates.

#### Methods
* **start**: Starts the server, listening on the port that is:
	* The SERVER_PORT environment variable or if that's not set
	* The parameter passed as -p on the command line or if that's not set
	* The **serverPort** attribute passed on the constructor, or if that's not set
	* The port 8123.

 The app also exposes the Util file as /shared/js/Utils.js in case you want to use it.

Also, if you tag some API with CORS, then it will be CORS promiscuous (at this moment, its an all
or nothing sorry)

### Utils

#### MultiLevelLogger
  Simple logger that allow multiple level logs. The configured level must be a bitmask of the desired
 enabled levels.
 
 Usage:
 ```
var logger = new MultiLevelLogger('Logger Name', 4); // Enable only error
logger.error('Test error'); // Logs an error
logger.log('Test log'); // does nothing
logger.enableLevel(1); // enable the log level
logger.log('Test log'); Prints the log
logger.disableLevel(1); Disable the log level (but leaves the rest)
```

Default defined levels:
* error: 1
* warn: 2
* log: 4
* trace: 8
##### Constructor
```
new MultiLevelLogger(name, initialLogLevel);
```

* **name**: Name of this logger. It will be printed on all the log lines.
* **initialLogLevel**: Initial value for the enabled log levels.

##### Methods
* **enableLevel(aLevel)**: Enables the passed levels (while keeping any other enabled values set).
* **disableLevel(aLevel)**: Disables the passed levels (while keeping any other enabled values set)
* **logLevel** (attribute): Used to set or read the current log level.
* **log(arguments)**: Logs the passed arguments, if the 'log' level is enabled.
* **error(arguments)**: Logs the passed arguments, if the 'error' level is enabled.
* **trace(arguments)**: Logs the passed arguments, if the 'trace' level is enabled.
* **warn(arguments)**: Logs the passed arguments, if the 'warn' level is enabled.

#### promisify(callbackFn, numRetValues, fnThis);
```
var fs = require('fs');

var readFile = Utils.promisify(fs.readFile);
readFile('something').then(r => doWhatever);
```

If callbackFn is a typical node callback function (of the kind that returns the error as the first
argument, and the value(s) as the second and subsequent arguments, this method returns a new function that returns a promise that will fullfill if callbackFn would have succeeded.

* **callbackFn*: the original function
* *numRetValues*: The number of values that the original function would return. By default, 1.
* *fnThis*: If set, the returned function is bound to the fnThis value. By default, it's undefined. Needed when promisifying methods that use this.


#### CachifiedObject
Returns a new object (of the first argument class) if the same object hasn't been constructed already, or a cached object if it's been cached already. Note that this implementation *requires* WeakMap, so it won't work on IE9.

If at some point this is needed on IE it will have to be implemented using x-linked arrays.

##### Constructor
```
var aObject = new Utils.CachifiedObject(Date, dateString);
// aObject will be the same as:
// aObject = new Date('dateString'); but if aObject was built already, a reference will be returned instead
```
* **aBaseObject**: Name of the type/constructor of the base object.
* **arguments**: List (**not** an array) of parameters that the original constructor gets.

It will return a new instance if:
* There wasn't an old instance already for that type or
* The number of arguments has changed or
* The actual arguments have changed

Otherwise it returns a reference to the previously created instance. Note that it also replaces the 
previous instance on the cache (so it loses that reference).


##### Methods

* **CachifiedObject.getCached(ObjectType)**: Returns the cached value of the requested type if it exists.

#### isA(template, object, allowEmptyArrays)

```
const TEMPLATE = {
  a1: '',
  a2: 3
};

Utils.isA(TEMPLATE, {}); // false
Utils.isA(TEMPLATE, {a1: 'foo', a2: 'bar'}); // false
Utils.isA(TEMPLATE, {a1: 'foo', a2: 45}); // true
```

Returns true if the object is of the same type than the template. That is, is a kind of "is object a template". The function will return true when, for attributes that are arrays on the template, all the elements of the array in object are of the same type (isA) than the  **first** element of the array on the template

#### booleanify(value)
```
Utils.booleanify('true'); // true
Utils.booleanify('something'); // false
```
Returns true value looks like true. Or in this case, 'true', 'TRUE', any number different from 0, and of course true

#### extendCopy(aSrc, aExtraElems)
```
var a = { 
 a1: 1,
 a2: 2,
 a3: 3
};
var b = {
 a1: 'foo',
 a4: 'bar'
}
Utils.extendCopy(a, b); // Returns {a1: 'foo', a2: 2, a3: 3, a4: 'bar'}

```

Copies from aExtraElems into aSrc. Returns a new object.
  

#### ServerPersistence 
WIP WIP WIP

This module implements all the persistence management that the server has to keep. It can be initialized with an object that specifies a set of keys (with default values) that have to be cached. Usually that can be used to retrieve the server configuration.
 
The object created will be a promise instance that will be resolved when the requested initial set of data is available. The fulfilled value of the promise will hold both the requested cached data and the methods needed to process the rest of the persistent data.

##### Constructor

```
 new ServerPersistence(aCachedEntries, aConnectParameters, aLogLevel, aModules, aPrefix);
```
The object will use whatever is defined in aModules. PersistenceProvider (or ioredis by default) to store the persistent information.
 
##### Methods
The PersistenceProvider must implement a subset of the ioredis interface. Specifically:
  - Constructor
  - It should emit the 'ready' event (set with provider.on('ready', callback)
  - get(aKey) => Promise
  - set(aKey) => Promise
  - pipeline()
  	- pipepine.get
  	- pipeline.exec

