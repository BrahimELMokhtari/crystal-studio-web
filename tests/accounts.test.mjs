import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAccountConfig, createAccountService, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH} from '../frontend/account-service.js';

const project = 'abcdefghijklmnopqrst';
const url = 'https://' + project + '.supabase.co';
const key = 'sb_publishable_public_test_key_123456789';
const origin = 'https://studio.example';
const redirect = origin + '/crystal-studio-web/';
const password = ' Spaces & punctuation! ';
const config = () => validateAccountConfig({VITE_SUPABASE_URL:url, VITE_SUPABASE_PUBLISHABLE_KEY:key});
const jwt = payload => [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'synthetic_signature'].join('.');

function fakeService({responses = {}, importerError, createError} = {}) {
  const calls = [], listeners = [], counts = {imports:0, clients:0, unsubscribe:0};
  const auth = Object.fromEntries(['initialize','getSession','signUp','signInWithPassword','signOut','resetPasswordForEmail','updateUser'].map(method => [method, async (...args) => {
    calls.push({method,args});
    const response = responses[method];
    if (response instanceof Error) throw response;
    return response ?? {data:{},error:null};
  }]));
  auth.onAuthStateChange = callback => {
    listeners.push(callback);
    return {data:{subscription:{unsubscribe(){counts.unsubscribe++;}}}};
  };
  const importer = async () => {
    counts.imports++;
    if (importerError) throw importerError;
    return {createClient(...args) {
      counts.clients++;calls.push({method:'createClient',args});
      if (createError) throw createError;
      return {auth};
    }};
  };
  return {service:createAccountService(config(),{importer,origin}),calls,listeners,counts};
}

test('accounts stay disabled without complete configuration and never load the SDK',async()=>{
  for (const env of [undefined,{},null,{VITE_SUPABASE_URL:url},{VITE_SUPABASE_PUBLISHABLE_KEY:key},{VITE_SUPABASE_URL:' ',VITE_SUPABASE_PUBLISHABLE_KEY:key}]) {
    const checked = validateAccountConfig(env);
    assert.equal(checked.enabled,false);assert.ok(checked.reason);assert.equal(checked.key,undefined);
    let imports = 0;
    const service = createAccountService(checked,{importer:async()=>{imports++;throw new Error('must not import');},origin});
    await assert.rejects(service.getSession(),/configur/i);
    await assert.rejects(service.signIn('user@example.com',password),/configur/i);
    assert.equal(imports,0);
  }
});

test('public publishable configuration normalizes only a trusted project origin',()=>{
  const checked = validateAccountConfig({VITE_SUPABASE_URL:'  '+url+'/',VITE_SUPABASE_PUBLISHABLE_KEY:' '+key+' '});
  assert.deepEqual(checked,{enabled:true,reason:'',url,key});assert.ok(Object.isFrozen(checked));
  for (const badUrl of ['http://'+project+'.supabase.co','https://supabase.co','https://project.supabase.co.attacker.example','https://a.b.supabase.co','https://account.example',url+':8443',url+'/auth/v1',url+'?other=1',url+'#x','https://user:pass@'+project+'.supabase.co','javascript:alert(1)']) {
    const result = validateAccountConfig({VITE_SUPABASE_URL:badUrl,VITE_SUPABASE_PUBLISHABLE_KEY:key});
    assert.equal(result.enabled,false,badUrl);assert.equal(result.key,undefined);
  }
});

test('legacy anon keys are allowed while privileged and unrelated keys fail closed',()=>{
  const anon = jwt({iss:'supabase',ref:project,role:'anon',iat:1,exp:4102444800});
  assert.equal(validateAccountConfig({VITE_SUPABASE_URL:url,VITE_SUPABASE_PUBLISHABLE_KEY:anon}).enabled,true);
  for (const candidate of ['sb_secret_do_not_use_in_a_browser', 'sb_publishable_...', 'not-a-key',jwt({iss:'supabase',ref:project,role:'service_role'}),jwt({iss:'supabase',ref:project,role:'authenticated'}),jwt({iss:'other',ref:project,role:'anon'}),jwt({iss:'supabase',ref:'otherproject',role:'anon'}),jwt(null), 'e30.invalid.signature']) {
    const result = validateAccountConfig({VITE_SUPABASE_URL:url,VITE_SUPABASE_PUBLISHABLE_KEY:candidate});
    assert.equal(result.enabled,false);assert.equal(result.key,undefined);assert.ok(!result.reason.includes(candidate));
  }
});

test('normalized service configuration is revalidated rather than trusting enabled:true',async()=>{
  let imports = 0;
  const service = createAccountService({enabled:true,url,key:'sb_secret_private'},{importer:()=>{imports++;},origin});
  assert.equal(service.enabled,false);await assert.rejects(service.getSession(),/public/);assert.equal(imports,0);
});

test('lazy concurrent requests share one SDK import and one persistent PKCE client',async()=>{
  const fake = fakeService({responses:{getSession:{data:{session:null},error:null}}});
  assert.equal(fake.counts.imports,0);
  const [session,signin] = await Promise.all([fake.service.getSession(),fake.service.signIn(' user@example.com ',password)]);
  assert.deepEqual(session,{session:null});assert.deepEqual(signin,{});
  assert.deepEqual(fake.counts,{imports:1,clients:1,unsubscribe:0});
  assert.deepEqual(fake.calls.find(call=>call.method==='createClient').args,[url,key,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}]);
  assert.deepEqual(fake.calls.find(call=>call.method==='signInWithPassword').args,[{email:'user@example.com',password}]);
});

test('signup preserves confirmation-pending state instead of fabricating a logged-in session',async()=>{
  const data = {user:{id:'synthetic-user'},session:null};
  const fake = fakeService({responses:{signUp:{data,error:null}}});
  assert.equal(await fake.service.signUp(' person@example.com ',password,redirect),data);
  assert.deepEqual(fake.calls.find(call=>call.method==='signUp').args,[{email:'person@example.com',password,options:{emailRedirectTo:redirect}}]);
});

test('password reset and recovery update call the actual SDK methods without inferring account existence',async()=>{
  const fake = fakeService({responses:{resetPasswordForEmail:{data:{},error:null},updateUser:{data:{user:{id:'synthetic-user'}},error:null}}});
  assert.deepEqual(await fake.service.resetPassword(' person@example.com ',redirect),{});
  assert.deepEqual(await fake.service.updatePassword(password),{user:{id:'synthetic-user'}});
  assert.deepEqual(fake.calls.find(call=>call.method==='resetPasswordForEmail').args,['person@example.com',{redirectTo:redirect}]);
  assert.deepEqual(fake.calls.find(call=>call.method==='updateUser').args,[{password}]);
});

test('recovery events reach a synchronous subscriber and unsubscribe is idempotent',async()=>{
  const fake = fakeService(), received = [], session = {user:{id:'synthetic-user'}};
  const unsubscribe = await fake.service.onAuthStateChange((event,current)=>{received.push({event,current});});
  fake.listeners[0]('INITIAL_SESSION',null);
  fake.listeners[0]('PASSWORD_RECOVERY',session);
  assert.deepEqual(received,[{event:'INITIAL_SESSION',current:null},{event:'PASSWORD_RECOVERY',current:session}]);
  unsubscribe();unsubscribe();fake.listeners[0]('SIGNED_OUT',null);
  assert.equal(received.length,2);assert.equal(fake.counts.unsubscribe,1);
  await assert.rejects(fake.service.onAuthStateChange(null),/callback/);
});

test('expired PKCE callback errors are surfaced before a normal session read without a second exchange',async()=>{
  const fake = fakeService({responses:{initialize:{data:{session:null},error:{message:'The account link has expired.'}}}});
  const unsubscribe = await fake.service.onAuthStateChange(()=>{});
  await assert.rejects(fake.service.getSession(),/expired/);
  assert.equal(fake.calls.filter(call=>call.method==='initialize').length,1);
  assert.equal(fake.calls.filter(call=>call.method==='getSession').length,0);
  // A bad link does not disable subsequent explicit sign-in with fresh credentials.
  await fake.service.signIn('person@example.com',password);
  unsubscribe();assert.equal(fake.counts.unsubscribe,1);
});

test('a recovery event registered before initial session reading remains available to the UI',async()=>{
  const session = {user:{id:'synthetic-user'}};
  const fake = fakeService({responses:{getSession:{data:{session},error:null}}}), events = [];
  await fake.service.onAuthStateChange((event,current)=>events.push({event,current}));
  fake.listeners[0]('PASSWORD_RECOVERY',session);
  assert.deepEqual(await fake.service.getSession(),{session});
  assert.deepEqual(events,[{event:'PASSWORD_RECOVERY',current:session}]);
});

test('signout applies to the current browser and does not retain a wrapper session',async()=>{
  const fake = fakeService({responses:{signOut:{error:null},getSession:{data:{session:null},error:null}}});
  assert.equal(await fake.service.signOut(),null);
  assert.deepEqual(fake.calls.find(call=>call.method==='signOut').args,[{scope:'local'}]);
  assert.deepEqual(await fake.service.getSession(),{session:null});
});

test('invalid credentials and callback URLs fail before loading or contacting the SDK',async()=>{
  const fake = fakeService();
  for (const email of [null,'','user','x@@example.com','x y@example.com','x@example','x\n@example.com','x'.repeat(255)+'@example.com']) {
    await assert.rejects(fake.service.signIn(email,password),/email/);
    await assert.rejects(fake.service.resetPassword(email,redirect),/email/);
  }
  for (const value of [null,'','short','x'.repeat(7),'x'.repeat(257),12345678]) {
    await assert.rejects(fake.service.signUp('person@example.com',value,redirect),/password/);
    await assert.rejects(fake.service.updatePassword(value),/password/);
  }
  for (const value of [undefined,'/relative', 'javascript:alert(1)', 'http://studio.example/','https://other.example/','https://user:pass@studio.example/']) {
    await assert.rejects(fake.service.signUp('person@example.com',password,value),/callback/);
    await assert.rejects(fake.service.resetPassword('person@example.com',value),/callback/);
  }
  assert.equal(fake.counts.imports,0);assert.equal(fake.calls.length,0);
});

test('password bounds do not trim punctuation or silently truncate longer inputs',async()=>{
  const fake = fakeService();assert.equal(MIN_PASSWORD_LENGTH,8);assert.equal(MAX_PASSWORD_LENGTH,256);
  await fake.service.signIn('person@example.com',' !@#$%^ ');
  await fake.service.updatePassword('x'.repeat(256));
  assert.equal(fake.calls.find(call=>call.method==='signInWithPassword').args[0].password,' !@#$%^ ');
  assert.equal(fake.calls.find(call=>call.method==='updateUser').args[0].password.length,256);
});

test('signin accepts an existing short provider password while new passwords still require eight characters',async()=>{
  const fake = fakeService();
  await fake.service.signIn('person@example.com','a!');
  assert.equal(fake.calls.find(call=>call.method==='signInWithPassword').args[0].password,'a!');
  for (const value of ['',null,'x'.repeat(257)]) await assert.rejects(fake.service.signIn('person@example.com',value),/password/);
  await assert.rejects(fake.service.signUp('person@example.com','a!',redirect),/8/);
  await assert.rejects(fake.service.updatePassword('a!'),/8/);
});

test('HTTPS and local HTTP callbacks are accepted without enabling off-site redirects in a browser',async()=>{
  for (const local of ['http://localhost:5174','http://127.0.0.1:5174','http://[::1]:5174']) {
    const service = createAccountService(config(),{origin:local,importer:async()=>({createClient:()=>({auth:{resetPasswordForEmail:async(email,options)=>({data:{email,options},error:null})}})})});
    const result = await service.resetPassword('person@example.com',local+'/');
    assert.equal(result.options.redirectTo,local+'/');
    await assert.rejects(service.resetPassword('person@example.com',redirect),/callback/);
  }
});

test('provider and thrown errors stay readable without leaking the supplied password or key',async()=>{
  for (const response of [{data:null,error:{message:'Invalid login credentials'}},new Error('Temporary connection failure')]) {
    const fake = fakeService({responses:{signInWithPassword:response}});
    await assert.rejects(fake.service.signIn('person@example.com',password),error=>error instanceof Error && /credentials|connection/.test(error.message));
  }
  const fake = fakeService({responses:{updateUser:{error:{message:'Rejected '+password+' with '+key}}}});
  await assert.rejects(fake.service.updatePassword(password),error=>!error.message.includes(password)&&!error.message.includes(key)&&error.message.includes('[redacted]'));
});

test('a failed lazy import can be retried instead of permanently poisoning the service',async()=>{
  let imports = 0;
  const service = createAccountService(config(),{origin,importer:async()=>{
    if (++imports === 1) throw new Error('Account SDK unavailable');
    return {createClient:()=>({auth:{getSession:async()=>({data:{session:null},error:null})}})};
  }});
  await assert.rejects(service.getSession(),/unavailable/);
  assert.deepEqual(await service.getSession(),{session:null});assert.equal(imports,2);
});
