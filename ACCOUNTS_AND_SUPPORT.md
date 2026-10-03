# Optional accounts and contributions

The workspace, imports, manual editing, projects and all exports remain available without registration or payment. Authentication is managed by Supabase; the Python API remains stateless. Projects continue to download to the user's device. This release does not upload projects to an account or introduce paid features.

Until the owner supplies working provider configuration, the account and support dialogs explain that the services are being prepared. They do not accept credentials, create pretend accounts or invent a payment recipient.

## Activate accounts

1. Create a Supabase project in your own account. Copy its HTTPS project URL and **publishable key** from its API settings. The older **anon** browser key also works. Never use a secret or service-role key in this frontend.
2. Enable the email/password provider, allow new signups and keep email confirmation enabled. The client uses PKCE and requires confirmation/reset links to open in the same browser that requested them.
3. Set the Auth **Site URL** to `https://brahimelmokhtari.github.io/crystal-studio-web/`. Allow that exact URL and `https://brahimelmokhtari.github.io/crystal-studio-web/?account=recovery` in the Auth redirect URL list. For local testing, also allow the equivalent localhost URLs.
4. Configure **custom SMTP** before inviting public users. Supabase's default sender only delivers to addresses in the project's organization, with restrictive testing limits. Verify a signup confirmation and password-reset email with an address outside the organization. [Supabase SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp)
5. Add GitHub repository **Actions variables** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. These are public browser configuration. Rerun the Pages workflow to activate the account form.
6. Verify a new account, confirmed-email login, logout, session reload and the complete password reset flow on the deployed URL. The application shows callback errors instead of silently ignoring an expired code.

Local equivalents in the excluded `frontend/.env.local` are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Restart Vite after changing them. The Supabase SDK alone stores and refreshes sessions; the application does not persist passwords. Public keys do not grant privileged database access; use Supabase Row Level Security if cloud data storage is added later. [Supabase API keys](https://supabase.com/docs/guides/api/api-keys), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)

## Activate optional support

Use payment links created in the account that should receive the funds. No secret payment key or card data belongs in this application.

1. In Stripe, create a fixed-price product for **EUR 1 per month**, then a recurring Payment Link. Confirm the amount, currency, billing interval and subscription management/cancellation instructions in the hosted checkout.
2. Create a separate **one-time, customer-chosen amount** Payment Link for flexible contributions. Stripe Payment Links supports chosen amounts for one-time payments; the monthly option uses a fixed price. [Stripe contribution options](https://support.stripe.com/questions/how-to-accept-donations-through-stripe?locale=en-GB)
3. Add GitHub Actions variables `DONATION_MONTHLY_URL` and `DONATION_ONCE_URL` with the actual hosted checkout URLs. For local development use `VITE_DONATION_MONTHLY_URL` and `VITE_DONATION_ONCE_URL`.
4. Rerun Pages deployment and verify both destinations. A link only appears when it is configured. Supported HTTPS destinations are Stripe checkout/payment links, PayPal and Ko-fi. The monthly link must actually offer EUR 1/month; the browser cannot inspect the provider's price configuration.

Checkout opens in a separate tab with `noopener noreferrer`. Donations do not require a Crystal Studio account. The application neither charges users directly nor treats an arbitrary return URL as proof of payment. No webhook or payment database is required for these optional hosted links.

## Verification

`npm.cmd test` includes provider configuration guards, lazy authentication, callback errors, signup, sign-in, session events, password recovery, credential redaction and payment-link validation.

The native browser script `tests/community.py` verifies the actual transparent scene download and responsive optional dialogs. Its account tests run the real Supabase SDK against **mock HTTP** on an isolated local Vite server; they do not prove live email delivery or actual payments. Run with `--public-only --url <site>` to check the unconfigured deployed site.

For the full browser check, run an isolated Vite server on port 5176 with a dummy public test key, `VITE_SUPABASE_URL=https://crystaltest.supabase.co`, `VITE_DONATION_MONTHLY_URL=https://buy.stripe.com/test_monthly` and `VITE_DONATION_ONCE_URL=https://buy.stripe.com/test_once`. Keep the ordinary, unconfigured server on port 5174. Run `python tests/community.py` with Python Playwright and installed Chrome. These synthetic settings must never be used in a production deployment.
