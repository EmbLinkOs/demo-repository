// Browser contract tests with simulated backend/captcha; no real guest records or emails.
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8000";
const event = {
  eventDate: "2027-02-28",
  eventTime: null,
  capacity: 10,
  maxPartySize: 3,
  registrationOpen: true,
  availableSeats: 10,
  organizerEmail: "team@example.com",
  privacyNoticeFr: "Notice de confidentialité française",
  privacyNoticeEn: "English privacy notice",
  venue: "Test venue",
  venueAddress: "Test address",
};
const settings = {
  event_date: "2027-02-28",
  event_time: null,
  capacity: 10,
  max_party_size: 3,
  registration_open: true,
  organizer_email: "team@example.com",
  privacy_notice_fr: "Notice de confidentialité française",
  privacy_notice_en: "English privacy notice",
  venue: "Test venue",
  venue_address: "Test address",
  retention_until: "2027-03-28",
};
const guest = {
  id: "11111111-1111-4111-8111-111111111111",
  first_name: "<img src=x onerror=alert(1)>",
  last_name: "Martin",
  email: "guest@example.com",
  phone: "",
  reference: "PD27-TEST",
  party_size: 2,
  status: "confirmed",
  checked_in: false,
  email_status: "failed",
};
let registration = null,
  action = null;
try {
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.EVENT_CONFIG=${JSON.stringify({ apiUrl: "https://api.test/reservations", supabaseUrl: "https://auth.test", supabaseAnonKey: "public-test-key", turnstileSiteKey: "public-test-site-key" })}`,
    }),
  );
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.turnstile={render:(target,options)=>{options.callback('test-captcha');return 1},reset:()=>{}};window.onGraduationCaptchaLoad();",
    }),
  );
  await page.route("https://api.test/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET")
      return route.fulfill({
        json: req.url().includes("admin=1")
          ? { settings, reservations: [guest] }
          : event,
      });
    const data = req.postDataJSON();
    if (data.action) {
      action = data;
      return route.fulfill({ json: { ok: true } });
    }
    registration = data;
    return route.fulfill({
      json: {
        message: "Votre réservation est enregistrée. Référence PD27-TEST.",
      },
    });
  });
  await page.route("https://auth.test/**", (route) =>
    route.fulfill({
      json: {
        access_token: "test-token",
        refresh_token: "test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    }),
  );
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#first-name").fill("Camille");
  await page.locator("#last-name").fill("Martin");
  await page.locator("#email").fill("camille@example.com");
  await page.locator("#party-size").selectOption("2");
  await page.locator("[name=consent]").check();
  assert.equal(await page.locator("#submit-registration").isEnabled(), true);
  await page.locator("#submit-registration").click();
  await page.locator("#form-result").waitFor();
  assert.equal(registration.partySize, 2);
  assert.equal(registration.consent, true);
  assert.equal(registration.language, "fr");
  assert.equal(registration.captchaToken, "test-captcha");
  assert.match(await page.locator("#form-result").innerText(), /PD27-TEST/);
  await page.goto(`${base}/admin.html`, { waitUntil: "networkidle" });
  await page.locator("#admin-email").fill("organizer@example.com");
  await page.locator("#admin-password").fill("test-password");
  await page.locator("#login-button").click();
  await page.locator("#workspace").waitFor();
  assert.equal(await page.locator("#reserved-count").innerText(), "2");
  assert.equal(await page.locator("#remaining-count").innerText(), "8");
  assert.equal(
    await page.locator("#reservations img").count(),
    0,
    "guest names rendered as text",
  );
  assert.match(await page.locator("#reservations").innerText(), /<img/);
  await page
    .getByRole("button", { name: "Accueillir le groupe", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#admin-message")
      .textContent.includes("enregistrée"),
  );
  assert.equal(action.action, "checkin");
  assert.equal(action.id, guest.id);
  await page.locator("#search").fill("not-present");
  assert.match(
    await page.locator("#reservations").innerText(),
    /Aucune réservation/,
  );
  await page.locator("#logout").click();
  assert.equal(await page.locator("#workspace").isVisible(), false);
  assert.equal(await page.locator("#reservations").innerText(), "");
  console.log(
    "PASS: configured registration/captcha contract, saved reference, organizer sign-in, counts, safe guest rendering, check-in action, search and sign-out. Providers were simulated.",
  );
} finally {
  await browser.close();
}
