// @ts-check

import dotenv from 'dotenv';
import { getMealsByPrice, getMensaLocationByInternalName, getMensaXMLIds, getOpenMensaIds, getTransList, getTransPosList, getTransForStats, getTransPosForStats, insertMensaXMLMeals, insertTransList, insertTransPosList, updateInternalCategory } from './db.js';
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

// ─── Card Stats Computation ─────────────────────────────────────────────────

/**
 * Rounds a number to at most 2 decimal places to avoid floating point artifacts.
 * @param {number} value - The value to round.
 * @returns {number}
 */
function round2(value) {
    return Math.round(value * 100) / 100;
}

/**
 * Rounds a number to at most 2 decimal places, but only if it's a finite number.
 * Returns 0 for NaN/Infinity.
 * @param {number} value - The value to round.
 * @returns {number}
 */
function safeRound2(value) {
    if (typeof value !== 'number' || !isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
}

/**
 * Returns the ISO date string (YYYY-MM-DD) for a given timestamp.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string}
 */
function tsToDateStr(ts) {
    const d = new Date(ts);
    return d.toISOString().split('T')[0];
}

/**
 * Returns the Monday of the week containing the given date string.
 * @param {string} dateStr - ISO date string (YYYY-MM-DD).
 * @returns {string} ISO date string of the Monday.
 */
function getMonday(dateStr) {
    const d = new Date(dateStr);
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
    return monday.toISOString().split('T')[0];
}

/**
 * Returns the semester identifier for a given date string.
 * SoSe: April–September, WiSe: October–March.
 * @param {string} dateStr - ISO date string (YYYY-MM-DD).
 * @returns {string} e.g. "sose24" or "wise24-25".
 */
function getSemester(dateStr) {
    const d = new Date(dateStr);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    if (month >= 4 && month <= 9) {
        const yr = year % 100;
        return `sose${yr}`;
    } else {
        const yr = year % 100;
        const nextYr = month <= 3 ? year - 1 : year;
        const nextYrShort = (nextYr + 1) % 100;
        return `wise${yr}-${String(nextYrShort).padStart(2, '0')}`;
    }
}

/**
 * Returns the weekday name (lowercase English) for a given date string.
 * @param {string} dateStr - ISO date string (YYYY-MM-DD).
 * @returns {string} e.g. "monday".
 */
function getWeekday(dateStr) {
    const d = new Date(dateStr);
    const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return weekdayNames[d.getUTCDay()];
}

/**
 * Returns the 15-minute time slot key for a given timestamp.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string} e.g. "10:30-10:45".
 */
function getTimeSlot(ts) {
    const d = new Date(ts);
    const hours = d.getUTCHours();
    const minutes = d.getUTCMinutes();
    const slotStart = Math.floor(minutes / 15) * 15;
    const slotEnd = slotStart + 15;
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(slotStart)}-${pad(hours)}:${pad(slotEnd)}`;
}

/**
 * Classifies a transpos name into a food type category.
 * @param {string} name - The transaction position name.
 * @returns {'drinks'|'meals'|'desserts'|'snacks'|'other'}
 */
function classifyFoodType(name) {
    // Meals: names starting with "Essen", "Vegan", "Wok", "Pizza", "Aktion Spezialitäten", "Regionales Gericht"
    if (/^(Essen|Vegan|Wok |Pizza |Aktion Spezialitäten|Regionales Gericht)/.test(name)) {
        return 'meals';
    }
    // Desserts
    if (/^(Dessert|Aktions-Dessert)/.test(name)) {
        return 'desserts';
    }
    // Drinks: contains Kola, Limo, Mate, Schorle, Kaffee, Saft, Getränk, Wasser, Tee, Drink
    if (/(Kola|Limo|Mate|Schorle|Kaffee|Saft|Getränk|Wasser|Tee|Drink)/.test(name)) {
        return 'drinks';
    }
    // Snacks
    if (/(Muffin|Brötchen|Donut|Kuchen|Laugen|Bagel|Franzbrötchen|Frikadelle|Obst|Sandwich|Bäcker)/.test(name)) {
        return 'snacks';
    }
    return 'other';
}

/**
 * Creates an empty time-slot map filled with 0 for all 96 slots of a day.
 * @returns {{ [slot: string]: number }}
 */
function createTimeSlotMap() {
    /** @type {{ [slot: string]: number }} */
    const map = {};
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 15) {
            const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
            map[`${pad(h)}:${pad(m)}-${pad(h)}:${pad(m + 15)}`] = 0;
        }
    }
    return map;
}

/**
 * @typedef {Object} SubStats
 * @property {number} total
 * @property {number} [max-per-transaction]
 * @property {{ [key: string]: number }} days
 * @property {{ [key: string]: number }} weeks
 * @property {{ [key: string]: number }} months
 * @property {{ [key: string]: number }} years
 * @property {{ [key: string]: number }} semesters
 * @property {{ [key: string]: number }} weekdays
 * @property {{ [key: string]: number }} time
 * @property {{ [weekday: string]: { [slot: string]: number } }} time-by-weekday
 * @property {{ [key: string]: number }} categories
 * @property {{ [key: string]: number }} canteens
 * @property {{ [key: string]: number }} register
 */

/**
 * Returns a fresh SubStats object initialised with zeros.
 * @returns {SubStats}
 */
function createEmptySubStats() {
    return {
        total: 0,
        days: {},
        weeks: {},
        months: {},
        years: {},
        semesters: {},
        weekdays: { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0 },
        time: createTimeSlotMap(),
        'time-by-weekday': {
            monday: createTimeSlotMap(),
            tuesday: createTimeSlotMap(),
            wednesday: createTimeSlotMap(),
            thursday: createTimeSlotMap(),
            friday: createTimeSlotMap(),
            saturday: createTimeSlotMap(),
            sunday: createTimeSlotMap()
        },
        categories: {},
        canteens: {},
        register: {}
    };
}

/**
 * Returns a SubStats object that also has the max-per-transaction field initialised to 0.
 * @returns {SubStats}
 */
function createEmptySubStatsWithMax() {
    const s = createEmptySubStats();
    s['max-per-transaction'] = 0;
    return s;
}

/**
 * Adds an amount (or count) into every dimension bucket of a SubStats struct.
 * This is the core aggregation function run once per transaction.
 *
 * @param {SubStats} target - The SubStats object being built up.
 * @param {number} amount - The numeric value to add (may be negative, e.g. refunds).
 * @param {number} ts - Unix timestamp (ms) of the transaction.
 * @param {string} kaName - The POS register name (Kassen-Name), used as the canteen / register key.
 * @param {string} category - Optional category label for the transaction (e.g. position name for food types).
 */
function aggregateToSubStats(target, amount, ts, kaName, category) {
    const dateStr = tsToDateStr(ts);
    target.total = round2(target.total + amount);

    // Days
    target.days[dateStr] = round2((target.days[dateStr] || 0) + amount);
    // Weeks (Monday anchor)
    const weekKey = getMonday(dateStr);
    target.weeks[weekKey] = round2((target.weeks[weekKey] || 0) + amount);
    // Months
    const monthKey = dateStr.slice(0, 7);
    target.months[monthKey] = round2((target.months[monthKey] || 0) + amount);
    // Years
    const yearKey = dateStr.slice(0, 4);
    target.years[yearKey] = round2((target.years[yearKey] || 0) + amount);
    // Semesters
    const semKey = getSemester(dateStr);
    target.semesters[semKey] = round2((target.semesters[semKey] || 0) + amount);
    // Weekdays
    const wd = getWeekday(dateStr);
    target.weekdays[wd] = round2((target.weekdays[wd] || 0) + amount);
    // Time slots (15 min)
    const slot = getTimeSlot(ts);
    target.time[slot] = round2((target.time[slot] || 0) + amount);
    // Time by weekday
    if (!target['time-by-weekday'][wd][slot]) {
        target['time-by-weekday'][wd][slot] = 0;
    }
    target['time-by-weekday'][wd][slot] = round2(target['time-by-weekday'][wd][slot] + amount);
    // Categories
    if (category) {
        target.categories[category] = round2((target.categories[category] || 0) + amount);
    }
    // Canteens — keyed by kaName (POS register name, includes canteen and register number)
    if (kaName) {
        target.canteens[kaName] = round2((target.canteens[kaName] || 0) + amount);
        // Register — same key as canteens (kaName identifies the specific register)
        target.register[kaName] = round2((target.register[kaName] || 0) + amount);
    }
}

/**
 * Computes visit streaks from a sorted array of unique date strings.
 *
 * @param {string[]} sortedDates - Sorted ISO date strings (YYYY-MM-DD).
 * @param {Set<string>} closedDates - Set of dates that are "closed" (no meals available).
 * @returns {{ longest: number, 'longest-without-weekends': number, 'longest-without-closed': number, current: number, 'current-without-weekends': number, 'current-without-closed': number }}
 */
function computeStreaks(sortedDates, closedDates = new Set()) {
    if (sortedDates.length === 0) {
        return { longest: 0, 'longest-without-weekends': 0, 'longest-without-closed': 0, current: 0, 'current-without-weekends': 0, 'current-without-closed': 0 };
    }

    const msInDay = 86400000;

    /**
     * Returns the longest consecutive streak from the given dates.
     * @param {string[]} dates
     * @returns {number}
     */
    function longestStreak(dates) {
        if (dates.length === 0) return 0;
        let maxLen = 1;
        let curLen = 1;
        for (let i = 1; i < dates.length; i++) {
            const prev = new Date(dates[i - 1]);
            const curr = new Date(dates[i]);
            const diff = (curr.getTime() - prev.getTime()) / msInDay;
            if (diff === 1) {
                curLen++;
                if (curLen > maxLen) maxLen = curLen;
            } else {
                curLen = 1;
            }
        }
        return maxLen;
    }

    /**
     * Returns the current streak (counting backward from the last date).
     * @param {string[]} dates
     * @returns {number}
     */
    function currentStreak(dates) {
        if (dates.length === 0) return 0;
        let streak = 1;
        for (let i = dates.length - 2; i >= 0; i--) {
            const next = new Date(dates[i + 1]);
            const curr = new Date(dates[i]);
            const diff = (next.getTime() - curr.getTime()) / msInDay;
            if (diff === 1) {
                streak++;
            } else {
                break;
            }
        }
        return streak;
    }

    const longest = longestStreak(sortedDates);
    const current = currentStreak(sortedDates);

    // Without weekends: filter out Saturday and Sunday
    const withoutWeekends = sortedDates.filter(d => {
        const day = new Date(d).getUTCDay();
        return day !== 0 && day !== 6;
    });
    const longestWithoutWeekends = longestStreak(withoutWeekends);
    const currentWithoutWeekends = currentStreak(withoutWeekends);

    // Without closed days: filter out dates that are in closedDates
    const withoutClosed = sortedDates.filter(d => !closedDates.has(d));
    const longestWithoutClosed = longestStreak(withoutClosed);
    const currentWithoutClosed = currentStreak(withoutClosed);

    return {
        longest,
        'longest-without-weekends': longestWithoutWeekends,
        'longest-without-closed': longestWithoutClosed,
        current,
        'current-without-weekends': currentWithoutWeekends,
        'current-without-closed': currentWithoutClosed
    };
}

/**
 * @typedef {{ [key: string]: number }} StreakProps
 */

/**
 * @typedef {Object} VisitStreaks
 * @property {number} longest
 * @property {number} longest-without-weekends
 * @property {number} longest-without-closed
 * @property {number} current
 * @property {number} current-without-weekends
 * @property {number} current-without-closed
 * @property {{ [key: string]: StreakProps }} per-canteen - Per-canteen streaks keyed by kaName.
 */

/**
 * @typedef {Object} CardStatsResult
 * @property {SubStats} spend-amounts
 * @property {SubStats} spend-amount-averages
 * @property {SubStats} spend-counts
 * @property {SubStats} transaction-amounts
 * @property {SubStats} transaction-amount-averages
 * @property {SubStats} transaction-counts
 * @property {SubStats} visits-counts
 * @property {SubStats} visits-averages
 * @property {VisitStreaks} visit-streaks
 * @property {SubStats} top-up-amounts
 * @property {SubStats} top-up-amount-averages
 * @property {SubStats} top-up-counts
 * @property {{ [key: string]: SubStats }} food-types-amounts
 * @property {{ [key: string]: SubStats }} food-types-amount-averages
 * @property {{ [key: string]: SubStats }} food-types-counts
 */

/**
 * Computes comprehensive card usage statistics.
 *
 * Fetches transaction data filtered by cardnumber, date range and location IDs,
 * then aggregates into all the time dimensions defined in stats-data.md
 * in a single pass over the data.
 *
 * @param {string} cardnumber - The card number to compute stats for.
 * @param {string|null} dateStart - ISO date string lower bound (inclusive), or null.
 * @param {string|null} dateEnd - ISO date string upper bound (inclusive), or null.
 * @param {number[]|null} locationIds - Array of mensa_locations ids, or null for all.
 * @returns {CardStatsResult}
 */
export function computeCardStats(cardnumber, dateStart, dateEnd, locationIds) {
    // Fetch only the rows needed — already filtered in SQL
    const transRows = getTransForStats(cardnumber, dateStart, dateEnd, locationIds);
    const transPosRows = getTransPosForStats(cardnumber, dateStart, dateEnd, locationIds);

    // Build a transFullId → positions lookup
    /** @type {{ [transFullId: string]: import('./db.js').TransPosRow[] }} */
    const posByTransId = {};
    for (const pos of transPosRows) {
        if (!posByTransId[pos.transFullId]) {
            posByTransId[pos.transFullId] = [];
        }
        posByTransId[pos.transFullId].push(pos);
    }

    // ── Initialise stat containers ──────────────────────────────────────────
    const spendAmounts = createEmptySubStatsWithMax();
    const spendCounts = createEmptySubStats();
    const transactionAmounts = createEmptySubStatsWithMax();
    const transactionCounts = createEmptySubStats();
    const topUpAmounts = createEmptySubStatsWithMax();
    const topUpCounts = createEmptySubStats();

    /** @type {Set<string>} */
    const allVisitDates = new Set();
    /** @type {{ [key: string]: Set<string> }} */
    const visitDatesByCanteen = {};
    /** @type {{ [date: string]: number }} */
    const visitTsByDate = {};
    /** @type {{ [kaName: string]: { [date: string]: number } }} */
    const visitTsByDateByCanteen = {};

    const foodTypesList = ['drinks', 'meals', 'desserts', 'snacks', 'other'];
    /** @type {{ [key: string]: SubStats }} */
    const foodTypeAmounts = {};
    /** @type {{ [key: string]: SubStats }} */
    const foodTypeCounts = {};
    for (const ft of foodTypesList) {
        foodTypeAmounts[ft] = createEmptySubStatsWithMax();
        foodTypeCounts[ft] = createEmptySubStats();
    }

    let totalSpendCount = 0;
    let totalTransCount = 0;
    let totalTopUpCount = 0;

    // ── Single pass over all transactions ───────────────────────────────────
    for (const trans of transRows) {
        const ts = trans.datum;
        const amount = trans.zahlBetrag;
        const kaName = trans.kaName;
        const typName = trans.typName;
        const transFullId = trans.transFullId;
        const dateStr = tsToDateStr(ts);
        const positions = posByTransId[transFullId] || [];

        // Classify transaction: top-up (Aufladung) vs spend (Verkauf/Automat)
        const isTopUp = amount > 0 && (typName === 'Karte' || typName === 'Aufladung' || positions.some(p => p.name === 'Aufwertung'));
        const isSpend = amount < 0 && (typName === 'Verkauf' || typName === 'Automat');

        if (isSpend) {
            const absAmount = Math.abs(amount);
            totalSpendCount++;

            // Track max-per-transaction (aggregateToSubStats handles total + all dimension buckets)
            if (absAmount > (spendAmounts['max-per-transaction'] || 0)) {
                spendAmounts['max-per-transaction'] = absAmount;
            }
            aggregateToSubStats(spendAmounts, absAmount, ts, kaName, '');

            // Spend counts
            aggregateToSubStats(spendCounts, 1, ts, kaName, '');

            // Track unique visit days (per canteen) and the first transaction timestamp for time-slot computation
            allVisitDates.add(dateStr);
            if (!visitTsByDate[dateStr]) {
                visitTsByDate[dateStr] = ts;
            }
            if (!visitDatesByCanteen[kaName]) {
                visitDatesByCanteen[kaName] = new Set();
            }
            visitDatesByCanteen[kaName].add(dateStr);
            if (!visitTsByDateByCanteen[kaName]) {
                visitTsByDateByCanteen[kaName] = {};
            }
            if (!visitTsByDateByCanteen[kaName][dateStr]) {
                visitTsByDateByCanteen[kaName][dateStr] = ts;
            }

            // Food type classification from positions
            for (const pos of positions) {
                const foodType = classifyFoodType(pos.name);
                if (pos.epreis > 0 && pos.gpreis > 0) {
                    const posAmount = pos.gpreis;
                    const ftTarget = foodTypeAmounts[foodType];
                    // Track max-per-transaction (aggregateToSubStats handles total + all dimension buckets)
                    if (posAmount > (ftTarget['max-per-transaction'] || 0)) {
                        ftTarget['max-per-transaction'] = posAmount;
                    }
                    aggregateToSubStats(ftTarget, posAmount, ts, kaName, pos.name);
                    aggregateToSubStats(foodTypeCounts[foodType], 1, ts, kaName, pos.name);
                }
            }
        }

        if (isTopUp) {
            totalTopUpCount++;
            // Track max-per-transaction (aggregateToSubStats handles total + all dimension buckets)
            if (amount > (topUpAmounts['max-per-transaction'] || 0)) {
                topUpAmounts['max-per-transaction'] = amount;
            }
            aggregateToSubStats(topUpAmounts, amount, ts, kaName, '');
            aggregateToSubStats(topUpCounts, 1, ts, kaName, '');
        }

        // Count every transaction (both spend and top-up)
        totalTransCount++;
        const absAmount = Math.abs(amount);
        // Track max-per-transaction (aggregateToSubStats handles total + all dimension buckets)
        if (absAmount > (transactionAmounts['max-per-transaction'] || 0)) {
            transactionAmounts['max-per-transaction'] = absAmount;
        }
        aggregateToSubStats(transactionAmounts, absAmount, ts, kaName, '');
        aggregateToSubStats(transactionCounts, 1, ts, kaName, '');
    }

    // ── Visit stats ─────────────────────────────────────────────────────────
    const sortedVisitDates = [...allVisitDates].sort();
    const visitsCounts = createEmptySubStats();
    const visitsAverages = createEmptySubStats();
    for (const d of sortedVisitDates) {
        // Use the actual first transaction timestamp for proper time-slot computation
        const visitTs = visitTsByDate[d] || new Date(d).getTime();
        aggregateToSubStats(visitsCounts, 1, visitTs, '', '');
    }
    visitsCounts.total = sortedVisitDates.length;
    visitsAverages.total = sortedVisitDates.length;

    // Populate visits-counts per canteen/register directly (just counts, not dimensions)
    for (const [kaName, dateSet] of Object.entries(visitDatesByCanteen)) {
        const count = dateSet.size;
        visitsCounts.canteens[kaName] = count;
        visitsCounts.register[kaName] = count;
    }

    // ── Visit streaks ───────────────────────────────────────────────────────
    const closedDates = new Set(); // could be extended with actual closed-day data
    const streaksAll = computeStreaks(sortedVisitDates, closedDates);

    /** @type {{ [key: string]: ReturnType<typeof computeStreaks> }} */
    const streaksPerCanteen = {};
    for (const [locKey, dateSet] of Object.entries(visitDatesByCanteen)) {
        const sorted = [...dateSet].sort();
        streaksPerCanteen[locKey] = computeStreaks(sorted, closedDates);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Produces an average SubStats by dividing every cell by the given divisor.
     * Values are rounded to 2 decimal places to avoid floating-point artifacts.
     *
     * @param {SubStats} subStats - The source aggregate.
     * @param {number} divisor - Number to divide by.
     * @param {boolean} [includeMax=false] - Whether to retain the max-per-transaction field.
     * @returns {SubStats}
     */
    function computeAverages(subStats, divisor, includeMax) {
        const avg = createEmptySubStats();
        if (divisor <= 0) return avg;

        avg.total = round2(subStats.total / divisor);
        if (includeMax && subStats['max-per-transaction'] !== undefined) {
            avg['max-per-transaction'] = subStats['max-per-transaction'];
        }

        // Days, weeks, months, years, semesters: clone keys, divide each value
        for (const key of /** @type {(keyof SubStats)[]} */ (['days', 'weeks', 'months', 'years', 'semesters'])) {
            const src = /** @type {{ [k: string]: number }} */ (/** @type {unknown} */ (subStats[key]));
            const dst = /** @type {{ [k: string]: number }} */ (/** @type {unknown} */ (avg[key]));
            for (const k of Object.keys(src)) {
                dst[k] = round2(src[k] / divisor);
            }
        }
        // Weekdays
        for (const k of Object.keys(avg.weekdays)) {
            avg.weekdays[k] = round2((subStats.weekdays[k] || 0) / divisor);
        }
        // Time slots
        for (const k of Object.keys(avg.time)) {
            avg.time[k] = round2((subStats.time[k] || 0) / divisor);
        }
        // Time by weekday
        for (const wd of Object.keys(avg['time-by-weekday'])) {
            const twd = subStats['time-by-weekday'][wd] || {};
            for (const slot of Object.keys(avg['time-by-weekday'][wd])) {
                avg['time-by-weekday'][wd][slot] = round2((twd[slot] || 0) / divisor);
            }
        }
        // Categories
        for (const k of Object.keys(subStats.categories)) {
            avg.categories[k] = round2(subStats.categories[k] / divisor);
        }
        // Canteens
        for (const k of Object.keys(subStats.canteens)) {
            avg.canteens[k] = round2(subStats.canteens[k] / divisor);
        }
        // Register
        for (const k of Object.keys(subStats.register)) {
            avg.register[k] = round2(subStats.register[k] / divisor);
        }
        return avg;
    }

    const spendAvgDivisor = totalSpendCount > 0 ? totalSpendCount : 1;
    const transAvgDivisor = totalTransCount > 0 ? totalTransCount : 1;
    const topUpAvgDivisor = totalTopUpCount > 0 ? totalTopUpCount : 1;
    const visitAvgDivisor = sortedVisitDates.length > 0 ? sortedVisitDates.length : 1;

    // ── Food type sub-stats ─────────────────────────────────────────────────
    /** @type {{ [key: string]: SubStats }} */
    const foodTypesAmountsOut = {};
    /** @type {{ [key: string]: SubStats }} */
    const foodTypesAmountAveragesOut = {};
    /** @type {{ [key: string]: SubStats }} */
    const foodTypesCountsOut = {};
    for (const ft of foodTypesList) {
        const amountObj = foodTypeAmounts[ft];
        const countObj = foodTypeCounts[ft];
        const divisor = countObj.total > 0 ? countObj.total : 1;
        foodTypesAmountsOut[ft] = amountObj;
        foodTypesAmountAveragesOut[ft] = computeAverages(amountObj, divisor, false);
        foodTypesCountsOut[ft] = countObj;
    }

    // ── Assemble result ─────────────────────────────────────────────────────
    return {
        'spend-amounts': spendAmounts,
        'spend-amount-averages': computeAverages(spendAmounts, spendAvgDivisor, false),
        'spend-counts': spendCounts,
        'transaction-amounts': transactionAmounts,
        'transaction-amount-averages': computeAverages(transactionAmounts, transAvgDivisor, false),
        'transaction-counts': transactionCounts,
        'visits-counts': visitsCounts,
        'visits-averages': computeAverages(visitsAverages, visitAvgDivisor, false),
        'visit-streaks': {
            longest: streaksAll.longest,
            'longest-without-weekends': streaksAll['longest-without-weekends'],
            'longest-without-closed': streaksAll['longest-without-closed'],
            current: streaksAll.current,
            'current-without-weekends': streaksAll['current-without-weekends'],
            'current-without-closed': streaksAll['current-without-closed'],
            'per-canteen': streaksPerCanteen
        },
        'top-up-amounts': topUpAmounts,
        'top-up-amount-averages': computeAverages(topUpAmounts, topUpAvgDivisor, false),
        'top-up-counts': topUpCounts,
        'food-types-amounts': foodTypesAmountsOut,
        'food-types-amount-averages': foodTypesAmountAveragesOut,
        'food-types-counts': foodTypesCountsOut
    };
}

/**
 * Fetches transactions and transaction positions for the given card number and password, inserts them into the database, and returns them along with the past date used for fetching.
 * @param {string} cardnumber 
 * @param {string} password 
 * @returns {Promise<{trans: any[], transpos: any[], pastDate: Date}>}
 */
export async function fetchTransAndTranspos(cardnumber, password, /** @type {((data: object) => any) | null} */ onProgress = null) {
    onProgress?.({ step: 'auth', message: 'Authenticating with Kartenservice...' });
    const { authToken, days } = await getAuthTokenWithDays(cardnumber, password);
    var today = new Date(new Date().setHours(0, 0, 0, 0));
    // add 1 day to end date to include transactions of today, as the API seems to use an exclusive end date
    var endDate = new Date(today.getTime() + (1 * 24 * 60 * 60 * 1000));
    var pastDate = new Date(today.getTime() - (days * 24 * 60 * 60 * 1000));
    onProgress?.({ step: 'fetch_transactions', message: 'Fetching transactions...' });
    const transactions = await getTransactions(cardnumber, pastDate, endDate, authToken);
    onProgress?.({ step: 'fetch_transpos', message: 'Fetching transaction positions...' });
    const transactionPositions = await getTransactionPositions(cardnumber, pastDate, endDate, authToken);
    onProgress?.({ step: 'insert', message: `Inserting ${transactions.length} transactions and ${transactionPositions.length} positions...`, count: transactions.length + transactionPositions.length });
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
export async function fetchOpenMensaMeals(pastDate, /** @type {((data: object) => any) | null} */ onProgress = null) {
    const canteens = getOpenMensaIds();
    const meals = await getAllOpenMensaMealsForCanteens(canteens, pastDate, onProgress);
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
export async function fetchMensaXMLMeals(pastDate, /** @type {((data: object) => any) | null} */ onProgress = null) {
    /** @type {XMLMeal[]} */
    var meals = [];
    // get date of monday of last week
    var lastWeekMonday = new Date();
    lastWeekMonday.setDate(lastWeekMonday.getDate() - lastWeekMonday.getDay() - 6);
    var today = new Date(new Date().setHours(0, 0, 0, 0));
    var futureDate = new Date(today.getTime() + (30 * 24 * 60 * 60 * 1000)); // add 1 Month to end date to include meals of the next month
    var days = [];
    for (var d = lastWeekMonday; d <= futureDate; d.setDate(d.getDate() + 1)) {
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
        onProgress?.({ step: 'fetch_canteen', message: `Fetched ${canteenMeals.length} meals for canteen ${canteen}`, done: index + 1, total: canteens.length, count: canteenMeals.length });

    }
    return meals;
}