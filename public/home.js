const form = document.getElementById("ticker-form");
const input = document.getElementById("ticker-input");
const statusEl = document.getElementById("status");
const suggestionsEl = document.getElementById("suggestions");
const trendingListEl = document.getElementById("trending-list");
const trendingStatusEl = document.getElementById("trending-status");
const authModal = document.getElementById("auth-modal");
const authClose = document.getElementById("auth-close");
const flowModal = document.getElementById("flow-modal");
const flowClose = document.getElementById("flow-close");
const flowTrigger = document.getElementById("flow-trigger");
const flowDetailTitle = document.getElementById("flow-detail-title");
const flowDetailSummary = document.getElementById("flow-detail-summary");
const flowDetailPoints = document.getElementById("flow-detail-points");
const flowNodes = Array.from(document.querySelectorAll(".flow-node"));
const loginTrigger = document.getElementById("login-trigger");
const registerTrigger = document.getElementById("register-trigger");
const showLoginButton = document.getElementById("show-login");
const showRegisterButton = document.getElementById("show-register");
const loginForm = document.getElementById("login-form");
const loginEmailEl = document.getElementById("login-email");
const loginPasswordEl = document.getElementById("login-password");
const loginStatusEl = document.getElementById("login-status");
const registerForm = document.getElementById("register-form");
const registerNameEl = document.getElementById("register-name");
const registerEmailEl = document.getElementById("register-email");
const registerPasswordEl = document.getElementById("register-password");
const registerStatusEl = document.getElementById("register-status");
const accountAvatarEl = document.getElementById("account-avatar");

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
const ACCOUNT_STORAGE_KEY = "fintel-user";
const FLOW_STEPS = {
    input: {
        title: "Search Input",
        summary: "The homepage captures a company name or symbol and starts the request path with quick local suggestions plus live lookup.",
        points: [
            "The search bar listens for live typing and form submission.",
            "Local suggestions appear immediately for common Indian stocks.",
            "The selected ticker is passed into the analysis request."
        ]
    },
    resolve: {
        title: "Ticker Resolve",
        summary: "FinTel matches natural company names like Reliance or HDFC Bank to valid NSE or BSE listing symbols.",
        points: [
            "Featured Indian symbols are checked first for faster resolution.",
            "If needed, Yahoo Finance search is queried to map names to listed symbols.",
            "The resolved symbol becomes the source for the remaining pipeline."
        ]
    },
    prices: {
        title: "Price API",
        summary: "Historical price data is pulled from Yahoo Finance, including recent closes and 52-week range context.",
        points: [
            "One month of daily price history is fetched through the chart API.",
            "The backend parses timestamps, close prices, and yearly range values.",
            "This data becomes the base input for prediction."
        ]
    },
    model: {
        title: "Forecast Model",
        summary: "The autoregressive ridge momentum model studies recent closes, lag values, and short-term behavior to forecast the next 5 business days.",
        points: [
            "Lag values, momentum, return patterns, and volatility are blended together.",
            "The model predicts future closes iteratively across trading days.",
            "The result is a short-term directional forecast rather than a guarantee."
        ]
    },
    news: {
        title: "News Context",
        summary: "Recent stock-related headlines are fetched separately to explain what the model may be reacting to in the market narrative.",
        points: [
            "Google News RSS is queried using the stock name and exchange context.",
            "Relevant headlines are filtered and attached to the analysis page.",
            "News supports interpretation but does not directly change forecast prices."
        ]
    },
    response: {
        title: "JSON Response",
        summary: "The backend combines pricing, forecast, news, and rationale into a structured JSON payload for the frontend.",
        points: [
            "Historical closes and predicted closes are returned together.",
            "52-week high/low and rationale metadata are included.",
            "The same backend also powers quick live-board snapshot responses."
        ]
    },
    ui: {
        title: "UI Render",
        summary: "The analysis page renders charts, tables, market links, and explanation cards from the JSON response.",
        points: [
            "The homepage focuses on discovery, while the analysis page shows detail.",
            "Charts and tables are built dynamically in JavaScript.",
            "The live board and suggestion system help users move quickly through the app."
        ]
    },
    accounts: {
        title: "Account Flow",
        summary: "Top-right login and registration controls open a modal account flow backed by Java endpoints and local storage.",
        points: [
            "New users register through the /register endpoint.",
            "Returning users sign in through the /login endpoint.",
            "The signed-in user state is reflected in the top-right avatar."
        ]
    }
};

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

function setRegisterStatus(message, isError = false) {
    if (!registerStatusEl) {
        return;
    }
    registerStatusEl.textContent = message;
    registerStatusEl.classList.toggle("negative", isError);
    registerStatusEl.classList.toggle("positive", !isError);
}

function setLoginStatus(message, isError = false) {
    if (!loginStatusEl) {
        return;
    }
    loginStatusEl.textContent = message;
    loginStatusEl.classList.toggle("negative", isError);
    loginStatusEl.classList.toggle("positive", !isError);
}

function setAuthMode(mode) {
    const isLogin = mode === "login";
    if (loginForm) {
        loginForm.hidden = !isLogin;
    }
    if (registerForm) {
        registerForm.hidden = isLogin;
    }
    showLoginButton?.classList.toggle("secondary", !isLogin);
    showRegisterButton?.classList.toggle("secondary", isLogin);
}

function openAuthModal(mode) {
    if (!authModal) {
        return;
    }
    setAuthMode(mode);
    authModal.hidden = false;
    document.body.classList.add("modal-open");
}

function closeAuthModal() {
    if (!authModal) {
        return;
    }
    authModal.hidden = true;
    document.body.classList.remove("modal-open");
}

function openFlowModal() {
    if (!flowModal) {
        return;
    }
    flowModal.hidden = false;
    document.body.classList.add("modal-open");
}

function closeFlowModal() {
    if (!flowModal) {
        return;
    }
    flowModal.hidden = true;
    document.body.classList.remove("modal-open");
}

function selectFlowStep(stepId) {
    const step = FLOW_STEPS[stepId];
    if (!step || !flowDetailTitle || !flowDetailSummary || !flowDetailPoints) {
        return;
    }

    flowDetailTitle.textContent = step.title;
    flowDetailSummary.textContent = step.summary;
    flowDetailPoints.innerHTML = step.points.map((point) => `<div class="flow-detail-point">${point}</div>`).join("");

    flowNodes.forEach((node) => {
        node.classList.toggle("is-active", node.dataset.flowStep === stepId);
    });
}

function saveCurrentUser(user) {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(user));
    updateAccountDisplay();
}

function readCurrentUser() {
    try {
        const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_error) {
        return null;
    }
}

function updateAccountDisplay() {
    const user = readCurrentUser();
    const name = user?.name?.trim();
    const initial = name ? name.charAt(0).toUpperCase() : "U";
    if (accountAvatarEl) {
        accountAvatarEl.textContent = initial;
        accountAvatarEl.title = name ? `Signed in as ${name}` : "FinTel user";
    }
    if (loginTrigger) {
        loginTrigger.textContent = name ? "Logged in" : "Login";
        loginTrigger.disabled = Boolean(name);
    }
    if (registerTrigger) {
        registerTrigger.textContent = name ? name : "Register";
    }
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

function rankTrendingStocks(items) {
    return [...items].sort((left, right) => {
        const leftDelta = left.forecast - left.current;
        const rightDelta = right.forecast - right.current;
        return rightDelta - leftDelta;
    });
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
    const requests = TRENDING_POOL.map(async (query) => {
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
    const rankedResults = rankTrendingStocks(settled.filter(Boolean));
    const positiveResults = rankedResults.filter((item) => item.forecast > item.current);
    const results = positiveResults.slice(0, Math.min(3, Math.max(2, positiveResults.length)));

    if (results.length < 2) {
        trendingListEl.innerHTML = `
            <article class="trending-item trending-loading">
                <div class="trending-meta">
                    <strong>Not enough bullish picks right now</strong>
                    <span>Reload to scan the board again.</span>
                </div>
            </article>
        `;
        trendingStatusEl.textContent = "Limited positive signals";
        return;
    }

    renderTrendingStocks(results);
    trendingStatusEl.textContent = "Bullish picks";
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

loginTrigger?.addEventListener("click", () => openAuthModal("login"));
registerTrigger?.addEventListener("click", () => {
    if (readCurrentUser()) {
        return;
    }
    openAuthModal("register");
});
showLoginButton?.addEventListener("click", () => setAuthMode("login"));
showRegisterButton?.addEventListener("click", () => setAuthMode("register"));
authClose?.addEventListener("click", closeAuthModal);
authModal?.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeAuth === "true") {
        closeAuthModal();
    }
});
flowTrigger?.addEventListener("click", openFlowModal);
flowClose?.addEventListener("click", closeFlowModal);
flowModal?.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeFlow === "true") {
        closeFlowModal();
    }
});
flowNodes.forEach((node) => {
    node.addEventListener("click", () => selectFlowStep(node.dataset.flowStep || "input"));
});

if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const payload = {
            email: loginEmailEl.value.trim(),
            password: loginPasswordEl.value
        };

        if (!payload.email || !payload.password) {
            setLoginStatus("Enter your email and password to continue.", true);
            return;
        }

        setLoginStatus("Checking your account...");

        try {
            const response = await fetch("/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) {
                setLoginStatus(data.error || "Unable to login right now.", true);
                return;
            }

            loginForm.reset();
            saveCurrentUser(data.user || {});
            setLoginStatus(`Welcome back, ${data.user?.name || "user"}.`);
            closeAuthModal();
        } catch (_error) {
            setLoginStatus("Unable to reach the login service right now.", true);
        }
    });
}

if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const payload = {
            name: registerNameEl.value.trim(),
            email: registerEmailEl.value.trim(),
            password: registerPasswordEl.value
        };

        if (!payload.name || !payload.email || !payload.password) {
            setRegisterStatus("Fill in name, email, and password to register.", true);
            return;
        }

        setRegisterStatus("Creating your FinTel account...");

        try {
            const response = await fetch("/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) {
                setRegisterStatus(data.error || "Unable to register right now.", true);
                return;
            }

            registerForm.reset();
            saveCurrentUser(data.user || {});
            setRegisterStatus(`Registered ${data.user?.name || "user"} successfully.`);
            closeAuthModal();
        } catch (_error) {
            setRegisterStatus("Unable to reach the registration service right now.", true);
        }
    });
}

updateAccountDisplay();
selectFlowStep("input");
window.setTimeout(loadTrendingStocks, 250);
