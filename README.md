# Kartenservice - Server/Middleware

## ToDO:
- Remove transaction history after card deletion
- Add documentation and readme content
- Improve file structure

### UI Bugs & Missing Implementations
- **No event handler for location "Bearbeiten" buttons** (`js.js`): `displayLocationTable` renders edit buttons with a `data-id` attribute but no click listener is attached anywhere, so the buttons do nothing
- **Login errors not shown to the user** (`js.js`): `loginFlow()` only `console.log`s validation and credential errors; no message is displayed in the UI when login fails
- **`runSyncSSE` button stays permanently disabled if stream ends without a `done` event** (`js.js`): The read loop exits when the stream closes (`done = true`) but only re-enables the button if a `done` SSE event was received; an abruptly closed stream leaves the button stuck
- **`add-location-btn` has no input validation and no error feedback** (`js.js`): Submitting with an empty name is not prevented client-side; non-201 responses (e.g. 400) are silently ignored with no message shown to the user

### Backend Bugs & Missing Implementations

#### Security
- **`PATCH /meals/:id`, `POST /locations`, `PUT /locations/:id` have no authentication** (`server.js`): These endpoints modify server data but have no `preHandler: authenticate`, so any unauthenticated user can overwrite meal categories and add/edit canteen locations
- **`POST /fetch/open-mensa` and `POST /fetch/mensa-xml` have no authentication** (`server.js`): Any anonymous caller can trigger remote fetches, causing unnecessary upstream API calls and potentially hitting rate limits