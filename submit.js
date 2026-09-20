/**
 * Baltimore 311 — weekly Dirty Alley Cleaning submissions.
 * Submits one request per entry in SUBMISSIONS via https://balt311.baltimorecity.gov/citizen/s/
 * Run: node submit.js   (add --dry-run to stop before the final Submit)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
// --only "Rose,Oliver" matches entries by searchText and submits just those
// --all submits everything; default (scheduled runs) filters by today's weekday
const onlyArg = process.argv.find((a, i) => process.argv[i - 1] === '--only');
const ALL = process.argv.includes('--all');
// --day N runs the schedule for weekday N (Mon=1, Thu=4) regardless of the
// actual day — used by run.sh to catch up a slot missed while logged out
const dayArg = process.argv.find((a, i) => process.argv[i - 1] === '--day');

const { CONTACT, SUBMISSIONS } = require('./config.js');

const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(LOG_DIR, `run-${stamp}.log`);

// Drop run logs and screenshots older than 30 days so the folder does not grow forever.
const MAX_LOG_AGE_MS = 30 * 24 * 60 * 60 * 1000;
for (const name of fs.readdirSync(LOG_DIR)) {
  const full = path.join(LOG_DIR, name);
  try {
    if (Date.now() - fs.statSync(full).mtimeMs > MAX_LOG_AGE_MS) fs.unlinkSync(full);
  } catch {}
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

// Pick an address via search box + suggestion dropdown (flaky, retried)
async function pickBySearch(page, searchText, suggestion) {
  const box = page.getByPlaceholder('Search', { exact: true }).first();
  for (let i = 0; i < 6; i++) {
    await box.click();
    await box.fill('');
    await box.pressSequentially(searchText, { delay: 120 });
    try {
      await page.getByText(suggestion).first().click({ timeout: 8000 });
      return;
    } catch {
      log(`  address suggestion retry ${i + 1}`);
    }
  }
  throw new Error('address suggestion never appeared');
}

// Pick a location by clicking the map at target lat/lng: center on a nearby
// known address, calibrate pixels-per-degree with two probe clicks (reading
// the site's reverse-geocode responses), then click the target point.
async function pickByMapClick(page, t) {
  const geos = [];
  const onResp = async resp => {
    let post = resp.request().postData() || '';
    try { post = decodeURIComponent(post); } catch {}
    if (!/fetchAddress/.test(post) || !/\\"lat\\"/.test(post)) return;
    try {
      const body = await resp.text();
      const m = body.match(/\\"lat\\":([\d.-]+),\\"long\\":([\d.-]+),\\"address\\":\\"([^\\]+)\\"/);
      const req = post.match(/\\"lat\\":\\"([\d.-]+)\\",\\"lng\\":\\"([\d.-]+)\\"/);
      if (req) geos.push({ clickLat: +req[1], clickLng: +req[2], address: m ? m[3] : '' });
    } catch {}
  };
  page.on('response', onResp);
  try {
    await pickBySearch(page, t.nearSearch, t.nearSuggestion);
    await page.waitForTimeout(3000);
    const bb = await page.locator('.leaflet-container').first().boundingBox();
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    const clickAndWait = async (x, y) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const n = geos.length;
        await page.mouse.click(x + attempt * 4, y + attempt * 4);
        for (let i = 0; i < 60 && geos.length === n; i++) await page.waitForTimeout(250);
        if (geos.length > n) return geos[geos.length - 1];
      }
      throw new Error('map click produced no reverse geocode');
    };
    // calibration: two clicks 240px apart diagonally
    const a = await clickAndWait(cx - 120, cy + 120);
    const b = await clickAndWait(cx + 120, cy - 120);
    const lngPerPx = (b.clickLng - a.clickLng) / 240;
    const latPerPx = (b.clickLat - a.clickLat) / -240; // y grows downward
    log(`  calibration: a=(${a.clickLat},${a.clickLng}) b=(${b.clickLat},${b.clickLng}) latPerPx=${latPerPx} lngPerPx=${lngPerPx}`);
    // b was clicked at (cx+120, cy-120); step from there to the target
    let tx = cx + 120 + (t.lng - b.clickLng) / lngPerPx;
    let ty = cy - 120 - (t.lat - b.clickLat) / latPerPx;
    // pan the map so the target sits center-right, clear of the info panel
    // that overlays the top-left corner and swallows clicks
    const panX = Math.round(cx + 150 - tx), panY = Math.round(cy + 60 - ty);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + panX, cy + panY, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(2500);
    // leaflet pans with inertia, so the drag distance isn't exact — take a
    // reference click and recompute the target position from it
    const ref = await clickAndWait(cx + 150, cy + 60);
    tx = cx + 150 + (t.lng - ref.clickLng) / lngPerPx;
    ty = cy + 60 - (t.lat - ref.clickLat) / latPerPx;
    log(`  map box=(${bb.x},${bb.y},${bb.width},${bb.height}) target px=(${tx},${ty})`);
    if (tx < bb.x || tx > bb.x + bb.width || ty < bb.y || ty > bb.y + bb.height)
      throw new Error('target point falls outside visible map');
    // the map can drift between clicks (pan inertia), so correct iteratively:
    // each reverse-geocode response reports where the click actually landed
    let hit;
    for (let i = 0; i < 4; i++) {
      hit = await clickAndWait(tx, ty);
      log(`  map click resolved to: ${hit.address}`);
      if (t.expect.test(hit.address)) break;
      tx += (t.lng - hit.clickLng) / lngPerPx;
      ty -= (t.lat - hit.clickLat) / latPerPx;
      if (tx < bb.x || tx > bb.x + bb.width || ty < bb.y || ty > bb.y + bb.height)
        throw new Error('corrected target falls outside visible map');
    }
    if (!t.expect.test(hit.address)) throw new Error(`nearest valid address "${hit.address}" did not match ${t.expect}`);
  } finally {
    page.off('response', onResp);
  }
}

async function submitOne(browser, sub) {
  const page = await browser.newPage();
  try {
    log(`--- ${sub.searchText}: starting`);
    await page.goto('https://balt311.baltimorecity.gov/citizen/s/', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(4000);

    // Open the Dirty Alley Cleaning request wizard
    await page.getByText('Dirty Alley Cleaning', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Request This Service' }).click({ timeout: 20000 });
    await page.waitForTimeout(4000);

    // Step 1: Attachments — skip
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 20000 });
    await page.waitForTimeout(4000);

    // Step 2: Location — via search suggestion, or map click for addresses
    // missing from the site's address table
    if (sub.mapTarget) await pickByMapClick(page, sub.mapTarget);
    else await pickBySearch(page, sub.searchText, sub.suggestion);
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 20000 });
    await page.waitForTimeout(4000);

    // Step 3: Details
    await page.check(`input[name="10SWP-DUMPEDFROM"][value="${sub.dumpedFromVehicle}"]`);
    await page.check(`input[name="10SWP-ALLEODDEVN"][value="${sub.oddOrEven}"]`);
    await page.check(`input[name="10SWP-100LBORMOR"][value="${sub.over100lb}"]`);
    await page.check(`input[name="10SWP-OBSRTRAFIC"][value="${sub.obstructingTraffic}"]`);
    await page.getByLabel(/Question 5/).fill(sub.description);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 20000 });
    await page.waitForTimeout(4000);

    // Step 4: Contact
    await page.locator('input[name="First Name"]').fill(CONTACT.firstName);
    await page.locator('input[name="Last Name"]').fill(CONTACT.lastName);
    await page.locator('input[name="Email"]').fill(CONTACT.email);
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 20000 });
    await page.waitForTimeout(4000);

    // Step 5: Review + Submit
    const review = await page.locator('.slds-modal__container, [role=dialog]').last().innerText();
    if (!/Review/.test(review)) throw new Error('did not reach Review step');
    if (DRY_RUN) {
      log(`  DRY RUN — stopping before submit. Review:\n${review}`);
      return { ok: true, dryRun: true };
    }
    await page.getByRole('button', { name: 'Submit Request', exact: true }).click({ timeout: 20000 });

    // wait up to 90s for the confirmation screen (submission can be slow)
    let confirmation = '';
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(2000);
      try { confirmation = await page.locator('.slds-modal__container, [role=dialog]').last().innerText(); }
      catch { confirmation = (await page.innerText('body')).slice(-1500); }
      if (/Service Request Submitted|\d{2}-\d{8}/.test(confirmation)) break;
    }
    if (!/Service Request Submitted|\d{2}-\d{8}/.test(confirmation))
      throw new Error('no confirmation screen appeared after Submit');
    const srMatch = confirmation.match(/\d{2}-\d{8}/);
    log(`  SUBMITTED. SR#: ${srMatch ? srMatch[0] : 'not found'}\n${confirmation.slice(0, 800)}`);
    await page.screenshot({ path: path.join(LOG_DIR, `confirm-${sub.searchText.replace(/\W+/g, '_')}-${stamp}.png`), fullPage: true });
    return { ok: true, sr: srMatch && srMatch[0] };
  } catch (err) {
    log(`  ERROR for ${sub.searchText}: ${err.message.split('\n')[0]}`);
    try { await page.screenshot({ path: path.join(LOG_DIR, `error-${sub.searchText.replace(/\W+/g, '_')}-${stamp}.png`), fullPage: true }); } catch {}
    return { ok: false, error: err.message };
  } finally {
    await page.close();
  }
}

(async () => {
  log(`Run started${DRY_RUN ? ' (dry run)' : ''}`);
  let todo;
  if (onlyArg) {
    const terms = onlyArg.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    todo = SUBMISSIONS.filter(s => terms.some(t => s.searchText.toLowerCase().includes(t)));
  } else if (ALL) {
    todo = SUBMISSIONS;
  } else {
    const today = dayArg ? Number(dayArg) : new Date().getDay();
    todo = SUBMISSIONS.filter(s => s.days.includes(today));
  }
  log(`Submitting ${todo.length} of ${SUBMISSIONS.length}: ${todo.map(s => s.searchText).join('; ') || '(none scheduled today)'}`);
  const browser = await chromium.launch();
  let failures = 0;
  for (const sub of todo) {
    // Most failures are transient: the 311 site timing out, or this machine's
    // network dropping mid-run. Retrying immediately hits the same condition,
    // so back off between attempts.
    const RETRY_DELAYS_MS = [30_000, 120_000];
    let res = await submitOne(browser, sub);
    for (let i = 0; !res.ok && i < RETRY_DELAYS_MS.length; i++) {
      log(`  ${sub.searchText}: attempt ${i + 1} failed, retrying in ${RETRY_DELAYS_MS[i] / 1000}s`);
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[i]));
      res = await submitOne(browser, sub);
    }
    if (!res.ok) {
      log(`  ${sub.searchText}: all ${RETRY_DELAYS_MS.length + 1} attempts failed`);
      failures++;
    }
  }
  await browser.close();
  log(`Run finished. Failures: ${failures}`);
  process.exit(failures ? 1 : 0);
})();
