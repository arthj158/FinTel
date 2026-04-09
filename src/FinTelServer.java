import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class FinTelServer {
    private static final int PORT = 8080;
    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("dd-MM-yyyy");
    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .build();

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/", new RootHandler());
        server.createContext("/analysis", new AnalysisHandler());
        server.createContext("/trending", new TrendingHandler());
        server.createContext("/app.js", new StaticFileHandler("public/app.js", "application/javascript; charset=utf-8"));
        server.createContext("/fintel-mark.svg", new StaticFileHandler("public/fintel-mark.svg", "image/svg+xml; charset=utf-8"));
        server.createContext("/home.js", new StaticFileHandler("public/home.js", "application/javascript; charset=utf-8"));
        server.createContext("/trending.js", new StaticFileHandler("public/trending.js", "application/javascript; charset=utf-8"));
        server.createContext("/predict", new PredictHandler());
        server.createContext("/search", new SearchHandler());
        server.createContext("/styles.css", new StaticFileHandler("public/styles.css", "text/css; charset=utf-8"));
        server.setExecutor(null);

        System.out.println("FinTel server running on http://localhost:" + PORT);
        server.start();
    }

    static class RootHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed.\"}");
                return;
            }
            sendText(exchange, 200, readFile("public/index.html"), "text/html; charset=utf-8");
        }
    }

    static class AnalysisHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed.\"}");
                return;
            }
            sendText(exchange, 200, readFile("public/analysis.html"), "text/html; charset=utf-8");
        }
    }

    static class TrendingHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed.\"}");
                return;
            }
            sendText(exchange, 200, readFile("public/trending.html"), "text/html; charset=utf-8");
        }
    }

    static class StaticFileHandler implements HttpHandler {
        private final String filePath;
        private final String contentType;

        private StaticFileHandler(String filePath, String contentType) {
            this.filePath = filePath;
            this.contentType = contentType;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed.\"}");
                return;
            }
            sendText(exchange, 200, readFile(filePath), contentType);
        }
    }

    static class SearchHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed.\"}");
                return;
            }

            Map<String, String> queryParams = parseQuery(exchange.getRequestURI());
            String query = queryParams.getOrDefault("query", "").trim();
            if (query.isEmpty()) {
                sendJson(exchange, 400, "{\"error\":\"Query parameter 'query' is required.\"}");
                return;
            }

            try {
                List<SearchResult> results = searchIndianStocks(query);
                sendJson(exchange, 200, buildSearchResponse(results));
            } catch (IllegalArgumentException e) {
                sendJson(exchange, 404, "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
            } catch (Exception e) {
                sendJson(exchange, 500, "{\"error\":\"Failed to search Indian stocks: " + escapeJson(e.getMessage()) + "\"}");
            }
        }
    }

    static class PredictHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed.\"}");
                return;
            }

            Map<String, String> queryParams = parseQuery(exchange.getRequestURI());
            String query = queryParams.getOrDefault("ticker", "").trim();
            if (query.isEmpty()) {
                sendJson(exchange, 400, "{\"error\":\"Query parameter 'ticker' is required. Use an Indian stock name or symbol.\"}");
                return;
            }

            try {
                SearchResult resolved = resolveIndianTicker(query);
                StockData stockData = fetchHistoricalPrices(resolved.symbol());
                List<PricePoint> historicalPrices = stockData.historicalPrices();
                if (historicalPrices.isEmpty()) {
                    sendJson(exchange, 404, "{\"error\":\"No historical prices found for '" + escapeJson(query) + "'.\"}");
                    return;
                }

                AutoRegressiveModel model = AutoRegressiveModel.train(historicalPrices);
                List<PredictedPricePoint> predictions = predictNextBusinessDays(historicalPrices, model, 5);
                List<NewsItem> newsItems = fetchNewsItems(resolved);
                ForecastRationale rationale = buildForecastRationale(resolved, historicalPrices, predictions, newsItems, model);
                String response = buildPredictionResponse(resolved, stockData, predictions, newsItems, rationale);
                sendJson(exchange, 200, response);
            } catch (IllegalArgumentException e) {
                sendJson(exchange, 404, "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
            } catch (Exception e) {
                sendJson(
                    exchange,
                    500,
                    "{\"error\":\"Failed to process query '" + escapeJson(query) + "': " + escapeJson(e.getMessage()) + "\"}"
                );
            }
        }
    }

    private static StockData fetchHistoricalPrices(String ticker) throws IOException, InterruptedException {
        String url = "https://query1.finance.yahoo.com/v8/finance/chart/" + ticker
            + "?range=1mo&interval=1d&includePrePost=false&events=div%2Csplits";

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("User-Agent", "Mozilla/5.0")
            .header("Accept", "application/json")
            .header("Accept-Language", "en-US,en;q=0.9")
            .GET()
            .build();

        HttpResponse<String> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IllegalArgumentException(
                "Unable to fetch data for ticker '" + ticker + "' (HTTP " + response.statusCode() + ")."
            );
        }

        String body = response.body();
        if (body.contains("\"result\":null") || body.contains("\"error\":{\"code\"")) {
            throw new IllegalArgumentException("Yahoo Finance returned no result for ticker '" + ticker + "'.");
        }

        List<Long> timestamps = parseLongArray(extractArray(body, "\"timestamp\":[", "]"));
        int quoteIndex = body.indexOf("\"quote\":[{");
        if (quoteIndex < 0) {
            throw new IllegalArgumentException("Yahoo Finance response did not include quote data for ticker '" + ticker + "'.");
        }

        int closeIndex = body.indexOf("\"close\":[", quoteIndex);
        if (closeIndex < 0) {
            throw new IllegalArgumentException("Yahoo Finance response did not include closing prices for ticker '" + ticker + "'.");
        }

        String closeArray = extractArray(body.substring(closeIndex), "\"close\":[", "]");
        List<Double> closes = parseDoubleArray(closeArray);

        List<PricePoint> prices = new ArrayList<>();
        int size = Math.min(timestamps.size(), closes.size());
        for (int i = 0; i < size; i++) {
            Double close = closes.get(i);
            if (close == null) {
                continue;
            }

            LocalDate date = Instant.ofEpochSecond(timestamps.get(i))
                .atZone(ZoneOffset.UTC)
                .toLocalDate();
            prices.add(new PricePoint(date, close));
        }

        if (prices.isEmpty()) {
            throw new IllegalArgumentException("No usable closing prices found for ticker '" + ticker + "'.");
        }

        double fiftyTwoWeekHigh = parseJsonDouble(body, "fiftyTwoWeekHigh");
        double fiftyTwoWeekLow = parseJsonDouble(body, "fiftyTwoWeekLow");

        return new StockData(prices, fiftyTwoWeekHigh, fiftyTwoWeekLow);
    }

    private static SearchResult resolveIndianTicker(String query) throws IOException, InterruptedException {
        String normalized = query.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("Enter an Indian stock name or NSE/BSE symbol.");
        }

        if (isIndianSymbol(normalized)) {
            String symbol = normalized.toUpperCase();
            return new SearchResult(symbol, symbol, "", inferExchangeFromSymbol(symbol), "INR");
        }

        List<SearchResult> results = searchIndianStocks(normalized);
        if (results.isEmpty()) {
            throw new IllegalArgumentException("No Indian stock match found for '" + normalized + "'.");
        }
        return results.get(0);
    }

    private static List<SearchResult> searchIndianStocks(String query) throws IOException, InterruptedException {
        String encodedQuery = java.net.URLEncoder.encode(query, StandardCharsets.UTF_8);
        String url = "https://query2.finance.yahoo.com/v1/finance/search?q=" + encodedQuery
            + "&quotesCount=25&newsCount=0&enableFuzzyQuery=true";

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("User-Agent", "Mozilla/5.0")
            .header("Accept", "application/json")
            .header("Accept-Language", "en-US,en;q=0.9")
            .GET()
            .build();

        HttpResponse<String> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IllegalArgumentException("Unable to search Yahoo Finance right now (HTTP " + response.statusCode() + ").");
        }

        List<String> quoteObjects = extractQuoteObjects(response.body());
        List<SearchResult> results = new ArrayList<>();
        for (String quoteObject : quoteObjects) {
            String symbol = extractJsonString(quoteObject, "symbol");
            String shortName = extractJsonString(quoteObject, "shortname");
            String longName = extractJsonString(quoteObject, "longname");
            String exchange = firstNonBlank(
                extractJsonString(quoteObject, "exchDisp"),
                extractJsonString(quoteObject, "exchange")
            );
            String quoteType = extractJsonString(quoteObject, "quoteType");

            if (symbol.isBlank() || !isIndianSearchMatch(symbol, exchange) || !"EQUITY".equalsIgnoreCase(quoteType) || symbol.startsWith("0P")) {
                continue;
            }

            results.add(new SearchResult(
                symbol,
                firstNonBlank(shortName, longName, symbol),
                longName,
                exchange,
                "INR"
            ));
        }

        if (results.isEmpty()) {
            throw new IllegalArgumentException("No Indian stock match found for '" + query + "'.");
        }

        return results;
    }

    private static List<NewsItem> fetchNewsItems(SearchResult resolved) throws IOException, InterruptedException {
        String baseSymbol = getBaseSymbol(resolved.symbol());
        String searchQuery = "\"" + firstNonBlank(resolved.longName(), resolved.displayName()) + "\" "
            + resolved.exchange() + " India stock " + baseSymbol;
        String encodedQuery = java.net.URLEncoder.encode(searchQuery, StandardCharsets.UTF_8);
        String url = "https://news.google.com/rss/search?q=" + encodedQuery + "&hl=en-IN&gl=IN&ceid=IN:en";

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("User-Agent", "Mozilla/5.0")
            .header("Accept", "application/rss+xml, application/xml, text/xml")
            .GET()
            .build();

        HttpResponse<String> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            return List.of();
        }

        List<String> itemBlocks = extractXmlItems(response.body());
        List<NewsItem> newsItems = new ArrayList<>();
        for (String itemBlock : itemBlocks) {
            String title = decodeHtml(extractXmlTag(itemBlock, "title"));
            String link = decodeHtml(extractXmlTag(itemBlock, "link"));
            String publishedAt = normalizePubDate(extractXmlTag(itemBlock, "pubDate"));
            String publisher = decodeHtml(extractXmlTag(itemBlock, "source"));

            if (title.isBlank() || link.isBlank() || !isRelevantNewsTitle(title, resolved)) {
                continue;
            }

            newsItems.add(new NewsItem(title, publisher.isBlank() ? "Unknown source" : publisher, link, publishedAt));
            if (newsItems.size() == 4) {
                break;
            }
        }

        return newsItems;
    }

    private static List<PredictedPricePoint> predictNextBusinessDays(
        List<PricePoint> historicalPrices,
        AutoRegressiveModel model,
        int forecastDays
    ) {
        List<PredictedPricePoint> predictions = new ArrayList<>();
        LocalDate nextDate = historicalPrices.get(historicalPrices.size() - 1).date();
        List<Double> rollingPrices = new ArrayList<>();
        for (PricePoint price : historicalPrices) {
            rollingPrices.add(price.close());
        }

        double recentMomentum = averageReturn(rollingPrices, 5);
        double recentVolatility = standardDeviationOfReturns(rollingPrices, 7);
        List<Double> rollingReturns = extractRecentReturns(rollingPrices, 7);
        double anchorAverage = averageOfLastValues(rollingPrices, 5);

        while (predictions.size() < forecastDays) {
            nextDate = nextDate.plusDays(1);
            if (nextDate.getDayOfWeek() == DayOfWeek.SATURDAY || nextDate.getDayOfWeek() == DayOfWeek.SUNDAY) {
                continue;
            }

            double latestClose = rollingPrices.get(rollingPrices.size() - 1);
            double modelClose = model.predictNextClose(rollingPrices);
            double modelReturn = latestClose == 0.0 ? 0.0 : (modelClose - latestClose) / latestClose;
            double patternReturn = rollingReturns.isEmpty() ? recentMomentum : rollingReturns.get(predictions.size() % rollingReturns.size());
            double previousPattern = rollingReturns.size() < 2
                ? patternReturn
                : rollingReturns.get((predictions.size() + rollingReturns.size() - 1) % rollingReturns.size());
            double returnAcceleration = patternReturn - previousPattern;
            double meanReversion = latestClose == 0.0 ? 0.0 : ((anchorAverage - latestClose) / latestClose) * 0.18;
            double momentumCarry = recentMomentum * Math.max(0.55, 1.0 - (predictions.size() * 0.08));
            double volatilityKick = recentVolatility * (0.85 + (predictions.size() * 0.10));
            double directionalKick = Math.signum(patternReturn == 0.0 ? momentumCarry : patternReturn) * volatilityKick;
            double adjustedReturn = (modelReturn * 0.20)
                + (momentumCarry * 0.24)
                + (patternReturn * 0.36)
                + (returnAcceleration * 0.14)
                + meanReversion
                + directionalKick;
            adjustedReturn = clamp(adjustedReturn, -0.045, 0.045);
            double predictedClose = latestClose * (1.0 + adjustedReturn);
            predictedClose = clamp(predictedClose, latestClose * 0.88, latestClose * 1.12);
            predictions.add(new PredictedPricePoint(nextDate, predictedClose));
            rollingPrices.add(predictedClose);
            rollingReturns.add(adjustedReturn);
            anchorAverage = ((anchorAverage * 4.0) + predictedClose) / 5.0;
            if (rollingReturns.size() > 7) {
                rollingReturns.remove(0);
            }
        }

        return predictions;
    }

    private static String buildPredictionResponse(
        SearchResult resolved,
        StockData stockData,
        List<PredictedPricePoint> predictions,
        List<NewsItem> newsItems,
        ForecastRationale rationale
    ) {
        List<PricePoint> historicalPrices = stockData.historicalPrices();
        List<PricePoint> displayHistory = historicalPrices.subList(Math.max(historicalPrices.size() - 7, 0), historicalPrices.size());
        StringBuilder json = new StringBuilder();
        json.append("{");
        json.append("\"ticker\":\"").append(escapeJson(resolved.symbol())).append("\",");
        json.append("\"company_name\":\"").append(escapeJson(resolved.displayName())).append("\",");
        json.append("\"exchange\":\"").append(escapeJson(resolved.exchange())).append("\",");
        json.append("\"currency\":\"").append(escapeJson(resolved.currency())).append("\",");
        json.append("\"fifty_two_week_high\":").append(formatDecimal(stockData.fiftyTwoWeekHigh())).append(",");
        json.append("\"fifty_two_week_low\":").append(formatDecimal(stockData.fiftyTwoWeekLow())).append(",");
        json.append("\"market_url\":\"").append(escapeJson(buildMarketUrl(resolved))).append("\",");
        json.append("\"news_search_url\":\"").append(escapeJson(buildNewsSearchUrl(resolved))).append("\",");
        json.append("\"model\":\"AutoregressiveRidgeMomentum\",");
        json.append("\"historical_prices\":[");

        for (int i = 0; i < displayHistory.size(); i++) {
            PricePoint point = displayHistory.get(i);
            if (i > 0) {
                json.append(",");
            }
            json.append("{");
            json.append("\"date\":\"").append(point.date().format(DATE_FORMAT)).append("\",");
            json.append("\"close\":").append(formatDecimal(point.close()));
            json.append("}");
        }

        json.append("],");
        json.append("\"predicted_prices\":[");

        for (int i = 0; i < predictions.size(); i++) {
            PredictedPricePoint point = predictions.get(i);
            if (i > 0) {
                json.append(",");
            }
            json.append("{");
            json.append("\"date\":\"").append(point.date().format(DATE_FORMAT)).append("\",");
            json.append("\"predicted_close\":").append(formatDecimal(point.predictedClose()));
            json.append("}");
        }

        json.append("],");
        json.append("\"rationale\":{");
        json.append("\"label\":\"").append(escapeJson(rationale.label())).append("\",");
        json.append("\"summary\":\"").append(escapeJson(rationale.summary())).append("\",");
        json.append("\"trend_direction\":\"").append(escapeJson(rationale.trendDirection())).append("\",");
        json.append("\"news_bias\":\"").append(escapeJson(rationale.newsBias())).append("\",");
        json.append("\"forecast_move\":\"").append(escapeJson(rationale.forecastMove())).append("\",");
        json.append("\"disclaimer\":\"").append(escapeJson(rationale.disclaimer())).append("\"");
        json.append("},");
        json.append("\"news_items\":[");

        for (int i = 0; i < newsItems.size(); i++) {
            NewsItem item = newsItems.get(i);
            if (i > 0) {
                json.append(",");
            }
            json.append("{");
            json.append("\"title\":\"").append(escapeJson(item.title())).append("\",");
            json.append("\"publisher\":\"").append(escapeJson(item.publisher())).append("\",");
            json.append("\"link\":\"").append(escapeJson(item.link())).append("\",");
            json.append("\"published_at\":\"").append(escapeJson(item.publishedAt())).append("\"");
            json.append("}");
        }

        json.append("],");
        json.append("\"generated_at\":\"").append(Instant.now().toString()).append("\"");
        json.append("}");
        return json.toString();
    }

    private static String buildSearchResponse(List<SearchResult> results) {
        StringBuilder json = new StringBuilder();
        json.append("{\"results\":[");
        for (int i = 0; i < results.size(); i++) {
            SearchResult result = results.get(i);
            if (i > 0) {
                json.append(",");
            }
            json.append("{");
            json.append("\"symbol\":\"").append(escapeJson(result.symbol())).append("\",");
            json.append("\"name\":\"").append(escapeJson(result.displayName())).append("\",");
            json.append("\"exchange\":\"").append(escapeJson(result.exchange())).append("\",");
            json.append("\"currency\":\"").append(escapeJson(result.currency())).append("\"");
            json.append("}");
        }
        json.append("]}");
        return json.toString();
    }

    private static Map<String, String> parseQuery(URI uri) {
        Map<String, String> params = new LinkedHashMap<>();
        String query = uri.getRawQuery();
        if (query == null || query.isBlank()) {
            return params;
        }

        String[] pairs = query.split("&");
        for (String pair : pairs) {
            String[] parts = pair.split("=", 2);
            String key = urlDecode(parts[0]);
            String value = parts.length > 1 ? urlDecode(parts[1]) : "";
            params.put(key, value);
        }

        return params;
    }

    private static String urlDecode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static void sendJson(HttpExchange exchange, int statusCode, String json) throws IOException {
        sendText(exchange, statusCode, json, "application/json; charset=utf-8");
    }

    private static void sendText(HttpExchange exchange, int statusCode, String body, String contentType) throws IOException {
        byte[] responseBytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(statusCode, responseBytes.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(responseBytes);
        }
    }

    private static String readFile(String filePath) throws IOException {
        return Files.readString(Path.of(filePath), StandardCharsets.UTF_8);
    }

    private static List<String> extractXmlItems(String body) {
        List<String> items = new ArrayList<>();
        Matcher matcher = Pattern.compile("<item>(.*?)</item>", Pattern.DOTALL).matcher(body);
        while (matcher.find()) {
            items.add(matcher.group(1));
        }
        return items;
    }

    private static String extractXmlTag(String body, String tagName) {
        Pattern pattern = Pattern.compile("<" + tagName + "(?: [^>]*)?>(.*?)</" + tagName + ">", Pattern.DOTALL);
        Matcher matcher = pattern.matcher(body);
        if (!matcher.find()) {
            return "";
        }
        return matcher.group(1).trim();
    }

    private static List<String> extractQuoteObjects(String body) {
        List<String> results = new ArrayList<>();
        int quotesStart = body.indexOf("\"quotes\":[");
        if (quotesStart < 0) {
            return results;
        }

        int arrayStart = body.indexOf("[", quotesStart);
        if (arrayStart < 0) {
            return results;
        }

        int depth = 0;
        int objectStart = -1;
        boolean inString = false;
        for (int i = arrayStart + 1; i < body.length(); i++) {
            char current = body.charAt(i);
            char previous = i > 0 ? body.charAt(i - 1) : '\0';

            if (current == '"' && previous != '\\') {
                inString = !inString;
            }
            if (inString) {
                continue;
            }

            if (current == '{') {
                if (depth == 0) {
                    objectStart = i;
                }
                depth++;
            } else if (current == '}') {
                depth--;
                if (depth == 0 && objectStart >= 0) {
                    results.add(body.substring(objectStart, i + 1));
                    objectStart = -1;
                }
            } else if (current == ']' && depth == 0) {
                break;
            }
        }

        return results;
    }

    private static String extractArray(String source, String startToken, String endToken) {
        int start = source.indexOf(startToken);
        if (start < 0) {
            return "";
        }
        start += startToken.length();
        int end = source.indexOf(endToken, start);
        if (end < 0) {
            return "";
        }
        return source.substring(start, end);
    }

    private static List<Long> parseLongArray(String csv) {
        List<Long> values = new ArrayList<>();
        if (csv.isBlank()) {
            return values;
        }

        for (String token : csv.split(",")) {
            String trimmed = token.trim();
            if (!trimmed.isEmpty() && !"null".equals(trimmed)) {
                values.add(Long.parseLong(trimmed));
            }
        }
        return values;
    }

    private static List<Double> parseDoubleArray(String csv) {
        List<Double> values = new ArrayList<>();
        if (csv.isBlank()) {
            return values;
        }

        for (String token : csv.split(",")) {
            String trimmed = token.trim();
            if ("null".equals(trimmed) || trimmed.isEmpty()) {
                values.add(null);
            } else {
                values.add(Double.parseDouble(trimmed));
            }
        }
        return values;
    }

    private static String formatDecimal(double value) {
        return String.format(Locale.US, "%.2f", value);
    }

    private static double parseJsonDouble(String source, String fieldName) {
        Pattern pattern = Pattern.compile("\"" + Pattern.quote(fieldName) + "\":(-?\\d+(?:\\.\\d+)?)");
        Matcher matcher = pattern.matcher(source);
        if (!matcher.find()) {
            return 0.0;
        }
        return Double.parseDouble(matcher.group(1));
    }

    private static ForecastRationale buildForecastRationale(
        SearchResult resolved,
        List<PricePoint> historicalPrices,
        List<PredictedPricePoint> predictions,
        List<NewsItem> newsItems,
        AutoRegressiveModel model
    ) {
        double latestClose = historicalPrices.get(historicalPrices.size() - 1).close();
        double forecastEnd = predictions.get(predictions.size() - 1).predictedClose();
        double fittedCurrent = model.predictNextClose(extractCloseValues(historicalPrices));
        double movePct = latestClose == 0.0 ? 0.0 : ((forecastEnd - latestClose) / latestClose) * 100.0;
        double shortAverage = averageOfLast(historicalPrices, 3);
        double mediumAverage = averageOfLast(historicalPrices, 7);
        double momentum = shortAverage - mediumAverage;
        String trendDirection = momentum > latestClose * 0.008 ? "Short-term momentum is above the weekly average"
            : momentum < -latestClose * 0.008 ? "Short-term momentum is below the weekly average"
            : "Short-term momentum is close to the weekly average";
        String newsBias = determineNewsBias(newsItems);
        String label = movePct >= 0 ? "FinTel sees upside pressure" : "FinTel sees downside pressure";
        String summary = buildRationaleSummary(resolved, movePct, trendDirection, newsBias, newsItems.size(), latestClose, fittedCurrent);
        String forecastMove = String.format(Locale.US, "%+.2f%% vs latest close", movePct);
        String disclaimer = "This forecast uses an autoregressive lag model with recent momentum, short volatility carry, and headline context. It is stronger than a straight line fit, but it is still an academic forecast, not certainty.";

        return new ForecastRationale(label, summary, trendDirection, newsBias, forecastMove, disclaimer);
    }

    private static String buildRationaleSummary(
        SearchResult resolved,
        double movePct,
        String trendDirection,
        String newsBias,
        int newsCount,
        double latestClose,
        double fittedCurrent
    ) {
        String directionPhrase;
        if (movePct >= 0 && latestClose < fittedCurrent) {
            directionPhrase = "The latest close sits below the model's recent lag-based estimate, so the forecast leans toward a modest rebound.";
        } else if (movePct < 0 && latestClose > fittedCurrent) {
            directionPhrase = "The latest close sits above the model's recent lag-based estimate, so the forecast allows for some cooling.";
        } else if (movePct >= 0) {
            directionPhrase = "The autoregressive model projects a modest rise from the latest close.";
        } else {
            directionPhrase = "The autoregressive model projects a softer path from the latest close.";
        }
        String newsPhrase = newsCount > 0
            ? "Recent matched headlines read as " + newsBias.toLowerCase(Locale.US) + "."
            : "Recent matched headlines were limited, so the model is leaning more on price trend than news.";
        return directionPhrase + " " + trendDirection + " is the main driver for " + resolved.displayName()
            + ", and " + newsPhrase;
    }

    private static List<Double> extractCloseValues(List<PricePoint> historicalPrices) {
        List<Double> closes = new ArrayList<>();
        for (PricePoint pricePoint : historicalPrices) {
            closes.add(pricePoint.close());
        }
        return closes;
    }

    private static double averageOfLast(List<PricePoint> historicalPrices, int window) {
        int start = Math.max(historicalPrices.size() - window, 0);
        double sum = 0.0;
        for (int i = start; i < historicalPrices.size(); i++) {
            sum += historicalPrices.get(i).close();
        }
        int count = historicalPrices.size() - start;
        return count == 0 ? 0.0 : sum / count;
    }

    private static double averageOfLastValues(List<Double> values, int window) {
        int start = Math.max(values.size() - window, 0);
        double sum = 0.0;
        for (int i = start; i < values.size(); i++) {
            sum += values.get(i);
        }
        int count = values.size() - start;
        return count == 0 ? 0.0 : sum / count;
    }

    private static double averageReturn(List<Double> closes, int window) {
        List<Double> returns = extractRecentReturns(closes, window);
        if (returns.isEmpty()) {
            return 0.0;
        }
        double sum = 0.0;
        for (double value : returns) {
            sum += value;
        }
        return sum / returns.size();
    }

    private static double standardDeviationOfReturns(List<Double> closes, int window) {
        List<Double> returns = extractRecentReturns(closes, window);
        if (returns.size() < 2) {
            return 0.0;
        }
        double mean = averageReturn(closes, window);
        double sumSquares = 0.0;
        for (double value : returns) {
            double diff = value - mean;
            sumSquares += diff * diff;
        }
        return Math.sqrt(sumSquares / returns.size());
    }

    private static List<Double> extractRecentReturns(List<Double> closes, int window) {
        List<Double> returns = new ArrayList<>();
        int start = Math.max(1, closes.size() - window);
        for (int i = start; i < closes.size(); i++) {
            double previous = closes.get(i - 1);
            double current = closes.get(i);
            if (previous != 0.0) {
                returns.add((current - previous) / previous);
            }
        }
        return returns;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static String determineNewsBias(List<NewsItem> newsItems) {
        int score = 0;
        for (NewsItem item : newsItems) {
            String title = item.title().toLowerCase(Locale.US);
            if (containsAny(title, "gain", "rise", "surge", "up", "deal", "wins", "growth", "rally", "outperform")) {
                score++;
            }
            if (containsAny(title, "fall", "down", "slip", "loss", "pressure", "worry", "tumbles", "weak", "miss")) {
                score--;
            }
        }

        if (score > 0) {
            return "Supportive headlines";
        }
        if (score < 0) {
            return "Cautious headlines";
        }
        return "Mixed headlines";
    }

    private static String extractJsonString(String source, String fieldName) {
        Pattern pattern = Pattern.compile("\"" + Pattern.quote(fieldName) + "\":\"((?:\\\\.|[^\"\\\\])*)\"");
        Matcher matcher = pattern.matcher(source);
        if (!matcher.find()) {
            return "";
        }
        return unescapeJson(matcher.group(1));
    }

    private static boolean isIndianSearchMatch(String symbol, String exchange) {
        String normalizedSymbol = symbol.toUpperCase();
        String normalizedExchange = exchange.toUpperCase();
        return normalizedSymbol.endsWith(".NS")
            || normalizedSymbol.endsWith(".BO")
            || normalizedExchange.contains("NSE")
            || normalizedExchange.contains("BSE")
            || normalizedExchange.contains("NSI")
            || normalizedExchange.contains("BOM");
    }

    private static boolean isIndianSymbol(String query) {
        String normalized = query.trim().toUpperCase();
        return normalized.endsWith(".NS") || normalized.endsWith(".BO");
    }

    private static boolean isRelevantNewsTitle(String title, SearchResult resolved) {
        String normalizedTitle = title.toLowerCase(Locale.US);
        String normalizedName = firstNonBlank(resolved.longName(), resolved.displayName()).toLowerCase(Locale.US);
        String baseSymbol = getBaseSymbol(resolved.symbol()).toLowerCase(Locale.US);

        if (containsAny(normalizedTitle, "historical prices", "quote & history", "tradingview", "stock price and chart")) {
            return false;
        }

        String[] nameTokens = normalizedName.replaceAll("[^a-z0-9 ]", " ").split("\\s+");
        int tokenMatches = 0;
        for (String token : nameTokens) {
            if (token.length() < 4) {
                continue;
            }
            if (normalizedTitle.contains(token)) {
                tokenMatches++;
            }
        }

        return normalizedTitle.contains(baseSymbol) || tokenMatches >= 1;
    }

    private static boolean containsAny(String source, String... terms) {
        for (String term : terms) {
            if (source.contains(term)) {
                return true;
            }
        }
        return false;
    }

    private static String inferExchangeFromSymbol(String symbol) {
        String normalized = symbol.toUpperCase();
        if (normalized.endsWith(".NS")) {
            return "NSE";
        }
        if (normalized.endsWith(".BO")) {
            return "BSE";
        }
        return "India";
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private static String getBaseSymbol(String symbol) {
        int dotIndex = symbol.indexOf('.');
        if (dotIndex < 0) {
            return symbol;
        }
        return symbol.substring(0, dotIndex);
    }

    private static String buildMarketUrl(SearchResult resolved) {
        if ("NSE".equalsIgnoreCase(resolved.exchange())) {
            return "https://www.nseindia.com/get-quotes/equity?symbol=" + getBaseSymbol(resolved.symbol());
        }

        String query = java.net.URLEncoder.encode(resolved.displayName() + " " + getBaseSymbol(resolved.symbol()) + " BSE", StandardCharsets.UTF_8);
        return "https://www.google.com/search?q=" + query;
    }

    private static String buildNewsSearchUrl(SearchResult resolved) {
        String query = java.net.URLEncoder.encode(
            "\"" + firstNonBlank(resolved.longName(), resolved.displayName()) + "\" " + resolved.exchange() + " India stock",
            StandardCharsets.UTF_8
        );
        return "https://news.google.com/search?q=" + query + "&hl=en-IN&gl=IN&ceid=IN:en";
    }

    private static String normalizePubDate(String pubDate) {
        if (pubDate == null || pubDate.isBlank()) {
            return Instant.now().toString();
        }
        try {
            return ZonedDateTime.parse(pubDate, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toString();
        } catch (DateTimeParseException ignored) {
            return Instant.now().toString();
        }
    }

    private static String decodeHtml(String value) {
        return value
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&nbsp;", " ");
    }

    private static String unescapeJson(String value) {
        return value
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
            .replace("\\/", "/");
    }

    private static String escapeJson(String value) {
        String escaped = value.replace("\\", "\\\\").replace("\"", "\\\"");
        Pattern controlChars = Pattern.compile("[\\x00-\\x1F]");
        Matcher matcher = controlChars.matcher(escaped);
        return matcher.replaceAll("");
    }

    static class PricePoint {
        private final LocalDate date;
        private final double close;

        PricePoint(LocalDate date, double close) {
            this.date = date;
            this.close = close;
        }

        LocalDate date() {
            return date;
        }

        double close() {
            return close;
        }
    }

    static class PredictedPricePoint {
        private final LocalDate date;
        private final double predictedClose;

        PredictedPricePoint(LocalDate date, double predictedClose) {
            this.date = date;
            this.predictedClose = predictedClose;
        }

        LocalDate date() {
            return date;
        }

        double predictedClose() {
            return predictedClose;
        }
    }

    static class SearchResult {
        private final String symbol;
        private final String displayName;
        private final String longName;
        private final String exchange;
        private final String currency;

        SearchResult(String symbol, String displayName, String longName, String exchange, String currency) {
            this.symbol = symbol;
            this.displayName = displayName;
            this.longName = longName;
            this.exchange = exchange;
            this.currency = currency;
        }

        String symbol() {
            return symbol;
        }

        String displayName() {
            return displayName;
        }

        String longName() {
            return longName;
        }

        String exchange() {
            return exchange;
        }

        String currency() {
            return currency;
        }
    }

    static class StockData {
        private final List<PricePoint> historicalPrices;
        private final double fiftyTwoWeekHigh;
        private final double fiftyTwoWeekLow;

        StockData(List<PricePoint> historicalPrices, double fiftyTwoWeekHigh, double fiftyTwoWeekLow) {
            this.historicalPrices = historicalPrices;
            this.fiftyTwoWeekHigh = fiftyTwoWeekHigh;
            this.fiftyTwoWeekLow = fiftyTwoWeekLow;
        }

        List<PricePoint> historicalPrices() {
            return historicalPrices;
        }

        double fiftyTwoWeekHigh() {
            return fiftyTwoWeekHigh;
        }

        double fiftyTwoWeekLow() {
            return fiftyTwoWeekLow;
        }
    }

    static class NewsItem {
        private final String title;
        private final String publisher;
        private final String link;
        private final String publishedAt;

        NewsItem(String title, String publisher, String link, String publishedAt) {
            this.title = title;
            this.publisher = publisher;
            this.link = link;
            this.publishedAt = publishedAt;
        }

        String title() {
            return title;
        }

        String publisher() {
            return publisher;
        }

        String link() {
            return link;
        }

        String publishedAt() {
            return publishedAt;
        }
    }

    static class ForecastRationale {
        private final String label;
        private final String summary;
        private final String trendDirection;
        private final String newsBias;
        private final String forecastMove;
        private final String disclaimer;

        ForecastRationale(
            String label,
            String summary,
            String trendDirection,
            String newsBias,
            String forecastMove,
            String disclaimer
        ) {
            this.label = label;
            this.summary = summary;
            this.trendDirection = trendDirection;
            this.newsBias = newsBias;
            this.forecastMove = forecastMove;
            this.disclaimer = disclaimer;
        }

        String label() {
            return label;
        }

        String summary() {
            return summary;
        }

        String trendDirection() {
            return trendDirection;
        }

        String newsBias() {
            return newsBias;
        }

        String forecastMove() {
            return forecastMove;
        }

        String disclaimer() {
            return disclaimer;
        }
    }

    static class AutoRegressiveModel {
        private static final int LAG_COUNT = 3;
        private static final double RIDGE_PENALTY = 0.35;

        private final double[] weights;
        private final double fallbackAverage;

        private AutoRegressiveModel(double[] weights, double fallbackAverage) {
            this.weights = weights;
            this.fallbackAverage = fallbackAverage;
        }

        static AutoRegressiveModel train(List<PricePoint> prices) {
            List<Double> closes = new ArrayList<>();
            for (PricePoint price : prices) {
                closes.add(price.close());
            }

            if (closes.size() <= LAG_COUNT + 1) {
                return new AutoRegressiveModel(defaultWeights(), average(closes));
            }

            int featureCount = 6;
            int sampleCount = closes.size() - LAG_COUNT;
            double[][] normal = new double[featureCount][featureCount];
            double[] rhs = new double[featureCount];

            for (int index = LAG_COUNT; index < closes.size(); index++) {
                double[] features = buildFeatures(closes, index);
                double target = closes.get(index);
                for (int row = 0; row < featureCount; row++) {
                    rhs[row] += features[row] * target;
                    for (int col = 0; col < featureCount; col++) {
                        normal[row][col] += features[row] * features[col];
                    }
                }
            }

            for (int i = 0; i < featureCount; i++) {
                normal[i][i] += i == 0 ? 0.0001 : RIDGE_PENALTY;
            }

            double[] solvedWeights = solveLinearSystem(normal, rhs);
            if (solvedWeights == null) {
                solvedWeights = defaultWeights();
            }

            return new AutoRegressiveModel(solvedWeights, average(closes.subList(Math.max(closes.size() - 5, 0), closes.size())));
        }

        double predictNextClose(List<Double> rollingPrices) {
            if (rollingPrices.isEmpty()) {
                return fallbackAverage;
            }
            if (rollingPrices.size() <= LAG_COUNT) {
                return average(rollingPrices);
            }

            double[] features = buildFeatures(rollingPrices, rollingPrices.size());
            double rawPrediction = dot(weights, features);
            double latestClose = rollingPrices.get(rollingPrices.size() - 1);
            double shortAverage = average(rollingPrices.subList(Math.max(rollingPrices.size() - 3, 0), rollingPrices.size()));
            double blendedPrediction = (rawPrediction * 0.82) + (shortAverage * 0.18);
            double maxUp = latestClose * 1.12;
            double maxDown = latestClose * 0.88;
            return clamp(blendedPrediction, maxDown, maxUp);
        }

        private static double[] buildFeatures(List<Double> closes, int targetIndex) {
            double lag1 = closes.get(targetIndex - 1);
            double lag2 = closes.get(targetIndex - 2);
            double lag3 = closes.get(targetIndex - 3);
            double avg3 = (lag1 + lag2 + lag3) / 3.0;
            double momentum = lag1 - lag3;
            return new double[] {1.0, lag1, lag2, lag3, avg3, momentum};
        }

        private static double[] solveLinearSystem(double[][] matrix, double[] vector) {
            int n = vector.length;
            double[][] augmented = new double[n][n + 1];

            for (int row = 0; row < n; row++) {
                System.arraycopy(matrix[row], 0, augmented[row], 0, n);
                augmented[row][n] = vector[row];
            }

            for (int pivot = 0; pivot < n; pivot++) {
                int bestRow = pivot;
                for (int row = pivot + 1; row < n; row++) {
                    if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[bestRow][pivot])) {
                        bestRow = row;
                    }
                }

                if (Math.abs(augmented[bestRow][pivot]) < 1e-9) {
                    return null;
                }

                if (bestRow != pivot) {
                    double[] temp = augmented[pivot];
                    augmented[pivot] = augmented[bestRow];
                    augmented[bestRow] = temp;
                }

                double divisor = augmented[pivot][pivot];
                for (int col = pivot; col <= n; col++) {
                    augmented[pivot][col] /= divisor;
                }

                for (int row = 0; row < n; row++) {
                    if (row == pivot) {
                        continue;
                    }
                    double factor = augmented[row][pivot];
                    for (int col = pivot; col <= n; col++) {
                        augmented[row][col] -= factor * augmented[pivot][col];
                    }
                }
            }

            double[] solution = new double[n];
            for (int i = 0; i < n; i++) {
                solution[i] = augmented[i][n];
            }
            return solution;
        }

        private static double average(List<Double> values) {
            if (values.isEmpty()) {
                return 0.0;
            }
            double sum = 0.0;
            for (double value : values) {
                sum += value;
            }
            return sum / values.size();
        }

        private static double dot(double[] left, double[] right) {
            double total = 0.0;
            for (int i = 0; i < left.length; i++) {
                total += left[i] * right[i];
            }
            return total;
        }

        private static double clamp(double value, double min, double max) {
            return Math.max(min, Math.min(max, value));
        }

        private static double[] defaultWeights() {
            return new double[] {0.0, 0.55, 0.20, 0.10, 0.15, 0.05};
        }
    }
}
