import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ quiet: true });

import { getAuthTokenWithDays, getTransactions, getTransactionPositions, getOpenMensaCanteens, getAllOpenMensaMealsForCanteensDuration, getAllOpenMensaMealsForCanteens, getMensaXML } from './api.js';
import { expandTransactions, createMealLookup, parseMensaXML, saveAndExpandMensaXML } from './logic.js';

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

        var today = new Date(new Date().setHours(0, 0, 0, 0));
        for (var d = new Date(2026, 3, 30); d <= today; d.setDate(d.getDate() + 1)) {
            var date = new Date(d);
            var dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const mealsXML = parseMensaXML(await getMensaXML(106, new Date(d)));
            if (mealsXML === null) {
                continue;
            }
            saveAndExpandMensaXML(mealsXML);
            console.log(`Processed ${mealsXML.length} meals for date:`, dateStr);
        }
    } catch (error) {
        console.error('Error fetching auth token:', error);
    }
})();