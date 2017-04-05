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
   apiDef: './apiDef.json',
   modulePath: __dirname + '/',
   appName: 'Test Swagger Module Implementation',
   serverPort: 8124
 });

swaggerServer.start();

```

The API definition is a standar YML API definition, extended with the following keywords:

 * x-implementation-module: Module that holds the implementation of all the defined methods.
   It must be a string resolvable by require(), so either a local path or a module name. All the
   rest of the names must be exposed in this module.
 * x-implementation-middleware: Array of methods that will be invoked for all the paths
 * x-implementation-configuration: Method that will be called *once* before starting the app, to
   allow any pre-configuration needed. It must return a promise.
 * x-implemented-in: For any given exposed API, the method that implements it. Must conform to the
   express method definition. If the key is used on a Security Definition, it's the module (also
   as a express Middleware) that implements the authentication.
 * x-implementation-final-middleware: Array of last middleware on the chain (usually error handlers)
 The app also exposes the Util file as /shared/js/Utils.js in case you want to use it.

Also, if you tag some API with CORS, then it will be CORS promiscuous (at this moment, its an all
or nothing sorry)

