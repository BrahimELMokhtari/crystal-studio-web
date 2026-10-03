import { createAccountService, validateAccountConfig } from './account-service.js';
import { supportConfig } from './support.js';

export function initializeCommunity(env = import.meta.env) {
  const $ = selector => document.querySelector(selector);
  const config = validateAccountConfig(env), accounts = createAccountService(config);
  const support = supportConfig(env);
  let mode = 'signin', session = null, pending = false, recovery = false, authRevision = 0;
  const dialog = $('#account-dialog'), form = $('#account-form');
  const titles = { signin: 'Welcome to Crystal Studio', signup: 'Create your account', reset: 'Reset your password', recovery: 'Choose a new password' };
  const actions = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link', recovery: 'Save new password' };
  const redirect = () => location.origin + location.pathname;
  function clearRecoveryMarker() {
    const url = new URL(location.href);url.searchParams.delete('account');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  function message(text = '', error = false) {
    $('#account-message').textContent = text;
    $('#account-message').classList.toggle('warning', error);
    $('#account-message').setAttribute('role', error ? 'alert' : 'status');
  }
  function draw() {
    const profile = !!session && !recovery;
    $('#open-account').textContent = session ? 'My account' : 'Account';
    $('#account-title').textContent = profile ? 'Your account' : titles[mode];
    $('#account-unavailable').hidden = config.enabled;
    form.hidden = !config.enabled || profile;
    $('#account-profile').hidden = !config.enabled || !profile;
    $('#account-email-label').hidden = mode === 'recovery';
    $('#account-email').disabled = pending || mode === 'recovery';
    $('#account-email').required = mode !== 'recovery';
    $('#account-password-label').hidden = mode === 'reset';
    $('#account-password').disabled = pending || mode === 'reset';
    $('#account-password').required = mode !== 'reset';
    $('#account-password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    // Existing provider passwords can be shorter than the new-account policy.
    $('#account-password').minLength = mode === 'signin' ? 1 : 8;
    $('#account-confirm-label').hidden = !['signup','recovery'].includes(mode);
    $('#account-confirm').disabled = pending || !['signup','recovery'].includes(mode);
    $('#account-confirm').required = ['signup','recovery'].includes(mode);
    $('#account-submit').textContent = pending ? 'Please wait...' : actions[mode];
    $('#account-submit').disabled = pending;
    $('#account-switch').hidden = recovery;
    $('#account-switch').textContent = mode === 'signin' ? 'Create an account' : 'Back to sign in';
    $('#account-forgot').hidden = mode !== 'signin';
    $('#account-password-help').hidden = !['signup','recovery'].includes(mode);
    $('#account-profile-email').textContent = session?.user?.email || 'Signed in';
    for (const id of ['account-switch','account-forgot','account-signout']) $('#'+id).disabled = pending;
  }
  function changeMode(next) { mode = next; form.reset(); message(); draw(); }
  function open() { draw(); if (!dialog.open) dialog.showModal(); }
  $('#open-account').onclick = open;
  $('#account-switch').onclick = () => changeMode(mode === 'signin' ? 'signup' : 'signin');
  $('#account-forgot').onclick = () => changeMode('reset');
  dialog.addEventListener('close', () => { form.reset(); if (!recovery) mode = 'signin'; message(); });
  form.onsubmit = async event => {
    event.preventDefault(); if (pending || !config.enabled) return;
    const email = $('#account-email').value.trim(), password = $('#account-password').value;
    if (['signup','recovery'].includes(mode) && password !== $('#account-confirm').value) {
      message('The passwords do not match.', true); return;
    }
    const activeMode = mode; pending = true; message(); draw();
    try {
      if (activeMode === 'signin') {
        const data = await accounts.signIn(email, password); session = data.session;
        message('Signed in. The workspace remains free to use.');
      } else if (activeMode === 'signup') {
        const data = await accounts.signUp(email, password, redirect()); session = data.session;
        message(session ? 'Your account is ready.' : 'Check your email for a confirmation link. Then return here to sign in.');
      } else if (activeMode === 'reset') {
        await accounts.resetPassword(email, redirect()+'?account=recovery');
        message('If an account exists for this email, a password reset link will be sent.');
      } else {
        await accounts.updatePassword(password); recovery = false; mode = 'signin';clearRecoveryMarker();
        message('Your password has been updated.');
      }
    } catch (error) { message(error.message || 'Account service unavailable. Please try again.', true); }
    finally { $('#account-password').value = ''; $('#account-confirm').value = ''; pending = false; draw(); }
  };
  $('#account-signout').onclick = async () => {
    if (pending) return; pending = true; draw();
    try { await accounts.signOut(); session = null; recovery = false; mode = 'signin';clearRecoveryMarker();message('Signed out. Your current structure is still open.'); }
    catch (error) { message(error.message || 'Unable to sign out. Please try again.', true); }
    finally { pending = false; draw(); }
  };
  // The auth event callback stays synchronous to avoid SDK refresh deadlocks.
  function onAuth(event, nextSession) {
    authRevision++;
    session = nextSession;
    if (event === 'PASSWORD_RECOVERY') { recovery = true; mode = 'recovery'; form.reset(); message(); open(); }
    else if (event === 'SIGNED_OUT') { recovery = false; mode = 'signin'; }
    draw();
  }
  if (config.enabled) {
    let initialRevision;
    accounts.onAuthStateChange(onAuth).then(() => {initialRevision=authRevision;return accounts.getSession();}).then(data => {
      if(initialRevision===authRevision)session = data.session;
      if(session&&new URLSearchParams(location.search).get('account')==='recovery') {recovery=true;mode='recovery';open();}
      draw();
      const params = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.slice(1));
      if (params.has('error_description') || hash.has('error_description')) {
        message('This account link has expired or could not be verified. Request a new link.', true); open();
      }
    }).catch(error => {
      message(error.message || 'Unable to connect to accounts. You can continue using the workspace.', true);
      if(new URLSearchParams(location.search).has('code')||new URLSearchParams(location.search).has('account')||location.hash.includes('error'))open();
    });
  }
  for (const [id, url] of [['donate-monthly',support.monthly],['donate-once',support.once]]) {
    const link = $('#'+id); link.hidden = !url;
    if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  }
  $('#support-unavailable').hidden = !!support.monthly || !!support.once;
  $('#support-payment-note').hidden = !support.monthly && !support.once;
  $('#open-support').onclick = () => $('#support-dialog').showModal();
  draw();
}
