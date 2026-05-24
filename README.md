# Kartenservice - Server/Middleware

## ToDO:
- Remove transaction history after card deletion
- Add docker image for easy deployment
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
- **`getTransactions` / `getTransactionPositions` ignore HTTP errors** (`js.js`): Both functions unconditionally call `.json()` on the response without checking `response.ok`, causing unhandled JSON-parse errors or silent wrong data on HTTP error responses (e.g. 401, 500)