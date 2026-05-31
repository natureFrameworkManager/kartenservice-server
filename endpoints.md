# All Endpoints 
?include Related data
?fields Filter response
?sort 
?order
?page
?page-size
?format json, csv, xml, (ical)
/distinct/fields

/meals
?date -- multiple
?date-start
?date-end
?date-offset
?week-date
?canteenId -- multiple
?category -- multiple
?internalCategory -- multiple
?name -- multiple
?price-student-min
?price-student-max
?price-employees-min
?price-employees-max
?price-pupils-min
?price-pupils-max
?price-others-min
?price-others-max
?notes -- multiple
?components -- multiple
?tags -- multiple
?has-internal-category
?has-notes
?has-components
?has-tags
--
?id -- multiple
?cardnumber
?today bool
?next bool
?week bool
?week-next bool
?week-date
/meals/{date}
-- same query parameters as /meals except date parameters
/meals/{date}/{canteenId}
-- same query parameters as /meals except date parameters and canteenId
/meals/{date}/{canteenId}/{mealId}
/meals/{id} Patch internalCategory
/meals/{cardnumber}
-- same query parameters as /meals
/meals/{cardnumber}/{date}
-- same query parameters as /meals except date parameters
/trans/{cardnumber}
?id -- multiple
?date -- multiple
?date-start
?date-end
?transId -- multiple
?ortName -- multiple
?kaName -- multiple
?typName -- multiple
?amount -- multiple
?amount-min
?amount-max
?has-file bool
?has-bonus bool
?mandatId -- multiple
/transpos/{cardnumber}
?id -- multiple
?date -- multiple
?date-start
?date-end
?transId -- multiple
?mandatId -- multiple
?posId -- multiple
?name -- multiple
?menge -- multiple
?menge-min
?menge-max
?single-price -- multiple
?single-price-min
?single-price-max
?whole-price -- multiple
?whole-price-min
?whole-price-max
?rabatt -- multiple
?rabatt-min
?rabatt-max
?bewertung -- multiple
/card/{cardnumber}/stats
?date-start
?date-end
?location-id -- multiple
/card Create, Update, Delete
/days
?date -- multiple
?date-start
?date-end
?week-date
?month-date
?year
?week bool
?month bool
?year bool
-- respond with available dates for meals and if they are from open-mensa, mensa-xml
/locations
?id -- multiple
?name -- multiple
?internalName -- multiple
?open-mensa-id -- multiple
?mensa-xml-id -- multiple
?has-mensa-xml bool
?has-open-mensa bool
?has-internal bool
/locations Create
/locations/{id} Update
/fetchs
?id -- multiple
?source -- multiple
?date -- multiple
?date-start
?date-end
?finish bool
?success bool
?error bool
/fetch/open-mensa
/fetch/open-mensa/sse
/fetch/mensa-xml
/fetch/mensa-xml/sse
/fetch/kartenservice
/fetch/kartenservice/sse
/syncs
?id -- multiple
?source -- multiple
?data-type -- multiple
?date -- multiple
?date-start
?date-end
?finish bool
?success bool
?error bool
/sync/host/meals
/sync/host/meals/sse
/sync/host/transactions
/sync/host/transactions/sse
/health
/stats