import { DatabaseSync } from 'node:sqlite';
import { InfisicalSDK } from '@infisical/sdk'
import dotenv from 'dotenv';
import { set } from 'zod';
dotenv.config({ quiet: true });

let client;

export async function setupInfisicalClient() {
    if (client) {
        return;
    }

    const infisicalSdk = new InfisicalSDK({
        siteUrl: process.env.INFISICAL_SITE_URL,
    });

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
db.exec(`
    CREATE TABLE IF NOT EXISTS openmensa_meals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        notes TEXT,
        prices TEXT,
        category TEXT NOT NULL,
        date INTEGER NOT NULL,
        canteenId INTEGER NOT NULL,
        UNIQUE(name, date, canteenId)
    );
    CREATE INDEX IF NOT EXISTS idx_openmensa_meals_date ON openmensa_meals (date);
    CREATE INDEX IF NOT EXISTS idx_openmensa_meals_canteenId ON openmensa_meals (canteenId);
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS mensa_xml_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        locationId INTEGER NOT NULL,
        date INTEGER NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        internalCategory TEXT,
        prices TEXT,
        components TEXT,
        tags TEXT,
        UNIQUE(locationId, date, name, category)
    );
    CREATE INDEX IF NOT EXISTS idx_mensa_xml_cache_locationId ON mensa_xml_cache (locationId);
    CREATE INDEX IF NOT EXISTS idx_mensa_xml_cache_date ON mensa_xml_cache (date);
    CREATE INDEX IF NOT EXISTS idx_mensa_xml_cache_internalCategory ON mensa_xml_cache (internalCategory);
`);

/**
 * 
 * @param {String} cardnumber 
 * @param {String} passwort
 * @return {void} 
 */
export async function insertCard(cardnumber, passwort) {
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

export async function updateCard(cardnumber, newPassword) {
    await client.secrets().updateSecret(cardnumber, {
        environment: process.env.INFISICAL_ENVIRONMENT || "dev",
        projectId: process.env.INFISICAL_PROJECT_ID,
        secretValue: newPassword
    });
}

export async function deleteCard(cardnumber) {
    await client.secrets().deleteSecret(cardnumber, {
        environment: process.env.INFISICAL_ENVIRONMENT || "dev",
        projectId: process.env.INFISICAL_PROJECT_ID,
    });
}

/**
 * 
 * @returns {{id: number, cardnumber: string, password: string}[]}
 */
export async function getCards() {
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
 * 
 * @param {String} cardnumber 
 * @returns {{id: number, cardnumber: string, password: string} | null}
 */
export async function getCard(cardnumber) {
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
 * 
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
        var date = new Date(dateParts[2], dateParts[1] - 1, dateParts[0], timeParts[0], timeParts[1]);
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
 * 
 * @param {String} cardnumber 
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
    return results.map(r => ({
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
export function getTransPosList(cardnumber) {
    if (!cardnumber) {
        var stmt = db.prepare('SELECT * FROM transpos');
        var results = stmt.all();
    } else {
        var stmt = db.prepare('SELECT * FROM transpos WHERE cardnumber = ?');
        var results = stmt.all(cardnumber);
    }
    return results.map(r => ({
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

export function getMensaLocations() {
    const stmt = db.prepare('SELECT * FROM mensa_locations');
    const results = stmt.all();
    return results.map(r => ({
        id: r.id,
        openMensaId: r.openMensaId,
        mensaXMLId: r.mensaXMLId,
        name: r.name,
        internalName: r.internalName
    }));
}

export function getMensaLocationByOpenMensaId(openMensaId) {
    const stmt = db.prepare('SELECT * FROM mensa_locations WHERE openMensaId = ?');
    const result = stmt.get(openMensaId);
    if (result) {
        return {
            id: result.id,
            openMensaId: result.openMensaId,
            mensaXMLId: result.mensaXMLId,
            name: result.name,
            internalName: result.internalName
        };
    } else {
        return null;
    }
}

export function getMensaLocationByMensaXMLId(mensaXMLId) {
    const stmt = db.prepare('SELECT * FROM mensa_locations WHERE mensaXMLId = ?');
    const result = stmt.get(mensaXMLId);
    if (result) {
        return {
            id: result.id,
            openMensaId: result.openMensaId,
            mensaXMLId: result.mensaXMLId,
            name: result.name,
            internalName: result.internalName
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
 * 
 * @param {OpenMensaMeal[]} meals 
 * @param {number|string} canteenId 
 * @param {string} date 
 */
export function insertOpenMensaMeals(meals, canteenId, date) {
    // parse date yyyy-mm-dd to timestamp
    var date = new Date(date);
    var mensaLocationId = getMensaLocationByOpenMensaId(canteenId).id;
    
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO meals (mensa_location_id, date, name, category, prices, notes)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const meal of meals) {
        stmt.run(
            mensaLocationId,
            date.getTime(),
            meal.name,
            meal.category,
            meal.prices ? JSON.stringify(meal.prices) : null,
            meal.notes ? JSON.stringify(meal.notes) : null
        );
    }
}

export function getOpenMensaDays(canteenId, startDate = null) {
    var startDate = startDate ? new Date(startDate) : new Date();
    var mensaLocationId = getMensaLocationByOpenMensaId(canteenId).id;
    const stmt = db.prepare('SELECT DISTINCT date FROM meals WHERE mensa_location_id = ? AND date >= ?');
    var results = stmt.all(mensaLocationId, startDate.getTime());
    return results.map(r => new Date(r.date));
}

export function getAllOpenMensaMeals() {
    const stmt = db.prepare('SELECT * FROM meals');
    const results = stmt.all();
    return results.map(r => ({
        id: r.id,
        name: r.name,
        notes: r.notes ? JSON.parse(r.notes) : null,
        prices: r.prices ? JSON.parse(r.prices) : null,
        category: r.category,
        date: new Date(r.date),
        canteenId: r.mensa_location_id
    }));
}

export function getOpenMensaMeals(canteenId, date) {
    var date = new Date(date);
    var mensaLocationId = getMensaLocationByOpenMensaId(canteenId).id;
    const stmt = db.prepare('SELECT * FROM meals WHERE mensa_location_id = ? AND date = ?');
    var results = stmt.all(mensaLocationId, date.getTime());
    if (results.length > 0) {
        return results.map(r => ({
            id: r.id,
            name: r.name,
            notes: r.notes ? JSON.parse(r.notes) : null,
            prices: r.prices ? JSON.parse(r.prices) : null,
            category: r.category,
            date: new Date(r.date),
            canteenId: r.mensa_location_id
        }));
    } else {
        return [];
    }
}

export function insertMensaXMLMeals(meals) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO meals (mensa_location_id, date, name, category, internalCategory, prices, components, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const meal of meals) {
        var mensaLocationId = getMensaLocationByMensaXMLId(meal.locationId).id;
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

export function getAllMensaXMLMeals() {
    const stmt = db.prepare('SELECT * FROM meals');
    const results = stmt.all();
    return results.map(r => ({
        id: r.id,
        locationId: r.mensa_location_id,
        date: new Date(r.date),
        name: r.name,
        category: r.category,
        internalCategory: r.internalCategory,
        prices: r.prices ? JSON.parse(r.prices) : null,
        components: r.components ? JSON.parse(r.components) : null,
        tags: r.tags ? JSON.parse(r.tags) : null
    }));
}

export function getMensaXMLMeals(canteenId, date) {
    var date = new Date(date);
    var mensaLocationId = getMensaLocationByMensaXMLId(canteenId).id;
    const stmt = db.prepare('SELECT * FROM meals WHERE mensa_location_id = ? AND date = ?');
    var results = stmt.all(mensaLocationId, date.getTime());
    if (results.length > 0) {
        return results.map(r => ({
            id: r.id,
            locationId: r.mensa_location_id,
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