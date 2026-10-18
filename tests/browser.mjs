import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8000";
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("h1").waitFor();
  assert.match(await page.locator("h1").innerText(), /Le début/);
  assert.equal(await page.locator("#submit-registration").isDisabled(), true);
  await page.locator("#first-name").fill("Camille");
  await page.locator("#last-name").fill("Martin");
  await page.locator("#party-size").selectOption("3");
  assert.equal(
    await page.locator("#preview-name").innerText(),
    "Camille Martin",
  );
  assert.equal(await page.locator("#preview-party").innerText(), "3 personnes");
  await page.locator("#language").click();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.match(await page.locator("h1").innerText(), /The start of/);
  assert.equal(
    await page.locator("#preview-name").innerText(),
    "Camille Martin",
  );
  assert.equal(await page.locator("#preview-party").innerText(), "3 people");
  assert.match(
    await page.locator("[data-event-date]").first().innerText(),
    /28 February 2027/,
  );
  await page.locator("#language").click();
  await page.locator("#first-name").fill("");
  await page.locator("#last-name").fill("");
  await page.locator("#party-size").selectOption("1");
  await page.screenshot({ path: "/tmp/polytech-desktop.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `No overflow at ${width}px`,
    );
    await page.locator("#language").click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `No English overflow at ${width}px`,
    );
    await page.locator("#language").click();
    await page.locator(".menu-toggle").click();
    assert.equal(
      await page.locator(".menu-toggle").getAttribute("aria-expanded"),
      "true",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".menu-toggle").getAttribute("aria-expanded"),
      "false",
    );
    await page.locator(".menu-toggle").click();
    await page.locator('#navigation a[href="#infos"]').click();
    assert.equal(
      await page.locator(".menu-toggle").getAttribute("aria-expanded"),
      "false",
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/polytech-mobile.png", fullPage: true });
  await page.goto(`${base}/admin.html`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("#login-button").isDisabled(), true);
  assert.equal(await page.locator("#workspace").isVisible(), false);
  await page.locator("#language").click();
  assert.match(
    await page.locator("#login-panel h2").innerText(),
    /Organizer sign-in/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: bilingual content, personalized preview, closed registration, mobile navigation, 320/390px layouts, organizer configuration guard, no browser errors.",
  );
} finally {
  await browser.close();
}
