# FinTel

Java stock forecast app for Indian equities that:

- Accepts an Indian stock name or NSE/BSE symbol
- Resolves company names to Yahoo Finance Indian tickers
- Fetches 1 month of historical prices from Yahoo Finance
- Trains a Linear Regression model
- Returns historical prices plus the next 5 predicted business-day prices as JSON
- Adds a FinTel-branded frontend dashboard at the root URL
- Shows a rationale block explaining the model direction
- Pulls recent Google News headlines to support the forecast narrative
- Links out to the matched exchange/news view for deeper research

## Project structure

- `src/FinTelServer.java` contains the HTTP server, Yahoo Finance fetch logic, linear regression model, API, and static file serving
- `public/index.html` contains the dashboard markup
- `public/styles.css` contains the visual design
- `public/app.js` loads forecast data and renders the chart, rationale, links, and news

## Run

```powershell
javac -d out src\FinTelServer.java
java -cp out FinTelServer
```

The server starts on `http://localhost:8080`.

Open `http://localhost:8080` to use the frontend dashboard.

## API

`GET /predict?ticker=Reliance`

`GET /search?query=HDFC`

## Example response

```json
{
  "ticker": "RELIANCE.NS",
  "company_name": "RELIANCE INDUSTRIES LTD",
  "exchange": "NSE",
  "currency": "INR",
  "model": "LinearRegression",
  "historical_prices": [
    {
      "date": "2026-03-09",
      "close": 1424.0
    }
  ],
  "predicted_prices": [
    {
      "date": "2026-04-07",
      "predicted_close": 1350.73
    }
  ],
  "generated_at": "2026-04-06T17:35:00Z"
}
```
