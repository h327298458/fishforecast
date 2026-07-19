/* global process, fetch, setTimeout, URL, navigator, document */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { chromium } from "playwright-core";

const port = 8897;
const baseUrl = `http://127.0.0.1:${port}`;
const databasePath = `./data/e2e-smoke-${process.pid}.db`;
const password = "E2e-Only-Password-987!";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "/usr/bin/google-chrome");
const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], { env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath, INITIAL_ADMIN_USERNAME: "admin", INITIAL_ADMIN_PASSWORD: password, NODE_ENV: "development", COOKIE_SECURE: "false" }, stdio: ["ignore", "pipe", "pipe"] });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/system-status`)).ok) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("E2E_SERVER_START_TIMEOUT");
}

const point = { id: "draft-bondi", name: "Bondi Beach", address: "Bondi Beach NSW 2026, Australia", latitude: -33.8915, longitude: 151.2767, state: "NSW", timezone: "Australia/Sydney", countryCode: "AU" };
const forecast = (url) => {
  const source = new URL(url).searchParams.get("preferredTideSource") ?? "BOM_OFFICIAL";
  const actualSource = source === "BOM_OFFICIAL" ? "EOT20_MODEL" : source;
  const timestamp = new Date(); timestamp.setUTCMinutes(0, 0, 0);
  const score = { safetyStatus: "SAFE", safetyScore: 83, comfortScore: 78, fishingConditionScore: 76, dataConfidenceScore: 81, confidenceReasons: ["E2E fixture"], positives: ["平均风速较温和"], negatives: [], missing: [], ruleVersion: "e2e" };
  const hours = Array.from({ length: 24 }, (_, index) => ({ timestampUtc: new Date(timestamp.getTime() + index * 3_600_000).toISOString(), timestampLocal: new Date(timestamp.getTime() + index * 3_600_000).toISOString().slice(0, 19), temperatureC: 21, precipitationProbabilityPercent: 5, windSpeedKmh: 12, windGustKmh: 18, windDirectionDeg: 90, pressureHpa: 1016, waveHeightM: 1.1, swellPeriodSeconds: 9, modelSeaLevelTrendM: .1, tideHeightM: actualSource === "NO_TIDE" ? null : Math.sin(index / 2) * .7, tidePhase: actualSource === "NO_TIDE" ? null : "rising", warningSeverity: "none", sources: {}, score }));
  return { snapshotId: null, spot: { ...point, spotType: "beach", fishingMethod: "bottom_fishing", waterType: "coastal", preferredTideSource: source }, generatedAtUtc: new Date().toISOString(), degraded: false, providerStatus: { weather: { status: "available", provider: "Open-Meteo" }, marine: { status: "available", provider: "Open-Meteo Marine" }, officialTide: { status: "unavailable", provider: "BOM" }, eot20: { status: "available", provider: "EOT20" }, warnings: { status: "available", provider: "BOM" } }, days: [{ date: timestamp.toISOString().slice(0, 10), hours, windows: [{ startUtc: hours[1].timestampUtc, endUtc: hours[4].timestampUtc, averageScore: 76 }, { startUtc: hours[14].timestampUtc, endUtc: hours[17].timestampUtc, averageScore: 74 }] }], tides: { selectedSource: actualSource, preferredSource: source, actualTideSourceUsed: actualSource, fallbackReason: source === "BOM_OFFICIAL" ? "OFFICIAL_TIDE_UNAVAILABLE_AUTO_EOT20" : null, official: null, model: { status: "available", available: true, version: "EOT20-test", applicability: "APPLICABLE", events: [{ type: "HIGH", timestampUtc: hours[3].timestampUtc, heightM: 1.2 }] }, comparison: null }, warnings: { status: "CLEAR", warnings: [] }, observation: {}, bomMarineForecast: { status: "available" }, nswMhlWave: { status: "available", applicability: "APPLICABLE" }, waterData: { status: "NOT_APPLICABLE" }, marineApplicability: { status: "APPLICABLE", confidence: .85, gridDistanceKm: .5, requestedCoordinates: { latitude: point.latitude, longitude: point.longitude }, returnedCoordinates: { latitude: point.latitude, longitude: point.longitude } }, rainfallContext: { status: "available" }, regulations: { status: "REAL", state: "NSW", officialLinks: [], notice: "test" } };
};

async function configureRoutes(page) {
  await page.route("**/api/geocode/search?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [point] }) }));
  await page.route("**/api/geocode/reverse?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: point }) }));
  await page.route("**/api/forecast?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(forecast(route.request().url())) }));
  await page.route("**/api/tides/eot20?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "available", data: { model: "EOT20", version: "test", applicability: "APPLICABLE", confidence: .8, calculationCoordinates: { latitude: point.latitude, longitude: point.longitude }, values: [], dailyRanges: [], events: [{ type: "HIGH", timestampUtc: new Date().toISOString(), timestampLocal: new Date().toISOString(), heightM: 1.2 }] } }) }));
}

async function login(page) {
  await page.goto(baseUrl);
  await page.locator('input[autocomplete="username"]').fill("admin");
  await page.locator('input[type="password"]').fill(password);
  await page.locator(".auth-submit").click();
  await page.locator(".map-panel").waitFor();
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") process.stderr.write(`BROWSER: ${message.text()}\n`); });
  page.on("pageerror", (error) => process.stderr.write(`PAGEERROR: ${error.message}\n`));
  await configureRoutes(page);
  await login(page);
  await page.locator("#spot-search").fill("Bondi Beach");
  await page.locator('[role="option"]').click();
  try { await page.locator(".recommended-windows").waitFor({ timeout: 10_000 }); }
  catch (error) { process.stderr.write(`${(await page.locator("body").innerText()).slice(0, 2000)}\n`); throw error; }
  await page.locator(".tide-source-control").waitFor();
  if ((await page.locator(".tide-source-control button.active").innerText()) !== "EOT20 模型") throw new Error("AUTO_EOT20_SOURCE_NOT_VISIBLE");
  const drawnWindowLabels = (await page.locator(".chart svg text").allTextContents()).filter((value) => value.startsWith("窗口"));
  if (drawnWindowLabels.length !== 2) throw new Error(`ALL_WINDOWS_NOT_DRAWN:${JSON.stringify(drawnWindowLabels)}`);
  await page.locator(".footer-actions button").first().click();
  await page.locator(".spot-list button").waitFor();
  await page.locator(".footer-actions .primary").click();
  await page.locator('.modal input[name="bites"]').fill("2");
  await page.locator('.modal input[name="catches"]').fill("1");
  await page.locator(".modal button.primary").click();
  await page.locator(".success").waitFor();
  await page.locator(".success button").click();
  await page.locator("header nav button").nth(1).click();
  await page.locator(".secondary-view article").waitFor();
  await context.close();

  for (const scenario of [{ name: "success", code: 0 }, { name: "denied", code: 1 }, { name: "timeout", code: 3 }]) {
    const mobile = await browser.newContext({ viewport: { width: scenario.name === "success" ? 390 : 430, height: scenario.name === "success" ? 844 : 932 } });
    await mobile.addInitScript((code) => { Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition(success, failure) { if (code === 0) success({ coords: { latitude: -33.8915, longitude: 151.2767, accuracy: 25 } }); else failure({ code }); } } }); }, scenario.code);
    const mobilePage = await mobile.newPage();
    await configureRoutes(mobilePage);
    await login(mobilePage);
    await mobilePage.locator(".search-input button").click();
    if (scenario.name === "success") await mobilePage.locator('.coordinate-fields input').first().waitFor();
    else await mobilePage.locator(".search-error").waitFor();
    const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error(`HORIZONTAL_OVERFLOW_${scenario.name.toUpperCase()}`);
    await mobile.close();
  }
  process.stdout.write("E2E PASS: search/save/refreshable persistence/log history + geolocation success/denied/timeout + 390x844 and 430x932\n");
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill();
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
}
