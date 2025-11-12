# Dynamic Express APIs

This project demonstrates a Node.js + Express server that can dynamically create API routes at runtime based on requests.

Key features:

-   Create dynamic API endpoints via `POST /api/create` (JSON body or multipart file upload containing `.json` or `.xlsx`).
-   Update dynamic API responses via `PUT /api/update`.
-   On startup the server loads `/apis/*.json` and registers those routes automatically.
-   Middleware logs dynamic requests and their responses.

Setup

1. Install dependencies:

```powershell
cd c:\Users\huyna\Documents\auto-path
npm install
```

2. Start server:

```powershell
npm start
```

Example usage

1. Create via JSON body

POST /api/create

Body (application/json):

```json
{
	"path": "/test",
	"method": "GET",
	"response": { "message": "ok" }
}
```

Response: saved metadata to `/apis/test.json` and route `GET /test` will be available.

2. Create via Excel file

-   Form field `path`: `/excel-test`
-   Form field `method`: `GET`
-   Form field `file`: attach an `.xlsx` file. The server reads the first sheet, converts rows to JSON and uses the first row object as the response.

Example curl (PowerShell style using `-F` for multipart):

```powershell
curl -X POST "http://localhost:3000/api/create" -F "path=/excel-test" -F "method=GET" -F "file=@C:\path\to\sample.xlsx"
```

3. Get the dynamic response

GET /test

```powershell
curl http://localhost:3000/test
```

4. Update an existing dynamic API

PUT /api/update

Body (application/json):

```json
{
	"path": "/test",
	"newResponse": { "status": "updated" }
}
```

Notes

-   Files for each dynamic API are stored in `/apis` as JSON files with fields: `path`, `method`, `response`.
-   Allowed HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD.
-   The server uses ES modules (`type: "module"` in `package.json`).

Troubleshooting

-   If a route doesn't appear, check the `/apis` directory for the corresponding JSON file.
-   Uploaded files are temporarily stored in `./uploads` then removed after processing.
