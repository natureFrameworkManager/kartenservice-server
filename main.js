import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ quiet: true });

import { getAuthTokenWithDays, getTransactions, getTransactionPositions, getOpenMensaCanteens, getAllOpenMensaMealsForCanteensDuration, getAllOpenMensaMealsForCanteens } from './api.js';
import { expandTransactions, createMealLookup } from './logic.js';

(async () => {
    try {
        const cardnumber = process.env.CARD_NUMBER;
        const password = process.env.CARD_PASSWORD;
        const { authToken, days } = await getAuthTokenWithDays(cardnumber, password);
        console.log('Auth Token:', authToken);
        console.log('Days:', days);
        var today = new Date();
        var pastDate = new Date(today.getTime() - (days * 24 * 60 * 60 * 1000));
        const transactions = await getTransactions(cardnumber, pastDate, today, authToken);
        console.log('Transactions:', transactions[0]);
        const transactionPositions = await getTransactionPositions(cardnumber, pastDate, today, authToken);
        console.log('Transaction Positions:', transactionPositions[0]);
        await expandTransactions(transactions, transactionPositions);
        const canteens = await getOpenMensaCanteens();
        console.log('Canteens:', canteens);
        console.log('Fetching meals for canteens may take up to', await getAllOpenMensaMealsForCanteensDuration(canteens.map(c => c.id), pastDate) / 1000, 'seconds');
        const meals = await getAllOpenMensaMealsForCanteens(canteens.map(c => c.id), pastDate);
        console.log('Meals:', meals[0]);
        console.log('Meals count:', meals.length);
        
        createMealLookup();
    } catch (error) {
        console.error('Error fetching auth token:', error);
    }
})();