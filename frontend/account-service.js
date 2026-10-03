// Public build-time configuration only. No passwords or session tokens are managed here.
const disabled = reason => Object.freeze({enabled:false, reason});
const keyMessage = 'Only a public Supabase publishable or legacy anon key can be used in the browser.';
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

function legacyAnonPayload(key) {
  const parts = key.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')), char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

export function validateAccountConfig(env = {}) {
  const rawUrl = env?.VITE_SUPABASE_URL;
  const rawKey = env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!rawUrl && !rawKey) return disabled('Accounts are not configured for this site.');
  if (typeof rawUrl !== 'string' || typeof rawKey !== 'string' || !rawUrl.trim() || !rawKey.trim()) return disabled('Account configuration is incomplete.');
  let url;
  try { url = new URL(rawUrl.trim()); } catch { return disabled('Account configuration requires an HTTPS Supabase project URL.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return disabled('Account configuration requires an HTTPS Supabase project URL.');
  }
  const key = rawKey.trim();
  if (key.length > 4096) return disabled(keyMessage);
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) {
    const payload = legacyAnonPayload(key);
    // This is a key-type guard, not signature verification; Supabase validates the key.
    if (!payload || payload.role !== 'anon' || payload.iss !== 'supabase' || (payload.ref !== undefined && payload.ref !== url.hostname.split('.')[0])) return disabled(keyMessage);
  }
  return Object.freeze({enabled:true, reason:'', url:url.origin, key});
}

function emailValue(value) {
  if (typeof value !== 'string') throw new Error('Enter a valid email address.');
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\x00-\x1f\x7f]/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}
function passwordValue(password, minimum = MIN_PASSWORD_LENGTH) {
  if (typeof password !== 'string' || password.length < minimum || password.length > MAX_PASSWORD_LENGTH) throw new Error(minimum === 1 ? 'Enter your password, up to 256 characters.' : 'Use a password between 8 and 256 characters.');
  return password; // Preserve spaces and punctuation; never trim or persist the password.
}
function redirectValue(value, origin) {
  let url;
  try { if (typeof value !== 'string' || value.length > 2048) throw new Error(); url = new URL(value); } catch { throw new Error('A valid account callback URL is required.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || (origin && url.origin !== origin)) throw new Error('Use an account callback URL on this site.');
  return url.href;
}

export function createAccountService(input = validateAccountConfig(import.meta.env ?? {}), {importer = () => import('@supabase/supabase-js'), origin = globalThis.location?.origin} = {}) {
  // Revalidate normalized configuration too: callers cannot bypass the public-key guard.
  const config = input?.enabled === true ? validateAccountConfig({VITE_SUPABASE_URL:input.url, VITE_SUPABASE_PUBLISHABLE_KEY:input.key}) : input?.enabled === false ? disabled(input.reason || 'Accounts are not configured for this site.') : validateAccountConfig(input);
  let clientPromise;
  function readableError(error, fallback, privateValues = []) {
    let message = typeof error?.message === 'string' && error.message.trim() ? error.message : fallback;
    for (const value of [config.key, ...privateValues]) if (typeof value === 'string' && value) message = message.split(value).join('[redacted]');
    return new Error(message);
  }
  async function client() {
    if (!config.enabled) throw new Error(config.reason);
    if (!clientPromise) {
      const pending = Promise.resolve().then(importer).then(sdk => {
        if (typeof sdk?.createClient !== 'function') throw new Error('The account service could not be loaded.');
        const instance = sdk.createClient(config.url, config.key, {auth:{flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
        if (!instance?.auth) throw new Error('The account service could not be loaded.');
        return instance;
      });
      clientPromise = pending;
      pending.catch(() => { if (clientPromise === pending) clientPromise = undefined; });
    }
    try { return await clientPromise; } catch (error) { throw readableError(error, 'The account service could not be loaded. Try again.'); }
  }
  async function call(method, args, privateValues = []) {
    try {
      const sdk = await client();
      // getSession alone can hide a failed PKCE callback. Reuse the SDK's existing
      // initialization result; never exchange the single-use code a second time.
      if (method === 'getSession' && typeof sdk.auth.initialize === 'function') {
        const initialized = await sdk.auth.initialize();
        if (initialized?.error) throw initialized.error;
      }
      const result = await sdk.auth[method](...args);
      if (result?.error) throw result.error;
      return result?.data ?? null;
    } catch (error) { throw readableError(error, 'The account request failed. Try again.', privateValues); }
  }
  return Object.freeze({
    enabled:config.enabled,
    reason:config.reason,
    getSession:() => call('getSession', []),
    async signUp(email, password, redirect) {
      const credentials = {email:emailValue(email), password:passwordValue(password), options:{emailRedirectTo:redirectValue(redirect, origin)}};
      return call('signUp', [credentials], [password]);
    },
    async signIn(email, password) {
      return call('signInWithPassword', [{email:emailValue(email), password:passwordValue(password, 1)}], [password]);
    },
    signOut:() => call('signOut', [{scope:'local'}]),
    async resetPassword(email, redirect) {
      return call('resetPasswordForEmail', [emailValue(email), {redirectTo:redirectValue(redirect, origin)}]);
    },
    async updatePassword(password) {
      return call('updateUser', [{password:passwordValue(password)}], [password]);
    },
    async onAuthStateChange(callback) {
      if (typeof callback !== 'function') throw new Error('An account state callback is required.');
      const sdk = await client();
      let active = true;
      // Keep event delivery synchronous so the UI can select recovery mode immediately.
      const result = sdk.auth.onAuthStateChange((event, session) => { if (active) callback(event, session); });
      const subscription = result?.data?.subscription;
      if (typeof subscription?.unsubscribe !== 'function') throw new Error('Account state updates are unavailable.');
      return () => { if (active) { active = false; subscription.unsubscribe(); } };
    },
  });
}
