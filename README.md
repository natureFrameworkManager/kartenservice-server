# Kartenservice - Server/Middleware

## ToDO:
- Remove transaction history after card deletion
- Add host sync for meals & locations and single card transactions for server-to-server sync
- Add SSE for sync updates
- Add UI for managing cards and meals
  - Allow changes to internal categories from meal view (add buttons to save changes, when input fields are changed)
  - Save meal select in transaction view (add button to save meal selection, when changed)
  - Save new location
  - Transaction date selection
  - Fix meal selection options in transaction view (only show meals that match the price, additionally show price, internal name, category in meal select options)
  - Wire up sync buttons
  - Add sync progress indicator
  - Add introduction page
- Add docker image for easy deployment
- Add documentation and readme content
- Improve file structure 