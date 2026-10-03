# Optional accounts and contributions

The workspace, imports, manual editing, projects and all exports remain available without registration or payment. Authentication is managed by Supabase; the Python API remains stateless. Projects continue to download to the user's device. This release does not upload projects to an account or introduce paid features.

On 3 October 2026, the owner's Supabase project `ypgyefsqgidhoidrkpcb` was connected and the account forms were enabled on [Crystal Studio](https://brahimelmokhtari.github.io/crystal-studio-web/) through [deployment 37149654825](https://github.com/BrahimELMokhtari/crystal-studio-web/actions/runs/37149654825). The real public key and browser connection were accepted; email signup is enabled and email confirmation is required. Live Login, Create account and password-reset forms passed browser checks. Production redirects, custom SMTP and delivered confirmation/reset emails have **not yet been verified**. Donation links are still missing, so support payments remain inactive.

When provider settings are absent, the corresponding dialog explains that the service is being prepared. The application does not create pretend accounts or invent a payment recipient.

The header has separate **Login** and **Create account** buttons. Create account opens email signup directly; Login opens sign-in. After login, **My account** replaces Login and the signup button is hidden. Email confirmation, password recovery and logout use the configured Supabase project. All tools remain free and usable without logging in.

## Connect and deploy the setup

Install and connect **Supabase** and **Stripe** to allow setup through the connected accounts. Alternatively, supply the public Supabase project URL/publishable key and two recipient-owned hosted payment links using the helper below. No personal access token, service-role key, SMTP password or Stripe secret belongs in this configuration file.

1. Complete the provider-side account and payment setup described below. Public registration requires working email delivery; a browser key alone does not configure SMTP.
2. Save a JSON file **outside this public project**, for example `../.deployment_auth/community/public-settings.json`, with only the settings to activate:

```json
{
  "VITE_SUPABASE_URL": "https://YOUR-PROJECT.supabase.co",
  "VITE_SUPABASE_PUBLISHABLE_KEY": "YOUR-PUBLIC-PUBLISHABLE-KEY",
  "VITE_DONATION_MONTHLY_URL": "https://buy.stripe.com/YOUR-LIVE-MONTHLY-LINK",
  "VITE_DONATION_ONCE_URL": "https://buy.stripe.com/YOUR-LIVE-CHOSEN-AMOUNT-LINK"
}
```

These are placeholders, which the helper rejects. Replace them with actual public settings. The Supabase URL/key must be supplied together. Donation links can be supplied independently. Omit settings to preserve their existing values; blank strings do not delete settings.

3. From the `crystal_studio_web` directory, validate without changing anything:

```powershell
node scripts/configure-community.mjs --file ../.deployment_auth/community/public-settings.json --check
```

4. Apply the validated settings and dispatch the existing GitHub Pages workflow:

```powershell
$env:GH_CONFIG_DIR = (Resolve-Path ../.deployment_auth/github).Path
node scripts/configure-community.mjs --file ../.deployment_auth/community/public-settings.json --github-cli ../.deployment_tools/github/bin/gh.exe --apply --deploy
```

On another computer, sign in using `gh auth login` and omit the portable `--github-cli` argument. The helper is deliberately restricted to `BrahimELMokhtari/crystal-studio-web`; it changes only the supplied public Actions variables. All settings are validated before any GitHub call. It refuses secret keys, unsupported fields, example projects and Stripe test links. Public values travel through stdin and are absent from printed summaries and command arguments. A variable-write failure stops workflow dispatch; check existing variables before retrying, since earlier writes may have succeeded.

5. Wait for [the deployment workflow](https://github.com/BrahimELMokhtari/crystal-studio-web/actions/workflows/pages.yml) to succeed, then verify real signup email delivery, login, password reset and both checkout destinations on [Crystal Studio](https://brahimelmokhtari.github.io/crystal-studio-web/). A successful helper run confirms variable updates/workflow dispatch, not completed hosting, delivered emails or checkout prices. Monthly support must actually be EUR 1/month and flexible support must use the intended recipient account.

## Activate accounts

1. Create a Supabase project in your own account. Copy its HTTPS project URL and **publishable key** from its API settings. The older **anon** browser key also works. Never use a secret or service-role key in this frontend.
2. Enable the email/password provider, allow new signups and keep email confirmation enabled. The client uses PKCE and requires confirmation/reset links to open in the same browser that requested them.
3. Set the Auth **Site URL** to `https://brahimelmokhtari.github.io/crystal-studio-web/`. Allow that exact URL and `https://brahimelmokhtari.github.io/crystal-studio-web/?account=recovery` in the Auth redirect URL list. For local testing, also allow the equivalent localhost URLs.
4. Configure **custom SMTP** before inviting public users. Supabase's default sender only delivers to addresses in the project's organization, with restrictive testing limits. Verify a signup confirmation and password-reset email with an address outside the organization. [Supabase SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp)
5. Add GitHub repository **Actions variables** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. These are public browser configuration. Rerun the Pages workflow to activate the account form.
6. Verify a new account, confirmed-email login, logout, session reload and the complete password reset flow on the deployed URL. The application shows callback errors instead of silently ignoring an expired code.

Local equivalents in the excluded `frontend/.env.local` are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Restart Vite after changing them. The Supabase SDK alone stores and refreshes sessions; the application does not persist passwords. Public keys do not grant privileged database access; use Supabase Row Level Security if cloud data storage is added later. [Supabase API keys](https://supabase.com/docs/guides/api/api-keys), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)

This hosted Auth integration connects through the SDK using the project URL/public key. `supabase init` and `supabase link` are optional local-development/management commands and are not required to activate these forms. CLI `supabase login` requires a separate Supabase account authorization; a public publishable key does not authorize project management. Redirects and SMTP must be configured through an authorized dashboard, CLI or Supabase connection. [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-link)

## Activate optional support

Use payment links created in the account that should receive the funds. No secret payment key or card data belongs in this application.

1. In Stripe, create a fixed-price product for **EUR 1 per month**, then a recurring Payment Link. Confirm the amount, currency, billing interval and subscription management/cancellation instructions in the hosted checkout.
2. Create a separate **one-time, customer-chosen amount** Payment Link for flexible contributions. Stripe Payment Links supports chosen amounts for one-time payments; the monthly option uses a fixed price. [Stripe contribution options](https://support.stripe.com/questions/how-to-accept-donations-through-stripe?locale=en-GB)
3. Add GitHub Actions variables `DONATION_MONTHLY_URL` and `DONATION_ONCE_URL` with the actual hosted checkout URLs. For local development use `VITE_DONATION_MONTHLY_URL` and `VITE_DONATION_ONCE_URL`.
4. Rerun Pages deployment and verify both destinations. A link only appears when it is configured. Supported HTTPS destinations are Stripe checkout/payment links, PayPal and Ko-fi. The monthly link must actually offer EUR 1/month; the browser cannot inspect the provider's price configuration.

Checkout opens in a separate tab with `noopener noreferrer`. Donations do not require a Crystal Studio account. The application neither charges users directly nor treats an arbitrary return URL as proof of payment. No webhook or payment database is required for these optional hosted links.

## Verification

`npm.cmd test` includes provider configuration guards, lazy authentication, callback errors, signup, sign-in, session events, password recovery, credential redaction and payment-link validation.

The native browser script `tests/community.py` verifies the actual transparent scene download and responsive optional dialogs. Its account tests run the real Supabase SDK against **mock HTTP** on an isolated local Vite server; they do not prove live email delivery or actual payments. Its `--url` checks expect accounts to be unconfigured, including with `--public-only`; do not use it against the now-configured production site. Never point `--auth-url` at production: interception targets only the dummy `crystaltest.supabase.co` host. For a configured live site, check form visibility and GET `/auth/v1/settings` without submitting credentials; signup/reset delivery needs a separate real-email verification.

For the full browser check, run an isolated Vite server on port 5176 with a dummy public test key, `VITE_SUPABASE_URL=https://crystaltest.supabase.co`, `VITE_DONATION_MONTHLY_URL=https://buy.stripe.com/test_monthly` and `VITE_DONATION_ONCE_URL=https://buy.stripe.com/test_once`. Use a separate unconfigured fixture server for `--url`, for example a clean source checkout without `frontend/.env.local`; the ordinary development server now uses the owner's public Supabase configuration. Run `python tests/community.py --url <unconfigured-fixture-url>` with Python Playwright and installed Chrome. These synthetic settings must never be used in a production deployment.
