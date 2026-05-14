import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { getAuthTokenWithDays, getTransactions, getTransactionPositions, getOpenMensaCanteens, getAllOpenMensaMealsForCanteensDuration, getAllOpenMensaMealsForCanteens, getMensaXML } from './api.js';
import { createMealLookup, updateMealLookup, parseMensaXML } from './logic.js';
import { insertMensaXMLMeals, insertOpenMensaMeals, insertTransList, insertTransPosList, getCards, insertCard, setupInfisicalClient } from './db.js'

(async () => {
    await setupInfisicalClient();
    try {
        await insertCard(process.env.CARD_NUMBER, process.env.CARD_PASSWORD);
        var pastDate = new Date();
        const cards = await getCards();
        for (const card of cards) {
            try {
                console.log('Processing card:', card.cardnumber);
                const { authToken, days } = await getAuthTokenWithDays(card.cardnumber, card.password);
                console.log('Auth Token:', authToken);
                console.log('Days:', days);
                var today = new Date(new Date().setHours(0, 0, 0, 0));
                var userPastDate = new Date(today.getTime() - (days * 24 * 60 * 60 * 1000));
                pastDate = new Date(Math.min(pastDate.getTime(), userPastDate.getTime()));
                const transactions = await getTransactions(card.cardnumber, userPastDate, today, authToken);
                insertTransList(transactions, card.cardnumber);
                console.log('Transactions:', transactions[0]);
                const transactionPositions = await getTransactionPositions(card.cardnumber, userPastDate, today, authToken);
                insertTransPosList(transactionPositions, card.cardnumber);
                console.log('Transaction Positions:', transactionPositions[0]);
            } catch (error) {
                console.error(`Error processing card ${card.cardnumber}:`, error);
            }
        }
        console.log('Earliest past date from all cards:', pastDate);
        const canteens = await getOpenMensaCanteens();
        // console.log('Canteens:', canteens);
        console.log('Fetching meals for canteens may take up to', await getAllOpenMensaMealsForCanteensDuration(canteens.map(c => c.id), pastDate) / 1000, 'seconds');
        const meals = await getAllOpenMensaMealsForCanteens(canteens.map(c => c.id), pastDate);
        console.log('Meals:', meals[0]);
        console.log('Meals count:', meals.length);

        // get date of monday of last week
        var lastWeekMonday = new Date();
        lastWeekMonday.setDate(lastWeekMonday.getDate() - lastWeekMonday.getDay() - 6);
        console.log('Last week monday:', lastWeekMonday);

        var today = new Date(new Date().setHours(0, 0, 0, 0));
        for (var d = lastWeekMonday; d <= today; d.setDate(d.getDate() + 1)) {
            var date = new Date(d);
            var dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const mealsXML = parseMensaXML(await getMensaXML(106, new Date(d)));
            if (mealsXML === null) {
                continue;
            }
            insertMensaXMLMeals(mealsXML);
            console.log(`Processed ${mealsXML.length} meals for date:`, dateStr);
        }
        
        /* await createMealLookup(); */
        updateMealLookup();
    } catch (error) {
        console.error(error);
    }
})();