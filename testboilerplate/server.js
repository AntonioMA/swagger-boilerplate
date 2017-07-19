var SwaggerServer = require('swagger-boilerplate').Server;

var swaggerServer =
 new SwaggerServer({
   apiDef: './apiDef.yml',
   modulePath: __dirname + '/',
   appName: 'Test Swagger Module Implementation',
   allowedCORSOrigins: process.env.ALLOWED_CORS_ORIGINS,
   serverPort: 8124
 });

swaggerServer.start();
