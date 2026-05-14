/// @ts-check

import { DatabaseSync } from 'node:sqlite';
import { InfisicalSDK } from '@infisical/sdk'
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

/**
 * @type {InfisicalSDK | null}
 */
let client;

/**
 * Initializes the Infisical client using environment credentials.
 * @returns {Promise<void>}
 */
export async function setupInfisicalClient() {
    if (client) {
        return;
    }

    const infisicalSdk = new InfisicalSDK({
        siteUrl: process.env.INFISICAL_SITE_URL,
    });

    if (!process.env.INFISICAL_CLIENT_ID || !process.env.INFISICAL_CLIENT_SECRET) {
        throw new Error('Infisical client credentials are not set in environment variables.');
    }
    await infisicalSdk.auth().universalAuth.login({
        clientId: process.env.INFISICAL_CLIENT_ID,
        clientSecret: process.env.INFISICAL_CLIENT_SECRET
    });

    client = infisicalSdk;
}

const db = new DatabaseSync('database.db');

// create schema
db.exec(`
    CREATE TABLE IF NOT EXISTS trans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mandantId INTEGER,
        transFullId TEXT NOT NULL UNIQUE,
        datum INTEGER NOT NULL,
        ortName TEXT,
        kaName TEXT,
        typName TEXT,
        zahlBetrag REAL,
        dateiablageId INTEGER,
        bonusInfo TEXT,
        cardnumber TEXT NOT NULL,
        UNIQUE(transFullId, datum, cardnumber)
    );
    CREATE INDEX IF NOT EXISTS idx_trans_cardnumber ON trans (cardnumber);
    CREATE INDEX IF NOT EXISTS idx_trans_transFullId ON trans (transFullId);
    CREATE INDEX IF NOT EXISTS idx_trans_datum ON trans (datum);
    CREATE INDEX IF NOT EXISTS idx_trans_ortName ON trans (ortName);
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS transpos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mandantId INTEGER,
        transFullId TEXT NOT NULL,
        posId INTEGER,
        name TEXT,
        menge INTEGER,
        epreis REAL,
        rabatt REAL,
        gpreis REAL,
        bewertung INTEGER,
        cardnumber TEXT NOT NULL,
        UNIQUE(transFullId, posId, cardnumber)
    );
    CREATE INDEX IF NOT EXISTS idx_transpos_cardnumber ON transpos (cardnumber);
    CREATE INDEX IF NOT EXISTS idx_transpos_transFullId ON transpos (transFullId);
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS mensa_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        openMensaId INTEGER NOT NULL UNIQUE,
        mensaXMLId INTEGER UNIQUE,
        name TEXT NOT NULL,
        internalName TEXT
    );
    INSERT OR IGNORE INTO mensa_locations (openMensaId, mensaXMLId, name, internalName) VALUES 
    (63, 106, 'Mensa am Park', 'MaP Mensaküche Leitung'),
    (64, 118, 'Mensa Academica', NULL),
    (65, 115, 'Mensa am Elsterbecken', 'Mensaküche amElsterbecken'),
    (66, 170, 'Mensa An den Tierkliniken', NULL),
    (68, 111, 'Mensa Petersteinweg', 'PSW Mensaküche Leitung'),
    (67, 162, 'Mensa Liebigstraße/Mensa und Cafeteria am Medizincampus', NULL),
    (69, 140, 'Mensa/Cafetaria Schönauer Straße', NULL),
    (70, 153, 'Cafeteria Dittrichring', NULL),
    (71, null, 'Cafeteria Koburger Straße', NULL),
    (72, 127, 'Cafeteria Philipp-Rosenthal-Straße/Mensaria am Botanischen Garten', NULL),
    (73, null, 'Cafeteria Wächterstraße', NULL);
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS meals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mensa_location_id INTEGER NOT NULL,
        date INTEGER NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        internalCategory TEXT,
        prices TEXT,
        notes TEXT,
        components TEXT,
        tags TEXT,
        FOREIGN KEY (mensa_location_id) REFERENCES mensa_locations(id),
        UNIQUE(mensa_location_id, date, name, category)
    );
    CREATE INDEX IF NOT EXISTS idx_meals_mensa_location_id ON meals (mensa_location_id);
    CREATE INDEX IF NOT EXISTS idx_meals_date ON meals (date);
    CREATE INDEX IF NOT EXISTS idx_meals_internalCategory ON meals (internalCategory);
`);

/**
 * 
 * @param {String} cardnumber 
 * @param {String} passwort
 * @return {Promise<void>} 
 */
export async function insertCard(cardnumber, passwort) {
    if (!client) {
        throw new Error('Infisical client is not initialized. Call setupInfisicalClient() first.');
    }
    if (process.env.INFISICAL_PROJECT_ID === undefined) {
        throw new Error('Infisical environment or project ID is not set in environment variables.');
    }
    try {
        await client.secrets().getSecret({
            environment: process.env.INFISICAL_ENVIRONMENT || "dev",
            projectId: process.env.INFISICAL_PROJECT_ID,
            secretName: cardnumber,
            viewSecretValue: false
        });
    } catch (error) {
        await client.secrets().createSecret(cardnumber, {
            environment: process.env.INFISICAL_ENVIRONMENT || "dev",
            projectId: process.env.INFISICAL_PROJECT_ID,
            secretValue: passwort
        });
    }
}

/**
 * Updates the password of an existing card secret in Infisical.
 * @param {string} cardnumber - The card number used as the secret name.
 * @param {string} newPassword - The new password value to store.
 * @returns {Promise<void>}
 */
export async function updateCard(cardnumber, newPassword) {
    if (!client) throw new Error('Infisical client is not initialized.');
    if (!process.env.INFISICAL_PROJECT_ID) throw new Error('INFISICAL_PROJECT_ID is not set.');
    await client.secrets().updateSecret(cardnumber, {
        environment: process.env.INFISICAL_ENVIRONMENT || "dev",
        projectId: process.env.INFISICAL_PROJECT_ID,
        secretValue: newPassword
    });
}

/**
 * Deletes a card secret from Infisical.
 * @param {string} cardnumber - The card number used as the secret name.
 * @returns {Promise<void>}
 */
export async function deleteCard(cardnumber) {
    if (!client) throw new Error('Infisical client is not initialized.');
    if (!process.env.INFISICAL_PROJECT_ID) throw new Error('INFISICAL_PROJECT_ID is not set.');
    await client.secrets().deleteSecret(cardnumber, {
        environment: process.env.INFISICAL_ENVIRONMENT || "dev",
        projectId: process.env.INFISICAL_PROJECT_ID,
    });
}

/**
 * Retrieves all card secrets from Infisical, returning their id, cardnumber (secret name) and password (secret value).
 * @returns {Promise<{id: string, cardnumber: string, password: string}[]>}
 */
export async function getCards() {
    if (!client) throw new Error('Infisical client is not initialized.');
    if (!process.env.INFISICAL_PROJECT_ID) throw new Error('INFISICAL_PROJECT_ID is not set.');
    const cardsResults = await client.secrets().listSecrets({
        environment: process.env.INFISICAL_ENVIRONMENT || "dev",
        projectId: process.env.INFISICAL_PROJECT_ID,
        viewSecretValue: true,
    });
    return cardsResults.secrets.map(c => ({
        id: c.id,
        cardnumber: c.secretKey,
        password: c.secretValue
    }));
}

/**
 * Retrieves a card secret from Infisical by its card number.
 * @param {string} cardnumber
 * @returns {Promise<{id: string, cardnumber: string, password: string} | null>}
 */
export async function getCard(cardnumber) {
    if (!client) throw new Error('Infisical client is not initialized.');
    if (!process.env.INFISICAL_PROJECT_ID) throw new Error('INFISICAL_PROJECT_ID is not set.');
    try {
        const card = await client.secrets().getSecret({
            environment: process.env.INFISICAL_ENVIRONMENT || "dev",
            projectId: process.env.INFISICAL_PROJECT_ID,
            secretName: cardnumber,
            viewSecretValue: true
        });
        return {
            id: card.id,
            cardnumber: card.secretKey,
            password: card.secretValue
        };
    } catch (error) {
        return null;
    }
}

/**
 * Inserts a list of transactions into the trans table, ignoring duplicates based on transFullId, datum and cardnumber.
 * @param {{mandantId: number, transFullId: string, datum: string, ortName: string, kaName: string, typName: string, zahlBetrag: number, dateiablageId: number|null, bonusInfo: string|null}[]} transList 
 * @param {String} cardnumber 
 * @return {void}
 */
export function insertTransList(transList, cardnumber) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO trans (mandantId, transFullId, datum, ortName, kaName, typName, zahlBetrag, dateiablageId, bonusInfo, cardnumber)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const trans of transList) {
        var dateParts = trans.datum.split(' ')[0].split('.');
        var timeParts = trans.datum.split(' ')[1].split(':');
        var date = new Date(Number(dateParts[2]), Number(dateParts[1]) - 1, Number(dateParts[0]), Number(timeParts[0]), Number(timeParts[1]));
        stmt.run(
            trans.mandantId,
            trans.transFullId,
            date.getTime(),
            trans.ortName,
            trans.kaName,
            trans.typName,
            trans.zahlBetrag,
            trans.dateiablageId ? trans.dateiablageId : null,
            trans.bonusInfo ? trans.bonusInfo : null,
            cardnumber
        );
    }
}

/**
 * Retrieves transactions from the database, optionally filtered by card number.
 * @param {String|null} cardnumber 
 * @returns {{id: number, mandantId: number, transFullId: string, datum: Date, ortName: string, kaName: string, typName: string, zahlBetrag: number, dateiablageId: number|null, bonusInfo: string|null, cardnumber: string}[]}
 */
export function getTransList(cardnumber) {
    if (!cardnumber) {
        var stmt = db.prepare('SELECT * FROM trans');
        var results = stmt.all();
    } else {
        var stmt = db.prepare('SELECT * FROM trans WHERE cardnumber = ?');
        var results = stmt.all(cardnumber);
    }
    return results.map(/** @param {any} r */ r => ({
        id: r.id,
        mandantId: r.mandantId,
        transFullId: r.transFullId,
        datum: new Date(r.datum),
        ortName: r.ortName,
        kaName: r.kaName,
        typName: r.typName,
        zahlBetrag: r.zahlBetrag,
        dateiablageId: r.dateiablageId ? r.dateiablageId : null,
        bonusInfo: r.bonusInfo ? r.bonusInfo : null,
        cardnumber: r.cardnumber
    }));
}

/**
 * Inserts a list of transaction positions into the transpos table, ignoring duplicates.
 * @param {{mandantId: number, transFullId: string, posId: number, name: string, menge: number, epreis: number, rabatt: number|null, gpreis: number, bewertung: number|null}[]} transPosList - Transaction positions to insert.
 * @param {string} cardnumber - The card number to associate the positions with.
 * @returns {void}
 */
export function insertTransPosList(transPosList, cardnumber) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO transpos (mandantId, transFullId, posId, name, menge, epreis, rabatt, gpreis, bewertung, cardnumber)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const transPos of transPosList) {
        stmt.run(
            transPos.mandantId,
            transPos.transFullId,
            transPos.posId,
            transPos.name,
            transPos.menge,
            transPos.epreis,
            transPos.rabatt ? transPos.rabatt : null,
            transPos.gpreis,
            transPos.bewertung ? transPos.bewertung : null,
            cardnumber
        );
    }
}

/**
 * @typedef {Object} TransPos
 * @property {number} id
 * @property {number} mandantId
 * @property {string} transFullId
 * @property {number} posId
 * @property {string} name
 * @property {number} menge
 * @property {number} epreis
 * @property {number|null} rabatt
 * @property {number} gpreis
 * @property {number|null} bewertung
 * @property {string} cardnumber
 */
/**
 * Retrieves transaction positions from the database, optionally filtered by card number.
 * @param {string|null} cardnumber - Card number to filter by, or null/undefined for all records.
 * @returns {TransPos[]}
 */
export function getTransPosList(cardnumber) {
    if (!cardnumber) {
        var stmt = db.prepare('SELECT * FROM transpos');
        var results = stmt.all();
    } else {
        var stmt = db.prepare('SELECT * FROM transpos WHERE cardnumber = ?');
        var results = stmt.all(cardnumber);
    }
    return results.map(/** @param {any} r */ r => ({
        id: r.id,
        mandantId: r.mandantId,
        transFullId: r.transFullId,
        posId: r.posId,
        name: r.name,
        menge: r.menge,
        epreis: r.epreis,
        rabatt: r.rabatt,
        gpreis: r.gpreis,
        bewertung: r.bewertung,
        cardnumber: r.cardnumber
    }));
}

/**
 * Returns all mensa locations from the database.
 * @returns {{id: number, openMensaId: number, mensaXMLId: number|null, name: string, internalName: string|null}[]}
 */
export function getMensaLocations() {
    const stmt = db.prepare('SELECT * FROM mensa_locations');
    const results = stmt.all();
    return results.map(/** @param {any} r */ r => ({
        id: r.id,
        openMensaId: r.openMensaId,
        mensaXMLId: r.mensaXMLId,
        name: r.name,
        internalName: r.internalName
    }));
}

/**
 * Looks up a mensa location by its OpenMensa API id.
 * @param {number} openMensaId - The OpenMensa canteen id.
 * @returns {{id: number, openMensaId: number, mensaXMLId: number|null, name: string, internalName: string|null} | null}
 */
export function getMensaLocationByOpenMensaId(openMensaId) {
    const stmt = db.prepare('SELECT * FROM mensa_locations WHERE openMensaId = ?');
    const result = stmt.get(openMensaId);
    if (result) {
        const r = /** @type {any} */ (result);
        return {
            id: r.id,
            openMensaId: r.openMensaId,
            mensaXMLId: r.mensaXMLId,
            name: r.name,
            internalName: r.internalName
        };
    } else {
        return null;
    }
}

/**
 * Looks up a mensa location by its Mensa XML feed id.
 * @param {number} mensaXMLId - The Mensa XML canteen id.
 * @returns {{id: number, openMensaId: number, mensaXMLId: number|null, name: string, internalName: string|null} | null}
 */
export function getMensaLocationByMensaXMLId(mensaXMLId) {
    const stmt = db.prepare('SELECT * FROM mensa_locations WHERE mensaXMLId = ?');
    const result = stmt.get(mensaXMLId);
    if (result) {
        const r = /** @type {any} */ (result);
        return {
            id: r.id,
            openMensaId: r.openMensaId,
            mensaXMLId: r.mensaXMLId,
            name: r.name,
            internalName: r.internalName
        };
    } else {
        return null;
    }
}

/**
 * @typedef {Object} OpenMensaMeal
 * @property {number} id
 * @property {string} name
 * @property {string} category
 * @property {Object} prices
 * @property {number|null} prices.students
 * @property {number|null} prices.employees
 * @property {number|null} prices.others
 * @property {number|null} prices.pupils
 * @property {string[]} notes
 */
/**
 * Inserts or updates meals from the OpenMensa API for a specific canteen and date.
 * @param {OpenMensaMeal[]} meals 
 * @param {number|string} canteenId 
 * @param {string} date 
 */
export function insertOpenMensaMeals(meals, canteenId, date) {
    // parse date yyyy-mm-dd to timestamp
    const dateObj = new Date(date);
    const location = getMensaLocationByOpenMensaId(Number(canteenId));
    if (!location) throw new Error(`Mensa location not found for OpenMensa id: ${canteenId}`);
    var mensaLocationId = location.id;
    
    const stmt = db.prepare(`
        INSERT INTO meals (mensa_location_id, date, name, category, prices, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(mensa_location_id, date, name, category) DO UPDATE SET name = excluded.name, category = excluded.category, prices = excluded.prices, notes = excluded.notes
    `);
    for (const meal of meals) {
        stmt.run(
            mensaLocationId,
            dateObj.getTime(),
            meal.name,
            meal.category,
            meal.prices ? JSON.stringify(meal.prices) : null,
            meal.notes ? JSON.stringify(meal.notes) : null
        );
    }
}

/**
 * Returns all distinct meal dates for a canteen on or after the given start date.
 * @param {number} canteenId - OpenMensa canteen id.
 * @param {string|null} startDate - ISO date string lower bound (inclusive). Defaults to today.
 * @returns {Date[]}
 */
export function getOpenMensaDays(canteenId, startDate = null) {
    const startDateObj = startDate ? new Date(startDate) : new Date();
    const location = getMensaLocationByOpenMensaId(canteenId);
    if (!location) throw new Error(`Mensa location not found for OpenMensa id: ${canteenId}`);
    var mensaLocationId = location.id;
    const stmt = db.prepare('SELECT DISTINCT date FROM meals WHERE mensa_location_id = ? AND date >= ?');
    var results = stmt.all(mensaLocationId, startDateObj.getTime());
    return results.map(/** @param {any} r */ r => new Date(r.date));
}

/**
 * Returns all meals from the database joined with their location data (OpenMensa format).
 * @returns {{id: number, name: string, notes: string[]|null, prices: Object|null, category: string, date: Date, locationName: string, locationInternalName: string|null, locationOpenMensaId: number, locationMensaXMLId: number|null, canteenId: number}[]}
 */
export function getAllOpenMensaMeals() {
    const stmt = db.prepare('SELECT meals.id, meals.mensa_location_id, mensa_locations.name AS locationName, mensa_locations.internalName AS locationInternalName, mensa_locations.openMensaId AS locationOpenMensaId, mensa_locations.mensaXMLId AS locationMensaXMLId, meals.date, meals.name, meals.category, meals.internalCategory, meals.prices, meals.components, meals.tags FROM meals INNER JOIN mensa_locations ON meals.mensa_location_id = mensa_locations.id');
    const results = stmt.all();
    return results.map(/** @param {any} r */ r => ({
        id: r.id,
        name: r.name,
        notes: r.notes ? JSON.parse(r.notes) : null,
        prices: r.prices ? JSON.parse(r.prices) : null,
        category: r.category,
        date: new Date(r.date),
        locationName: r.locationName,
        locationInternalName: r.locationInternalName,
        locationOpenMensaId: r.locationOpenMensaId,
        locationMensaXMLId: r.locationMensaXMLId,
        canteenId: r.mensa_location_id
    }));
}

/**
 * Returns all meals for a specific canteen and date (OpenMensa format).
 * @param {number} canteenId - OpenMensa canteen id.
 * @param {string} date - ISO date string.
 * @returns {{id: number, name: string, notes: string[]|null, prices: Object|null, category: string, date: Date, locationName: string, locationInternalName: string|null, locationOpenMensaId: number, locationMensaXMLId: number|null, canteenId: number}[]}
 */
export function getOpenMensaMeals(canteenId, date) {
    const dateObj = new Date(date);
    const location = getMensaLocationByOpenMensaId(canteenId);
    if (!location) throw new Error(`Mensa location not found for OpenMensa id: ${canteenId}`);
    var mensaLocationId = location.id;
    const stmt = db.prepare('SELECT meals.id, meals.mensa_location_id, mensa_locations.name AS locationName, mensa_locations.internalName AS locationInternalName, mensa_locations.openMensaId AS locationOpenMensaId, mensa_locations.mensaXMLId AS locationMensaXMLId, meals.date, meals.name, meals.category, meals.internalCategory, meals.prices, meals.components, meals.tags FROM meals INNER JOIN mensa_locations ON meals.mensa_location_id = mensa_locations.id WHERE meals.mensa_location_id = ? AND meals.date = ?');
    var results = stmt.all(mensaLocationId, dateObj.getTime());
    if (results.length > 0) {
        return results.map(/** @param {any} r */ r => ({
            id: r.id,
            name: r.name,
            notes: r.notes ? JSON.parse(r.notes) : null,
            prices: r.prices ? JSON.parse(r.prices) : null,
            category: r.category,
            date: new Date(r.date),
            locationName: r.locationName,
            locationInternalName: r.locationInternalName,
            locationOpenMensaId: r.locationOpenMensaId,
            locationMensaXMLId: r.locationMensaXMLId,
            canteenId: r.mensa_location_id
        }));
    } else {
        return [];
    }
}

/**
 * Inserts or updates meals from the Mensa XML feed.
 * @param {{locationId: number, date: Date, name: string, category: string, internalCategory: string|null, prices: Object|null, components: string[]|null, tags: string[]|null}[]} meals - Meals to upsert.
 * @returns {void}
 */
export function insertMensaXMLMeals(meals) {
    const stmt = db.prepare(`
        INSERT INTO meals (mensa_location_id, date, name, category, internalCategory, prices, components, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mensa_location_id, date, name, category) DO UPDATE SET name = excluded.name, category = excluded.category, internalCategory = excluded.internalCategory, prices = excluded.prices, components = excluded.components, tags = excluded.tags
    `);
    for (const meal of meals) {
        const loc = getMensaLocationByMensaXMLId(meal.locationId);
        if (!loc) throw new Error(`Mensa location not found for XML id: ${meal.locationId}`);
        var mensaLocationId = loc.id;
        stmt.run(
            mensaLocationId,
            meal.date.getTime(),
            meal.name,
            meal.category,
            meal.internalCategory,
            meal.prices ? JSON.stringify(meal.prices) : null,
            meal.components ? JSON.stringify(meal.components) : null,
            meal.tags ? JSON.stringify(meal.tags) : null
        );
    }
}

/**
 * Returns all meals from the database joined with their location data (Mensa XML format).
 * @returns {{id: number, locationId: number, locationName: string, locationInternalName: string|null, locationOpenMensaId: number, locationMensaXMLId: number|null, date: Date, name: string, category: string, internalCategory: string|null, prices: Object|null, components: string[]|null, tags: string[]|null}[]}
 */
export function getAllMensaXMLMeals() {
    const stmt = db.prepare('SELECT meals.id, meals.mensa_location_id, mensa_locations.name AS locationName, mensa_locations.internalName AS locationInternalName, mensa_locations.openMensaId AS locationOpenMensaId, mensa_locations.mensaXMLId AS locationMensaXMLId, meals.date, meals.name, meals.category, meals.internalCategory, meals.prices, meals.components, meals.tags FROM meals INNER JOIN mensa_locations ON meals.mensa_location_id = mensa_locations.id');
    const results = stmt.all();
    return results.map(/** @param {any} r */ r => ({
        id: r.id,
        locationId: r.mensa_location_id,
        locationName: r.locationName,
        locationInternalName: r.locationInternalName,
        locationOpenMensaId: r.locationOpenMensaId,
        locationMensaXMLId: r.locationMensaXMLId,
        date: new Date(r.date),
        name: r.name,
        category: r.category,
        internalCategory: r.internalCategory,
        prices: r.prices ? JSON.parse(r.prices) : null,
        components: r.components ? JSON.parse(r.components) : null,
        tags: r.tags ? JSON.parse(r.tags) : null
    }));
}

/**
 * Returns meals for a specific Mensa XML canteen and date.
 * @param {number} canteenId - Mensa XML canteen id.
 * @param {string} date - ISO date string.
 * @returns {{id: number, locationId: number, locationName: string, locationInternalName: string|null, locationOpenMensaId: number, locationMensaXMLId: number|null, date: Date, name: string, category: string, internalCategory: string|null, prices: Object|null, components: string[]|null, tags: string[]|null}[]}
 */
export function getMensaXMLMeals(canteenId, date) {
    const dateObj = new Date(date);
    const location = getMensaLocationByMensaXMLId(canteenId);
    if (!location) throw new Error(`Mensa location not found for XML id: ${canteenId}`);
    var mensaLocationId = location.id;
    const stmt = db.prepare('SELECT meals.id, meals.mensa_location_id, mensa_locations.name AS locationName, mensa_locations.internalName AS locationInternalName, mensa_locations.openMensaId AS locationOpenMensaId, mensa_locations.mensaXMLId AS locationMensaXMLId, meals.date, meals.name, meals.category, meals.internalCategory, meals.prices, meals.components, meals.tags FROM meals INNER JOIN mensa_locations ON meals.mensa_location_id = mensa_locations.id WHERE meals.mensa_location_id = ? AND meals.date = ?');
    var results = stmt.all(mensaLocationId, dateObj.getTime());
    if (results.length > 0) {
        return results.map(/** @param {any} r */ r => ({
            id: r.id,
            locationId: r.mensa_location_id,
            locationName: r.locationName,
            locationInternalName: r.locationInternalName,
            locationOpenMensaId: r.locationOpenMensaId,
            locationMensaXMLId: r.locationMensaXMLId,
            date: new Date(r.date),
            name: r.name,
            category: r.category,
            internalCategory: r.internalCategory,
            prices: r.prices ? JSON.parse(r.prices) : null,
            components: r.components ? JSON.parse(r.components) : null,
            tags: r.tags ? JSON.parse(r.tags) : null
        }));
    } else {
        return [];
    }
}

/**
 * Looks up a mensa location's internal database id by its internal name.
 * @param {string} internalName - The internal name of the mensa location.
 * @returns {number | null} The internal database id, or null if not found.
 */
export function getMensaLocationByInternalName(internalName) {
    const stmt = db.prepare('SELECT * FROM mensa_locations WHERE internalName = ?');
    const result = stmt.get(internalName);
    if (result) {
        return /** @type {any} */ (result).id;
    } else {
        return null;
    }
}

/**
 * Returns meal ids and their internal categories for meals that match the price for the given canteen and date.
 * @param {number} canteenId 
 * @param {Date} date 
 * @param {number} price 
 * @returns {{id: number, internalCategory: string}[]} mealIds of meals that match the price for the given canteen and date
 */
export function getMealsByPrice(canteenId, date, price) {
    // filter meals by matching the location, date and price if the price is for any category equal than the given price
    const stmt = db.prepare(`SELECT meals.id, meals.internalCategory FROM meals WHERE meals.mensa_location_id = ? AND meals.date = ? AND (meals.prices IS NOT NULL AND (json_extract(meals.prices, '$.students') = ? OR json_extract(meals.prices, '$.employees') = ? OR json_extract(meals.prices, '$.others') = ? OR json_extract(meals.prices, '$.pupils') = ?))`);
    var results = stmt.all(canteenId, date.getTime(), price, price, price, price);
    return results.map(/** @param {any} r */ r => ({id: r.id, internalCategory: r.internalCategory}));
}

/**
 * Sets the internalCategory field on a meal record.
 * @param {number} mealId - The meal's database id.
 * @param {string} internalCategory - The internal category string to assign.
 * @returns {void}
 */
export function updateInternalCategory(mealId, internalCategory) {
    const stmt = db.prepare('UPDATE meals SET internalCategory = ? WHERE id = ?');
    stmt.run(internalCategory, mealId);
}