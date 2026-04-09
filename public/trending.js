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

function openAnalysis(ticker) {
    window.location.href = `/analysis?ticker=${encodeURIComponent(ticker)}`;
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
    trendingStatusEl.textContent = "Loading now";
    const selected = pickTrendingStocks(8);

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

loadTrendingStocks();
