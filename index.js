// Main server: dynamic API creation and registration
import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
// (xlsx removed — we only support .json uploads now)
import swaggerUi from 'swagger-ui-express';
import fs from 'fs-extra';
import path from 'path';

const app = express();
const upload = multer({ dest: path.join(process.cwd(), 'uploads') });
const apisDir = path.join(process.cwd(), 'apis');

// Use body-parser to parse JSON bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// In-memory store for dynamic APIs. Key: "METHOD /path" -> response object
const apiStore = new Map();

// Ensure apis directory exists
await fs.ensureDir(apisDir);

// Helper: normalize a route path to a filename (remove leading slash, replace slashes)
function pathToFilename(routePath) {
  // remove leading slash
  let name = routePath.replace(/^\//, '');
  if (!name) name = 'root';
  // replace remaining slashes with underscores
  name = name.replace(/\//g, '_');
  // remove characters that are problematic in filenames
  name = name.replace(/[^a-zA-Z0-9_\-\.]/g, '');
  return `${name}.json`;
}

// Allowed HTTP methods for dynamic registration
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']);

// Middleware: log dynamic requests and responses
app.use((req, res, next) => {
  const key = `${req.method} ${req.path}`;
  if (!apiStore.has(key)) return next();

  // Log incoming request
  console.log('=== Dynamic Request ===');
  console.log('method:', req.method);
  console.log('path:', req.path);
  console.log('query:', req.query);
  console.log('body:', req.body);

  // Intercept res.json and res.send to capture response body
  const oldJson = res.json.bind(res);
  const oldSend = res.send.bind(res);

  res.json = (body) => {
    console.log('Dynamic Response:', body);
    return oldJson(body);
  };
  res.send = (body) => {
    console.log('Dynamic Response (send):', body);
    return oldSend(body);
  };

  next();
});

// Register a dynamic route if not already registered.
function registerRoute(routePath, method, initialResponse) {
  const methodUpper = method.toUpperCase();
  if (!ALLOWED_METHODS.has(methodUpper)) {
    throw new Error(`Method ${method} is not allowed`);
  }

  const key = `${methodUpper} ${routePath}`;
  // store in-memory response (will be used by the handler closure)
  apiStore.set(key, initialResponse);

  // If already registered as an Express route, skip binding again.
  // We'll detect this by checking app._router stack for a matching path+method.
  const already = app._router && app._router.stack && app._router.stack.some((layer) => {
    return layer.route && layer.route.path === routePath && layer.route.methods[methodUpper.toLowerCase()];
  });

  if (already) return;

  // Register route. Handler reads response from apiStore at request time (so updates apply immediately).
  app[methodUpper.toLowerCase()](routePath, (req, res) => {
    const k = `${req.method} ${req.path}`;
    const resp = apiStore.get(k) ?? {};
    // respond with JSON
    res.json(resp);
  });

  console.log(`Registered dynamic route: [${methodUpper}] ${routePath}`);
}

// Build OpenAPI (Swagger) spec dynamically from files in /apis
async function buildOpenApiSpec() {
  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'Dynamic Express APIs',
      version: '1.0.0',
      description: 'APIs dynamically created at runtime. This spec is generated from files in /apis.'
    },
    paths: {},
    components: {
      schemas: {}
    }
  };

  // utility: infer a simple JSON Schema from an example value
  function inferSchema(value) {
    if (value === null) return { type: 'null' };
    const t = typeof value;
    if (t === 'string') return { type: 'string' };
    if (t === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
    if (t === 'boolean') return { type: 'boolean' };
    if (Array.isArray(value)) {
      // infer items schema from first element (simple heuristic)
      if (value.length === 0) return { type: 'array', items: {} };
      return { type: 'array', items: inferSchema(value[0]) };
    }
    if (t === 'object') {
      const props = {};
      for (const [k, v] of Object.entries(value)) {
        props[k] = inferSchema(v);
      }
      return { type: 'object', properties: props };
    }
    // fallback
    return {};
  }

  // add management endpoints with clear requestBody schemas
  spec.paths['/api/create'] = {
    post: {
      summary: 'Create a dynamic API (JSON body or multipart file upload)',
  description: 'Create a new dynamic API. You can send a JSON body or multipart/form-data with a .json file upload.',
      requestBody: {
        required: true,
        // Put multipart/form-data first so Swagger UI defaults to the file upload form
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Route path to create', example: '/excel-test' },
                method: { type: 'string', description: 'HTTP method', example: 'GET' },
                file: { type: 'string', format: 'binary', description: 'Upload a .json file containing the response' }
              },
              required: ['path', 'file']
            },
            encoding: {
              file: {
                contentType: 'application/json'
              }
            }
          },
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Route path to create', example: '/test' },
                method: { type: 'string', description: 'HTTP method', example: 'GET' },
                // response may be object or JSON string
                response: {
                  oneOf: [
                    { type: 'object', description: 'JSON object response' },
                    { type: 'string', description: 'JSON string representing the response' }
                  ]
                }
              },
              required: ['path', 'response']
            },
            examples: {
              objectExample: { value: { path: '/test', method: 'GET', response: { message: 'ok' } } },
            }
          }
        }
      },
      responses: { '200': { description: 'Created' } }
    }
  };

  spec.paths['/api/update'] = {
    put: {
      summary: 'Update a dynamic API response',
      description: 'Update the stored response for an existing dynamic route.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Route path to update', example: '/test' },
                newResponse: { type: 'object', description: 'New JSON response to return from the route' }
              },
              required: ['path', 'newResponse']
            },
            example: { path: '/test', newResponse: { status: 'updated' } }
          }
        }
      },
      responses: { '200': { description: 'Updated' } }
    }
  };

  // read dynamic apis metadata and add to paths (and components.schemas)
  try {
    const files = await fs.readdir(apisDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const meta = await fs.readJson(path.join(apisDir, file));
        if (!meta || !meta.path || !meta.method) continue;
        const p = meta.path;
        const m = meta.method.toLowerCase();
        spec.paths[p] = spec.paths[p] || {};
        // derive a schema name for components
        const baseName = `${meta.method}_${file.replace(/\.json$/i, '')}`.replace(/[^a-zA-Z0-9_]/g, '_');
        const schemaName = `Response_${baseName}`;

        // infer schema from example response and add to components
        try {
          const inferred = inferSchema(meta.response);
          spec.components.schemas[schemaName] = inferred;
        } catch (e) {
          // ignore schema inference errors
        }

        spec.paths[p][m] = {
          summary: `Dynamic route ${meta.method} ${meta.path}`,
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${schemaName}` },
                  example: meta.response
                }
              }
            }
          }
        };
      } catch (err) {
        // skip invalid file
      }
    }
  } catch (err) {
    console.error('Error building OpenAPI spec:', err.message);
  }

  return spec;
}

// Serve the OpenAPI JSON so Swagger UI can load the latest spec
app.get('/openapi.json', async (req, res) => {
  const spec = await buildOpenApiSpec();
  res.json(spec);
});

// Mount Swagger UI; it will load /openapi.json dynamically
app.use('/sw', swaggerUi.serve, swaggerUi.setup(null, { swaggerUrl: '/openapi.json' }));

// Load apis on startup
async function loadApisOnStartup() {
  const files = await fs.readdir(apisDir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const full = path.join(apisDir, file);
      const meta = await fs.readJson(full);
      if (meta && meta.path && meta.method && typeof meta.response !== 'undefined') {
        registerRoute(meta.path, meta.method, meta.response);
      } else {
        console.warn(`Skipping invalid API file: ${file}`);
      }
    } catch (err) {
      console.error('Error loading API file', file, err.message);
    }
  }
}

// POST /api/create
// Supports JSON body or multipart/form-data with a file (.json or .xlsx)
app.post('/api/create', upload.single('file'), async (req, res) => {
  try {
    let routePath;
    let method;
    let responseObj;

    if (req.file) {
      // multipart form (only .json file supported)
      routePath = req.body.path;
      method = req.body.method || 'GET';

      const uploadedPath = req.file.path;
      const originalName = req.file.originalname || '';

      if (originalName.toLowerCase().endsWith('.json')) {
        responseObj = await fs.readJson(uploadedPath);
      } else {
        // unknown or unsupported file type: only .json allowed
        await fs.remove(uploadedPath);
        return res.status(400).json({ error: 'Unsupported file type. Use .json only' });
      }

      // cleanup uploaded file
      await fs.remove(uploadedPath);
    } else {
      // JSON body case
      routePath = req.body.path;
      method = req.body.method || 'GET';
      responseObj = req.body.response;

      // If response is provided as a JSON string, try to parse it
      if (typeof responseObj === 'string') {
        try {
          const parsed = JSON.parse(responseObj);
          responseObj = parsed;
        } catch (e) {
          return res.status(400).json({ error: 'response is a string but not valid JSON' });
        }
      }
    }

    if (!routePath || !method) {
      return res.status(400).json({ error: 'Missing path or method' });
    }

    const methodUpper = method.toUpperCase();
    if (!ALLOWED_METHODS.has(methodUpper)) {
      return res.status(400).json({ error: `Method ${method} is not allowed` });
    }

    // Save metadata to /apis/<filename>.json
    const filename = pathToFilename(routePath);
    const out = { path: routePath, method: methodUpper, response: responseObj };
    await fs.writeJson(path.join(apisDir, filename), out, { spaces: 2 });

    // Register route (or update in-memory response)
    registerRoute(routePath, methodUpper, responseObj);

    res.json({ ok: true, path: routePath, method: methodUpper, savedTo: `/apis/${filename}` });
  } catch (err) {
    console.error('Error in /api/create', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/update - update an existing dynamic API's response
app.put('/api/update', async (req, res) => {
  try {
    const { path: routePath, newResponse } = req.body;
    if (!routePath) return res.status(400).json({ error: 'Missing path' });

    // allow newResponse as JSON string or object
    let parsedResponse = newResponse;
    if (typeof newResponse === 'string') {
      try {
        parsedResponse = JSON.parse(newResponse);
      } catch (e) {
        return res.status(400).json({ error: 'newResponse is a string but not valid JSON' });
      }
    }

    const filename = pathToFilename(routePath);
    const full = path.join(apisDir, filename);
    if (!await fs.pathExists(full)) {
      return res.status(404).json({ error: `API metadata not found for path ${routePath}` });
    }

    const meta = await fs.readJson(full);
  meta.response = parsedResponse;
    await fs.writeJson(full, meta, { spaces: 2 });

    const key = `${meta.method} ${meta.path}`;
  apiStore.set(key, parsedResponse);

    res.json({ ok: true, updated: key });
  } catch (err) {
    console.error('Error in /api/update', err);
    res.status(500).json({ error: err.message });
  }
});

// Simple root
app.get('/', (req, res) => {
  res.send('Dynamic Express APIs - see README for usage');
});

// Start server after loading APIs
const PORT = process.env.PORT || 3000;
await loadApisOnStartup();
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// Export for tests (optional)
export { app, apiStore };
