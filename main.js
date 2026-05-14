import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { getAuthTokenWithDays, getTransactions, getTransactionPositions, getOpenMensaCanteens, getAllOpenMensaMealsForCanteensDuration, getAllOpenMensaMealsForCanteens, getMensaXML } from './api.js';
import { updateMealLookup, parseMensaXML, fetchTransAndTranspos, fetchOpenMensaMeals, fetchMensaXMLMeals } from './logic.js';
import { insertMensaXMLMeals, insertOpenMensaMeals, insertTransList, insertTransPosList, getCards, insertCard, setupInfisicalClient, getMensaXMLIds, getMissingMensaXMLDays } from './db.js'

(async () => {
    await setupInfisicalClient();
    try {
        await insertCard(process.env.CARD_NUMBER, process.env.CARD_PASSWORD);

        var pastDate = new Date();

        const cards = await getCards();
        for (const card of cards) {
            try {
                console.log('Processing card:', card.cardnumber);
                const { trans, transpos, pastDate: userPastDate } = await fetchTransAndTranspos(card.cardnumber, card.password);
                pastDate = new Date(Math.min(pastDate.getTime(), userPastDate.getTime()));
            } catch (error) {
                console.error(`Error processing card ${card.cardnumber}:`, error);
            }
        }

        console.log('Earliest past date from all cards:', pastDate.toISOString().split('T')[0]);
        const meals = await fetchOpenMensaMeals(pastDate);
        console.log('OpenMensa Meals count:', meals.length);
        
        const mensaXMLMeals = await fetchMensaXMLMeals(pastDate);
        console.log('Mensa XML Meals count:', mensaXMLMeals.length);

        updateMealLookup();
    } catch (error) {
        console.error(error);
    }
})();