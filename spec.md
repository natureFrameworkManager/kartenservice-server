# Endpoints
Get all combined meals: GET /meals
Get all meals from MensaXML: GET /meals/mensa-xml
Get all meals from OpenMensa: GET /meals/open-mensa
Get all meal lookups: GET /meal-lookups
Get meal lookup for a specific date: GET /meal-lookups/:date
Get meal lookup for a specific date and canteen: GET /meal-lookups/:date/:canteenId
Get meal lookup for a specific date, canteen and meal name: GET /meal-lookups/:date/:canteenId/:mealName
Get meal lookup for a specific card number: GET /meal-lookups/card/:cardNumber - auth required
Get meal lookup for a specific card number and date: GET /meal-lookups/card/:cardNumber/:date - auth required
Get all transactions: GET /trans/:cardNumber - auth required
Get all transaction positions: GET /transpos/:cardNumber - auth required
Trigger open mensa meal fetch: POST /fetch/open-mensa
Trigger mensa xml meal fetch: POST /fetch/mensa-xml
Add a card: POST /card with body { "cardNumber": "123456789", "password": "password" } - check against kartenserivce for validity of card number and password before adding
Update a card password POST /card with body { "cardNumber": "123456789", "password": "newpassword" } - check against kartenserivce for validity of new password before updating
Delete a card: DELETE /card with body { "cardNumber": "123456789" } - auth required
Trigger transaction and transaction position fetch for a card: POST /fetch/kartenservice with body { "cardNumber": "123456789" } - auth required