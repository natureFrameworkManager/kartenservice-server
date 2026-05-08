import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import fs from 'fs';

import { getAuthToken, getAuthTokenWithDays, getTransactions, getTransactionPositions, getOpenMensaCanteens, getAllOpenMensaMealsForCanteens, getMensaXML } from './api.js';
import { createMealLookup, parseMensaXML } from './logic.js';
import { insertMensaXMLMeals, insertTransList, insertTransPosList, getCard, insertCard, updateCard, deleteCard, setupInfisicalClient, getTransList, getTransPosList, getAllMensaXMLMeals, getAllOpenMensaMeals } from './db.js';

await setupInfisicalClient();

const fastify = Fastify({ logger: true });
fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

function readMealLookup() {
    try {
        return JSON.parse(fs.readFileSync(process.env.MEAL_LOOKUP_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

async function authenticate(request, reply) {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        reply.code(401).header('WWW-Authenticate', 'Basic realm="kartenservice"').send({ error: 'Authentication required' });
        return;
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
        reply.code(401).send({ error: 'Invalid credentials format' });
        return;
    }
    const cardnumber = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);
    const card = await getCard(cardnumber);
    if (!card || card.password !== password) {
        reply.code(401).send({ error: 'Invalid credentials' });
        return;
    }
    request.authenticatedCard = cardnumber;
}

// GET /meals - no logic, placeholder
fastify.get('/meals', async (request, reply) => {
    return 'meals';
});

// GET /meals/mensa-xml
fastify.get('/meals/mensa-xml', async (request, reply) => {
    return getAllMensaXMLMeals();
});

// GET /meals/open-mensa
fastify.get('/meals/open-mensa', async (request, reply) => {
    return getAllOpenMensaMeals();
});

// GET /meal-lookups
fastify.get('/meal-lookups', async (request, reply) => {
    return readMealLookup();
});

// GET /meal-lookups/card/:cardNumber - auth required
// Must be registered before /meal-lookups/:date so Fastify's router prefers the static "card" segment
fastify.get('/meal-lookups/card/:cardNumber', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = request.params;
    if (request.authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    const allLookups = readMealLookup();
    const transactions = getTransList(cardNumber);
    const result = {};
    for (const trans of transactions) {
        const dateStr = trans.datum.toISOString().split('T')[0];
        if (allLookups[dateStr]) {
            result[dateStr] = allLookups[dateStr];
        }
    }
    return result;
});

// GET /meal-lookups/card/:cardNumber/:date - auth required
fastify.get('/meal-lookups/card/:cardNumber/:date', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber, date } = request.params;
    if (request.authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    const allLookups = readMealLookup();
    if (!allLookups[date]) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return allLookups[date];
});

// GET /meal-lookups/:date
fastify.get('/meal-lookups/:date', async (request, reply) => {
    const { date } = request.params;
    const allLookups = readMealLookup();
    if (!allLookups[date]) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return allLookups[date];
});

// GET /meal-lookups/:date/:canteenId
fastify.get('/meal-lookups/:date/:canteenId', async (request, reply) => {
    const { date, canteenId } = request.params;
    const allLookups = readMealLookup();
    if (!allLookups[date] || !allLookups[date][canteenId]) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return allLookups[date][canteenId];
});

// GET /meal-lookups/:date/:canteenId/:mealName
fastify.get('/meal-lookups/:date/:canteenId/:mealName', async (request, reply) => {
    const { date, canteenId, mealName } = request.params;
    const allLookups = readMealLookup();
    if (!allLookups[date] || !allLookups[date][canteenId] || !(mealName in allLookups[date][canteenId])) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return allLookups[date][canteenId][mealName];
});

// GET /trans/:cardNumber - auth required
fastify.get('/trans/:cardNumber', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = request.params;
    if (request.authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    return getTransList(cardNumber);
});

// GET /transpos/:cardNumber - auth required
fastify.get('/transpos/:cardNumber', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = request.params;
    if (request.authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    return getTransPosList(cardNumber);
});

// POST /fetch/open-mensa - trigger open mensa meal fetch
fastify.post('/fetch/open-mensa', async (request, reply) => {
    const startDate = new Date(new Date().setDate(new Date().getDate() - 7));
    getOpenMensaCanteens()
        .then(canteens => getAllOpenMensaMealsForCanteens(canteens.map(c => c.id), startDate))
        .then(() => createMealLookup())
        .catch(err => fastify.log.error('Error in open mensa fetch:', err));
    reply.code(202).send({ message: 'Open Mensa fetch triggered' });
});

// POST /fetch/mensa-xml - trigger mensa xml meal fetch
fastify.post('/fetch/mensa-xml', async (request, reply) => {
    (async () => {
        const lastWeekMonday = new Date();
        lastWeekMonday.setDate(lastWeekMonday.getDate() - lastWeekMonday.getDay() - 6);
        const today = new Date(new Date().setHours(0, 0, 0, 0));
        for (let d = new Date(lastWeekMonday); d <= today; d.setDate(d.getDate() + 1)) {
            const date = new Date(d);
            try {
                const xmlDoc = await getMensaXML(106, date);
                if (xmlDoc === null) continue;
                const mealsXML = parseMensaXML(xmlDoc);
                if (mealsXML === null) continue;
                insertMensaXMLMeals(mealsXML);
            } catch (err) {
                fastify.log.error(`Error fetching mensa XML for date ${date.toISOString().split('T')[0]}:`, err);
            }
        }
        await createMealLookup();
    })().catch(err => fastify.log.error('Error in mensa XML fetch:', err));
    reply.code(202).send({ message: 'Mensa XML fetch triggered' });
});

// POST /card - add a card (validate credentials against kartenservice before adding)
fastify.post('/card', async (request, reply) => {
    const { cardNumber, password } = request.body ?? {};
    if (!cardNumber || !password) {
        reply.code(400).send({ error: 'cardNumber and password are required' });
        return;
    }
    try {
        await getAuthToken(cardNumber, password);
    } catch (err) {
        reply.code(400).send({ error: `Invalid card credentials: ${err.message}` });
        return;
    }
    const existing = await getCard(cardNumber);
    if (existing) {
        reply.code(409).send({ error: 'Card already exists' });
        return;
    }
    await insertCard(cardNumber, password);
    reply.code(201).send({ message: 'Card added' });
});

// PUT /card - update a card password (validate new credentials against kartenservice)
fastify.put('/card', async (request, reply) => {
    const { cardNumber, password } = request.body ?? {};
    if (!cardNumber || !password) {
        reply.code(400).send({ error: 'cardNumber and password are required' });
        return;
    }
    const existing = await getCard(cardNumber);
    if (!existing) {
        reply.code(404).send({ error: 'Card not found' });
        return;
    }
    try {
        await getAuthToken(cardNumber, password);
    } catch (err) {
        reply.code(400).send({ error: `Invalid card credentials: ${err.message}` });
        return;
    }
    await updateCard(cardNumber, password);
    reply.code(200).send({ message: 'Card password updated' });
});

// DELETE /card - auth required
fastify.delete('/card', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = request.body ?? {};
    if (!cardNumber) {
        reply.code(400).send({ error: 'cardNumber is required' });
        return;
    }
    if (request.authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    const existing = await getCard(cardNumber);
    if (!existing) {
        reply.code(404).send({ error: 'Card not found' });
        return;
    }
    await deleteCard(cardNumber);
    reply.code(200).send({ message: 'Card deleted' });
});

// POST /fetch/kartenservice - auth required, fetch transactions for a card
fastify.post('/fetch/kartenservice', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = request.body ?? {};
    if (!cardNumber) {
        reply.code(400).send({ error: 'cardNumber is required' });
        return;
    }
    if (request.authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    const card = await getCard(cardNumber);
    (async () => {
        const { authToken, days } = await getAuthTokenWithDays(card.cardnumber, card.password);
        const today = new Date(new Date().setHours(0, 0, 0, 0));
        const pastDate = new Date(today.getTime() - (days * 24 * 60 * 60 * 1000));
        const transactions = await getTransactions(cardNumber, pastDate, today, authToken);
        insertTransList(transactions, cardNumber);
        const transactionPositions = await getTransactionPositions(cardNumber, pastDate, today, authToken);
        insertTransPosList(transactionPositions, cardNumber);
        await createMealLookup();
    })().catch(err => fastify.log.error('Error fetching kartenservice data:', err));
    reply.code(202).send({ message: 'Kartenservice fetch triggered' });
});

try {
    await fastify.listen({ port: process.env.PORT || 3000 });
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}