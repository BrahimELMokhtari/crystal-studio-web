const paymentHosts = new Set(['buy.stripe.com', 'checkout.stripe.com', 'ko-fi.com', 'www.ko-fi.com', 'paypal.me', 'www.paypal.me', 'www.paypal.com', 'paypal.com']);

// Payments always take place with the configured provider, outside the workspace.
export function paymentLink(value) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !paymentHosts.has(url.hostname) || url.pathname === '/' || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export function supportConfig(env = {}) {
  return {
    monthly: paymentLink(env.VITE_DONATION_MONTHLY_URL),
    once: paymentLink(env.VITE_DONATION_ONCE_URL),
  };
}
