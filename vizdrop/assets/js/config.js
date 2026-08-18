// VizDrop is free forever. One optional link keeps the lights on.
// Trakteer (Indonesian: QRIS / GoPay / OVO / bank transfer).
export const DONATE_URL = 'https://trakteer.id/smithsshn/tip';

export const donateConfigured = () => /^https?:\/\//.test(DONATE_URL) && !DONATE_URL.includes('YOUR');
