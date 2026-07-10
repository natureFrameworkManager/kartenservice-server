// Dark mode
document.documentElement.classList.toggle(
    "dark",
    localStorage.theme === "dark" ||
        (!("theme" in localStorage) && window.matchMedia("(prefers-color-scheme: dark)").matches)
);

let host = "";
let proto = "";
let cardnumber = sessionStorage.getItem("cardnumber");
let password = sessionStorage.getItem("password");
let statsData = null;
let activeTab = "overview";
let charts = {};

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAY_LABELS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

function escapeHTML(str) {
    return String(str == null ? "" : str)
        .replace(/&/g, "\x26amp;")
        .replace(/</g, "\x26lt;")
        .replace(/>/g, "\x26gt;")
        .replace(/"/g, "\x26quot;")
        .replace(/'/g, "\x26#39;");
}

function getAutoHost() {
    const basePath = window.location.pathname.replace(/\/stats\/?$/, "").replace(/\/$/, "");
    return window.location.host + basePath;
}

async function detectProto(hostName) {
    try {
        await fetch(`https://${hostName}/locations`, { method: "HEAD" });
        return "https";
    } catch {
        try {
            const r = await fetch(`http://${hostName}/locations`, { method: "HEAD", redirect: "follow" });
            return r.url.startsWith("https://") ? "https" : "http";
        } catch { return "http"; }
    }
}

async function fetchStats(cardnumber, password) {
    const resp = await fetch(`${proto}://${host}/card/${cardnumber}/stats`, {
        headers: { "Authorization": `Basic ${btoa(cardnumber + ":" + password)}` }
    });
    if (!resp.ok) throw new Error(`Stats fetch failed: ${resp.status}`);
    return resp.json();
}

function destroyCharts() {
    Object.values(charts).forEach(c => c.destroy());
    charts = {};
}

// === Chart helpers ===
function chartColors() {
    const dark = document.documentElement.classList.contains("dark");
    return {
        text: dark ? "oklch(0.967 0.001 286.375)" : "oklch(0.21 0.034 264.665)",
        grid: dark ? "oklch(0.274 0.006 286.033)" : "oklch(0.872 0.01 258.338)",
        blue: dark ? "oklch(0.596 0.145 163.225)" : "oklch(0.546 0.245 262.881)",
        blueAlpha: dark ? "rgba(98,195,163,0.3)" : "rgba(37,99,235,0.3)",
        colors: dark
            ? ["oklch(0.596 0.145 163.225)", "oklch(0.7 0.14 50)", "oklch(0.6 0.18 300)", "oklch(0.65 0.16 200)", "oklch(0.7 0.1 100)"]
            : ["oklch(0.546 0.245 262.881)", "oklch(0.637 0.237 25.331)", "oklch(0.5 0.2 300)", "oklch(0.6 0.16 200)", "oklch(0.65 0.1 100)"]
    };
}

function barChart(canvasId, labels, datasets, options = {}) {
    const c = chartColors();
    const ctx = document.getElementById(canvasId).getContext("2d");
    charts[canvasId] = new Chart(ctx, {
        type: "bar",
        data: { labels, datasets: datasets.map((ds, i) => ({ ...ds, backgroundColor: ds.backgroundColor || c.colors[i % c.colors.length] })) },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: c.text } } },
            scales: {
                x: { ticks: { color: c.text, maxRotation: 60 }, grid: { color: c.grid } },
                y: { ticks: { color: c.text }, grid: { color: c.grid } }
            },
            ...options
        }
    });
}

function lineChart(canvasId, labels, datasets, options = {}) {
    const c = chartColors();
    const ctx = document.getElementById(canvasId).getContext("2d");
    charts[canvasId] = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: datasets.map((ds, i) => ({
                ...ds,
                borderColor: ds.borderColor || c.colors[i % c.colors.length],
                backgroundColor: ds.backgroundColor || (c.colors[i % c.colors.length] + "33"),
                tension: 0.3,
                fill: false
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: c.text } } },
            scales: {
                x: { ticks: { color: c.text, maxRotation: 60 }, grid: { color: c.grid } },
                y: { ticks: { color: c.text }, grid: { color: c.grid } }
            },
            ...options
        }
    });
}

function heatmapTable(containerId, data, xLabels, yLabels, valueFn, options = {}) {
    const { title, formatVal } = options;
    const max = Math.max(...Object.values(data).map(valueFn).filter(v => v > 0), 1);
    let html = "";
    if (title) html += `<h3 class="text-lg font-semibold mb-3">${title}</h3>`;
    html += `<div class="overflow-x-auto"><table class="w-full text-xs border-collapse"><thead><tr><th class="p-1 border border-gray-300 dark:border-gray-600 sticky left-0 bg-white dark:bg-[oklch(21%_0.006_285.885)] z-10"></th>`;
    xLabels.forEach(x => html += `<th class="p-1 border border-gray-300 dark:border-gray-600 whitespace-nowrap">${escapeHTML(x)}</th>`);
    html += "</tr></thead><tbody>";
    yLabels.forEach(y => {
        html += `<tr><td class="p-1 border border-gray-300 dark:border-gray-600 font-medium sticky left-0 bg-white dark:bg-[oklch(21%_0.006_285.885)] whitespace-nowrap">${escapeHTML(y)}</td>`;
        xLabels.forEach(x => {
            const val = valueFn(data, y, x);
            const intensity = max > 0 ? val / max : 0;
            const alpha = intensity * 0.7;
            html += `<td class="p-1 border border-gray-300 dark:border-gray-600 text-center" style="background-color:rgba(37,99,235,${alpha})">${formatVal ? formatVal(val) : numberFormatter.format(val)}</td>`;
        });
        html += "</tr>";
    });
    html += "</tbody></table></div>";
    document.getElementById(containerId).innerHTML = html;
}

function formatMoney(v) { return currencyFormatter.format(v); }
function formatNum(v) { return numberFormatter.format(v); }

// === Build Overview ===
function buildOverview() {
    const sa = statsData["spend-amounts"];
    const sc = statsData["spend-counts"];
    const tc = statsData["transaction-counts"];
    const vc = statsData["visits-counts"];
    const vs = statsData["visit-streaks"];
    const ta = statsData["top-up-amounts"];
    const tuc = statsData["top-up-counts"];

    const cards = [
        { label: "Gesamtausgaben", value: formatMoney(sa.total), sub: `${sc.total} Zahlungen` },
        { label: "Transaktionen", value: tc.total, sub: `Ø ${formatMoney(statsData["transaction-amount-averages"].total)}` },
        { label: "Besuche", value: vc.total, sub: `${Object.keys(sa.days).length} Tage` },
        { label: "Guthaben aufgeladen", value: formatMoney(ta.total), sub: `${tuc.total} Aufladungen, Ø ${formatMoney(statsData["top-up-amount-averages"].total)}` },
        { label: "Längste Besuchsserie", value: `${vs.longest} Tage`, sub: `Aktuell: ${vs.current} Tage` },
        { label: "Max pro Transaktion", value: formatMoney(sa["max-per-transaction"]), sub: `Ø Ausgabe: ${formatMoney(statsData["spend-amount-averages"].total)}` },
        { label: "Längste Serie (ohne WE)", value: `${vs["longest-without-weekends"]} Tage`, sub: `Ohne geschlossen: ${vs["longest-without-closed"]} Tage` },
    ];

    document.getElementById("overview-cards").innerHTML = cards.map(c => `
        <div class="stat-card bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-5 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">${c.label}</p>
            <p class="text-2xl font-bold">${c.value}</p>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">${c.sub}</p>
        </div>
    `).join("");
}

// === Tab: Time Overview ===
function buildTimeOverview() {
    destroyCharts();
    const sa = statsData["spend-amounts"];
    const html = [];

    // Time distribution
    const timeSlots = Object.keys(sa.time).filter(k => sa.time[k] > 0 || k.startsWith("12:") || k.startsWith("13:"));
    if (timeSlots.length === 0) timeSlots.push(...Object.keys(sa.time).slice(44, 72));
    const timeLabels = timeSlots.map(t => t.slice(0, 5));
    const timeValues = timeSlots.map(t => sa.time[t]);

    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Ausgaben nach Tageszeit</h3>
        <div style="height:350px"><canvas id="chart-time"></canvas></div>
    </div>`);

    // Weekday distribution
    const wdValues = WEEKDAYS.map(d => sa.weekdays[d] || 0);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Ausgaben nach Wochentag</h3>
        <div style="height:300px"><canvas id="chart-weekday"></canvas></div>
    </div>`);

    // Top times insight
    const sortedTimes = Object.entries(sa.time).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0).slice(0, 5);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-3">Hauptessenszeiten</h3>
        <div class="space-y-2">
            ${sortedTimes.map(([slot, val]) => `
                <div class="flex justify-between items-center">
                    <span class="font-medium">${slot} Uhr</span>
                    <span>${formatMoney(val)}</span>
                    <div class="flex-1 mx-4 h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
                        <div class="h-2 bg-[oklch(0.546_0.245_262.881)] dark:bg-[oklch(0.596_0.145_163.225)] rounded-full" style="width:${(val / (sortedTimes[0]?.[1] || 1)) * 100}%"></div>
                    </div>
                </div>
            `).join("")}
        </div>
    </div>`);

    const totalSpend = sa.weekdays.monday + sa.weekdays.tuesday + sa.weekdays.wednesday + sa.weekdays.thursday + sa.weekdays.friday;
    const avgPerDay = totalSpend / 5;
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
        <h3 class="text-lg font-semibold mb-3">Erkenntnisse</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <li>Durchschnittliche Tagesausgaben (Mo-Fr): <strong>${formatMoney(avgPerDay)}</strong></li>
            <li>Teuerster Wochentag: <strong>${WEEKDAY_LABELS_DE[WEEKDAYS.indexOf(Object.entries(sa.weekdays).sort((a,b) => b[1] - a[1])[0]?.[0] || "monday")]}</strong></li>
            <li>Samstagsausgaben gesamt: <strong>${formatMoney(sa.weekdays.saturday || 0)}</strong></li>
            <li>Sonntagsausgaben gesamt: <strong>${formatMoney(sa.weekdays.sunday || 0)}</strong> (Mensa geschlossen)</li>
        </ul>
    </div>`);

    document.getElementById("tab-content").innerHTML = html.join("");
    barChart("chart-time", timeLabels, [{ label: "Ausgaben", data: timeValues }]);
    barChart("chart-weekday", WEEKDAY_LABELS_DE, [{ label: "Ausgaben", data: wdValues }]);
}

// === Tab: Trends ===
function buildTrends() {
    destroyCharts();
    const sa = statsData["spend-amounts"];
    const html = [];

    // Monthly
    const monthKeys = Object.keys(sa.months).sort();
    const monthVals = monthKeys.map(k => sa.months[k]);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Ausgaben pro Monat</h3>
        <div style="height:300px"><canvas id="chart-months"></canvas></div>
    </div>`);

    // Weekly
    const weekKeys = Object.keys(sa.weeks).sort();
    const weekVals = weekKeys.map(k => sa.weeks[k]);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Ausgaben pro Woche</h3>
        <div style="height:300px"><canvas id="chart-weeks"></canvas></div>
    </div>`);

    // Semesters
    const semKeys = Object.keys(sa.semesters).sort();
    const semVals = semKeys.map(k => sa.semesters[k]);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Ausgaben pro Semester</h3>
        <div style="height:250px"><canvas id="chart-semesters"></canvas></div>
    </div>`);

    // Insight
    const monthlyAvg = monthVals.length > 0 ? monthVals.reduce((a, b) => a + b, 0) / monthVals.length : 0;
    const weeklyAvg = weekVals.length > 0 ? weekVals.reduce((a, b) => a + b, 0) / weekVals.length : 0;
    const maxMonth = monthKeys.length > 0 ? monthKeys[monthVals.indexOf(Math.max(...monthVals))] : "-";

    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
        <h3 class="text-lg font-semibold mb-3">Erkenntnisse</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <li>Durchschnittliche monatliche Ausgaben: <strong>${formatMoney(monthlyAvg)}</strong></li>
            <li>Durchschnittliche wöchentliche Ausgaben: <strong>${formatMoney(weeklyAvg)}</strong></li>
            <li>Teuerster Monat: <strong>${maxMonth}</strong></li>
            <li>Gesamtausgaben im analysierten Zeitraum: <strong>${formatMoney(sa.total)}</strong></li>
        </ul>
    </div>`);

    document.getElementById("tab-content").innerHTML = html.join("");
    barChart("chart-months", monthKeys, [{ label: "Ausgaben", data: monthVals }]);
    lineChart("chart-weeks", weekKeys, [{ label: "Ausgaben", data: weekVals }]);
    barChart("chart-semesters", semKeys, [{ label: "Ausgaben", data: semVals }]);
}

// === Tab: Categories ===
function buildCategories() {
    destroyCharts();
    const cats = statsData["spend-amounts"].categories;
    const catCounts = statsData["spend-counts"].categories;
    const catAvgs = statsData["spend-amount-averages"].categories;
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);
    const top15 = sorted.slice(0, 15);
    const html = [];

    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Top 15 Kategorien nach Ausgaben</h3>
        <div style="height:400px"><canvas id="chart-cats"></canvas></div>
    </div>`);

    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-3">Alle Kategorien</h3>
        <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
                <th class="text-left p-2">Kategorie</th><th class="text-right p-2">Ausgaben</th><th class="text-right p-2">Anzahl</th><th class="text-right p-2">Ø</th>
            </tr></thead>
            <tbody>${sorted.map(([name, val]) => `
                <tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td class="p-2">${escapeHTML(name)}</td>
                    <td class="p-2 text-right">${formatMoney(val)}</td>
                    <td class="p-2 text-right">${catCounts[name] || 0}</td>
                    <td class="p-2 text-right">${formatMoney(catAvgs[name] || 0)}</td>
                </tr>
            `).join("")}</tbody>
        </table></div>
    </div>`);

    // Insight
    const totalCatSpend = sorted.reduce((s, [, v]) => s + v, 0);
    const top3 = sorted.slice(0, 3);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
        <h3 class="text-lg font-semibold mb-3">Erkenntnisse</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <li>Anzahl verschiedener Kategorien: <strong>${sorted.length}</strong></li>
            ${top3.map(([name, val]) => `<li>Top-Kategorie: <strong>${escapeHTML(name)}</strong> mit ${formatMoney(val)} (${((val / totalCatSpend) * 100).toFixed(1)}% der Ausgaben)</li>`).join("")}
        </ul>
    </div>`);

    document.getElementById("tab-content").innerHTML = html.join("");
    barChart("chart-cats", top15.map(([n]) => n.length > 25 ? n.slice(0, 22) + "..." : n), [{ label: "Ausgaben", data: top15.map(([, v]) => v) }], {
        indexAxis: "y"
    });
}

// === Tab: Food Types ===
function buildFoodTypes() {
    destroyCharts();
    const ft = statsData["food-types-amounts"];
    const ftc = statsData["food-types-counts"];
    const types = ["drinks", "meals", "desserts", "snacks", "other"];
    const typeLabels = ["Getränke", "Hauptgerichte", "Desserts", "Snacks", "Sonstiges"];
    const totals = types.map(t => ft[t]?.total || 0);
    const counts = types.map(t => ftc[t]?.total || 0);

    const html = [];
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Ausgaben nach Essenstyp</h3>
        <div style="height:300px"><canvas id="chart-foodtypes"></canvas></div>
    </div>`);

    // Per-type breakdown
    types.forEach((type, i) => {
        const cats = ft[type]?.categories || {};
        const sortedCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);
        if (sortedCats.length === 0) return;
        html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
            <h3 class="text-lg font-semibold mb-3">${typeLabels[i]} – Details</h3>
            <div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
                    <th class="text-left p-2">Kategorie</th><th class="text-right p-2">Ausgaben</th><th class="text-right p-2">Anteil</th>
                </tr></thead>
                <tbody>${sortedCats.map(([name, val]) => `
                    <tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td class="p-2">${escapeHTML(name)}</td>
                        <td class="p-2 text-right">${formatMoney(val)}</td>
                        <td class="p-2 text-right">${totals[i] > 0 ? ((val / totals[i]) * 100).toFixed(1) + "%" : "-"}</td>
                    </tr>
                `).join("")}</tbody>
            </table></div>
        </div>`);
    });

    const totalFood = totals.reduce((a, b) => a + b, 0);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
        <h3 class="text-lg font-semibold mb-3">Erkenntnisse</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <li>Hauptgerichte machen <strong>${((totals[1] / totalFood) * 100).toFixed(1)}%</strong> der Ausgaben aus</li>
            <li>Getränke: <strong>${formatMoney(totals[0])}</strong> (${counts[0]} Käufe)</li>
            <li>Snacks: <strong>${formatMoney(totals[3])}</strong> (${counts[3]} Käufe)</li>
            <li>Desserts: <strong>${formatMoney(totals[2])}</strong> (${counts[2]} Käufe)</li>
        </ul>
    </div>`);

    document.getElementById("tab-content").innerHTML = html.join("");
    barChart("chart-foodtypes", typeLabels, [{ label: "Ausgaben", data: totals }]);
}

// === Tab: Canteens ===
function buildCanteens() {
    destroyCharts();
    const sa = statsData["spend-amounts"];
    const sc = statsData["spend-counts"];
    const canteens = Object.entries(sa.canteens).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);
    const labels = canteens.map(([id]) => `Nr. ${id}`);
    const vals = canteens.map(([, v]) => v);
    const counts = canteens.map(([id]) => sc.canteens[id] || 0);

    const html = [];
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Ausgaben pro Standort</h3>
        <div style="height:300px"><canvas id="chart-canteens"></canvas></div>
    </div>`);

    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-3">Standort-Details</h3>
        <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
                <th class="text-left p-2">Standort ID</th><th class="text-right p-2">Ausgaben</th><th class="text-right p-2">Besuche</th><th class="text-right p-2">Ø pro Besuch</th>
            </tr></thead>
            <tbody>${canteens.map(([id, val], i) => `
                <tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td class="p-2">Nr. ${escapeHTML(id)}</td>
                    <td class="p-2 text-right">${formatMoney(val)}</td>
                    <td class="p-2 text-right">${counts[i]}</td>
                    <td class="p-2 text-right">${counts[i] > 0 ? formatMoney(val / counts[i]) : "-"}</td>
                </tr>
            `).join("")}</tbody>
        </table></div>
    </div>`);

    // Register breakdown
    const reg = sa.register || {};
    const sortedReg = Object.entries(reg).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
        <h3 class="text-lg font-semibold mb-3">Ausgaben pro Kasse</h3>
        <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
                <th class="text-left p-2">Kasse</th><th class="text-right p-2">Ausgaben</th>
            </tr></thead>
            <tbody>${sortedReg.map(([name, val]) => `
                <tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td class="p-2">${escapeHTML(name)}</td>
                    <td class="p-2 text-right">${formatMoney(val)}</td>
                </tr>
            `).join("")}</tbody>
        </table></div>
    </div>`);

    document.getElementById("tab-content").innerHTML = html.join("");
    barChart("chart-canteens", labels, [{ label: "Ausgaben", data: vals }]);
}

// === Tab: Top-Ups ===
function buildTopups() {
    destroyCharts();
    const ta = statsData["top-up-amounts"];
    const tuc = statsData["top-up-counts"];
    const taua = statsData["top-up-amount-averages"];
    const html = [];

    const monthKeys = Object.keys(ta.months).sort();
    const monthVals = monthKeys.map(k => ta.months[k]);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Aufladungen pro Monat</h3>
        <div style="height:300px"><canvas id="chart-topup-months"></canvas></div>
    </div>`);

    const wdVals = WEEKDAYS.map(d => ta.weekdays[d] || 0);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Aufladungen nach Wochentag</h3>
        <div style="height:250px"><canvas id="chart-topup-weekday"></canvas></div>
    </div>`);

    // Register breakdown for topups
    const reg = ta.register || {};
    const sortedReg = Object.entries(reg).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
        <h3 class="text-lg font-semibold mb-3">Erkenntnisse</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <li>Gesamtaufladungen: <strong>${formatMoney(ta.total)}</strong> in ${tuc.total} Vorgängen</li>
            <li>Durchschnittliche Aufladung: <strong>${formatMoney(taua.total)}</strong></li>
            <li>Maximale Einzelaufladung: <strong>${formatMoney(ta["max-per-transaction"] || 0)}</strong></li>
            <li>Häufigste Aufladestation: <strong>${escapeHTML(sortedReg[0]?.[0] || "-")}</strong></li>
        </ul>
    </div>`);

    document.getElementById("tab-content").innerHTML = html.join("");
    barChart("chart-topup-months", monthKeys, [{ label: "Aufladungen", data: monthVals }]);
    barChart("chart-topup-weekday", WEEKDAY_LABELS_DE, [{ label: "Aufladungen", data: wdVals }]);
}

// === Tab: Streaks ===
function buildStreaks() {
    destroyCharts();
    const vs = statsData["visit-streaks"];
    const pc = vs["per-canteen"] || {};
    const html = [];

    html.push(`<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="stat-card bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-5 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Längste Serie</p>
            <p class="text-3xl font-bold">${vs.longest} <span class="text-sm font-normal">Tage</span></p>
            <p class="text-xs text-gray-400 mt-1">Ohne WE: ${vs["longest-without-weekends"]} | Ohne geschlossen: ${vs["longest-without-closed"]}</p>
        </div>
        <div class="stat-card bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-5 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Aktuelle Serie</p>
            <p class="text-3xl font-bold">${vs.current} <span class="text-sm font-normal">Tage</span></p>
            <p class="text-xs text-gray-400 mt-1">Ohne WE: ${vs["current-without-weekends"]} | Ohne geschlossen: ${vs["current-without-closed"]}</p>
        </div>
    </div>`);

    // Per-canteen streaks
    const canteenEntries = Object.entries(pc).sort((a, b) => b[1].longest - a[1].longest);
    if (canteenEntries.length > 0) {
        html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
            <h3 class="text-lg font-semibold mb-3">Besuchsserien pro Standort</h3>
            <div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
                    <th class="text-left p-2">Standort</th>
                    <th class="text-right p-2">Längste</th>
                    <th class="text-right p-2">Ohne WE</th>
                    <th class="text-right p-2">Ohne geschl.</th>
                    <th class="text-right p-2">Aktuell</th>
                </tr></thead>
                <tbody>${canteenEntries.map(([id, s]) => `
                    <tr class="border-b border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td class="p-2">Nr. ${escapeHTML(id)}</td>
                        <td class="p-2 text-right">${s.longest} Tage</td>
                        <td class="p-2 text-right">${s["longest-without-weekends"]} Tage</td>
                        <td class="p-2 text-right">${s["longest-without-closed"]} Tage</td>
                        <td class="p-2 text-right">${s.current} Tage</td>
                    </tr>
                `).join("")}</tbody>
            </table></div>
        </div>`);
    }

    document.getElementById("tab-content").innerHTML = html.join("");
}

// === Tab: Time Heatmap ===
function buildTimeHeatmap() {
    destroyCharts();
    const tbw = statsData["spend-amounts"]["time-by-weekday"] || {};
    const timeSlots = tbw["monday"] ? Object.keys(tbw["monday"]) : [];
    const activeSlots = timeSlots.filter(slot => WEEKDAYS.some(d => (tbw[d]?.[slot] || 0) > 0));
    const displaySlots = activeSlots.length > 0 ? activeSlots : timeSlots.slice(36, 80);

    const containerId = "tab-content";
    document.getElementById(containerId).innerHTML = `<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]" id="heatmap-container"></div>`;

    heatmapTable("heatmap-container", tbw, displaySlots.map(s => s.slice(0, 5)), WEEKDAY_LABELS_DE,
        (data, yLabel, xSlot) => {
            const dayIdx = WEEKDAY_LABELS_DE.indexOf(yLabel);
            const dayKey = WEEKDAYS[dayIdx];
            return data[dayKey]?.[xSlot + ":00-" + xSlot.slice(3, 5) + ":15"] ||
                   data[dayKey]?.[xSlot + ":15-" + xSlot.slice(3, 5) + ":30"] ||
                   Object.entries(data[dayKey] || {}).find(([k]) => k.startsWith(xSlot))?.[1] || 0;
        },
        { title: "Ausgaben nach Wochentag & Uhrzeit (Heatmap)", formatVal: formatMoney }
    );
}

// === Tab: Counts Comparison ===
function buildCounts() {
    destroyCharts();
    const sc = statsData["spend-counts"];
    const tc = statsData["transaction-counts"];
    const vc = statsData["visits-counts"];
    const tuc = statsData["top-up-counts"];
    const html = [];

    const monthKeys = Object.keys(sc.months).sort();
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Monatlicher Vergleich: Zahlungen vs Transaktionen vs Besuche</h3>
        <div style="height:300px"><canvas id="chart-counts-compare"></canvas></div>
    </div>`);

    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
        <h3 class="text-lg font-semibold mb-3">Erkenntnisse</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <li>Gesamtzahl Zahlungen (Einzelposten): <strong>${sc.total}</strong></li>
            <li>Gesamtzahl Transaktionen (Kassiervorgänge): <strong>${tc.total}</strong></li>
            <li>Gesamtzahl Besuche (Tage): <strong>${vc.total}</strong></li>
            <li>Gesamtzahl Aufladungen: <strong>${tuc.total}</strong></li>
            <li>Ø Posten pro Transaktion: <strong>${(sc.total / tc.total).toFixed(1)}</strong></li>
            <li>Ø Transaktionen pro Besuchstag: <strong>${(tc.total / vc.total).toFixed(1)}</strong></li>
        </ul>
    </div>`);

    document.getElementById("tab-content").innerHTML = html.join("");
    barChart("chart-counts-compare", monthKeys, [
        { label: "Zahlungen", data: monthKeys.map(k => sc.months[k] || 0) },
        { label: "Transaktionen", data: monthKeys.map(k => tc.months[k] || 0) },
        { label: "Besuche", data: monthKeys.map(k => vc.months[k] || 0) }
    ]);
}

// === Tab: Averages ===
function buildAverages() {
    destroyCharts();
    const saa = statsData["spend-amount-averages"];
    const taa = statsData["transaction-amount-averages"];
    const taua = statsData["top-up-amount-averages"];
    const html = [];

    // Monthly averages
    const monthKeys = Object.keys(saa.months).sort();
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Durchschnittliche Ausgaben pro Monat</h3>
        <div style="height:300px"><canvas id="chart-avg-monthly"></canvas></div>
    </div>`);

    // Weekday averages
    const wdSpend = WEEKDAYS.map(d => saa.weekdays[d] || 0);
    const wdTrans = WEEKDAYS.map(d => taa.weekdays[d] || 0);
    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)] mb-6">
        <h3 class="text-lg font-semibold mb-4">Ø Ausgaben & Transaktionen pro Wochentag</h3>
        <div style="height:300px"><canvas id="chart-avg-weekday"></canvas></div>
    </div>`);

    html.push(`<div class="bg-white dark:bg-[oklch(21%_0.006_285.885)] rounded-xl p-6 shadow-sm border border-[oklch(0.872_0.01_258.338)] dark:border-[oklch(0.274_0.006_286.033)]">
        <h3 class="text-lg font-semibold mb-3">Erkenntnisse</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <li>Ø Ausgabe pro Zahlung: <strong>${formatMoney(saa.total)}</strong></li>
            <li>Ø Transaktionsbetrag: <strong>${formatMoney(taa.total)}</strong></li>
            <li>Ø Aufladungsbetrag: <strong>${formatMoney(taua.total)}</strong></li>
            <li>Höchster Ø am: <strong>${WEEKDAY_LABELS_DE[wdSpend.indexOf(Math.max(...wdSpend))]}</strong> (${formatMoney(Math.max(...wdSpend))})</li>
        </ul>
    </div>`);

    document.getElementById("tab-content").innerHTML = html.join("");
    barChart("chart-avg-monthly", monthKeys, [{ label: "Ø Ausgabe", data: monthKeys.map(k => saa.months[k] || 0) }]);
    barChart("chart-avg-weekday", WEEKDAY_LABELS_DE, [
        { label: "Ø Ausgabe", data: wdSpend },
        { label: "Ø Transaktion", data: wdTrans }
    ]);
}

// === Tab definitions ===
const tabs = [
    { id: "overview", label: "Übersicht", build: buildOverview },
    { id: "time", label: "Tageszeit", build: buildTimeOverview },
    { id: "trends", label: "Trends", build: buildTrends },
    { id: "categories", label: "Kategorien", build: buildCategories },
    { id: "foodtypes", label: "Essenstypen", build: buildFoodTypes },
    { id: "canteens", label: "Standorte", build: buildCanteens },
    { id: "topups", label: "Aufladungen", build: buildTopups },
    { id: "streaks", label: "Serien", build: buildStreaks },
    { id: "heatmap", label: "Heatmap", build: buildTimeHeatmap },
    { id: "counts", label: "Vergleich", build: buildCounts },
    { id: "averages", label: "Durchschnitte", build: buildAverages },
];

function buildTabNav() {
    document.getElementById("tab-nav").innerHTML = tabs.map(t => `
        <button class="tab-btn px-4 py-2 text-sm font-medium rounded-t-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap ${activeTab === t.id ? "tab-active border-b-2 border-[oklch(0.546_0.245_262.881)] dark:border-[oklch(0.596_0.145_163.225)] text-[oklch(0.546_0.245_262.881)] dark:text-[oklch(0.596_0.145_163.225)]" : "text-gray-500"}"
            data-tab="${t.id}">${t.label}</button>
    `).join("");
}

function switchTab(tabId) {
    activeTab = tabId;
    destroyCharts();
    const tab = tabs.find(t => t.id === tabId);
    if (tab) tab.build();
    buildTabNav();
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
}

async function loadStats() {
    const cardnumberInput = document.getElementById("cardnumber-input").value.trim();
    const passwordInput = document.getElementById("password-input").value.trim();

    if (!cardnumberInput || !passwordInput) {
        document.getElementById("login-error").classList.remove("hidden");
        document.getElementById("login-error").textContent = "Bitte Karten-Nummer und Passwort eingeben.";
        return;
    }

    document.getElementById("login-error").classList.add("hidden");
    document.getElementById("loading-section").classList.remove("hidden");
    document.getElementById("dashboard-section").classList.add("hidden");

    try {
        statsData = await fetchStats(cardnumberInput, passwordInput);
        cardnumber = cardnumberInput;
        password = passwordInput;
        sessionStorage.setItem("cardnumber", cardnumberInput);
        sessionStorage.setItem("password", passwordInput);

        document.getElementById("login-section").classList.add("hidden");
        document.getElementById("loading-section").classList.add("hidden");
        document.getElementById("dashboard-section").classList.remove("hidden");

        switchTab("overview");
    } catch (err) {
        document.getElementById("loading-section").classList.add("hidden");
        document.getElementById("login-error").classList.remove("hidden");
        document.getElementById("login-error").textContent = "Fehler beim Laden. Bitte überprüfe Anmeldedaten und Server-Verbindung.";
        console.error(err);
    }
}

// Init
(async () => {
    host = getAutoHost();
    proto = await detectProto(host);

    if (cardnumber && password) {
        document.getElementById("cardnumber-input").value = cardnumber;
        document.getElementById("password-input").value = password;
        await loadStats();
    }
})();

document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await loadStats();
});