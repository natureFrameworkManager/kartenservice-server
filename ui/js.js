// On page load or when changing themes, best to add inline in `head` to avoid FOUC
document.documentElement.classList.toggle(
    "dark",
    localStorage.theme === "dark" ||
        (!("theme" in localStorage) && window.matchMedia("(prefers-color-scheme: dark)").matches)
,);

let host = "";
let proto = "";

let cardnumber = sessionStorage.getItem('cardnumber');
let password = sessionStorage.getItem('password');

let locations = [];
let allTransactions = {};

const currencyFormatter = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR"
});

/**
 * Escapes a string for safe insertion into HTML.
 * @param {*} str
 * @returns {string}
 */
function escapeHTML(str) {
    return String(str == null ? "" : str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Detects whether the host supports HTTPS or redirects from HTTP to HTTPS.
 * Tries HTTPS first; if that fails, tries HTTP and follows any redirect to check
 * whether the server ultimately serves over HTTPS.
 * @param {string} hostName
 * @returns {Promise<"https"|"http">}
 */
async function detectProto(hostName) {
    try {
        await fetch(`https://${hostName}/locations`, { method: "HEAD" });
        return "https";
    } catch {
        try {
            const response = await fetch(`http://${hostName}/locations`, { method: "HEAD", redirect: "follow" });
            if (response.url.startsWith("https://")) {
                return "https";
            }
            return "http";
        } catch {
            return "http";
        }
    }
}

/**
 * Derives the API host (hostname:port + base path, no trailing slash) from the
 * current page URL by stripping a trailing /ui/ segment.
 * Examples:
 *   https://api.casparkroll.de/kartenservice/v1/ui/ -> "api.casparkroll.de/kartenservice/v1"
 *   http://localhost:3000/ui/                       -> "localhost:3000"
 * @returns {string}
 */
function getAutoHost() {
    const basePath = window.location.pathname.replace(/\/ui\/?$/, "").replace(/\/$/, "");
    return window.location.host + basePath;
}

/**
 * 
 * @returns {Promise<{id: number, name: string, internalName: string, mensaXMLId: number, openMensaId: number}[]>}
 */
async function getLocations() {
    var response = await fetch(`${proto}://${host}/locations`);
    if (!response.ok) throw new Error(`getLocations failed: ${response.status}`);
    var data = await response.json();
    return data;
}

/**
 * @typedef {Object} Meal
 * @property {number} id
 * @property {Date} date
 * @property {number} mensa_location_id
 * @property {string} locationName
 * @property {string|null} locationInternalName
 * @property {number|null} locationMensaXMLId
 * @property {number|null} locationOpenMensaId
 * @property {string} name
 * @property {string} category
 * @property {string} internalCategory
 * @property {string[]} components
 * @property {{ students: number, employees: number, others: number }} prices
 * @property {string[]} notes
 * @property {[string, string][]} tags
 */

/**
 * 
 * @param {*} locationId 
 * @param {*} date 
 * @returns {Promise<Meal[]>}
 */
async function getMeals(locationId = null, date = new Date(), name = null) {
    if (locationId === null) {
        var response = await fetch(`${proto}://${host}/meals/${date.toISOString().split("T")[0]}`);
    } else if (name === null) {
        var response = await fetch(`${proto}://${host}/meals/${date.toISOString().split("T")[0]}/${locationId}`);
    } else {
        var response = await fetch(`${proto}://${host}/meals/${date.toISOString().split("T")[0]}/${locationId}/${encodeURIComponent(name)}`);
    }
    if (response.status == 404) {
        return [];
    }
    var data = await response.json();
    return data.map(meal => {
        meal.date = new Date(meal.date);
        return meal;
    });
}

/**
 * 
 * @param {string} cardnumber 
 * @param {string} password 
 * @param {Date} date 
 * @returns {Promise<Meal[]>}
 */
async function getCardMeals(cardnumber, password, date = null) {
    if (date === null) {
        var response = await fetch(`${proto}://${host}/meals/card/${cardnumber}`, {
            headers: {
                "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
            }
        });
    } else {
        var response = await fetch(`${proto}://${host}/meals/card/${cardnumber}/${date.toISOString().split("T")[0]}`, {
            headers: {
                "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
            }
        });
    }
    if (response.status == 404) {
        return [];
    }
    if (!response.ok) throw new Error(`getCardMeals failed: ${response.status}`);
    var data = await response.json();
    return data.map(meal => {
        meal.date = new Date(meal.date);
        return meal;
    });
}

/**
 * @param {number} mealId
 * @param {string} internalCategory
 */
async function updateMealInternalCategory(mealId, internalCategory) {
    var response = await fetch(`${proto}://${host}/meals/${mealId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ internalCategory })
    });
    return response;
}

/**
 * @typedef {Object} Transaction
 * @property {number} id
 * @property {number} mandantId
 * @property {string} transFullId
 * @property {Date} datum
 * @property {string} ortName
 * @property {string} kaName
 * @property {string} typName
 * @property {number} zahlBetrag
 * @property {number} dateiablageId
 * @property {null} bonusInfo
 * @property {string} cardnumber
 */
/**
 * @param {string} cardnumber 
 * @param {string} password 
 * @returns {Promise<Transaction[]>}
 */
async function getTransactions(cardnumber, password) {
    var response = await fetch(`${proto}://${host}/trans/${cardnumber}`, {
        headers: {
            "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
        }
    });
    if (!response.ok) throw new Error(`getTransactions failed: ${response.status}`);
    var data = await response.json();
    return data.map(transaction => {
        transaction.datum = new Date(transaction.datum);
        return transaction;
    });
}

/**
 * @typedef {Object} TransactionPositions
 * @property {number} id
 * @property {number} mandantId
 * @property {string} transFullId
 * @property {number} posId
 * @property {string} name
 * @property {number} menge
 * @property {number} epreis
 * @property {number} rabatt
 * @property {number} gpreis
 * @property {number} bewertung
 * @property {string} cardnumber
 */
/**
 * 
 * @param {string} cardnumber 
 * @param {string} password 
 * @returns {Promise<TransactionPositions[]>}
 */
async function getTransactionPositions(cardnumber, password) {
    var response = await fetch(`${proto}://${host}/transpos/${cardnumber}`, {
        headers: {
            "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
        }
    });
    if (!response.ok) throw new Error(`getTransactionPositions failed: ${response.status}`);
    var data = await response.json();
    return data;
}

/**
 * @typedef {Transaction & { positions: TransactionPositions[] }} CombinedTransaction
 */

/**
 * 
 * @param {Transaction[]} transactions 
 * @param {TransactionPositions[]} positions 
 * @returns {CombinedTransaction[]} Combines transactions with their corresponding positions by matching transFullId
 */
function combineTransactionsWithPositions(transactions, positions) {
    const transactionsWithPositions = transactions.map(transaction => {
        transaction.positions = positions.filter(position => position.transFullId === transaction.transFullId);
        return transaction;
    });
    return transactionsWithPositions;
}

/**
 * @typedef {CombinedTransaction & { positions: (TransactionPositions & { meal: Meal | null, meals: Meal[] | null })[] }} CombinedTransactionWithMeals
 */
/**
 * 
 * @param {CombinedTransaction[]} transactionsWithPositions 
 * @param {Meal[]} meals 
 * @returns {CombinedTransactionWithMeals[]}
 */
async function addMealsToCombinedTransactions(transactionsWithPositions, meals) {
    const mealsLocationDateNameMap = {};
    meals.forEach(meal => {
        const key = `${meal.locationInternalName}-${meal.date.toISOString().split("T")[0]}-${meal.internalCategory}`;
        mealsLocationDateNameMap[key] = meal;
    });
    await Promise.all(transactionsWithPositions.map(async transaction => {
        await Promise.all(transaction.positions.map(async position => {
            const key = `${transaction.ortName}-${transaction.datum.toISOString().split("T")[0]}-${position.name}`;
            position.meal = mealsLocationDateNameMap[key] || null;
            if (position.meal === null && position.name.includes("Essen")) {
                var locationId = locations.find(el => el.internalName == transaction.ortName)?.id || null;
                var data = await getMeals(locationId, transaction.datum)
                console.log(transaction.datum.toISOString(), data)
                position.meals = data || []; 
                console.log(position.meals);
            } else {
                position.meals = [];
            }
        }));
    }));
    return transactionsWithPositions;
}

/**
 * 
 * @param {CombinedTransactionWithMeals[] | CombinedTransaction[] | Transaction[]} transactions 
 * @returns {{[key: string]: CombinedTransactionWithMeals[] | CombinedTransaction[] | Transaction[]}} 
 */
function groupTransactionsByDay(transactions) {
    const transactionsByDay = {};
    transactions.forEach(transaction => {
        const d = transaction.datum;
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (!transactionsByDay[dateKey]) {
            transactionsByDay[dateKey] = [];
        }
        transactionsByDay[dateKey].push(transaction);
    });
    return transactionsByDay;
}

/**
 * 
 * @param {Meal[]} meals 
 * @returns {{[key: number]: {locationName: string, meals: Meal[]}}}
 */
function groupMealsByLocation(meals) {
    const mealsByLocation = {};
    meals.forEach(meal => {
        if (!mealsByLocation[meal.mensa_location_id]) {
            mealsByLocation[meal.mensa_location_id] = {
                locationName: meal.locationName,
                meals: []
            };
        }
        mealsByLocation[meal.mensa_location_id].meals.push(meal);
    });
    return mealsByLocation;
}
/**
 * 
 * @param {{id: number, name: string, internalName: string, mensaXMLId: number, openMensaId: number}[]} locations 
 */
function displayLocationSelector(locations) {
    const locationSelect = document.querySelector("#meals-view select#location-input");
    locationSelect.innerHTML = "<option value=''>Alle Standorte</option>";
    locations.forEach(location => {
        const option = document.createElement("option");
        option.value = location.id;
        option.textContent = location.name;
        locationSelect.appendChild(option);
    });
}

/**
 * 
 * @param {{id: number, name: string, internalName: string, mensaXMLId: number, openMensaId: number}[]} locations 
 */
function displayLocationTable(locations) {
    const locationTableBody = document.querySelector("#location-view div#location-list tbody");
    locationTableBody.innerHTML = "";
    locations.forEach(location => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${escapeHTML(location.name)}</td>
            <td>${location.internalName === null ? "-" : escapeHTML(location.internalName)}</td>
            <td>${location.openMensaId === null ? "-" : location.openMensaId}</td>
            <td>${location.mensaXMLId === null ? "-" : location.mensaXMLId}</td>
            <td><button data-id="${location.id}">Bearbeiten</button></td>
        `;
        locationTableBody.appendChild(row);
    });
}

/**
 * 
 * @param {{[key: number]: {locationName: string, meals: Meal[]}}} mealsByLocation 
 */
function displayMeals(mealsByLocation) {
    const locationContainer = document.querySelector("#meals-view div#location-list");
    locationContainer.innerHTML = "";
    for (const locationId in mealsByLocation) {
        var location = mealsByLocation[locationId];
        const locationDiv = document.createElement("div");
        locationDiv.classList.add("location-con");
        locationDiv.innerHTML = `
            <h3>${escapeHTML(location.locationName)}</h3>
            <div class="meals-list">
                ${getLocationMealHTML(location.meals)}
            </div>
        `;
        locationContainer.appendChild(locationDiv);
    }
}

/**
 * 
 * @param {Meal[]} meals 
 * @returns {string}
 */
function getLocationMealHTML(meals) {
    return meals.map(meal => {
        return `
            <div class="meal-con" data-meal-id="${meal.id}">
                <span class="meal-name">${escapeHTML(meal.name)}</span>
                <div class="meal-components-con">
                    ${meal.components.map(component => `<span>${escapeHTML(component)}</span>`).join("")}
                </div>
                <div class="meal-input">
                    <label for="">Int. Kateg.</label>
                    <input type="text" placeholder="-" value="${meal.internalCategory ? escapeHTML(meal.internalCategory) : ""}" data-original-value="${meal.internalCategory ? escapeHTML(meal.internalCategory) : ""}">
                    <button class="save-internal-category-btn" style="display: none;">Speichern</button>
                </div>
                <div class="meal-bottom">
                    <span class="meal-category">${escapeHTML(meal.category)}</span>
                    <span class="meal-price">${currencyFormatter.format(meal.prices.students)}</span>
                </div>
                <details class="meal-detail-con">
                    <summary>Details</summary>
                    <div class="meal-details">
                        ${getMealDetailsHTML(meal)}
                    </div>
                </details>
            </div>
        `;
    }).join("");
}

/**
 * 
 * @param {Meal} meal 
 * @returns {string}
 */
function getMealDetailsHTML(meal) {
    var notesHTML = meal.notes.length > 0 ? `
            <div class="meal-notes">
                <h4>Notizen</h4>
                <ul>
                    ${meal.notes.map(note => `<li>${escapeHTML(note)}</li>`).join("")}
                </ul>
            </div>
        ` : "<div class='meal-notes'></div>";
    var tagsHTML = meal.tags.length > 0 ? `
            <div class="meal-tags">
                <span>Tags:</span>
                ${meal.tags.map(tag => {
                    if (Array.isArray(tag)) {
                        return `
                                <div class="meal-tag-con">
                                    <span>${escapeHTML(tag[0])}:</span>
                                    <span>${escapeHTML(tag[1])}</span>
                                </div>`;
                    }
                    switch (typeof tag) {
                        case "string":
                            return `<span>${escapeHTML(tag)}</span>`;
                        case "object":
                            return `
                                <div class="meal-tag-con">
                                    <span>${escapeHTML(tag.type)}:</span>
                                    <span>${escapeHTML(tag.name)}</span>
                                </div>`;
                        default:
                            return `<span>${escapeHTML(tag)}</span>`;
                    }
                }).join("")}
            </div>
        ` : "<div class='meal-tags'></div>";
    return `
        <div class="meal-prices">
            <span>Studierende: <span class="meal-price-student">${currencyFormatter.format(meal.prices.students)}</span></span>
            <span>Angestellte: <span class="meal-price-employee">${currencyFormatter.format(meal.prices.employees)}</span></span>
            <span>Gäste: <span class="meal-price-guest">${currencyFormatter.format(meal.prices.others)}</span></span>
        </div>
        ${notesHTML}
        ${tagsHTML}
    `;
}

/**
 * 
 * @param {{[key: string]: CombinedTransactionWithMeals[] | CombinedTransaction[] | Transaction[]}} transactions Grouped transactions with meals
 */
function displayTransactions(transactions) {
    const transactionContainer = document.querySelector("#transaction-view div#transaction-list");
    transactionContainer.innerHTML = "";
    var days = Object.keys(transactions)
    days.sort((a, b) => new Date(b) - new Date(a));
    days.forEach(date => {
        var dailyTotal = transactions[date].reduce((total, transaction) => total + transaction.zahlBetrag, 0);

        const transactionDiv = document.createElement("div");
        transactionDiv.classList.add("transaction-day-con");
        transactionDiv.innerHTML = `
            <div class="transaction-day-header">
                <span class="transaction-date">${new Date(date).toLocaleDateString("de-DE", { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                <span class="transaction-day-total">${currencyFormatter.format(dailyTotal)}</span>
            </div>
            <div class="transaction-day-details">
                ${transactions[date].map(transaction => getTransactionHTML(transaction)).join("")}
            </div>
        `;
        transactionContainer.appendChild(transactionDiv);
    });
}

/**
 * 
 * @param {CombinedTransactionWithMeals} transaction 
 * @returns 
 */
function getTransactionHTML(transaction) {
    if (transaction.positions.length > 1) {
        var transactionTotal = transaction.positions.reduce((total, position) => total + position.gpreis, 0);
        return `
            <div class="transaction-con">
                <div class="transaction-con-header">
                    <div class="info-con">
                        <div class="horizontal-con">
                            <span>${transaction.datum.toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' })}</span>
                            <span class="type-span">${escapeHTML(transaction.typName)}</span>
                        </div>
                        <div class="location-con">
                            <span>${escapeHTML(locations.find(location => location.internalName === transaction.ortName)?.name || "Unbekannt")}</span>
                            <span>&middot;</span>
                            <span>${escapeHTML(transaction.kaName)}</span>
                        </div>
                    </div>
                    <div></div>
                    <span>${currencyFormatter.format(transactionTotal)}</span>
                </div>
                <div class="transaction-position-con">
                    ${transaction.positions.map(position => getTransactionPositionHTML(position)).join("")}
                </div>
            </div>
            `;
    } else if (transaction.positions.length === 1) {
        if (transaction.positions[0].meal !== null) {
            var html = `
                <div class="transaction-position-meal-reference">
                    <span>[${transaction.positions[0].meal.id}]</span>
                    <span>${escapeHTML(transaction.positions[0].meal.name)}</span>
                    <span>${escapeHTML(transaction.positions[0].meal.category)}</span>
                </div>
            `;
        } else if (transaction.positions[0].meal === null && transaction.positions[0].name.includes("Essen")) {
            var filteredMeals = transaction.positions[0].meals.filter(meal => Math.abs(meal.prices.students - transaction.positions[0].epreis) < 0.005);
            var optionHtml = filteredMeals.map(meal => {
                return `
                    <option value="${meal.id}">${escapeHTML(meal.name)} (${escapeHTML(meal.internalCategory || '-')} | ${currencyFormatter.format(meal.prices.students)} | ${escapeHTML(meal.category)})</option>
                `;
            }).join("");
            var html = `
                <div class="missing-transaction-position-meal-reference">
                    <select class="meal-reference-select" data-position-name="${escapeHTML(transaction.positions[0].name)}">
                        <option disabled selected>Essen zuordnen</option>
                        ${optionHtml}
                    </select>
                    <button class="save-meal-select-btn">Speichern</button>
                </div>
            `;
        } else {
            var html = `
                <div class="missing-transaction-position-meal-reference">
                </div>
            `;
        }
        return `
            <div class="transaction-con">
                <div class="transaction-con-header">
                    <div class="info-con">
                        <div class="horizontal-con">
                            <span>${transaction.datum.toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' })}</span>
                            <div class="type-con">
                                <span>${escapeHTML(transaction.typName)}</span>
                                <span>&middot;</span>
                                <span>${escapeHTML(transaction.positions[0].name)}</span>
                            </div>
                        </div>
                        <div class="location-con">
                            <span>${escapeHTML(locations.find(location => location.internalName === transaction.ortName)?.name || "Unbekannt")}</span>
                            <span>&middot;</span>
                            <span>${escapeHTML(transaction.kaName)}</span>
                        </div>
                    </div>
                    ${html}
                    <span>${currencyFormatter.format(transaction.positions[0].gpreis)}</span>
                </div>
            </div>
        `;
    } else {
        return "";
    }
}

/**
 * 
 * @param {TransactionPositions & {meal: Meal | null}} position 
 * @returns 
 */
function getTransactionPositionHTML(position) {
    if (position.meal !== null) {
        return `
            <div class="transaction-position">
                <div>
                    <span>${escapeHTML(position.name)}</span>
                    <span>${position.menge}x ${currencyFormatter.format(position.epreis)}</span>
                </div>
                <div class="transaction-position-meal-reference">
                    <span>[${position.meal.id}]</span>
                    <span>${escapeHTML(position.meal.name)}</span>
                    <span>${escapeHTML(position.meal.category)}</span>
                </div>
                <span>${currencyFormatter.format(position.gpreis)}</span>
            </div>`;
    } else if (position.name.includes("Essen") && position.meals !== undefined) {
        var filteredMeals = position.meals.filter(meal => Math.abs(meal.prices.students - position.epreis) < 0.005);
        var html = filteredMeals.map(meal => {
            return `
                <option value="${meal.id}">${escapeHTML(meal.name)} (${escapeHTML(meal.internalCategory || '-')} | ${currencyFormatter.format(meal.prices.students)} | ${escapeHTML(meal.category)})</option>
            `;
        }).join("");
        return `
            <div class="transaction-position">
                <div>
                    <span>${escapeHTML(position.name)}</span>
                    <span>${position.menge}x ${currencyFormatter.format(position.epreis)}</span>
                </div>
                <div class="missing-transaction-position-meal-reference">
                    <select class="meal-reference-select" data-position-name="${escapeHTML(position.name)}">
                        <option disabled selected>Essen zuordnen</option>
                        ${html}
                    </select>
                    <button class="save-meal-select-btn">Speichern</button>
                </div>
                <span>${currencyFormatter.format(position.gpreis)}</span>
            </div>
        `;
    } else {
        return `
            <div class="transaction-position">
                <div>
                    <span>${escapeHTML(position.name)}</span>
                    <span>${position.menge}x ${currencyFormatter.format(position.epreis)}</span>
                </div>
                <div class="missing-transaction-position-meal-reference">
                </div>
                <span>${currencyFormatter.format(position.gpreis)}</span>
            </div>
        `;
    }
}

function displayUnauthenticatedTransactions() {
    const transactionContainer = document.querySelector("#transaction-view div#transaction-list");
    transactionContainer.innerHTML = `
        <div class="unauthenticated-con">
            <span>Bitte melde dich an, um deine Transaktionen zu sehen.</span>
        </div>
    `;
}
async function transactionDiplayFlow() {
    if (cardnumber && password) {
        let transactions = await getTransactions(cardnumber, password);
        console.log(transactions);
        let transactionPositions = await getTransactionPositions(cardnumber, password);
        console.log(transactionPositions);
        let combinedTransactions = combineTransactionsWithPositions(transactions, transactionPositions);
        console.log(combinedTransactions);
        let cardMeals = await getCardMeals(cardnumber, password);
        let combinedTransactionsWithMeals = await addMealsToCombinedTransactions(combinedTransactions, cardMeals);
        console.log(combinedTransactionsWithMeals);
        console.log(combinedTransactionsWithMeals.filter(t => t.positions.some(p => p.meals === undefined)))
        allTransactions = groupTransactionsByDay(combinedTransactionsWithMeals);
        displayTransactions(allTransactions);
    } else {
        displayUnauthenticatedTransactions();
    }
}
async function mealsLocationsFlow() {
    locations = await getLocations();
    displayLocationSelector(locations);
    displayLocationTable(locations);
    console.log(locations);

    let meals = await getMeals(null, new Date());
    meals = groupMealsByLocation(meals);
    displayMeals(meals);
    console.log(meals);
}
function displayUnreachableHost() {
    const locationContainer = document.querySelector("#meals-view div#location-list");
    locationContainer.innerHTML = `
        <div class="unreachable-host-con">
            <span>Der Server ist nicht erreichbar. Bitte überprüfe die Host-URL und ob der Server läuft.</span>
        </div>
    `;
    const locationTableBody = document.querySelector("#location-view div#location-list tbody");
    locationTableBody.innerHTML = `
        <tr>
            <td colspan="5" class="unreachable-host-con">
                <span>Der Server ist nicht erreichbar. Bitte überprüfe die Host-URL und ob der Server läuft.</span>
            </td>
        </tr>
    `;
     const transactionContainer = document.querySelector("#transaction-view div#transaction-list");
     transactionContainer.innerHTML = `
        <div class="unreachable-host-con">
            <span>Der Server ist nicht erreichbar. Bitte überprüfe die Host-URL und ob der Server läuft.</span>
        </div>
    `;
}

async function loginFlow() {
    var cardIdInput = document.querySelector("#login-con input#card-id-input");
    var cardId = cardIdInput.value;

    var passwordInput = document.querySelector("#login-con input#password-input");
    var passwordValue = passwordInput.value;

    var response = await fetch(`${proto}://${host}/card`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            cardNumber: cardId,
            password: passwordValue
        })
    });
    var data = await response.json();
    if (response.status === 200) {
        console.log("Karte existiert bereits, Daten wurden aktualisiert");
        cardnumber = cardId;
        password = passwordValue;
        sessionStorage.setItem('cardnumber', cardId);
        sessionStorage.setItem('password', passwordValue);
        document.querySelector("#login-con").style.display = "none";
        document.querySelector("#action-con").style.display = "none";
        document.querySelector("#user-con").style.display = "";
        document.querySelector("#user-con span").textContent = cardId;
        try {
            await transactionDiplayFlow();
        } catch (error) {
            displayUnreachableHost();
        }
    } else if (response.status === 201) {
        console.log("Karte erfolgreich hinzugefügt");
        cardnumber = cardId;
        password = passwordValue;
        sessionStorage.setItem('cardnumber', cardId);
        sessionStorage.setItem('password', passwordValue);
        document.querySelector("#login-con").style.display = "none";
        document.querySelector("#action-con").style.display = "none";
        document.querySelector("#user-con").style.display = "";
        document.querySelector("#user-con span").textContent = cardId;
        try {
            await transactionDiplayFlow();
        } catch (error) {
            displayUnreachableHost();
        }
    } else if (response.status === 400 && data.error === "cardNumber and password are required") {
        console.log("Ungültige Eingabe, bitte überprüfe deine Anmeldedaten");
        document.querySelector("#login-error-con").innerHTML = "<span>Bitte Karten-Nummer und Passwort eingeben.</span>";
        setTimeout(() => { document.querySelector("#login-error-con").innerHTML = ""; }, 5000);
    } else if (response.status === 400 && data.error.startsWith("Invalid card credentials")) {
        console.log("Ungültige Kartendaten und konnte nicht mit den Kartenservice validiert werden, bitte überprüfe deine Anmeldedaten");
        document.querySelector("#login-error-con").innerHTML = "<span>Ungültige Anmeldedaten. Bitte überprüfe Karten-Nummer und Passwort.</span>";
        setTimeout(() => { document.querySelector("#login-error-con").innerHTML = ""; }, 5000);
    } else {
        console.log("Unbekannter Fehler, bitte versuche es später erneut");
        document.querySelector("#login-error-con").innerHTML = "<span>Unbekannter Fehler. Bitte versuche es später erneut.</span>";
        setTimeout(() => { document.querySelector("#login-error-con").innerHTML = ""; }, 5000);
    }
}

function changeView(viewId) {
    document.querySelectorAll("body > div:not(#intro-overlay)").forEach(div => {
        if (div.id === viewId) {
            div.style.display = "";
        } else {
            div.style.display = "none";
        }
    });
    document.querySelectorAll("aside nav span").forEach(span => {
        if (span.dataset.view === viewId) {
            span.classList.add("active");
        } else {
            span.classList.remove("active");
        }
    });
}

document.querySelectorAll("aside nav span").forEach(button => {
    button.addEventListener("click", (event) => {
        const viewId = event.target.dataset.view;
        changeView(viewId);
    });
});
changeView("meals-view");

(async () => {
    if (cardnumber && password) {
        document.querySelector("#login-con").style.display = "none";
        document.querySelector("#action-con").style.display = "none";
        document.querySelector("#user-con").style.display = "";
    }

    host = getAutoHost();
    document.querySelector("#host-input").value = host;
    console.log("Aktueller Host:", host);
    try {
        proto = await detectProto(host);
        await mealsLocationsFlow();
        await transactionDiplayFlow();
    } catch (error) {
        displayUnreachableHost();
    }

    document.querySelector("#meals-view select#location-input").addEventListener("change", async (event) => {
        var dateValue = document.querySelector("#meals-view input#date-input").value;
        const date = dateValue == "" ? new Date() : new Date(dateValue + "T00:00:00");
        const locationId = event.target.value;
        let meals = await getMeals(locationId === "" ? null : locationId, date);
        meals = groupMealsByLocation(meals);
        displayMeals(meals);
        console.log(meals);
    });
    document.querySelector("#meals-view input#date-input").addEventListener("change", async (event) => {
        var dateValue = event.target.value;
        const date = dateValue == "" ? new Date() : new Date(dateValue + "T00:00:00");
        const locationId = document.querySelector("#meals-view select#location-input").value;
        let meals = await getMeals(locationId === "" ? null : locationId, date);
        meals = groupMealsByLocation(meals);
        displayMeals(meals);
        console.log(meals);
    });
    document.querySelector("#host-input").addEventListener("change", async (event) => {
        console.log("Host geändert zu:", event.target.value);
        try {
            host = event.target.value;
            proto = await detectProto(host);
            await mealsLocationsFlow();
            await transactionDiplayFlow();
        } catch (error) {
            displayUnreachableHost();
            if (event.target.value === getAutoHost()) {
                document.querySelector("#host-error-con").innerHTML = "<span>Fehler beim Verbinden mit dem Server.<br>Bitte stelle sicher, dass der Server läuft und die Host-URL korrekt ist.</span>";
            } else {
                document.querySelector("#host-error-con").innerHTML = "<span>Fehler beim Verbinden mit dem Server.<br>Bitte überprüfe die Host-URL und ob der Server CORS-Anfragen erlaubt.</span>";
            }
            setTimeout(() => {
                document.querySelector("#host-error-con").innerHTML = "";
            }, 5000);
        }
    });
    document.querySelector("#host-con span").addEventListener("click", async () => {
        host = getAutoHost();
        document.querySelector("#host-input").value = host;
        proto = await detectProto(host);
        try {
            await mealsLocationsFlow();
            await transactionDiplayFlow();
        } catch (error) {
            displayUnreachableHost();
        }
    });

    document.querySelector("form#login-con").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await loginFlow();
        } catch (error) {
            displayUnreachableHost();
        }
    });
    document.querySelector("#user-con span").addEventListener("click", () => {
        if (document.querySelector("#action-con").style.display === "none") {
            document.querySelector("#action-con").style.display = "";
        } else {
            document.querySelector("#action-con").style.display = "none";
        }
    });
    document.querySelector("#user-con button").addEventListener("click", () => {
        cardnumber = null;
        password = null;
        sessionStorage.removeItem('cardnumber');
        sessionStorage.removeItem('password');
        document.querySelector("#login-con").style.display = "";
        document.querySelector("#action-con").style.display = "none";
        document.querySelector("#user-con").style.display = "none";
        displayUnauthenticatedTransactions();
    });
    document.querySelector("dialog button#confirm-delete-card-btn").addEventListener("click", async () => {
        var response = await fetch(`${proto}://${host}/card`, {
            method: "DELETE",
            body: JSON.stringify({
                cardNumber: cardnumber
            }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
            }
        });
        if (response.status === 200) {
            console.log("Karte erfolgreich gelöscht");
            cardnumber = null;
            password = null;
            sessionStorage.removeItem('cardnumber');
            sessionStorage.removeItem('password');
            document.querySelector("#login-con").style.display = "";
            document.querySelector("#action-con").style.display = "none";
            document.querySelector("#user-con").style.display = "none";
            displayUnauthenticatedTransactions();
        } else {
            console.log("Fehler beim Löschen der Karte, bitte versuche es später erneut");
        }
        document.querySelector("dialog").hidePopover();
    });

    document.querySelector("#meals-view div#location-list").addEventListener("input", (event) => {
        if (event.target.matches(".meal-input input[type='text']")) {
            const input = event.target;
            const btn = input.closest(".meal-input").querySelector(".save-internal-category-btn");
            btn.style.display = input.value !== input.dataset.originalValue ? "" : "none";
        }
    });
    document.querySelector("#meals-view div#location-list").addEventListener("click", async (event) => {
        if (event.target.matches(".save-internal-category-btn")) {
            const btn = event.target;
            const input = btn.closest(".meal-input").querySelector("input");
            const mealId = btn.closest("[data-meal-id]").dataset.mealId;
            await updateMealInternalCategory(Number(mealId), input.value);
            input.dataset.originalValue = input.value;
            btn.style.display = "none";
        }
    });

    document.querySelector("#location-view #add-location-btn").addEventListener("click", async () => {
        var name = document.querySelector("#location-view #location-name-input").value.trim();
        if (!name) {
            document.querySelector("#location-error-con").innerHTML = "<span>Bitte einen Namen angeben.</span>";
            setTimeout(() => { document.querySelector("#location-error-con").innerHTML = ""; }, 5000);
            return;
        }
        var internalName = document.querySelector("#location-view #location-internal-name-input").value.trim() || null;
        var openMensaIdStr = document.querySelector("#location-view #location-openmensa-id-input").value.trim();
        var mensaXMLIdStr = document.querySelector("#location-view #location-studenwerk-id-input").value.trim();
        var openMensaId = openMensaIdStr ? Number(openMensaIdStr) : null;
        var mensaXMLId = mensaXMLIdStr ? Number(mensaXMLIdStr) : null;
        var response = await fetch(`${proto}://${host}/locations`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ name, internalName, openMensaId, mensaXMLId })
        });
        if (response.status === 201) {
            locations = await getLocations();
            displayLocationTable(locations);
            displayLocationSelector(locations);
            document.querySelector("#location-view #location-name-input").value = "";
            document.querySelector("#location-view #location-internal-name-input").value = "";
            document.querySelector("#location-view #location-openmensa-id-input").value = "";
            document.querySelector("#location-view #location-studenwerk-id-input").value = "";
        } else {
            const msg = await response.json().then(d => d.error || d.message).catch(() => null);
            document.querySelector("#location-error-con").innerHTML = `<span>Fehler beim Speichern${msg ? ": " + escapeHTML(msg) : " (" + response.status + ")"}</span>`;
            setTimeout(() => { document.querySelector("#location-error-con").innerHTML = ""; }, 5000);
        }
    });

    document.querySelector("#transaction-query button").addEventListener("click", () => {
        document.querySelector("#transaction-date-input").value = "";
        displayTransactions(allTransactions);
    });
    document.querySelector("#transaction-date-input").addEventListener("change", (event) => {
        var dateValue = event.target.value;
        if (dateValue === "") {
            displayTransactions(allTransactions);
        } else {
            var filtered = {};
            if (allTransactions[dateValue]) {
                filtered[dateValue] = allTransactions[dateValue];
            }
            displayTransactions(filtered);
        }
    });

    document.querySelector("#transaction-view div#transaction-list").addEventListener("click", async (event) => {
        if (event.target.matches(".save-meal-select-btn")) {
            const btn = event.target;
            const select = btn.closest(".missing-transaction-position-meal-reference").querySelector(".meal-reference-select");
            const mealId = select.value;
            const positionName = select.dataset.positionName;
            if (!mealId || mealId === "") return;
            await updateMealInternalCategory(Number(mealId), positionName);
            btn.textContent = "Gespeichert";
            btn.disabled = true;
        }
    });

    /**
     * Runs a sync by connecting to an SSE endpoint and streaming progress to the UI.
     * @param {string} url SSE endpoint URL (full, including host)
     * @param {string|null} authToken Base64-encoded "cardnumber:password" for authenticated endpoints, or null
     * @param {HTMLButtonElement} btn
     * @param {HTMLElement} statusEl
     */
    function runSyncSSE(url, authToken, btn, statusEl) {
        const progressCon = document.querySelector(`#${statusEl.id.replace('-status', '-progress')}`);
        const progressBar = progressCon?.querySelector('.sync-progress-bar');

        /** @param {number} pct 0–100 */
        function setProgress(pct) {
            if (!progressCon || !progressBar) return;
            progressCon.classList.remove('indeterminate');
            progressBar.style.width = `${pct}%`;
        }
        function setIndeterminate() {
            if (!progressCon || !progressBar) return;
            progressBar.style.width = '';
            progressCon.classList.add('indeterminate');
        }
        function showProgress() {
            progressCon?.classList.add('active');
            setIndeterminate();
        }
        function hideProgress() {
            progressCon?.classList.remove('active', 'indeterminate');
            if (progressBar) progressBar.style.width = '';
        }

        if (authToken) {
            const urlObj = new URL(url);
            urlObj.searchParams.set('token', authToken);
            url = urlObj.toString();
        }

        btn.disabled = true;
        statusEl.textContent = "Verbinde...";
        showProgress();

        console.log(url);
        const es = new EventSource(url);
        let finished = false;

        function finish(message, isError = false) {
            if (finished) return;
            finished = true;
            es.close();
            statusEl.textContent = message;
            btn.disabled = false;
            if (isError) hideProgress();
        }

        es.addEventListener('progress', (e) => {
            const payload = JSON.parse(/** @type {MessageEvent} */ (e).data);
            statusEl.textContent = payload.total
                ? `${payload.message} (${payload.done}/${payload.total})`
                : payload.message;
            if (payload.total) {
                setProgress((payload.done / payload.total) * 100);
            } else {
                setIndeterminate();
            }
        });

        es.addEventListener('done', () => {
            if (finished) return;
            finished = true;
            es.close();
            setProgress(100);
            statusEl.textContent = "Fertig";
            btn.disabled = false;
            setTimeout(() => hideProgress(), 800);
        });

        es.addEventListener('error', (e) => {
            if (e instanceof MessageEvent) {
                try {
                    const payload = JSON.parse(e.data);
                    finish(`Fehler: ${payload.message}`, true);
                } catch {
                    finish("Serverfehler", true);
                }
            } else {
                finish(finished ? "" : "Verbindung unterbrochen", !finished);
            }
        });
    }

    document.querySelector("#sync-open-mensa-btn").addEventListener("click", () => {
        runSyncSSE(
            `${proto}://${host}/fetch/open-mensa/sse`,
            null,
            document.querySelector("#sync-open-mensa-btn"),
            document.querySelector("#sync-open-mensa-status")
        );
    });

    document.querySelector("#sync-mensa-xml-btn").addEventListener("click", () => {
        runSyncSSE(
            `${proto}://${host}/fetch/mensa-xml/sse`,
            null,
            document.querySelector("#sync-mensa-xml-btn"),
            document.querySelector("#sync-mensa-xml-status")
        );
    });

    document.querySelector("#sync-kartenservice-btn").addEventListener("click", () => {
        const statusEl = document.querySelector("#sync-kartenservice-status");
        if (!cardnumber || !password) {
            statusEl.textContent = "Bitte zuerst anmelden.";
            return;
        }
        runSyncSSE(
            `${proto}://${host}/fetch/kartenservice/sse?cardNumber=${encodeURIComponent(cardnumber)}`,
            btoa(cardnumber + ":" + password),
            document.querySelector("#sync-kartenservice-btn"),
            statusEl
        );
    });

    document.querySelector("#sync-meals-btn").addEventListener("click", () => {
        const hostUrl = document.querySelector("#sync-meals-host-input").value.trim();
        if (!hostUrl) return;
        runSyncSSE(
            `${proto}://${host}/sync/host/meals/sse?hostUrl=${encodeURIComponent(hostUrl)}`,
            null,
            document.querySelector("#sync-meals-btn"),
            document.querySelector("#sync-meals-status")
        );
    });

    document.querySelector("#sync-transactions-btn").addEventListener("click", () => {
        const statusEl = document.querySelector("#sync-transactions-status");
        if (!cardnumber || !password) {
            statusEl.textContent = "Bitte zuerst anmelden.";
            return;
        }
        const hostUrl = document.querySelector("#sync-transactions-host-input").value.trim();
        if (!hostUrl) return;
        runSyncSSE(
            `${proto}://${host}/sync/host/transactions/sse?hostUrl=${encodeURIComponent(hostUrl)}&cardNumber=${encodeURIComponent(cardnumber)}`,
            btoa(cardnumber + ":" + password),
            document.querySelector("#sync-transactions-btn"),
            statusEl
        );
    });

    // Introduction overlay
    const introOverlay = document.querySelector("#intro-overlay");
    const introCloseBtn = document.querySelector("#intro-close-btn");
    const introDontShowAgain = document.querySelector("#intro-dont-show-again");

    if (localStorage.getItem("introSeen") !== "true") {
        introOverlay.classList.remove("hidden");
    } else {
        introOverlay.classList.add("hidden");
    }

    introCloseBtn.addEventListener("click", () => {
        if (introDontShowAgain.checked) {
            localStorage.setItem("introSeen", "true");
        }
        introOverlay.classList.add("hidden");
    });

    introOverlay.addEventListener("click", (event) => {
        if (event.target === introOverlay) {
            if (introDontShowAgain.checked) {
                localStorage.setItem("introSeen", "true");
            }
            introOverlay.classList.add("hidden");
        }
    });
})();