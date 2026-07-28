import assert from "node:assert/strict";
import { Builder, By, until, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import firefox from "selenium-webdriver/firefox.js";
import generatedLog from "selenium-webdriver/bidi/generated/log.js";
import generatedNetwork from "selenium-webdriver/bidi/generated/network.js";
import { PrismaClient } from "@prisma/client";

const { Log } = generatedLog;
const { Network } = generatedNetwork;
const browser = process.argv[2] ?? "firefox";
const firefoxPrivate = browser !== "firefox-normal";
const baseUrl = process.env.BROWSER_TEST_BASE_URL ?? "http://localhost:3000";
const runId = `${browser}-${Date.now()}`;
const email = `lead-detail-${runId}@example.test`;
const password = "Browser-test-password-2026";
const prisma = new PrismaClient();

function builderFor(selectedBrowser) {
  const preferences = new logging.Preferences();
  preferences.setLevel(logging.Type.BROWSER, logging.Level.ALL);
  preferences.setLevel(logging.Type.PERFORMANCE, logging.Level.ALL);
  const builder = new Builder().setLoggingPrefs(preferences);

  if (selectedBrowser === "chrome") {
    return builder
      .forBrowser("chrome")
      .setChromeOptions(
        new chrome.Options()
          .enableBidi()
          .setChromeBinaryPath(
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          )
          .addArguments(
            "--headless=new",
            "--disable-extensions",
            "--no-first-run",
            "--no-default-browser-check",
          ),
      );
  }
  if (selectedBrowser === "firefox" || selectedBrowser === "firefox-normal") {
    const options = new firefox.Options()
      .enableBidi()
      .setBinary("C:\\Program Files\\Mozilla Firefox\\firefox.exe")
      .addArguments("-headless");
    if (firefoxPrivate) options.addArguments("-private");
    return builder
      .forBrowser("firefox")
      .setFirefoxOptions(options);
  }
  throw new Error(
    "Usage: node scripts/lead-detail-browser.mjs firefox|firefox-normal|chrome",
  );
}

async function stableLeadHeading(driver, expected) {
  await driver.wait(async () => {
    try {
      return (
        (await driver.findElement(By.css("h1")).getText()) === expected
      );
    } catch {
      return false;
    }
  }, 15_000);
  const documentProbe = await driver.executeScript(`
    window.__leadHomeDocumentProbe = crypto.randomUUID();
    return window.__leadHomeDocumentProbe;
  `);
  await driver.sleep(2_000);
  assert.equal(
    await driver.executeScript("return window.__leadHomeDocumentProbe"),
    documentProbe,
    "The browser replaced the lead document after it appeared ready.",
  );
  const heading = await driver.findElement(By.css("h1"));
  assert.equal(await heading.getText(), expected);
  assert.equal(await heading.isDisplayed(), true);
}

async function captureReloadDiagnostics(driver) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await driver.executeScript(`
        const navigation = performance.getEntriesByType("navigation")[0];
        return {
          navigation: navigation?.toJSON?.() ?? null,
          nextRequestId: window.__next_r ?? null,
          sessionStorageKeys: Array.from(
            { length: sessionStorage.length },
            (_, index) => sessionStorage.key(index),
          ),
          readyState: document.readyState,
        };
      `);
    } catch {
      // The document can disappear between any two WebDriver commands while
      // reproducing the reload storm. Retry against the next document.
    }
  }
  return null;
}

let driver;
let bidiLog;
let network;
const navigationRequests = [];
const navigationResponses = [];
const bidiBrowserErrors = [];
let removedServiceWorkers = 0;
let phase = "starting browser";
try {
  driver = await builderFor(browser).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 10_000 });
  network = await Network.create(driver);
  bidiLog = await Log.create(driver);
  await bidiLog.onEntryAdded((entry) => {
    if (entry.level === "error") {
      bidiBrowserErrors.push({
        type: entry.type,
        text: entry.text,
      });
    }
  });
  await network.onBeforeRequestSent((event) => {
    if (event.navigation) {
      navigationRequests.push({
        url: event.request.url,
        method: event.request.method,
        initiator: event.initiator?.type ?? null,
      });
    }
  });
  await network.onResponseCompleted((event) => {
    if (event.navigation) {
      const headers = Object.fromEntries(
        event.response.headers.map((header) => [
          header.name.toLowerCase(),
          header.value.value,
        ]),
      );
      navigationResponses.push({
        url: event.response.url,
        status: event.response.status,
        fromCache: event.response.fromCache,
        bytesReceived: event.response.bytesReceived,
        bodySize: event.response.bodySize,
        cacheControl: headers["cache-control"] ?? null,
        contentType: headers["content-type"] ?? null,
      });
    }
  });

  phase = "registering account";
  await driver.get(`${baseUrl}/register`);
  await driver.findElement(By.css('input[name="name"]')).sendKeys("Browser Test");
  await driver.findElement(By.css('input[name="email"]')).sendKeys(email);
  await driver.findElement(By.css('input[name="password"]')).sendKeys(password);
  await driver
    .findElement(By.xpath("//button[normalize-space()='Create account']"))
    .click();
  await driver.wait(async () => new URL(await driver.getCurrentUrl()).pathname === "/", 20_000);
  removedServiceWorkers = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    if (!("serviceWorker" in navigator)) {
      done(0);
      return;
    }
    navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      await Promise.all(registrations.map((registration) => registration.unregister()));
      done(registrations.length);
    }, () => done(0));
  `);

  phase = "creating lead";
  await driver.get(`${baseUrl}/leads/new`);
  await driver.findElement(By.css('input[name="name"]')).sendKeys(`Reload ${runId}`);
  await driver.findElement(By.css('button[type="submit"]')).click();
  await driver.wait(
    async () => {
      const pathname = new URL(await driver.getCurrentUrl()).pathname;
      return /^\/leads\/[^/]+$/.test(pathname) && pathname !== "/leads/new";
    },
    20_000,
  );

  const leadName = `Reload ${runId}`;
  const leadUrl = await driver.getCurrentUrl();
  const leadId = new URL(leadUrl).pathname.split("/").at(-1);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  assert.ok(user && leadId);
  await prisma.leadActivity.createMany({
    data: Array.from({ length: 21 }, (_, index) => ({
      userId: user.id,
      leadId,
      type: "LEAD_CREATED",
      actorType: "SYSTEM",
      source: "SYSTEM",
      title: `Historical activity ${index}`,
      occurredAt: new Date(`2020-01-01T00:${String(index).padStart(2, "0")}:00.000Z`),
    })),
  });
  const leadNavigationStart = navigationRequests.length;
  phase = "opening the lead directly";
  await driver.get(leadUrl);
  phase = "checking initial lead document";
  await stableLeadHeading(driver, leadName);
  phase = "waiting for activity timeline";
  await driver.wait(
    until.elementLocated(By.xpath("//h2[normalize-space()='Activity']")),
    15_000,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    phase = `refreshing lead document ${attempt + 1}`;
    await driver.navigate().refresh();
    await stableLeadHeading(driver, leadName);
  }
  assert.equal(
    navigationRequests.length - leadNavigationStart,
    4,
    "Expected one direct lead document and exactly three requested refreshes.",
  );

  phase = "creating dated follow-up";
  const details = await driver.findElement(By.css("details"));
  await driver.executeScript("arguments[0].open = true", details);
  await driver.findElement(By.css('input[name="title"]')).sendKeys("Dated follow-up");
  const dueDate = await driver.findElement(By.css('input[name="dueDate"]'));
  await driver.executeScript(
    "arguments[0].value = '2026-08-12'; arguments[0].dispatchEvent(new Event('input', { bubbles: true }));",
    dueDate,
  );
  await driver.findElement(By.xpath("//button[normalize-space()='Create task']")).click();
  await driver.wait(
    until.elementLocated(By.xpath("//*[normalize-space()='Dated follow-up']")),
    40_000,
  );
  await driver.wait(async () => {
    const value = await driver
      .findElement(By.css('input[name="nextFollowUp"]'))
      .getAttribute("value");
    return value === "2026-08-12";
  }, 40_000);
  await stableLeadHeading(driver, leadName);

  phase = "loading older timeline activity";
  await driver
    .findElement(By.xpath("//button[normalize-space()='Load older activity']"))
    .click();
  await driver.wait(
    until.elementLocated(
      By.xpath("//*[normalize-space()='Historical activity 0']"),
    ),
    20_000,
  );

  phase = "opening a related task";
  const relatedTaskLink = await driver.findElement(
    By.xpath("//a[normalize-space()='Open task']"),
  );
  await driver.executeScript(
    "arguments[0].scrollIntoView({ block: 'center' })",
    relatedTaskLink,
  );
  await relatedTaskLink.click();
  await driver.wait(
    until.elementLocated(By.xpath("//h1[normalize-space()='Edit task']")),
    20_000,
  );
  await driver.navigate().back();
  await stableLeadHeading(driver, leadName);

  phase = "checking browser back and forward";
  await driver.get(`${baseUrl}/leads`);
  await driver.wait(
    until.elementLocated(By.xpath("//h1[normalize-space()='Leads']")),
    20_000,
  );
  await driver.navigate().back();
  await stableLeadHeading(driver, leadName);
  await driver.navigate().forward();
  await driver.wait(
    until.elementLocated(By.xpath("//h1[normalize-space()='Leads']")),
    20_000,
  );
  await driver.navigate().back();
  await stableLeadHeading(driver, leadName);

  let browserLogs = [];
  try {
    browserLogs = await driver.manage().logs().get(logging.Type.BROWSER);
  } catch {
    // Firefox does not expose the legacy WebDriver browser-log endpoint.
  }
  const severe = browserLogs.filter(
    (entry) => entry.level.value >= logging.Level.SEVERE.value,
  );
  assert.deepEqual(
    [
      ...bidiBrowserErrors.map((entry) => entry.text),
      ...severe.map((entry) => entry.message),
    ],
    [],
    `Unexpected browser console errors in ${browser}`,
  );

  console.log(
    JSON.stringify({
      browser,
      firefoxMode:
        browser === "chrome" ? null : firefoxPrivate ? "private" : "normal",
      leadRefreshes: 3,
      timelineLoaded: true,
      olderActivityLoaded: true,
      relatedTaskOpened: true,
      backForwardChecked: true,
      followUpUpdated: true,
      browserErrors: bidiBrowserErrors.length + severe.length,
      removedServiceWorkers,
      leadDocumentRequests: navigationRequests.length - leadNavigationStart,
      leadDocumentResponses: navigationResponses.filter(
        (response) => response.url === leadUrl,
      ),
    }),
  );
} catch (error) {
  console.error(`[lead-detail-browser] Failed while ${phase}.`);
  if (driver) {
    console.error(
      `[lead-detail-browser] URL: ${await driver
        .getCurrentUrl()
        .catch(() => "unavailable")}`,
    );
    console.error(
      `[lead-detail-browser] Diagnostics: ${JSON.stringify(
        await captureReloadDiagnostics(driver),
      )}`,
    );
    console.error(
      `[lead-detail-browser] Navigation requests: ${JSON.stringify(
        navigationRequests.slice(-20),
      )}`,
    );
    console.error(
      `[lead-detail-browser] Navigation responses: ${JSON.stringify(
        navigationResponses.slice(-20),
      )}`,
    );
    console.error(
      `[lead-detail-browser] Browser errors: ${JSON.stringify(
        bidiBrowserErrors,
      )}`,
    );
    await driver
      .takeScreenshot()
      .then((image) =>
        import("node:fs/promises").then(({ writeFile }) =>
          writeFile(`C:\\tmp\\leadhome-${browser}-failure.png`, image, "base64"),
        ),
      )
      .catch(() => undefined);
  }
  throw error;
} finally {
  if (driver) await driver.quit().catch(() => undefined);
  await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
  await prisma.$disconnect();
}
