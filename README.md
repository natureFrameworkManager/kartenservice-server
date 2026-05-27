# Kartenservice - Server/Middleware

## ToDO:
- Remove transaction history after card deletion
- Add documentation and readme content
- Improve file structure

### UI Bugs & Missing Implementations
- **No event handler for location "Bearbeiten" buttons** (`js.js`): `displayLocationTable` renders edit buttons with a `data-id` attribute but no click listener is attached anywhere, so the buttons do nothing

### Backend Bugs & Missing Implementations

#### Security
- **`PATCH /meals/:id`, `POST /locations`, `PUT /locations/:id` have no authentication** (`server.js`): These endpoints modify server data but have no `preHandler: authenticate`, so any unauthenticated user can overwrite meal categories and add/edit canteen locations
- **`POST /fetch/open-mensa` and `POST /fetch/mensa-xml` have no authentication** (`server.js`): Any anonymous caller can trigger remote fetches, causing unnecessary upstream API calls and potentially hitting rate limits