// On page load or when changing themes, best to add inline in `head` to avoid FOUC
document.documentElement.classList.toggle(
    "dark",
    localStorage.theme === "dark" ||
        (!("theme" in localStorage) && window.matchMedia("(prefers-color-scheme: dark)").matches)
,);

let host = "localhost:3001";

let cardnumber;
let password;

let locations = [];
let allTransactions = {};

const currencyFormatter = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR"
});

/**
 * 
 * @returns {Promise<{id: number, name: string, internalName: string, mensaXMLId: number, openMensaId: number}[]>}
 */
async function getLocations() {
    var response = await fetch(`http://${host}/locations`);
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
        var response = await fetch(`http://${host}/meals/${date.toISOString().split("T")[0]}`);
    } else if (name === null) {
        var response = await fetch(`http://${host}/meals/${date.toISOString().split("T")[0]}/${locationId}`);
    } else {
        var response = await fetch(`http://${host}/meals/${date.toISOString().split("T")[0]}/${locationId}/${encodeURIComponent(name)}`);
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
        var response = await fetch(`http://${host}/meals/card/${cardnumber}`, {
            headers: {
                "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
            }
        });
    } else {
        var response = await fetch(`http://${host}/meals/card/${cardnumber}/${date.toISOString().split("T")[0]}`, {
            headers: {
                "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
            }
        });
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
 * @param {number} mealId
 * @param {string} internalCategory
 */
async function updateMealInternalCategory(mealId, internalCategory) {
    var response = await fetch(`http://${host}/meals/${mealId}`, {
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
    var response = await fetch(`http://${host}/trans/${cardnumber}`, {
        headers: {
            "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
        }
    });
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
    var response = await fetch(`http://${host}/transpos/${cardnumber}`, {
        headers: {
            "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
        }
    });
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
        const dateKey = transaction.datum.toISOString().split("T")[0];
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
            <td>${location.name}</td>
            <td>${location.internalName === null ? "-" : location.internalName}</td>
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
            <h3>${location.locationName}</h3>
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
                <span class="meal-name">${meal.name}</span>
                <div class="meal-components-con">
                    ${meal.components.map(component => `<span>${component}</span>`).join("")}
                </div>
                <div class="meal-input">
                    <label for="">Int. Kateg.</label>
                    <input type="text" placeholder="-" value="${meal.internalCategory ? meal.internalCategory : ""}" data-original-value="${meal.internalCategory ? meal.internalCategory : ""}">
                    <button class="save-internal-category-btn" style="display: none;">Speichern</button>
                </div>
                <div class="meal-bottom">
                    <span class="meal-category">${meal.category}</span>
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
                    ${meal.notes.map(note => `<li>${note}</li>`).join("")}
                </ul>
            </div>
        ` : "<div class='meal-notes'></div>";
    var tagsHTML = meal.tags.length > 0 ? `
            <div class="meal-tags">
                <span>Tags:</span>
                ${meal.tags.map(tag => {
                    switch (typeof tag) {
                        case "string":
                            return `<span>${tag}</span>`;
                            break;
                        case "object":
                            return `
                                <div class="meal-tag-con">
                                    <span>${tag.type}:</span>
                                    <span>${tag.name}</span>
                                </div>`;
                            break;
                        case "array":
                            return `
                                <div class="meal-tag-con">
                                    <span>${tag[0]}:</span>
                                    <span>${tag[1]}</span>
                                </div>`;
                            break;
                        default:
                            return `<span>${tag}</span>`;
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
                            <span class="type-span">${transaction.typName}</span>
                        </div>
                        <div class="location-con">
                            <span>${locations.find(location => location.internalName === transaction.ortName)?.name || "Unbekannt"}</span>
                            <span>&middot;</span>
                            <span>${transaction.kaName}</span>
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
                    <span>${transaction.positions[0].meal.name}</span>
                    <span>${transaction.positions[0].meal.category}</span>
                </div>
            `;
        } else if (transaction.positions[0].meal === null && transaction.positions[0].name.includes("Essen")) {
            var filteredMeals = transaction.positions[0].meals.filter(meal => Math.abs(meal.prices.students - transaction.positions[0].epreis) < 0.005);
            var optionHtml = filteredMeals.map(meal => {
                return `
                    <option value="${meal.id}">${meal.name} (${meal.internalCategory || '-'} | ${currencyFormatter.format(meal.prices.students)} | ${meal.category})</option>
                `;
            }).join("");
            var html = `
                <div class="missing-transaction-position-meal-reference">
                    <select class="meal-reference-select" data-position-name="${transaction.positions[0].name}">
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
                                <span>${transaction.typName}</span>
                                <span>&middot;</span>
                                <span>${transaction.positions[0].name}</span>
                            </div>
                        </div>
                        <div class="location-con">
                            <span>${locations.find(location => location.internalName === transaction.ortName)?.name || "Unbekannt"}</span>
                            <span>&middot;</span>
                            <span>${transaction.kaName}</span>
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
                    <span>${position.name}</span>
                    <span>${position.menge}x ${currencyFormatter.format(position.epreis)}</span>
                </div>
                <div class="transaction-position-meal-reference">
                    <span>[${position.meal.id}]</span>
                    <span>${position.meal.name}</span>
                    <span>${position.meal.category}</span>
                </div>
                <span>${currencyFormatter.format(position.gpreis)}</span>
            </div>`;
    } else if (position.name.includes("Essen") && position.meals !== undefined) {
        var filteredMeals = position.meals.filter(meal => Math.abs(meal.prices.students - position.epreis) < 0.005);
        var html = filteredMeals.map(meal => {
            return `
                <option value="${meal.id}">${meal.name} (${meal.internalCategory || '-'} | ${currencyFormatter.format(meal.prices.students)} | ${meal.category})</option>
            `;
        }).join("");
        return `
            <div class="transaction-position">
                <div>
                    <span>${position.name}</span>
                    <span>${position.menge}x ${currencyFormatter.format(position.epreis)}</span>
                </div>
                <div class="missing-transaction-position-meal-reference">
                    <select class="meal-reference-select" data-position-name="${position.name}">
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
                    <span>${position.name}</span>
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
function transactionDiplayFlow() {
    if (cardnumber && password) {
        (async () => {
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
        })();
    } else {
        displayUnauthenticatedTransactions();
    }
}
async function mealsLocationsFlow() {
    locations = await getLocations();
    displayLocationSelector(locations);
    displayLocationTable(locations);
    console.log(locations);

    let meals = await getMeals(null,new Date("2026-05-13"));
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

    var response = await fetch(`http://${host}/card`, {
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
        document.querySelector("#login-con").style.display = "none";
        document.querySelector("#action-con").style.display = "none";
        document.querySelector("#user-con").style.display = "";
        try {
            await transactionDiplayFlow();
        } catch (error) {
            displayUnreachableHost();
        }
    } else if (response.status === 201) {
        console.log("Karte erfolgreich hinzugefügt");
        cardnumber = cardId;
        password = passwordValue;
        document.querySelector("#login-con").style.display = "none";
        document.querySelector("#action-con").style.display = "none";
        document.querySelector("#user-con").style.display = "";
        try {
            await transactionDiplayFlow();
        } catch (error) {
            displayUnreachableHost();
        }
    } else if (response.status === 400 && data.error === "cardNumber and password are required") {
        console.log("Ungültige Eingabe, bitte überprüfe deine Anmeldedaten");
    } else if (response.status === 400 && data.error.startsWith("Invalid card credentials")) {   
        console.log("Ungültige Kartendaten und konnte nicht mit den Kartenservice validiert werden, bitte überprüfe deine Anmeldedaten");
    } else {
        console.log("Unbekannter Fehler, bitte versuche es später erneut");
    }
}

function changeView(viewId) {
    document.querySelectorAll("body > div").forEach(div => {
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
    try {
        await mealsLocationsFlow();
        await transactionDiplayFlow();
    } catch (error) {
        displayUnreachableHost();
    }

    document.querySelector("#meals-view select#location-input").addEventListener("change", async (event) => {
        var dateValue = document.querySelector("#meals-view input#date-input").value;
        const date = dateValue == "" ? new Date() : new Date(dateValue);
        const locationId = event.target.value;
        let meals = await getMeals(locationId === "" ? null : locationId, date);
        meals = groupMealsByLocation(meals);
        displayMeals(meals);
        console.log(meals);
    });
    document.querySelector("#meals-view input#date-input").addEventListener("change", async (event) => {
        var dateValue = event.target.value;
        const date = dateValue == "" ? new Date() : new Date(dateValue);
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
            await mealsLocationsFlow();
            await transactionDiplayFlow();
        } catch (error) {
            displayUnreachableHost();
            if (event.target.value === window.location.host) {
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
        document.querySelector("#host-input").value = window.location.host;
        host = window.location.host;
        try {
            await mealsLocationsFlow();
            await transactionDiplayFlow();
        } catch (error) {
            displayUnreachableHost();
        }
    });

    document.querySelector("#login-con button").addEventListener("click", async () => {
        try {
            await loginFlow();
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
        document.querySelector("#login-con").style.display = "";
        document.querySelector("#action-con").style.display = "none";
        document.querySelector("#user-con").style.display = "none";
        displayUnauthenticatedTransactions();
    });
    document.querySelector("dialog button#confirm-delete-card-btn").addEventListener("click", async () => {
        var response = await fetch(`http://${host}/card`, {
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
        var internalName = document.querySelector("#location-view #location-internal-name-input").value.trim() || null;
        var openMensaIdStr = document.querySelector("#location-view #location-openmensa-id-input").value.trim();
        var mensaXMLIdStr = document.querySelector("#location-view #location-studenwerk-id-input").value.trim();
        var openMensaId = openMensaIdStr ? Number(openMensaIdStr) : null;
        var mensaXMLId = mensaXMLIdStr ? Number(mensaXMLIdStr) : null;
        var response = await fetch(`http://${host}/locations`, {
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

    document.querySelector("#sync-meals-btn").addEventListener("click", async () => {
        const hostUrl = document.querySelector("#sync-meals-host-input").value.trim();
        if (!hostUrl) return;
        const btn = document.querySelector("#sync-meals-btn");
        btn.disabled = true;
        btn.textContent = "Wird geladen...";
        try {
            var response = await fetch(`http://${host}/sync/host/meals`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hostUrl })
            });
            if (response.status === 202) {
                btn.textContent = "Gestartet";
            } else {
                var data = await response.json();
                btn.textContent = `Fehler: ${data.error}`;
                btn.disabled = false;
            }
        } catch {
            btn.textContent = "Fehler";
            btn.disabled = false;
        }
    });

    document.querySelector("#sync-transactions-btn").addEventListener("click", async () => {
        if (!cardnumber || !password) {
            alert("Bitte zuerst anmelden.");
            return;
        }
        const hostUrl = document.querySelector("#sync-transactions-host-input").value.trim();
        if (!hostUrl) return;
        const btn = document.querySelector("#sync-transactions-btn");
        btn.disabled = true;
        btn.textContent = "Wird geladen...";
        try {
            var response = await fetch(`http://${host}/sync/host/transactions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Basic ${btoa(cardnumber + ":" + password)}`
                },
                body: JSON.stringify({ hostUrl, cardNumber: cardnumber })
            });
            if (response.status === 202) {
                btn.textContent = "Gestartet";
            } else {
                var data = await response.json();
                btn.textContent = `Fehler: ${data.error}`;
                btn.disabled = false;
            }
        } catch {
            btn.textContent = "Fehler";
            btn.disabled = false;
        }
    });
})();