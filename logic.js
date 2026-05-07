import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ quiet: true });

const transactionFile = process.env.TRANSACTION_FILE;
const transactionItemsFile = process.env.TRANSACTION_POSITIONS_FILE;
const openMensaCacheFile = process.env.OPENMENSA_CACHE_FILE;
const mealLookupFile = process.env.MEAL_LOOKUP_FILE;

export const ortNameOpenMensaMapping = {
    "MaP Mensaküche Leitung": 63, // Mensa am Park
    "-": 64, // Mensa Academica
    "Mensaküche amElsterbecken": 65, // Mensa am Elsterbecken
    "-": 66, // Mensa An den Tierkliniken
    "PSW Mensaküche Leitung": 68, // Mensa Petersteinweg
    "-": 67, // Mensa Liebigstraße
    "-": 69, // Mensa/Cafetaria Schönauer Straße
    "-": 70, // Cafeteria Dittrichring
    "-": 71, // Cafeteria Koburger Straße
    "-": 72, // Cafeteria Philipp-Rosenthal-Straße
};

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
 * expand transaction and transaction items storage logs with current data
 * @param {Transaction[]} transactions 
 * @param {TransactionPosition[]} transactionItems 
 */
export async function expandTransactions(transactions, transactionItems) {
    let existingTransactions = [];
    let existingTransactionItems = [];
    if (fs.existsSync(transactionFile)) {
        existingTransactions = JSON.parse(fs.readFileSync(transactionFile, 'utf-8'));
    }
    if (fs.existsSync(transactionItemsFile)) {
        existingTransactionItems = JSON.parse(fs.readFileSync(transactionItemsFile, 'utf-8'));
    }
    const allTransactions = [...existingTransactions, ...transactions];
    const allTransactionItems = [...existingTransactionItems, ...transactionItems];
    // Filter out transactions that are already in the existing transactions based on transFullId and datum or posId for transaction items
    const uniqueTransactions = allTransactions.filter((transaction, index, self) =>
        index === self.findIndex((t) => t.transFullId === transaction.transFullId && t.datum === transaction.datum)
    );
    const uniqueTransactionItems = allTransactionItems.filter((transactionItem, index, self) =>
        index === self.findIndex((ti) => ti.transFullId === transactionItem.transFullId && ti.posId === transactionItem.posId)
    );
    fs.writeFileSync(transactionFile, JSON.stringify(uniqueTransactions, null, 2));
    fs.writeFileSync(transactionItemsFile, JSON.stringify(uniqueTransactionItems, null, 2));   
}

export async function createMealLookup() {
    let transactions = JSON.parse(fs.readFileSync(transactionFile, 'utf-8'));
    let transactionItems = JSON.parse(fs.readFileSync(transactionItemsFile, 'utf-8'));
    let openMensaMeals = JSON.parse(fs.readFileSync(openMensaCacheFile, 'utf-8'));
    const mealLookup = {};
    transactionItems = transactionItems.filter(ti => ti.name.startsWith("Essen"));
    console.log('Filtered Transaction Items:', [...new Set(transactionItems.map(ti => ti.name))]);
    for (const item of transactionItems) {
        const transaction = transactions.find(t => t.transFullId === item.transFullId);
        const price = item.epreis;
        if (transaction) {
            var date_string = transaction.datum.split(' ')[0]; // Get date part only
            const date = new Date(date_string.split('.').reverse().join('-')); // Convert to Date object
            if (mealLookup[date.toISOString().split('T')[0]] === undefined) {
                mealLookup[date.toISOString().split('T')[0]] = {};
            }
            const ortName = transaction.ortName;
            const canteenId = ortNameOpenMensaMapping[ortName];
            if (canteenId) {
                if (mealLookup[date.toISOString().split('T')[0]][canteenId] === undefined) {
                    mealLookup[date.toISOString().split('T')[0]][canteenId] = {};
                }
                // cacheKey is canteenId + date in format YYYY-MM-DD
                const cacheKey = `${canteenId}_${date.toISOString().split('T')[0]}`;
                var meals = openMensaMeals[cacheKey] || [];
                const mealsWithPrice = meals.filter(meal => meal.prices && Object.values(meal.prices).includes(price));
                if (mealsWithPrice.length > 0) {
                    if (mealsWithPrice.length > 1) {
                        console.warn(`Multiple meals [${mealsWithPrice.map(meal => meal.category).join(', ')}] found for canteen ${canteenId} on ${date.toISOString().split('T')[0]} with price ${price}, taking the first one`);
                    }
                    mealLookup[date.toISOString().split('T')[0]][canteenId][item.name] = mealsWithPrice[0];
                    // console.log(`Matched meal ${mealsWithPrice[0].category} for transaction item ${item.name} with price ${price}`);
                } else {
                    console.warn(`No meal found for canteen ${canteenId} on ${date.toISOString().split('T')[0]} with price ${price}`);
                }
            }
        }
    }
    fs.writeFileSync(mealLookupFile, JSON.stringify(mealLookup, null, 2));
}