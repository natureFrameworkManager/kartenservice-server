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
import { updateMealLookup, fetchOpenMensaMeals, fetchMensaXMLMeals, fetchTransAndTranspos, computeCardStats } from './logic.js';
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
    index: 'index.html',
    setHeaders: (res, filePath, stat) => {
        // Last-Modified is set automatically by @fastify/send via stat.mtime
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
        res.setHeader('CDN-Cache-Control', 'public, max-age=604800');
        res.setHeader('Surrogate-Control', 'public, max-age=604800');
    }
});
await fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'ui'),
    prefix: '/ui',
    index: 'index.html',
    decorateReply: false,
    setHeaders: (res, filePath, stat) => {
        // Last-Modified is set automatically by @fastify/send via stat.mtime
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
        res.setHeader('CDN-Cache-Control', 'public, max-age=604800');
        res.setHeader('Surrogate-Control', 'public, max-age=604800');
    }
});
await fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'stats'),
    prefix: '/stats',
    index: 'index.html',
    decorateReply: false,
    setHeaders: (res, filePath, stat) => {
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
        res.setHeader('CDN-Cache-Control', 'public, max-age=604800');
        res.setHeader('Surrogate-Control', 'public, max-age=604800');
    }
});

/**
 * Returns today's date as a YYYY-MM-DD string.
 * @returns {string}
 */
function todayDateString() {
    return toDateString(new Date());
}

/**
 * Global onSend hook that sets caching headers based on the endpoint group.
 * Works in concert with the CDN (Cloudflare) and API gateway (APISIX).
 */
fastify.addHook('onSend', async (request, reply, payload) => {
    const url = request.url;
    const method = request.method;

    // Never cache mutating requests or error responses
    if (method !== 'GET' || reply.statusCode >= 400) {
        reply.header('Cache-Control', 'no-store');
        return payload;
    }

    // SSE streams must not be cached
    if (url.includes('/sse')) {
        reply.header('Cache-Control', 'no-store');
        reply.header('X-Accel-Buffering', 'no');
        return payload;
    }

    // Static files under /docs, /ui and /stats are handled by fastifyStatic setHeaders
    if (url.startsWith('/docs') || url.startsWith('/ui') || url.startsWith('/stats')) {
        return payload;
    }

    // /locations — rarely changes, cache aggressively
    if (url.startsWith('/locations')) {
        reply.header('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
        reply.header('CDN-Cache-Control', 'public, max-age=86400');
        reply.header('Surrogate-Control', 'public, max-age=86400');
        reply.header('Vary', 'Accept-Encoding');
        return payload;
    }

    // /meals — changes daily around midday; past dates rarely change
    if (url.startsWith('/meals')) {
        const today = todayDateString();

        /**
         * Heuristic: determine if this request targets only past dates.
         * Checks URL path date, query date, date-offset, date-start/date-end, week-date.
         * Returns 'past' if all dates are before today, 'today' if only today, 'mixed' otherwise.
         * @returns {'past' | 'today' | 'mixed'}
         */
        function mealDateScope() {
            // 1. Date in URL path: /meals/2025-01-15/...
            const pathMatch = url.match(/^\/meals\/(\d{4}-\d{2}-\d{2})/);
            if (pathMatch) {
                return pathMatch[1] < today ? 'past' : (pathMatch[1] === today ? 'today' : 'mixed');
            }

            const q = /** @type {any} */ (request.query);

            // 2. Explicit ?date= query params
            const dates = asArray(q.date).filter(Boolean);
            if (dates.length > 0) {
                const allPast = dates.every(d => d < today);
                const anyToday = dates.some(d => d === today);
                if (allPast && !anyToday) return 'past';
                if (dates.every(d => d === today)) return 'today';
                return 'mixed';
            }

            // 3. ?today flag
            if (q.today !== undefined) return 'today';

            // 4. ?date-offset=N
            if (q['date-offset'] !== undefined) {
                const offset = Number(q['date-offset']);
                const target = new Date();
                target.setUTCDate(target.getUTCDate() + offset);
                const targetStr = toDateString(target);
                return targetStr < today ? 'past' : (targetStr === today ? 'today' : 'mixed');
            }

            // 5. ?date-start and ?date-end range
            const dateStart = q['date-start'];
            const dateEnd = q['date-end'];
            if (dateStart || dateEnd) {
                if (dateEnd && dateEnd < today) return 'past';
                if (dateStart && dateStart < today && (!dateEnd || dateEnd === dateStart)) return 'past';
                if (dateStart && dateStart > today) return 'mixed';
                return 'mixed';
            }

            // 6. ?week with optional ?week-date
            if (q.week !== undefined || q['week-next'] !== undefined) {
                const base = new Date(q['week-date'] ?? Date.now());
                if (q['week-next'] !== undefined) base.setUTCDate(base.getUTCDate() + 7);
                const range = weekRange(toDateString(base));
                if (range.end < today) return 'past';
                if (range.start <= today && range.end >= today) return 'mixed';
                return 'mixed';
            }

            // No narrowing hints — default conservative
            return 'mixed';
        }

        const scope = mealDateScope();
        if (scope === 'past') {
            reply.header('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
            reply.header('CDN-Cache-Control', 'public, max-age=604800');
            reply.header('Surrogate-Control', 'public, max-age=604800');
        } else if (scope === 'today') {
            reply.header('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
            reply.header('CDN-Cache-Control', 'public, max-age=1800');
            reply.header('Surrogate-Control', 'public, max-age=1800');
        } else {
            // Mixed or uncertain — conservative short cache
            reply.header('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
            reply.header('CDN-Cache-Control', 'public, max-age=1800');
            reply.header('Surrogate-Control', 'public, max-age=1800');
        }
        reply.header('Vary', 'Accept-Encoding');
        return payload;
    }

    // /trans and /transpos — user-specific, changes throughout the day
    if (url.startsWith('/trans')) {
        reply.header('Cache-Control', 'private, max-age=60, s-maxage=0');
        reply.header('CDN-Cache-Control', 'private, no-cache');
        reply.header('Surrogate-Control', 'private, no-cache');
        reply.header('Vary', 'Authorization, Accept-Encoding');
        return payload;
    }

    // /card/:cardNumber/stats — changes in relation to transactions
    if (url.includes('/stats')) {
        reply.header('Cache-Control', 'private, max-age=120, s-maxage=0');
        reply.header('CDN-Cache-Control', 'private, no-cache');
        reply.header('Surrogate-Control', 'private, no-cache');
        reply.header('Vary', 'Authorization, Accept-Encoding');
        return payload;
    }

    // Default for any other GET endpoint
    reply.header('Cache-Control', 'public, max-age=300, s-maxage=3600');
    reply.header('Vary', 'Accept-Encoding');
    return payload;
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

/**
 * @param {any} value
 * @returns {any[]}
 */
function asArray(value) {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
    return date.toISOString().split('T')[0];
}

/**
 * @param {string} date
 * @returns {{start: string, end: string}}
 */
function weekRange(date) {
    const day = new Date(date);
    const diff = day.getUTCDay() === 0 ? -6 : 1 - day.getUTCDay();
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + diff));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6));
    return { start: toDateString(start), end: toDateString(end) };
}

/**
 * @param {any} value
 * @returns {boolean|null}
 */
function boolParam(value) {
    if (value === undefined) return null;
    if (value === false || value === 'false' || value === '0') return false;
    return true;
}

/**
 * @param {any} query
 * @param {{includeDate?: boolean, includeCanteenId?: boolean}} options
 */
function mealFilters(query, options = {}) {
    const filters = {
        ids: asArray(query.id).map(Number).filter(Number.isFinite),
        date: options.includeDate === false ? [] : asArray(query.date).filter(Boolean),
        dateStart: options.includeDate === false ? null : query['date-start'] ?? null,
        dateEnd: options.includeDate === false ? null : query['date-end'] ?? null,
        canteenIds: options.includeCanteenId === false ? [] : asArray(query.canteenId).map(Number).filter(Number.isFinite),
        categories: asArray(query.category).filter(Boolean),
        internalCategories: asArray(query.internalCategory).filter(Boolean),
        names: asArray(query.name).filter(Boolean),
        priceStudentMin: query['price-student-min'] == null ? null : Number(query['price-student-min']),
        priceStudentMax: query['price-student-max'] == null ? null : Number(query['price-student-max']),
        priceEmployeesMin: query['price-employees-min'] == null ? null : Number(query['price-employees-min']),
        priceEmployeesMax: query['price-employees-max'] == null ? null : Number(query['price-employees-max']),
        pricePupilsMin: query['price-pupils-min'] == null ? null : Number(query['price-pupils-min']),
        pricePupilsMax: query['price-pupils-max'] == null ? null : Number(query['price-pupils-max']),
        priceOthersMin: query['price-others-min'] == null ? null : Number(query['price-others-min']),
        priceOthersMax: query['price-others-max'] == null ? null : Number(query['price-others-max']),
        notes: asArray(query.notes).filter(Boolean),
        components: asArray(query.components).filter(Boolean),
        tags: asArray(query.tags).filter(Boolean),
        hasInternalCategory: boolParam(query['has-internal-category']),
        hasNotes: boolParam(query['has-notes']),
        hasComponents: boolParam(query['has-components']),
        hasTags: boolParam(query['has-tags'])
    };
    if (options.includeDate !== false) {
        if (query.today !== undefined) filters.date = [toDateString(new Date())];
        if (query.next !== undefined) {
            const next = new Date();
            next.setUTCDate(next.getUTCDate() + 1);
            filters.date = [toDateString(next)];
        }
        if (query['date-offset'] !== undefined) {
            const offset = new Date();
            offset.setUTCDate(offset.getUTCDate() + Number(query['date-offset']));
            filters.date = [toDateString(offset)];
        }
        if (query.week !== undefined || query['week-next'] !== undefined || query['week-date'] !== undefined) {
            const base = new Date(query['week-date'] ?? Date.now());
            if (query['week-next'] !== undefined) base.setUTCDate(base.getUTCDate() + 7);
            const range = weekRange(toDateString(base));
            filters.date = [];
            filters.dateStart = range.start;
            filters.dateEnd = range.end;
        }
    }
    return filters;
}

/** Returns all meals, optionally filtered by query parameters. */
fastify.get('/meals', async (request, reply) => {
    const query = /** @type {any} */ (request.query);
    return getMeals(null, null, null, mealFilters(query));
});

/** Returns all meals for the given date. */
fastify.get('/meals/:date', async (request, reply) => {
    const query = /** @type {any} */ (request.query);
    const { date } = /** @type {ParamsDate} */ (request.params);
    const meals = getMeals(date, null, null, mealFilters(query, { includeDate: false }));
    if (meals.length === 0) {
        reply.code(404).send({ error: 'Not found' });
        return;
    }
    return meals;
});

/** Returns all meals for the given date and canteen. */
fastify.get('/meals/:date/:canteenId', async (request, reply) => {
    const query = /** @type {any} */ (request.query);
    const { date, canteenId } = /** @type {ParamsDateCanteen} */ (request.params);
    const meals = getMeals(date, Number(canteenId), null, mealFilters(query, { includeDate: false, includeCanteenId: false }));
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

/** Returns comprehensive usage statistics for the authenticated card. */
fastify.get('/card/:cardNumber/stats', { preHandler: authenticate }, async (request, reply) => {
    const { cardNumber } = /** @type {ParamsCardNumber} */ (request.params);
    if (/** @type {any} */ (request).authenticatedCard !== cardNumber) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
    }
    const query = /** @type {any} */ (request.query);
    const dateStart = query['date-start'] ?? null;
    const dateEnd = query['date-end'] ?? null;
    const locationIds = query['location-id']
        ? (Array.isArray(query['location-id']) ? query['location-id'] : [query['location-id']]).map(Number).filter(Number.isFinite)
        : null;
    return computeCardStats(cardNumber, dateStart, dateEnd, locationIds);
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