const form = document.getElementById("ticker-form");
const input = document.getElementById("ticker-input");
const statusEl = document.getElementById("status");
const suggestionsEl = document.getElementById("suggestions");
const trendingListEl = document.getElementById("trending-list");
const trendingStatusEl = document.getElementById("trending-status");

const TRENDING_POOL = [
    "Reliance",
    "TCS",
    "Infosys",
    "HDFC Bank",
    "ICICI Bank",
    "Bharti Airtel",
    "Larsen & Toubro",
    "Tata Motors",
    "Axis Bank",
    "Maruti Suzuki",
    "State Bank of India",
    "Tata Steel"
];
let suggestionRequestId = 0;

function formatCurrency(value, currency = "INR") {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 2
    }).format(value);
}

function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("negative", isError);
}

function openAnalysis(ticker) {
    const cleanTicker = ticker.trim();
    if (!cleanTicker) {
        setStatus("Enter an Indian stock name or NSE/BSE symbol.", true);
        return;
    }

    window.location.href = `/analysis?ticker=${encodeURIComponent(cleanTicker)}`;
}

function pickTrendingStocks(count) {
    const shuffled = [...TRENDING_POOL];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count);
}

function renderTrendingStocks(items) {
    trendingListEl.innerHTML = items.map((item) => {
        const delta = item.forecast - item.current;
        const deltaPct = item.current === 0 ? 0 : (delta / item.current) * 100;
        return `
            <article class="trending-item" data-ticker="${item.query}">
                <div class="trending-meta">
                    <strong>${item.name}</strong>
                    <span>${item.symbol} &middot; ${item.exchange}</span>
                </div>
                <div class="trending-prices">
                    <div>
                        <span>Current</span>
                        <strong>${formatCurrency(item.current, item.currency)}</strong>
                    </div>
                    <div>
                        <span>Forecast</span>
                        <strong>${formatCurrency(item.forecast, item.currency)}</strong>
                    </div>
                </div>
                <div class="trending-delta ${delta < 0 ? "negative" : ""}">
                    ${delta >= 0 ? "+" : ""}${formatCurrency(delta, item.currency)} &middot; ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%
                </div>
            </article>
        `;
    }).join("");

    trendingListEl.querySelectorAll(".trending-item").forEach((item) => {
        item.addEventListener("click", () => openAnalysis(item.dataset.ticker || ""));
    });
}

async function loadTrendingStocks() {
    if (!trendingListEl || !trendingStatusEl) {
        return;
    }

    trendingStatusEl.textContent = "Loading now";
    const selected = pickTrendingStocks(3);
    const requests = selected.map(async (query) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const response = await fetch(`/snapshot?ticker=${encodeURIComponent(query)}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            const data = await response.json();
            if (!response.ok) {
                return null;
            }
            return {
                query,
                name: data.company_name,
                symbol: data.ticker,
                exchange: data.exchange,
                currency: data.currency || "INR",
                current: data.current ?? 0,
                forecast: data.forecast ?? 0
            };
        } catch (_error) {
            return null;
        }
    });

    const settled = await Promise.all(requests);
    const results = settled.filter(Boolean);

    if (!results.length) {
        trendingListEl.innerHTML = `
            <article class="trending-item trending-loading">
                <div class="trending-meta">
                    <strong>Unable to load trending stocks</strong>
                    <span>Try refreshing the page once.</span>
                </div>
            </article>
        `;
        trendingStatusEl.textContent = "Load failed";
        return;
    }

    renderTrendingStocks(results);
    trendingStatusEl.textContent = "Updated on reload";
}

function buildLocalSuggestions(query) {
    const cleanQuery = query.trim().toLowerCase();
    if (cleanQuery.length < 2) {
        return [];
    }

    return TRENDING_POOL
        .filter((name) => name.toLowerCase().includes(cleanQuery))
        .slice(0, 6)
        .map((name) => ({
            symbol: name,
            name,
            exchange: "India"
        }));
}

function renderSuggestions(results) {
    if (!results.length) {
        suggestionsEl.hidden = true;
        suggestionsEl.innerHTML = "";
        return;
    }

    suggestionsEl.innerHTML = results.slice(0, 8).map((result) => `
        <button class="suggestion-item" type="button" data-symbol="${result.symbol}">
            <span>${result.name}</span>
            <span class="suggestion-meta">${result.symbol} &middot; ${result.exchange}</span>
        </button>
    `).join("");
    suggestionsEl.hidden = false;

    suggestionsEl.querySelectorAll(".suggestion-item").forEach((button) => {
        button.addEventListener("click", () => openAnalysis(button.dataset.symbol || ""));
    });
}

async function searchSuggestions(query) {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
        suggestionsEl.hidden = true;
        suggestionsEl.innerHTML = "";
        return;
    }

    const localResults = buildLocalSuggestions(cleanQuery);
    if (localResults.length) {
        renderSuggestions(localResults);
    }

    const requestId = ++suggestionRequestId;
    try {
        const response = await fetch(`/search?query=${encodeURIComponent(cleanQuery)}`);
        const data = await response.json();
        if (requestId !== suggestionRequestId) {
            return;
        }
        if (!response.ok) {
            if (!localResults.length) {
                suggestionsEl.hidden = true;
                suggestionsEl.innerHTML = "";
            }
            return;
        }
        renderSuggestions(data.results || []);
    } catch (_error) {
        if (!localResults.length) {
            suggestionsEl.hidden = true;
            suggestionsEl.innerHTML = "";
        }
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    openAnalysis(input.value);
});

input.addEventListener("input", () => {
    searchSuggestions(input.value);
});

window.setTimeout(loadTrendingStocks, 250);
