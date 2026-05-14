// @ts-check

import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { getAuthToken } from './api.js';
import { updateMealLookup, fetchOpenMensaMeals, fetchMensaXMLMeals, fetchTransAndTranspos } from './logic.js';
import { getCard, insertCard, updateCard, deleteCard, setupInfisicalClient, getTransList, getTransPosList, getMeals, getCardMeals } from './db.js';

/**
 * @typedef {{ date: string }} ParamsDate
 * @typedef {{ date: string, canteenId: string }} ParamsDateCanteen
 * @typedef {{ date: string, canteenId: string, mealName: string }} ParamsDateCanteenMeal
 * @typedef {{ cardNumber: string }} ParamsCardNumber
 * @typedef {{ cardNumber: string, date: string }} ParamsCardNumberDate
 * @typedef {{ cardNumber: string, password: string }} BodyCard
 * @typedef {{ cardNumber: string }} BodyCardNumber
 */

await setupInfisicalClient();

const fastify = Fastify({ logger: true });
fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

/**
 * Fastify preHandler hook that verifies Basic auth credentials against stored card secrets.
 * Sets `request.authenticatedCard` to the card number on success.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
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
    /** @type {any} */ (request).authenticatedCard = cardnumber;
}

/** Returns all meals, optionally filtered by date, canteen, and internal category. */
fastify.get('/meals', async (request, reply) => {
    return getMeals();
});

/** Returns all meals for the given date. */
fastify.get('/meals/:date', async (request, reply) => {
    const { date } = /** @type {ParamsDate} */ (request.params);
    const meals = getMeals(date);
    if (meals.length === 0) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return meals;
});

/** Returns all meals for the given date and canteen. */
fastify.get('/meals/:date/:canteenId', async (request, reply) => {
    const { date, canteenId } = /** @type {ParamsDateCanteen} */ (request.params);
    const meals = getMeals(date, Number(canteenId));
    if (meals.length === 0) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return meals;
});

/** Returns a single meal by date, canteen, and meal name. */
fastify.get('/meals/:date/:canteenId/:mealName', async (request, reply) => {
    const { date, canteenId, mealName } = /** @type {ParamsDateCanteenMeal} */ (request.params);
    const meals = getMeals(date, Number(canteenId));
    const meal = meals.find(m => m.name === mealName);
    if (!meal) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return meal;
});

/** Returns all meals matched to the transactions of the authenticated card. */
fastify.get('/meals/card/:cardNumber', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = /** @type {ParamsCardNumber} */ (request.params);
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    return getCardMeals(cardNumber);
});

/** Returns meals matched to the transactions of the authenticated card on a specific date. */
fastify.get('/meals/card/:cardNumber/:date', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber, date } = /** @type {ParamsCardNumberDate} */ (request.params);
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    return getCardMeals(cardNumber, new Date(date));
});

/** Returns all transactions for the authenticated card. */
fastify.get('/trans/:cardNumber', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = /** @type {ParamsCardNumber} */ (request.params);
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    return getTransList(cardNumber);
});

/** Returns all transaction positions for the authenticated card. */
fastify.get('/transpos/:cardNumber', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = /** @type {ParamsCardNumber} */ (request.params);
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    return getTransPosList(cardNumber);
});

/** Triggers an async fetch of meals from the OpenMensa API for the past 7 days. */
fastify.post('/fetch/open-mensa', async (request, reply) => {
    const startDate = new Date(new Date().setDate(new Date().getDate() - 7));
    fetchOpenMensaMeals(startDate)
        .then(() => updateMealLookup())
        .catch(err => fastify.log.error('Error in open mensa fetch:', err));
    reply.code(202).send({ message: 'Open Mensa fetch triggered' });
});

/** Triggers an async fetch of meals from the Mensa XML feed for the past week. */
fastify.post('/fetch/mensa-xml', async (request, reply) => {
    const startDate = new Date(new Date().setDate(new Date().getDate() - 7));
    fetchMensaXMLMeals(startDate)
        .then(() => updateMealLookup())
        .catch(err => fastify.log.error('Error in mensa XML fetch:', err));
    reply.code(202).send({ message: 'Mensa XML fetch triggered' });
});

/** Registers a new card by validating credentials against the Kartenservice API. */
fastify.post('/card', async (request, reply) => {
    const { cardNumber, password } = /** @type {BodyCard} */ (request.body) ?? {};
    if (!cardNumber || !password) {
        reply.code(400).send({ error: 'cardNumber and password are required' });
        return;
    }
    try {
        await getAuthToken(cardNumber, password);
    } catch (err) {
        reply.code(400).send({ error: `Invalid card credentials: ${/** @type {any} */ (err).message}` });
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

/** Updates the stored password for an existing card after re-validating credentials. */
fastify.put('/card', async (request, reply) => {
    const { cardNumber, password } = /** @type {BodyCard} */ (request.body) ?? {};
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
        reply.code(400).send({ error: `Invalid card credentials: ${/** @type {any} */ (err).message}` });
        return;
    }
    await updateCard(cardNumber, password);
    reply.code(200).send({ message: 'Card password updated' });
});

/** Deletes the authenticated card from storage. */
fastify.delete('/card', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = /** @type {BodyCardNumber} */ (request.body) ?? {};
    if (!cardNumber) {
        reply.code(400).send({ error: 'cardNumber is required' });
        return;
    }
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
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

/** Triggers an async fetch of transactions and transaction positions for the authenticated card. */
fastify.post('/fetch/kartenservice', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = /** @type {BodyCardNumber} */ (request.body) ?? {};
    if (!cardNumber) {
        reply.code(400).send({ error: 'cardNumber is required' });
        return;
    }
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    const card = await getCard(cardNumber);
    if (!card) {
        reply.code(404).send({ error: 'Card not found' });
        return;
    }
    fetchTransAndTranspos(card.cardnumber, card.password)
        .then(() => updateMealLookup())
        .catch(err => fastify.log.error('Error fetching kartenservice data:', err));
    reply.code(202).send({ message: 'Kartenservice fetch triggered' });
});

try {
    await fastify.listen({ port: Number(process.env.PORT) || 3000 });
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}