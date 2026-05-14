// @ts-check

import dotenv from 'dotenv';
import {JSDOM} from 'jsdom';
import { getOpenMensaDays, insertOpenMensaMeals, getOpenMensaMeals as getDBOpenMensaMeals } from './db.js';
dotenv.config({ quiet: true });

const baseUrl = process.env.BASE_URL;
const basicAuth = Buffer.from(`${process.env.BASIC_AUTH_USERNAME}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64');

const openMensaApiUrl = process.env.OPENMENSA_API_URL;
const mensaXmlUrl = process.env.MENSA_XML_URL;

/**
 * 
 * @param {*} cardnumber 
 * @param {*} password 
 * @returns 
 */
export async function getAuthToken(cardnumber, password) {
    const response = await fetch(`${baseUrl}LOGIN?karteNr=${cardnumber}&datenformat=JSON`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ "BenutzerID": cardnumber, "Passwort": password })
    });
    if (!response.ok) {
        if (response.status === 401) {
            // Basic auth failed
            throw new Error(await response.text());
        } else if (response.status === 599) {
            // Error from the server, possibly due to invalid credentials
            throw new Error(await response.text());
        } else if (response.status === 403) {
            // Card internet access is not active
            throw new Error("Card internet access is not active.");
        } else if (response.status === 408) {
            // Request timeout
            throw new Error("Request timed out. Please try again later.");
        } else {
            // Other errors
            throw new Error(`Unexpected error: ${response.status} - ${await response.text()}`);
        }
    }
    const data = await response.json();
    return data[0].authToken;
}

/**
 * 
 * @param {*} cardnumber 
 * @param {*} password 
 * @returns 
 */
export async function getAuthTokenWithDays(cardnumber, password) {
    const response = await fetch(`${baseUrl}LOGIN?karteNr=${cardnumber}&datenformat=JSON`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ "BenutzerID": cardnumber, "Passwort": password })
    });
    if (!response.ok) {
        if (response.status === 401) {
            // Basic auth failed
            throw new Error(await response.text());
        } else if (response.status === 599) {
            // Error from the server, possibly due to invalid credentials
            throw new Error(await response.text());
        } else if (response.status === 403) {
            // Card internet access is not active
            throw new Error("Card internet access is not active.");
        } else if (response.status === 408) {
            // Request timeout
            throw new Error("Request timed out. Please try again later.");
        } else {
            // Other errors
            throw new Error(`Unexpected error: ${response.status} - ${await response.text()}`);
        }
    }
    const data = await response.json();
    return { authToken: data[0].authToken, days: data[0].lTransTage };
}

/**
 * @typedef {Object} Transaction
 * @property {number} mandantId
 * @property {number} id ID of the transaction, sequential for each request but not a global identifier
 * @property {string} transFullId Unique identifier for the transaction, consisting of mandantId, id and a random number.
 * @property {string} datum Date of the transaction in the format "dd.MM.yyyy HH:mm"
 * @property {string} ortName Name of the location where the transaction took place, e.g. "Mensa Hochallee"
 * @property {string} kaName Name of the cash register where the transaction took place, e.g. "Kasse 1"
 * @property {string} typName Type of the transaction, e.g. "Verkauf" for a purchase or "Aufladung" for a top-up
 * @property {number} zahlBetrag Amount of the transaction, negative for purchases and positive for top-ups
 * @property {number} dateiablageId ID for receipts, not set if no receipt is available
 * @property {string} bonusInfo optional field
 */
/**
 * Returns a list of transactions for the given card number and date range. Requires an auth token obtained from the getAuthToken function.
 * @param {string} cardnumber 
 * @param {Date} dateStart
 * @param {Date} dateEnd 
 * @param {string} authToken 
 * @returns {Promise<Transaction[]>} List of transactions for the given card and date range
 */
export async function getTransactions(cardnumber, dateStart, dateEnd, authToken) {
    var dateStartStr = `${String(dateStart.getDate()).padStart(2, '0')}.${String(dateStart.getMonth() + 1).padStart(2, '0')}.${dateStart.getFullYear()}`;
    var dateEndStr = `${String(dateEnd.getDate()).padStart(2, '0')}.${String(dateEnd.getMonth() + 1).padStart(2, '0')}.${dateEnd.getFullYear()}`;
    const response = await fetch(`${baseUrl}TRANS?karteNr=${cardnumber}&datumVon=${dateStartStr}&datumBis=${dateEndStr}&authToken=${authToken}`, {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'accept': 'application/json'
        }
    });
    if (!response.ok) {
        if (response.status === 401) {
            // Basic auth failed
            throw new Error(await response.text());
        } else if (response.status === 403) {
            // Missing or invalid auth token
            throw new Error("Missing or invalid auth token.");
        } else {
            // Other errors
            throw new Error(`Unexpected error: ${response.status} - ${await response.text()}`);
        }
    }
    const data = await response.json();
    return data;
}

/**
 * @typedef {Object} TransactionPosition
 * @property {number} mandantId
 * @property {number} id ID of the transaction position, sequential for each transaction but not a global identifier
 * @property {string} transFullId Identifier of the transaction this position belongs to
 * @property {number} posId Position sequence number within the transaction, starting at 1
 * @property {string} name Name of the item, e.g. "Menü 1"
 * @property {number} menge Quantity of the item
 * @property {number} epreis Unit price of the item
 * @property {number} rabatt Discount amount for the item, negative for discounts
 * @property {number} gpreis Total price of the items after applying the discount
 * @property {number} bewertung Rating bitmask
 */
/**
 * Returns a list of transaction positions for a given card number, date range and auth token. Requires an auth token obtained from the getAuthToken function.
 * @param {string} cardnumber 
 * @param {Date} dateStart 
 * @param {Date} dateEnd 
 * @param {string} authToken 
 * @returns {Promise<TransactionPosition[]>} List of transaction positions for the given card and date range
 */
export async function getTransactionPositions(cardnumber, dateStart, dateEnd, authToken) {
    var dateStartStr = `${String(dateStart.getDate()).padStart(2, '0')}.${String(dateStart.getMonth() + 1).padStart(2, '0')}.${dateStart.getFullYear()}`;
    var dateEndStr = `${String(dateEnd.getDate()).padStart(2, '0')}.${String(dateEnd.getMonth() + 1).padStart(2, '0')}.${dateEnd.getFullYear()}`;
    const response = await fetch(`${baseUrl}TRANSPOS?karteNr=${cardnumber}&datumVon=${dateStartStr}&datumBis=${dateEndStr}&authToken=${authToken}`, {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'accept': 'application/json'
        }
    });
    if (!response.ok) {
        if (response.status === 401) {
            // Basic auth failed
            throw new Error(await response.text());
        } else if (response.status === 403) {
            // Missing or invalid auth token
            throw new Error("Missing or invalid auth token.");
        } else {
            // Other errors
            throw new Error(`Unexpected error: ${response.status} - ${await response.text()}`);
        }
    }
    const data = await response.json();
    return data;
}

/**
 * Returns the XML document containing the menu for the given location and date.
 * @param {string} locationId 
 * @param {Date} date 
 * @returns {Promise<Document|null>} XML document containing the menu for the given location and date
 */
export async function getMensaXML(locationId, date) {
    var dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const response = await fetch(`${mensaXmlUrl}?location=${locationId}&date=${dateStr}`, {
        method: 'GET',
        headers: {
            'accept': 'application/xml'
        }
    });
    if (!response.ok) {
        throw new Error(`Unexpected error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.text();
    if (!data || data.trim() === '') {
        console.error(`Received empty response for location ${locationId} on date ${dateStr}`);
        return null;
    }
    const xmlDoc = new JSDOM(data, { contentType: "application/xml" }).window.document;
    return xmlDoc;
}

/**
 * Fetches the list of canteens from the OpenMensa API and filters them to include only those located in Leipzig.
 * @returns {Promise<{id: number, name: string, city: string, address: string, coordinates: number[]}[]>} List of canteens in Leipzig with their id, name, city, address, and coordinates
 */
export async function getOpenMensaCanteens() {
    const response = await fetch(`${openMensaApiUrl}/canteens`, {
        method: 'GET',
        headers: {
            'accept': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Unexpected error: ${response.status} - ${await response.text()}`);
    }
    /** @type {{id: number, name: string, city: string, address: string, coordinates: number[]}[]} */
    const data = await response.json();
    return (data.filter(canteen => canteen.city === "Leipzig"));
}

/**
 * Fetches the list of canteen days for a given canteen starting from a specified date from the OpenMensa API. Handles pagination if there are multiple pages of results.
 * @param {number|string} canteenId 
 * @param {Date} startDate 
 * @returns {Promise<{date: string, closed: boolean}[]>} List of canteen days starting from the given date, including the date and whether the canteen is closed on that day. Date formatted as "yyyy-MM-dd".
 */
export async function getOpenMensaCanteenDays(canteenId, startDate) {
    var dateStartStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    const response = await fetch(`${openMensaApiUrl}/canteens/${canteenId}/days?start=${dateStartStr}`, {
        method: 'GET',
        headers: {
            'accept': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Unexpected error: ${response.status} - ${await response.text()}`);
    }
    // check for pagination
    const totalPages = parseInt(response.headers.get('X-Total-Pages') || '1');
    /** @type {{date: string, closed: boolean}[]} */
    let allData = [];
    for (let page = 1; page <= totalPages; page++) {
        const pageResponse = await fetch(`${openMensaApiUrl}/canteens/${canteenId}/days?start=${dateStartStr}&page=${page}`, {
            method: 'GET',
            headers: {
                'accept': 'application/json'
            }
        });
        if (!pageResponse.ok) {
            throw new Error(`Unexpected error: ${pageResponse.status} - ${await pageResponse.text()}`);
        }
        const pageData = await pageResponse.json();
        allData = allData.concat(pageData);
    }
    return allData;
}

/**
 * @typedef {Object} Meal
 * @property {number} id ID of the meal
 * @property {string} name Name of the meal
 * @property {string} category Category of the meal, e.g. "Menü", "Beilage", etc.
 * @property {{students: number|null, employees: number|null, others: number|null, pupils: number|null}} prices Prices for different groups, null if not available
 * @property {string[]} notes List of notes for the meal, e.g. dietary information, allergens, etc.
 */
/**
 * Fetches the list of meals for a given canteen and date from the OpenMensa API. Handles pagination if there are multiple pages of results. Caches the results in the database and returns cached data if available and the date is not in the future.
 * @param {number|string} canteenId 
 * @param {string} date - ISO date string.
 * @returns {Promise<Meal[]>}
 */
export async function getOpenMensaMeals(canteenId, date) {
    const cachedData = getDBOpenMensaMeals(Number(canteenId), date);
    if (cachedData && cachedData.length > 0 && new Date(date) <= new Date(new Date().toISOString().split('T')[0])) {
        return cachedData;
    }
    const response = await fetch(`${openMensaApiUrl}/canteens/${canteenId}/days/${date}/meals`, {
        method: 'GET',
        headers: {
            'accept': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Unexpected error: ${response.status} - ${await response.text()}`);
    }
    // check for pagination
    const totalPages = parseInt(response.headers.get('X-Total-Pages') || '1');
    /** @type {Meal[]} */
    let allData = [];
    for (let page = 1; page <= totalPages; page++) {
        const pageResponse = await fetch(`${openMensaApiUrl}/canteens/${canteenId}/days/${date}/meals?page=${page}`, {
            method: 'GET',
            headers: {
                'accept': 'application/json'
            }
        });
        if (!pageResponse.ok) {
            if (pageResponse.status === 429) {
                // Too many requests, wait and retry
                console.warn(`Rate limit exceeded.`);
                break;
            }
            throw new Error(`Unexpected error: ${pageResponse.status} - ${await pageResponse.text()}`);
        }
        const pageData = await pageResponse.json();
        allData = allData.concat(pageData);
    }
    insertOpenMensaMeals(allData, canteenId, date);
    return allData;
}

/**
 * Fetches all meals for a given canteen starting from a specified date. Filters out closed days and days that are already cached.
 * @param {number|string} canteenId 
 * @param {Date} startDate 
 * @returns {Promise<Meal[]>}
 */
export async function getAllOpenMensaMeals(canteenId, startDate) {
    let canteenDays = await getOpenMensaCanteenDays(canteenId, startDate);
    canteenDays = canteenDays.filter(day => day.closed === false); // Filter out closed days
    var cachedDays = getOpenMensaDays(Number(canteenId), startDate);
    cachedDays = cachedDays.filter(days => days.getTime() < new Date(new Date().setHours(0, 0, 0, 0)).getTime()); // Filter out today and future days
    canteenDays = canteenDays.filter(day => !cachedDays.some(cachedDay => cachedDay.getTime() === new Date(day.date).getTime())); // Filter out days that are already cached
    /** @type {Meal[]} */
    let allMeals = [];
    for (const day of canteenDays) {
        const meals = await getOpenMensaMeals(canteenId, day.date);
        allMeals = allMeals.concat(meals);
        await new Promise(resolve => setTimeout(resolve, 100)); // wait 100ms between requests to avoid hitting rate limits
    }
    return allMeals;
}

/**
 * Fetches all meals for a list of canteens starting from a specified date. Filters out closed days and days that are already cached.
 * @param {Array<number|string>} canteenIds 
 * @param {Date} startDate 
 * @returns {Promise<Meal[]>}
 */
export async function getAllOpenMensaMealsForCanteens(canteenIds, startDate) {
    /** @type {Meal[]} */
    let allMeals = [];
    for (const canteenId of canteenIds) {
        const meals = await getAllOpenMensaMeals(canteenId, startDate);
        console.log(`Fetched ${meals.length} meals for canteen ${canteenId}, canteen progress: ${canteenIds.indexOf(canteenId) + 1}/${canteenIds.length}`);
        allMeals = allMeals.concat(meals);
    }
    return allMeals;
}

/**
 * Estimates the duration to fetch all meals for a list of canteens starting from a specified date based on the number of days that need to be fetched and a fixed wait time between requests.
 * @param {Array<number|string>} canteenIds 
 * @param {Date} startDate 
 * @returns {Promise<number>} Estimated duration in milliseconds to fetch all meals for the given canteens and start date.
 */
export async function getAllOpenMensaMealsForCanteensDuration(canteenIds, startDate) {
    let days = 0;
    for (const canteenId of canteenIds) {
        const canteenDays = await getOpenMensaCanteenDays(canteenId, startDate);
        days += canteenDays.length;
    }
    // Assuming 100ms wait between requests, calculate the total duration
    const totalDurationMs = days * 100;
    return totalDurationMs;
}

