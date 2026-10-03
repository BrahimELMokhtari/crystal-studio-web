import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentLink, supportConfig } from '../frontend/support.js';

test('optional support has no invented payment destination', () => {
  assert.deepEqual(supportConfig(), { monthly: null, once: null });
  assert.deepEqual(supportConfig({ VITE_DONATION_MONTHLY_URL: 'https://buy.stripe.com/test_example' }),
    { monthly: 'https://buy.stripe.com/test_example', once: null });
});

test('hosted payment URLs reject unsafe protocols and lookalike destinations', () => {
  for (const url of ['javascript:alert(1)', 'http://buy.stripe.com/abc', 'https://buy.stripe.com.evil.com/a',
    'https://user:password@buy.stripe.com/a', 'https://evil.com/a', 'https://buy.stripe.com/',
    'https://buy.stripe.com:444/a', 'https://buy.stripe.com/a#fake-success', '', 'invalid']) {
    assert.equal(paymentLink(url), null, url);
  }
  for (const url of ['https://buy.stripe.com/abc', 'https://ko-fi.com/crystalstudio',
    'https://paypal.me/crystalstudio', 'https://www.paypal.com/donate/?hosted_button_id=abc']) {
    assert.equal(paymentLink(url), url);
  }
});
