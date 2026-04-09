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
    const selected = pickTrendingStocks(5);

    const results = await Promise.all(selected.map(async (query) => {
        try {
            const response = await fetch(`/predict?ticker=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (!response.ok) {
                return null;
            }

            const current = data.historical_prices[data.historical_prices.length - 1]?.close ?? 0;
            const forecast = data.predicted_prices[data.predicted_prices.length - 1]?.predicted_close ?? 0;
            return {
                query,
                name: data.company_name,
                symbol: data.ticker,
                exchange: data.exchange,
                currency: data.currency || "INR",
                current,
                forecast
            };
        } catch (_error) {
            return null;
        }
    }));

    const validResults = results.filter(Boolean);
    if (!validResults.length) {
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

    renderTrendingStocks(validResults);
    trendingStatusEl.textContent = "Updated on reload";
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

    try {
        const response = await fetch(`/search?query=${encodeURIComponent(cleanQuery)}`);
        const data = await response.json();
        if (!response.ok) {
            suggestionsEl.hidden = true;
            suggestionsEl.innerHTML = "";
            return;
        }
        renderSuggestions(data.results || []);
    } catch (_error) {
        suggestionsEl.hidden = true;
        suggestionsEl.innerHTML = "";
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    openAnalysis(input.value);
});

input.addEventListener("input", () => {
    searchSuggestions(input.value);
});

loadTrendingStocks();
