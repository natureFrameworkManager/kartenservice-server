import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('database.db');

// create schema
db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cardnumber TEXT NOT NULL UNIQUE,
        passwort TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cards_cardnumber ON cards (cardnumber);
`);
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

export function insertCard(cardnumber, passwort) {
    const stmt = db.prepare('INSERT OR IGNORE INTO cards (cardnumber, passwort) VALUES (?, ?)');
    stmt.run(cardnumber, passwort);
}

export function getCard(cardnumber) {
    const stmt = db.prepare('SELECT * FROM cards WHERE cardnumber = ?');
    return stmt.get(cardnumber);
}

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

export function insertOpenMensaMeals(meals, canteenId, date) {
    // parse date yyyy-mm-dd to timestamp
    var date = new Date(date);
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO openmensa_meals (name, notes, prices, category, date, canteenId)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const meal of meals) {
        stmt.run(
            meal.name,
            meal.notes ? JSON.stringify(meal.notes) : null,
            meal.prices ? JSON.stringify(meal.prices) : null,
            meal.category,
            date.getTime(),
            canteenId
        );
    }
}

export function insertMensaXMLMeals(meals) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO mensa_xml_cache (locationId, date, name, category, internalCategory, prices, components, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const meal of meals) {
        stmt.run(
            meal.locationId,
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