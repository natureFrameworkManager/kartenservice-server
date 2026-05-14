import dotenv from 'dotenv';
import fs from 'fs';
import { getMealsByPrice, getMensaLocationByInternalName, getMensaXMLMeals, getOpenMensaMeals, getTransList, getTransPosList, updateInternalCategory } from './db.js';
dotenv.config({ quiet: true });

const transactionFile = process.env.TRANSACTION_FILE;
const transactionItemsFile = process.env.TRANSACTION_POSITIONS_FILE;
const openMensaCacheFile = process.env.OPENMENSA_CACHE_FILE;
const mealLookupFile = process.env.MEAL_LOOKUP_FILE;
const mensaXMLFile = process.env.XML_CACHE_FILE;
    
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