import dotenv from 'dotenv';
import fs from 'fs';
import { getMealsByPrice, getMensaLocationByInternalName, getMensaXMLMeals, getOpenMensaMeals, getTransList, getTransPosList, updateInternalCategory } from './db.js';
dotenv.config({ quiet: true });

const transactionFile = process.env.TRANSACTION_FILE;
const transactionItemsFile = process.env.TRANSACTION_POSITIONS_FILE;
const openMensaCacheFile = process.env.OPENMENSA_CACHE_FILE;
const mealLookupFile = process.env.MEAL_LOOKUP_FILE;
const mensaXMLFile = process.env.XML_CACHE_FILE;

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
export const ortNameMensaXMLMapping = {
    "MaP Mensaküche Leitung": 106, // Mensa am Park
    "-": 118, // Mensa Academica
    "Mensaküche amElsterbecken": 115, // Mensa am Elsterbecken
    "-": 170, // Mensa An den Tierkliniken
    "PSW Mensaküche Leitung": 111, // Mensa Petersteinweg
    "-": 162, // Mensa Liebigstraße/Mensa und Cafeteria am Medizincampus
    "-": 140, // Mensa/Cafetaria Schönauer Straße
    "-": 153, // Cafeteria Dittrichring
    "-": null, // Cafeteria Koburger Straße
    "-": 127, // Cafeteria Philipp-Rosenthal-Straße/Mensaria am Botanischen Garten
};

async function findMealOpenMensa(canteenId, date, price) {
    let openMensaMeals = getOpenMensaMeals(canteenId, date);
    const mealsWithPrice = openMensaMeals.filter(meal => meal.prices && Object.values(meal.prices).includes(price));
    if (mealsWithPrice.length > 0) {
        if (mealsWithPrice.length > 1) {
            console.warn(`Multiple meals [${mealsWithPrice.map(meal => meal.category).join(', ')}] found for canteen ${canteenId} on ${date.toISOString().split('T')[0]} with price ${price}, taking the first one`);
        }
        return mealsWithPrice[0];
    } else {
        return null;
    }
}

async function findMealMensaXML(canteenId, date, price) {
    var meals = getMensaXMLMeals(canteenId, date);
    const mealsWithPrice = meals.filter(meal => meal.prices && Object.values(meal.prices).includes(price));
    if (mealsWithPrice.length > 0) {
        if (mealsWithPrice.length > 1) {
            console.warn(`Multiple meals [${mealsWithPrice.map(meal => meal.category).join(', ')}] found in Mensa XML for canteen ${canteenId} on ${date.toISOString().split('T')[0]} with price ${price}, taking the first one`);
        }
        return mealsWithPrice[0];
    } else {
        return null;
    }
}
    
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

export async function createMealLookup() {
    let transactions = getTransList();
    let transactionItems = getTransPosList();
    const mealLookup = {};
    transactionItems = transactionItems.filter(ti => ti.name.startsWith("Essen"));
    console.log('Filtered Transaction Items:', [...new Set(transactionItems.map(ti => ti.name))]);
    for (const item of transactionItems) {
        const transaction = transactions.find(t => t.transFullId === item.transFullId);
        const price = item.epreis;
        if (transaction) {
            const date = new Date(transaction.datum.toISOString().split('T')[0]);
            if (mealLookup[date.toISOString().split('T')[0]] === undefined) {
                mealLookup[date.toISOString().split('T')[0]] = {};
            }
            const ortName = transaction.ortName;
            const canteenIdOpenMensa = ortNameOpenMensaMapping[ortName];
            if (canteenIdOpenMensa) {
                if (mealLookup[date.toISOString().split('T')[0]][canteenIdOpenMensa] === undefined) {
                    mealLookup[date.toISOString().split('T')[0]][canteenIdOpenMensa] = {};
                }
                mealLookup[date.toISOString().split('T')[0]][canteenIdOpenMensa][item.name] = null; // initialize with null to indicate that we have looked for this meal
                var meal = await findMealOpenMensa(canteenIdOpenMensa, date, price);
                if (meal) {
                    mealLookup[date.toISOString().split('T')[0]][canteenIdOpenMensa][item.name] = meal;
                    // console.log(`Matched meal ${mealsWithPrice[0].category} for transaction item ${item.name} with price ${price}`);
                } else {
                    console.warn(`No meal found for canteen ${canteenIdOpenMensa} on ${date.toISOString().split('T')[0]} with price ${price}`);
                }
            }
            const canteenIdMensaXML = ortNameMensaXMLMapping[ortName];
            if (canteenIdMensaXML) {
                if (mealLookup[date.toISOString().split('T')[0]][canteenIdMensaXML] === undefined) {
                    mealLookup[date.toISOString().split('T')[0]][canteenIdMensaXML] = {};
                }
                var meal = await findMealMensaXML(canteenIdMensaXML, date, price);
                if (meal) {
                    mealLookup[date.toISOString().split('T')[0]][canteenIdMensaXML][item.name] = meal;
                    // console.log(`Matched meal ${meal.category} for transaction item ${item.name} with price ${price}`);
                } else {
                    console.warn(`No meal found in Mensa XML for canteen ${canteenIdMensaXML} on ${date.toISOString().split('T')[0]} with price ${price}`);
                }
            }
        }
    }
    fs.writeFileSync(mealLookupFile, JSON.stringify(mealLookup, null, 2));
}

function parseMensaXMLPrices(pricesElements) {
    var priceMap = {};
    for (const price of pricesElements) {
        var priceType = price.attributes.getNamedItem('consumerID').value;
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
    return priceMap;
}

/**
 * 
 * @param {Document} xmldocument 
 */
export function parseMensaXML(xmldocument) {
    var meals = [];
    for (const element of xmldocument.querySelectorAll('group')) {
        var date = new Date(element.attributes.getNamedItem('productiondate').value);
        var category = element.querySelector('name').textContent;
        var prices = parseMensaXMLPrices(element.querySelectorAll('prices price'));

        var components = [...element.querySelectorAll('components component')].map(c => c.querySelector("name1").textContent);
        var tags = [...element.querySelectorAll('taggings tagging')].filter(t => t.textContent).map(t => ({name: t.textContent, type: t.attributes.getNamedItem('type').value}));

        var type = element.attributes.getNamedItem('type').value == "1" ? "Essen" : "Komponente";
        var locationId = element.attributes.getNamedItem('location').value;
        var internalCategory = element.querySelector('internalname').textContent;

        if (type === "Essen") {
            if (components.length > 0) {
                meals.push({
                    type: type,
                    locationId: locationId,
                    date: date,
                    name: components[0],
                    category: category,
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
                    category: category,
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
            return a.locationId - b.locationId;
        } 
        if (a.date.getTime() !== b.date.getTime()) {
            return a.date.getTime() - b.date.getTime();
        }
        if (a.type !== b.type) {
            return a.type.localeCompare(b.type);
        }
        if (a.category !== b.category) {
            return a.category.localeCompare(b.category);
        }
        return 0;
    });
    return meals;
}