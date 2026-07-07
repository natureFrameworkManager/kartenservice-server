// @ts-check

import { timingSafeEqual } from 'crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifySSE from '@fastify/sse';
import fastifyStatic from '@fastify/static';
import fastifyETag from '@fastify/etag';
import fastifyCompress from '@fastify/compress';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { getAuthToken } from './api.js';
import { updateMealLookup, fetchOpenMensaMeals, fetchMensaXMLMeals, fetchTransAndTranspos } from './logic.js';
import { getCard, insertCard, updateCard, deleteCard, setupInfisicalClient, getTransList, getTransPosList, getMeals, getCardMeals, getMensaLocations, insertMensaLocation, updateMensaLocation, updateInternalCategory, upsertLocationFromRemote, insertMealsFromRemote, insertTransListFromRemote, insertTransPosList } from './db.js';

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
await fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
await fastify.register(fastifySSE);
await fastify.register(fastifyETag, {
    weak: false,
    algorithm: 'sha256',
    replyWith304: true
});
await fastify.register(
    fastifyCompress, { 
        global: true 
    }
)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'docs'),
    prefix: '/docs',
    index: 'index.html'
});
await fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'ui'),
    prefix: '/ui',
    index: 'index.html',
    decorateReply: false
});

/**
 * Fastify preHandler hook that verifies Basic auth credentials against stored card secrets.
 * Sets `request.authenticatedCard` to the card number on success.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
async function authenticate(request, reply) {
    // EventSource cannot send custom headers; accept Base64 credentials via ?token= as fallback
    const tokenParam = /** @type {any} */ (request.query).token;
    const authHeader = request.headers['authorization'] ?? (tokenParam ? `Basic ${tokenParam}` : undefined);
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
    const passwordsMatch = card && timingSafeEqual(
        Buffer.from(card.password),
        Buffer.from(password)
    );
    if (!card || !passwordsMatch) {
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
    const meals = getMeals(date, Number(canteenId), mealName);
    if (meals.length === 0) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return meals;
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
        await updateCard(cardNumber, password);
        reply.code(200).send({ message: 'Card already exists; password updated', warning: 'Card was already registered' });
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

/** Returns all mensa locations. */
fastify.get('/locations', async (request, reply) => {
    return getMensaLocations();
});

/** Adds a new mensa location. At least one of openMensaId or mensaXMLId must be provided. */
fastify.post('/locations', async (request, reply) => {
    const { name, internalName, openMensaId, mensaXMLId } = /** @type {any} */ (request.body) ?? {};
    if (!name) {
        reply.code(400).send({ error: 'name is required' });
        return;
    }
    if (openMensaId == null && mensaXMLId == null) {
        reply.code(400).send({ error: 'At least one of openMensaId or mensaXMLId is required' });
        return;
    }
    try {
        const location = insertMensaLocation(name, internalName ?? null, openMensaId ?? null, mensaXMLId ?? null);
        reply.code(201).send(location);
    } catch (/** @type {any} */ err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            reply.code(409).send({ error: 'A location with that openMensaId or mensaXMLId already exists' });
        } else {
            throw err;
        }
    }
});

/** Updates all fields of an existing mensa location. */
fastify.put('/locations/:id', async (request, reply) => {
    const { id } = /** @type {{id: string}} */ (request.params);
    const { name, internalName, openMensaId, mensaXMLId } = /** @type {any} */ (request.body) ?? {};
    if (!name) {
        reply.code(400).send({ error: 'name is required' });
        return;
    }
    if (openMensaId == null && mensaXMLId == null) {
        reply.code(400).send({ error: 'At least one of openMensaId or mensaXMLId is required' });
        return;
    }
    try {
        const updated = updateMensaLocation(Number(id), name, internalName ?? null, openMensaId ?? null, mensaXMLId ?? null);
        if (!updated) {
            reply.code(404).send({ error: 'Location not found' });
            return;
        }
        reply.code(200).send({ message: 'Location updated' });
    } catch (/** @type {any} */ err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            reply.code(409).send({ error: 'A location with that openMensaId or mensaXMLId already exists' });
        } else {
            throw err;
        }
    }
});

/** Updates the internalCategory of a single meal. */
fastify.patch('/meals/:id', async (request, reply) => {
    const { id } = /** @type {{id: string}} */ (request.params);
    const { internalCategory } = /** @type {any} */ (request.body) ?? {};
    if (internalCategory === undefined) {
        reply.code(400).send({ error: 'internalCategory is required' });
        return;
    }
    updateInternalCategory(Number(id), internalCategory);
    reply.code(200).send({ message: 'Meal updated' });
});

/** Fetches meals and locations from a remote server running the same API and stores them locally. */
fastify.post('/sync/host/meals', async (request, reply) => {
    const { hostUrl } = /** @type {any} */ (request.body) ?? {};
    if (!hostUrl) {
        reply.code(400).send({ error: 'hostUrl is required' });
        return;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(hostUrl);
    } catch {
        reply.code(400).send({ error: 'Invalid hostUrl' });
        return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        reply.code(400).send({ error: 'hostUrl must use http or https' });
        return;
    }
    const baseUrl = parsedUrl.origin;
    (async () => {
        const [locationsRes, mealsRes] = await Promise.all([
            fetch(`${baseUrl}/locations`),
            fetch(`${baseUrl}/meals`)
        ]);
        if (!locationsRes.ok) throw new Error(`Failed to fetch locations from remote: ${locationsRes.status}`);
        if (!mealsRes.ok) throw new Error(`Failed to fetch meals from remote: ${mealsRes.status}`);
        const remoteLocations = await locationsRes.json();
        const remoteMeals = await mealsRes.json();
        for (const loc of remoteLocations) {
            upsertLocationFromRemote(loc.name, loc.internalName ?? null, loc.openMensaId ?? null, loc.mensaXMLId ?? null);
        }
        insertMealsFromRemote(remoteMeals);
        updateMealLookup();
    })().catch(err => fastify.log.error('Error in host meals sync:', err));
    reply.code(202).send({ message: 'Host meals sync triggered' });
});

/** Fetches transactions for the authenticated card from a remote server and stores them locally. */
fastify.post('/sync/host/transactions', { preHandler: authenticate }, async (request, reply) => {
    const { hostUrl, cardNumber } = /** @type {any} */ (request.body) ?? {};
    if (!hostUrl || !cardNumber) {
        reply.code(400).send({ error: 'hostUrl and cardNumber are required' });
        return;
    }
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(hostUrl);
    } catch {
        reply.code(400).send({ error: 'Invalid hostUrl' });
        return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        reply.code(400).send({ error: 'hostUrl must use http or https' });
        return;
    }
    const card = await getCard(cardNumber);
    if (!card) {
        reply.code(404).send({ error: 'Card not found' });
        return;
    }
    const baseUrl = parsedUrl.origin;
    const authHeader = `Basic ${Buffer.from(`${card.cardnumber}:${card.password}`).toString('base64')}`;
    (async () => {
        const [transRes, transposRes] = await Promise.all([
            fetch(`${baseUrl}/trans/${cardNumber}`, { headers: { 'Authorization': authHeader } }),
            fetch(`${baseUrl}/transpos/${cardNumber}`, { headers: { 'Authorization': authHeader } })
        ]);
        if (!transRes.ok) throw new Error(`Failed to fetch transactions from remote: ${transRes.status}`);
        if (!transposRes.ok) throw new Error(`Failed to fetch transaction positions from remote: ${transposRes.status}`);
        const remoteTrans = await transRes.json();
        const remoteTranspos = await transposRes.json();
        insertTransListFromRemote(remoteTrans, cardNumber);
        insertTransPosList(remoteTranspos, cardNumber);
        updateMealLookup();
    })().catch(err => fastify.log.error('Error in host transactions sync:', err));
    reply.code(202).send({ message: 'Host transactions sync triggered' });
});

/** Streams SSE progress events while fetching meals from the OpenMensa API. */
fastify.get('/fetch/open-mensa/sse', { sse: true }, async function(request, reply) {
    if (!reply.sse) {
        reply.code(406).send({ error: 'This endpoint requires Accept: text/event-stream' });
        return;
    }
    const safeSend = (/** @type {any} */ event) => reply.sse.isConnected ? reply.sse.send(event).catch(() => {}) : Promise.resolve();
    const startDate = new Date(new Date().setDate(new Date().getDate() - 7));
    try {
        await safeSend({ event: 'progress', data: { step: 'start', message: 'Starting OpenMensa fetch...' } });
        const meals = await fetchOpenMensaMeals(startDate, (data) => safeSend({ event: 'progress', data }));
        await safeSend({ event: 'progress', data: { step: 'meal_lookup', message: 'Updating meal lookup...' } });
        updateMealLookup();
        await safeSend({ event: 'done', data: { message: 'OpenMensa sync completed', count: meals.length } });
    } catch (err) {
        fastify.log.error(err, 'Error in open mensa SSE fetch');
        await safeSend({ event: 'error', data: { message: /** @type {any} */ (err).message } });
    }
});

/** Streams SSE progress events while fetching meals from the Mensa XML feed. */
fastify.get('/fetch/mensa-xml/sse', { sse: true }, async function(request, reply) {
    if (!reply.sse) {
        reply.code(406).send({ error: 'This endpoint requires Accept: text/event-stream' });
        return;
    }
    const safeSend = (/** @type {any} */ event) => reply.sse.isConnected ? reply.sse.send(event).catch(() => {}) : Promise.resolve();
    const startDate = new Date(new Date().setDate(new Date().getDate() - 7));
    try {
        await safeSend({ event: 'progress', data: { step: 'start', message: 'Starting Mensa XML fetch...' } });
        const meals = await fetchMensaXMLMeals(startDate, (data) => safeSend({ event: 'progress', data }));
        await safeSend({ event: 'progress', data: { step: 'meal_lookup', message: 'Updating meal lookup...' } });
        updateMealLookup();
        await safeSend({ event: 'done', data: { message: 'Mensa XML sync completed', count: meals.length } });
    } catch (err) {
        fastify.log.error(err, 'Error in mensa XML SSE fetch');
        await safeSend({ event: 'error', data: { message: /** @type {any} */ (err).message } });
    }
});

/** Streams SSE progress events while fetching transactions for the authenticated card from the Kartenservice API. */
fastify.get('/fetch/kartenservice/sse', { sse: true, preHandler: authenticate }, async function(request, reply) {
    const { cardNumber } = /** @type {any} */ (request.query);
    if (!cardNumber) {
        reply.code(400).send({ error: 'cardNumber query parameter is required' });
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
    if (!reply.sse) {
        reply.code(406).send({ error: 'This endpoint requires Accept: text/event-stream' });
        return;
    }
    const safeSend = (/** @type {any} */ event) => reply.sse.isConnected ? reply.sse.send(event).catch(() => {}) : Promise.resolve();
    try {
        const { trans, transpos } = await fetchTransAndTranspos(card.cardnumber, card.password, (data) => safeSend({ event: 'progress', data }));
        await safeSend({ event: 'progress', data: { step: 'meal_lookup', message: 'Updating meal lookup...' } });
        updateMealLookup();
        await safeSend({ event: 'done', data: { message: 'Kartenservice sync completed', count: trans.length + transpos.length } });
    } catch (err) {
        fastify.log.error(err, 'Error in kartenservice SSE fetch');
        await safeSend({ event: 'error', data: { message: /** @type {any} */ (err).message } });
    }
});

/** Streams SSE progress events while fetching meals and locations from a remote server. */
fastify.get('/sync/host/meals/sse', { sse: true }, async function(request, reply) {
    const { hostUrl } = /** @type {any} */ (request.query);
    if (!hostUrl) {
        reply.code(400).send({ error: 'hostUrl query parameter is required' });
        return;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(hostUrl);
    } catch {
        reply.code(400).send({ error: 'Invalid hostUrl' });
        return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        reply.code(400).send({ error: 'hostUrl must use http or https' });
        return;
    }
    const baseUrl = parsedUrl.origin;
    const safeSend = (/** @type {any} */ event) => reply.sse.isConnected ? reply.sse.send(event).catch(() => {}) : Promise.resolve();
    try {
        await safeSend({ event: 'progress', data: { step: 'fetch_locations', message: 'Fetching locations from remote server...' } });
        const locationsRes = await fetch(`${baseUrl}/locations`);
        if (!locationsRes.ok) throw new Error(`Failed to fetch locations from remote: ${locationsRes.status}`);
        const remoteLocations = await locationsRes.json();
        await safeSend({ event: 'progress', data: { step: 'insert_locations', message: `Inserting ${remoteLocations.length} locations...`, count: remoteLocations.length } });
        for (const loc of remoteLocations) {
            upsertLocationFromRemote(loc.name, loc.internalName ?? null, loc.openMensaId ?? null, loc.mensaXMLId ?? null);
        }
        await safeSend({ event: 'progress', data: { step: 'fetch_meals', message: 'Fetching meals from remote server...' } });
        const mealsRes = await fetch(`${baseUrl}/meals`);
        if (!mealsRes.ok) throw new Error(`Failed to fetch meals from remote: ${mealsRes.status}`);
        const remoteMeals = await mealsRes.json();
        await safeSend({ event: 'progress', data: { step: 'insert_meals', message: `Inserting ${remoteMeals.length} meals...`, count: remoteMeals.length } });
        insertMealsFromRemote(remoteMeals);
        await safeSend({ event: 'progress', data: { step: 'meal_lookup', message: 'Updating meal lookup...' } });
        updateMealLookup();
        await safeSend({ event: 'done', data: { message: 'Host meals sync completed', inserted: { locations: remoteLocations.length, meals: remoteMeals.length } } });
    } catch (err) {
        fastify.log.error(err, 'Error in host meals SSE sync');
        await safeSend({ event: 'error', data: { message: /** @type {any} */ (err).message } });
    }
});

/** Streams SSE progress events while fetching card transactions from a remote server. */
fastify.get('/sync/host/transactions/sse', { sse: true, preHandler: authenticate }, async function(request, reply) {
    const { hostUrl, cardNumber } = /** @type {any} */ (request.query);
    if (!hostUrl || !cardNumber) {
        reply.code(400).send({ error: 'hostUrl and cardNumber query parameters are required' });
        return;
    }
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(hostUrl);
    } catch {
        reply.code(400).send({ error: 'Invalid hostUrl' });
        return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        reply.code(400).send({ error: 'hostUrl must use http or https' });
        return;
    }
    const card = await getCard(cardNumber);
    if (!card) {
        reply.code(404).send({ error: 'Card not found' });
        return;
    }
    const baseUrl = parsedUrl.origin;
    const authHeader = `Basic ${Buffer.from(`${card.cardnumber}:${card.password}`).toString('base64')}`;
    const safeSend = (/** @type {any} */ event) => reply.sse.isConnected ? reply.sse.send(event).catch(() => {}) : Promise.resolve();
    try {
        await safeSend({ event: 'progress', data: { step: 'fetch_transactions', message: 'Fetching transactions from remote server...' } });
        const [transRes, transposRes] = await Promise.all([
            fetch(`${baseUrl}/trans/${cardNumber}`, { headers: { 'Authorization': authHeader } }),
            fetch(`${baseUrl}/transpos/${cardNumber}`, { headers: { 'Authorization': authHeader } })
        ]);
        if (!transRes.ok) throw new Error(`Failed to fetch transactions from remote: ${transRes.status}`);
        if (!transposRes.ok) throw new Error(`Failed to fetch transaction positions from remote: ${transposRes.status}`);
        const remoteTrans = await transRes.json();
        const remoteTranspos = await transposRes.json();
        await safeSend({ event: 'progress', data: { step: 'insert', message: `Inserting ${remoteTrans.length} transactions and ${remoteTranspos.length} positions...`, count: remoteTrans.length + remoteTranspos.length } });
        insertTransListFromRemote(remoteTrans, cardNumber);
        insertTransPosList(remoteTranspos, cardNumber);
        await safeSend({ event: 'progress', data: { step: 'meal_lookup', message: 'Updating meal lookup...' } });
        updateMealLookup();
        await safeSend({ event: 'done', data: { message: 'Host transactions sync completed', inserted: { transactions: remoteTrans.length, transactionPositions: remoteTranspos.length } } });
    } catch (err) {
        fastify.log.error(err, 'Error in host transactions SSE sync');
        await safeSend({ event: 'error', data: { message: /** @type {any} */ (err).message } });
    }
});

try {
    await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}