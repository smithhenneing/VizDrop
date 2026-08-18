// Pro licensing. Free tier: row cap + watermarked exports.
// Pro ($5/mo): validated against a Lemon Squeezy license key.
//
// SETUP (one time, see README):
//  1. Create a Lemon Squeezy store + a $5/mo subscription product with
//     "License keys" enabled.
//  2. Paste the product's checkout URL into CHECKOUT_URL below (and in the
//     pricing links on index.html).
// Nothing else is needed — key validation uses Lemon Squeezy's public
// license API directly from the browser.

export const CHECKOUT_URL = 'https://YOUR-STORE.lemonsqueezy.com/buy/YOUR-PRODUCT-UUID';
const VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';
const DEV_PREFIX = 'VIZDROP-DEV-'; // offline keys for your own testing — remove before launch if you like
const STORAGE_KEY = 'vizdrop.license';

export const FREE_ROW_LIMIT = 5000;

export function getLicense() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function isPro() {
  const lic = getLicense();
  return !!(lic && lic.status === 'valid');
}

export async function activate(key) {
  key = String(key || '').trim();
  if (!key) throw new Error('Please paste your license key first.');
  if (key.toUpperCase().startsWith(DEV_PREFIX)) {
    save({ key, status: 'valid', plan: 'dev', validatedAt: Date.now() });
    return { plan: 'dev' };
  }
  let resp, data;
  try {
    resp = await fetch(VALIDATE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key: key }),
    });
    data = await resp.json();
  } catch {
    throw new Error('Could not reach the license server. Check your internet connection and try again.');
  }
  if (!data || data.valid !== true) {
    throw new Error((data && data.error) || 'That key was not recognized. Double-check it from your purchase email.');
  }
  const status = data.license_key && data.license_key.status;
  if (status && status !== 'active') {
    throw new Error(`This license is ${status}. Renew your subscription to keep Pro features.`);
  }
  save({ key, status: 'valid', plan: 'pro', validatedAt: Date.now() });
  return { plan: 'pro' };
}

export function deactivate() {
  localStorage.removeItem(STORAGE_KEY);
}

// Silent re-check on load (tolerates being offline — keeps last known state).
export async function revalidate() {
  const lic = getLicense();
  if (!lic || lic.plan === 'dev') return;
  if (Date.now() - (lic.validatedAt || 0) < 86400000) return; // once a day is plenty
  try {
    const resp = await fetch(VALIDATE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key: lic.key }),
    });
    const data = await resp.json();
    if (data && data.valid === false) deactivate();
    else if (data && data.valid === true) save({ ...lic, validatedAt: Date.now() });
  } catch { /* offline — keep last known state */ }
}

function save(lic) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lic));
}
