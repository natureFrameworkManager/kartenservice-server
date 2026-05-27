# Kartenservice - Server/Middleware

## ToDO:
- Remove transaction history after card deletion
- Add documentation and readme content
- Improve file structure

### UI Bugs & Missing Implementations
- **Hardcoded date in `mealsLocationsFlow`** (`js.js`): `getMeals` is called with a hardcoded past date (`new Date("2026-05-13")`) instead of `new Date()` or the value from the date input field
- **Dead `case "array"` branch in `getMealDetailsHTML`** (`js.js`): `typeof []` returns `"object"`, never `"array"`, so the array tag-rendering branch is unreachable dead code; `Array.isArray()` should be used instead
- **`host` variable inconsistent with input default** (`js.js` / `index.html`): JS initializes `host = "localhost:3001"` but the input field has `value="localhost"` (no port), so the UI shows a different host than the one actually used until the user changes the field
- **`#user-con span` never updated after login** (`js.js`): The span inside `#user-con` always shows the hardcoded placeholder card number from the HTML; `loginFlow()` never sets it to the actual logged-in card number
- **No event handler for location "Bearbeiten" buttons** (`js.js`): `displayLocationTable` renders edit buttons with a `data-id` attribute but no click listener is attached anywhere, so the buttons do nothing
- **`transactionDiplayFlow` is not truly awaitable** (`js.js`): The function is synchronous and fires an internal async IIFE; `await transactionDiplayFlow()` in `loginFlow` and the main init does not actually wait for transactions to load, and the surrounding `try/catch` does not catch errors from within
- **Date string timezone off-by-one bug** (`js.js`): `new Date(dateValue)` where `dateValue` is an ISO date string (e.g. `"2026-05-13"`) is parsed as UTC midnight; in timezones east of UTC this resolves to the previous day, causing wrong dates in meal and transaction queries
- **`getTransactions` / `getTransactionPositions` / `getLocations` / `getCardMeals` ignore HTTP errors** (`js.js`): These functions unconditionally call `.json()` on the response without checking `response.ok`, causing unhandled parse errors or silent wrong data on HTTP error responses (e.g. 401, 500)
- **Double `loginFlow()` call on button click** (`js.js`): Both `#login-con button` click and `form#login-con` submit event listeners call `loginFlow()`; a button click fires both events, submitting the form twice
- **Login errors not shown to the user** (`js.js`): `loginFlow()` only `console.log`s validation and credential errors; no message is displayed in the UI when login fails
- **`runSyncSSE` button stays permanently disabled if stream ends without a `done` event** (`js.js`): The read loop exits when the stream closes (`done = true`) but only re-enables the button if a `done` SSE event was received; an abruptly closed stream leaves the button stuck
- **`add-location-btn` has no input validation and no error feedback** (`js.js`): Submitting with an empty name is not prevented client-side; non-201 responses (e.g. 400) are silently ignored with no message shown to the user
- **XSS via unescaped server data injected as HTML** (`js.js`): `getLocationMealHTML`, `displayLocationTable`, `getTransactionHTML`, and `getTransactionPositionHTML` interpolate server-provided strings (names, categories, etc.) directly into template-literal HTML without escaping, allowing stored XSS if any value contains HTML
- **`groupTransactionsByDay` groups by UTC date, causing wrong day buckets in non-UTC timezones** (`js.js`): `transaction.datum.toISOString().split("T")[0]` uses UTC midnight as the day boundary; transactions near midnight are bucketed under the wrong calendar day for users in timezones east of UTC

### Backend Bugs & Missing Implementations

#### Security
- **`PATCH /meals/:id`, `POST /locations`, `PUT /locations/:id` have no authentication** (`server.js`): These endpoints modify server data but have no `preHandler: authenticate`, so any unauthenticated user can overwrite meal categories and add/edit canteen locations
- **`POST /fetch/open-mensa` and `POST /fetch/mensa-xml` have no authentication** (`server.js`): Any anonymous caller can trigger remote fetches, causing unnecessary upstream API calls and potentially hitting rate limits