const form = document.getElementById("ticker-form");
const input = document.getElementById("ticker-input");
const statusEl = document.getElementById("status");
const latestCloseEl = document.getElementById("latest-close");
const forecastEndEl = document.getElementById("forecast-end");
const trendDeltaEl = document.getElementById("trend-delta");
const pointsUsedEl = document.getElementById("points-used");
const fiftyTwoHighEl = document.getElementById("fifty-two-high");
const fiftyTwoLowEl = document.getElementById("fifty-two-low");
const chartTitleEl = document.getElementById("chart-title");
const generatedAtEl = document.getElementById("generated-at");
const historyTableEl = document.getElementById("history-table");
const forecastTableEl = document.getElementById("forecast-table");
const chartEl = document.getElementById("chart");
const suggestionsEl = document.getElementById("suggestions");
const rationaleBadgeEl = document.getElementById("rationale-badge");
const rationaleSummaryEl = document.getElementById("rationale-summary");
const reasonTrendEl = document.getElementById("reason-trend");
const reasonNewsBiasEl = document.getElementById("reason-news-bias");
const reasonForecastMoveEl = document.getElementById("reason-forecast-move");
const rationaleDisclaimerEl = document.getElementById("rationale-disclaimer");
const primaryMarketLinkEl = document.getElementById("primary-market-link");
const newsSearchLinkEl = document.getElementById("news-search-link");
const newsListEl = document.getElementById("news-list");

let currentCurrency = "INR";

function currencyFormatter(currency) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 2
    });
}

function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("negative", isError);
}

function formatNumber(value) {
    return currencyFormatter(currentCurrency).format(value);
}

function formatTimestamp(isoValue) {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) {
        return "Updated just now";
    }
    return `Updated ${date.toLocaleString("en-IN")}`;
}

function formatDisplayDate(value) {
    if (typeof value === "string" && /^\d{2}-\d{2}-\d{4}$/.test(value)) {
        return value;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString("en-GB").replace(/\//g, "-");
}

function formatRelativeDate(isoValue) {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) {
        return "Recent";
    }
    return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function renderMetrics(data) {
    currentCurrency = data.currency || "INR";
    const latestClose = data.historical_prices.at(-1)?.close ?? 0;
    const forecastEnd = data.predicted_prices.at(-1)?.predicted_close ?? 0;
    const delta = forecastEnd - latestClose;

    latestCloseEl.textContent = formatNumber(latestClose);
    forecastEndEl.textContent = formatNumber(forecastEnd);
    trendDeltaEl.textContent = `${delta >= 0 ? "+" : ""}${formatNumber(delta)}`;
    trendDeltaEl.className = delta >= 0 ? "positive" : "negative";
    pointsUsedEl.textContent = `${data.historical_prices.length} + ${data.predicted_prices.length}`;
    fiftyTwoHighEl.textContent = formatNumber(data.fifty_two_week_high || 0);
    fiftyTwoLowEl.textContent = formatNumber(data.fifty_two_week_low || 0);
    chartTitleEl.textContent = `${data.company_name} (${data.ticker})`;
    generatedAtEl.textContent = formatTimestamp(data.generated_at);
}

function renderRationale(data) {
    const rationale = data.rationale || {};
    rationaleBadgeEl.textContent = rationale.label || "Model view";
    rationaleSummaryEl.textContent = rationale.summary || "FinTel is combining the recent price trend with recent headlines.";
    reasonTrendEl.textContent = rationale.trend_direction || "Unavailable";
    reasonNewsBiasEl.textContent = rationale.news_bias || "Mixed";
    reasonForecastMoveEl.textContent = rationale.forecast_move || "--";
    rationaleDisclaimerEl.textContent = rationale.disclaimer || "This is a directional explanation, not a guarantee.";
}

function renderMarketLinks(data) {
    const marketUrl = data.market_url || "#";
    const newsUrl = data.news_search_url || "#";

    primaryMarketLinkEl.href = marketUrl;
    primaryMarketLinkEl.textContent = data.exchange === "NSE" ? "Open official NSE quote page" : "Open matched market view";

    newsSearchLinkEl.href = newsUrl;
    newsSearchLinkEl.textContent = "Open Google News results";
}

function renderNews(data) {
    const items = data.news_items || [];
    if (!items.length) {
        newsListEl.innerHTML = `
            <article class="news-item">
                <div class="news-meta">No recent matched headlines were found for this stock.</div>
            </article>
        `;
        return;
    }

    newsListEl.innerHTML = items.map((item) => `
        <article class="news-item">
            <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
            <div class="news-meta">${item.publisher} • ${formatRelativeDate(item.published_at)}</div>
        </article>
    `).join("");
}

function renderTable(rows, target, valueKey) {
    target.innerHTML = rows.map((row) => `
        <tr>
            <td>${formatDisplayDate(row.date)}</td>
            <td>${formatNumber(row[valueKey])}</td>
        </tr>
    `).join("");
}

function buildPath(points, xScale, yScale) {
    return points.map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command}${xScale(index)} ${yScale(point.value)}`;
    }).join(" ");
}

function renderChart(data) {
    const history = data.historical_prices.map((point) => ({
        label: formatDisplayDate(point.date),
        value: point.close
    }));
    const forecast = data.predicted_prices.map((point) => ({
        label: formatDisplayDate(point.date),
        value: point.predicted_close
    }));
    const allPoints = [...history, ...forecast];

    const width = 900;
    const height = 420;
    const margin = { top: 28, right: 28, bottom: 56, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const values = allPoints.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const paddedMin = min - (max - min || 1) * 0.18;
    const paddedMax = max + (max - min || 1) * 0.18;
    const xScale = (index) => margin.left + (innerWidth * index) / Math.max(allPoints.length - 1, 1);
    const yScale = (value) => margin.top + innerHeight - ((value - paddedMin) / (paddedMax - paddedMin || 1)) * innerHeight;

    const historyPath = buildPath(history, xScale, yScale);
    const forecastStart = history.length - 1;
    const forecastWithJoin = [
        { ...history.at(-1), label: history.at(-1)?.label ?? "" },
        ...forecast
    ];
    const forecastPath = forecastWithJoin.map((point, index) => {
        const globalIndex = forecastStart + index;
        const command = index === 0 ? "M" : "L";
        return `${command}${xScale(globalIndex)} ${yScale(point.value)}`;
    }).join(" ");

    const yTicks = Array.from({ length: 5 }, (_, index) => paddedMin + ((paddedMax - paddedMin) * index) / 4);
    const xTickStep = Math.max(Math.floor(allPoints.length / 6), 1);
    const xTicks = allPoints.filter((_, index) => index % xTickStep === 0 || index === allPoints.length - 1);

    chartEl.innerHTML = `
        <defs>
            <linearGradient id="historyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#37d6b3" stop-opacity="0.34"></stop>
                <stop offset="100%" stop-color="#37d6b3" stop-opacity="0"></stop>
            </linearGradient>
        </defs>
        ${yTicks.map((tick) => `
            <g>
                <line x1="${margin.left}" y1="${yScale(tick)}" x2="${width - margin.right}" y2="${yScale(tick)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="5 8"></line>
                <text x="${margin.left - 14}" y="${yScale(tick) + 4}" text-anchor="end" fill="#95a7c8" font-size="12">${formatNumber(tick)}</text>
            </g>
        `).join("")}
        <path d="${historyPath} L${xScale(history.length - 1)} ${height - margin.bottom} L${xScale(0)} ${height - margin.bottom} Z" fill="url(#historyGradient)"></path>
        <path d="${historyPath}" fill="none" stroke="#37d6b3" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="${forecastPath}" fill="none" stroke="#ffb14a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="10 10"></path>
        <line x1="${xScale(history.length - 1)}" y1="${margin.top}" x2="${xScale(history.length - 1)}" y2="${height - margin.bottom}" stroke="rgba(255,177,74,0.35)" stroke-dasharray="6 8"></line>
        ${allPoints.map((point, index) => {
            const isForecast = index >= history.length;
            const fill = isForecast ? "#ffb14a" : "#37d6b3";
            return `<circle cx="${xScale(index)}" cy="${yScale(point.value)}" r="4.5" fill="${fill}"></circle>`;
        }).join("")}
        ${xTicks.map((tick) => {
            const index = allPoints.findIndex((point) => point.label === tick.label);
            return `
                <g>
                    <text x="${xScale(index)}" y="${height - 20}" text-anchor="middle" fill="#95a7c8" font-size="12">${tick.label.slice(0, 5)}</text>
                </g>
            `;
        }).join("")}
    `;
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
            <span class="suggestion-meta">${result.symbol} · ${result.exchange}</span>
        </button>
    `).join("");
    suggestionsEl.hidden = false;

    suggestionsEl.querySelectorAll(".suggestion-item").forEach((button) => {
        button.addEventListener("click", () => {
            loadTicker(button.dataset.symbol || "");
        });
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

async function loadTicker(ticker) {
    const cleanTicker = ticker.trim();
    if (!cleanTicker) {
        setStatus("Enter an Indian stock name or NSE/BSE symbol.", true);
        return;
    }

    input.value = cleanTicker;
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = "";
    setStatus(`Loading ${cleanTicker}...`);

    try {
        const response = await fetch(`/predict?ticker=${encodeURIComponent(cleanTicker)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Unable to fetch ticker data.");
        }

        renderMetrics(data);
        renderRationale(data);
        renderMarketLinks(data);
        renderTable(data.historical_prices, historyTableEl, "close");
        renderTable(data.predicted_prices, forecastTableEl, "predicted_close");
        renderNews(data);
        renderChart(data);
        setStatus(`Showing ${data.company_name} on ${data.exchange} with ${data.historical_prices.length} historical points, 5 forecast points, and recent news context.`);
    } catch (error) {
        setStatus(error.message || "Something went wrong.", true);
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadTicker(input.value);
});

input.addEventListener("input", () => {
    searchSuggestions(input.value);
});

document.querySelectorAll(".ticker-chip").forEach((button) => {
    button.addEventListener("click", () => loadTicker(button.dataset.ticker || ""));
});

loadTicker("Reliance");
