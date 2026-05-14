// @ts-check

import dotenv from 'dotenv';
import { getMealsByPrice, getMensaLocationByInternalName, getMensaXMLIds, getOpenMensaIds, getTransList, getTransPosList, insertMensaXMLMeals, insertTransList, insertTransPosList, updateInternalCategory } from './db.js';
import { getAllOpenMensaMealsForCanteens, getAuthTokenWithDays, getMensaXML, getTransactionPositions, getTransactions } from './api.js';
dotenv.config({ quiet: true });
    
export function updateMealLookup() {
    let transactions = getTransList();
    let transactionItems = getTransPosList();
    transactionItems = transactionItems.filter(ti => ti.name.startsWith("Essen"));
    console.log('Filtered Transaction Items:', [...new Set(transactionItems.map(ti => ti.name))]); 
    for (const item of transactionItems) {
        const transaction = transactions.find(t => t.transFullId === item.transFullId);
        const price = item.epreis;
        if (transaction) {
            const date = new Date(transaction.datum.toISOString().split('T')[0]);
            const mensaLocationId = getMensaLocationByInternalName(transaction.ortName);
            if (mensaLocationId) {
                var meals = getMealsByPrice(mensaLocationId, date, price);
                meals = meals.filter(meal => meal.internalCategory === null);
                if (meals.length > 0) {
                    if (meals.length > 1) {
                        console.warn(`Multiple meals [${meals.map(meal => JSON.stringify(meal)).join(', ')}] found for location ${transaction.ortName} on ${date.toISOString().split('T')[0]} with price ${price}`);
                    } else {
                        console.log(`Matched meal ${JSON.stringify(meals[0])} for transaction item ${item.name} with price ${price}`);
                        updateInternalCategory(meals[0].id, item.name);
                    }
                } else {
                    console.warn(`No meal found for location ${transaction.ortName} on ${date.toISOString().split('T')[0]} with price ${price}`);
                }
            } else {
                console.warn(`No mensa location found for transaction with ortName ${transaction.ortName}`);
            }
        }
    }
}

/**
 * 
 * @param {NodeListOf<Element>} pricesElements 
 * @returns {{students: number|null, employees: number|null, others: number|null, pupils: number|null}}
 */
function parseMensaXMLPrices(pricesElements) {
    var priceMap = {};
    for (const price of pricesElements) {
        var priceType = price.attributes.getNamedItem('consumerID')?.value;
        var priceValue = parseFloat(price.textContent);
        switch (priceType) {
            case "0":
                priceMap["students"] = priceValue;
                break;
            case "1":
                priceMap["employees"] = priceValue;
                break;
            case "2":
                priceMap["others"] = priceValue;
                break;
        }
    }
    return Object.assign({ students: null, employees: null, others: null, pupils: null }, priceMap);
}

/**
 * 
 * @param {Document} xmldocument 
 * @return {{type: string, locationId: string, date: Date, name: string, category: string, internalCategory: string, prices: {students: number|null, employees: number|null, others: number|null, pupils: number|null}, components: string[], tags: {name: string, type: string}[]}[]}
 */
export function parseMensaXML(xmldocument) {
    var meals = [];
    for (const element of xmldocument.querySelectorAll('group')) {
        if (element.attributes.getNamedItem('productiondate') === null || element.attributes.getNamedItem('type') === null || element.attributes.getNamedItem('location') === null) {
            console.warn(`Group element is missing required attributes: ${element.outerHTML}`);
            continue;
        }
        var date = new Date(/** @type {Attr} */ (element.attributes.getNamedItem('productiondate')).value);
        var category = element.querySelector('name')?.textContent ?? undefined;
        var prices = parseMensaXMLPrices(element.querySelectorAll('prices price'));

        var components = [...element.querySelectorAll('components component')].map(c => c.querySelector("name1")?.textContent ?? '');
        var tags = [...element.querySelectorAll('taggings tagging')].filter(t => t.textContent).map(t => ({name: t.textContent, type: /** @type {Attr} */ (t.attributes.getNamedItem('type')).value}));

        var type = /** @type {Attr} */ (element.attributes.getNamedItem('type')).value == "1" ? "Essen" : "Komponente";
        var locationId = /** @type {Attr} */ (element.attributes.getNamedItem('location')).value;
        var internalCategory = element.querySelector('internalname')?.textContent ?? '';

        if (type === "Essen") {
            if (components.length > 0) {
                meals.push({
                    type: type,
                    locationId: locationId,
                    date: date,
                    name: components[0],
                    category: category ?? '',
                    internalCategory: internalCategory,
                    prices: prices,
                    components: components.slice(1),
                    tags: tags
                });
            } 
        } else {
            for (const component of components) {
                meals.push({
                    type: type,
                    locationId: locationId,
                    date: date,
                    name: component,
                    category: category ?? '',
                    internalCategory: internalCategory,
                    prices: prices,
                    components: [], // components of components are not provided by the API
                    tags: tags
                });
            }
        }
    }
    // sort by location, date, then by type, then by category
    meals.sort((a, b) => {
        if (a.locationId !== b.locationId) {
            return Number(a.locationId) - Number(b.locationId);
        } 
        if (a.date.getTime() !== b.date.getTime()) {
            return a.date.getTime() - b.date.getTime();
        }
        if (a.type !== b.type) {
            return a.type.localeCompare(b.type);
        }
        if (a.category !== b.category) {
            return (a.category ?? '').localeCompare(b.category ?? '');
        }
        return 0;
    });
    return meals;
}

/**
 * Fetches transactions and transaction positions for the given card number and password, inserts them into the database, and returns them along with the past date used for fetching.
 * @param {string} cardnumber 
 * @param {string} password 
 * @returns {Promise<{trans: any[], transpos: any[], pastDate: Date}>}
 */
export async function fetchTransAndTranspos(cardnumber, password) {
    const { authToken, days } = await getAuthTokenWithDays(cardnumber, password);
    var today = new Date(new Date().setHours(0, 0, 0, 0));
    var pastDate = new Date(today.getTime() - (days * 24 * 60 * 60 * 1000));
    const transactions = await getTransactions(cardnumber, pastDate, today, authToken);
    const transactionPositions = await getTransactionPositions(cardnumber, pastDate, today, authToken);

    insertTransList(transactions, cardnumber);
    insertTransPosList(transactionPositions, cardnumber);

    return { trans: transactions, transpos: transactionPositions, pastDate: pastDate };
}

/**
 * @typedef {Object} OpenMensaMeal
 * @property {string} name Name of the meal
 * @property {string} category Category of the meal, e.g. "Menü", "Beilage", etc.
 * @property {{students: number|null, employees: number|null, others: number|null, pupils: number|null}} prices Prices for different groups, null if not available
 * @property {string[]} notes List of notes for the meal, e.g. dietary information, allergens, etc.
 */
/**
 * Fetches meals from the OpenMensa API for all canteens and the given past date, and returns them.
 * @param {Date} pastDate 
 * @returns {Promise<OpenMensaMeal[]>}
 */
export async function fetchOpenMensaMeals(pastDate) {
    const canteens = getOpenMensaIds();
    const meals = await getAllOpenMensaMealsForCanteens(canteens, pastDate);
    return meals;
}

/**
 * @typedef {Object} XMLMeal
 * @property {string} type Type of the meal, either "Essen" or "Komponente"
 * @property {string} locationId ID of the canteen location
 * @property {Date} date Date of the meal
 * @property {string} name Name of the meal or component
 * @property {string} category Category of the meal, e.g. "Menü", "Beilage", etc.
 * @property {string} internalCategory Internal category of the meal, can be used for matching with transactions
 * @property {{students: number|null, employees: number|null, others: number|null, pupils: number|null}} prices Prices for different groups, null if not available
 * @property {string[]} components List of components if this is a meal, empty if this is a component
 * @property {{name: string, type: string}[]} tags List of tags for the meal or component, e.g. dietary information, allergens, etc. 
 */
/**
 * Fetches meals from the Mensa XML API for all canteens and the given past date, and returns them.
 * @param {Date} pastDate 
 * @returns {Promise<XMLMeal[]>}
 */
export async function fetchMensaXMLMeals(pastDate) {
    /** @type {XMLMeal[]} */
    var meals = [];
    // get date of monday of last week
    var lastWeekMonday = new Date();
    lastWeekMonday.setDate(lastWeekMonday.getDate() - lastWeekMonday.getDay() - 6);
    var today = new Date(new Date().setHours(0, 0, 0, 0));
    var days = [];
    for (var d = lastWeekMonday; d <= today; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }

    const canteens = getMensaXMLIds();
    for (let index = 0; index < canteens.length; index++) {
        const canteen = canteens[index];

        // API only provides meals for the current, future and maybe last week
        // var canteenDays = days.concat(getMissingMensaXMLDays(canteen, pastDate));
        var canteenDays = days;
        /** @type {XMLMeal[]} */
        var canteenMeals = [];
        for (const d of canteenDays) {
            var xml = await getMensaXML(canteen, new Date(d));
            if (xml === null) {
                continue;
            }
            const mealsXML = parseMensaXML(xml);
            if (mealsXML === null) {
                continue;
            }
            canteenMeals = canteenMeals.concat(mealsXML);
            insertMensaXMLMeals(mealsXML.filter(m => m.category !== undefined));
        }
        meals = meals.concat(canteenMeals);
        console.log(`Fetched ${canteenMeals.length} meals for canteen ${canteen}, canteen progess: ${index + 1}/${canteens.length}`);

    }
    return meals;
}