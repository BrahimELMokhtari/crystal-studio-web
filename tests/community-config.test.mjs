import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {REPOSITORY,planCommunityConfiguration,publicConfigurationSummary,executeCommunityConfiguration,parseCommunityArguments,runCommunityCli} from '../scripts/configure-community.mjs';

// Synthetic, format-valid fixtures are never sent to GitHub or payment/auth services.
const account = {
  VITE_SUPABASE_URL:'https://qwertyuiopasdfghjklzx.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6',
};
const links = {VITE_DONATION_MONTHLY_URL:'https://buy.stripe.com/aAb123CdE456FgH789',VITE_DONATION_ONCE_URL:'https://ko-fi.com/crystalstudio'};
const full = () => ({...account,...links});
const runner = calls => async (cli,args,options)=>{calls.push({cli,args,options});};
const jwt = role => [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({iss:'supabase',ref:'qwertyuiopasdfghjklzx',role,iat:1,exp:4102444800})).toString('base64url'),'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'].join('.');

test('complete public settings map to precisely the existing four repository variables',()=>{
  const config=full(),snapshot=structuredClone(config),plan=planCommunityConfiguration(config);
  assert.equal(plan.repository,REPOSITORY);assert.equal(plan.deploy,false);
  assert.deepEqual(plan.variables,[{name:'SUPABASE_URL',value:account.VITE_SUPABASE_URL},{name:'SUPABASE_PUBLISHABLE_KEY',value:account.VITE_SUPABASE_PUBLISHABLE_KEY},{name:'DONATION_MONTHLY_URL',value:links.VITE_DONATION_MONTHLY_URL},{name:'DONATION_ONCE_URL',value:links.VITE_DONATION_ONCE_URL}]);
  assert.deepEqual(plan.readiness,{accountPair:true,monthlyLink:true,onceLink:true});assert.deepEqual(config,snapshot);
  assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.variables));assert.ok(Object.isFrozen(plan.variables[0]));
});

test('partial updates preserve omitted account and donation settings instead of generating deletions',()=>{
  const once=planCommunityConfiguration({VITE_DONATION_ONCE_URL:links.VITE_DONATION_ONCE_URL});
  assert.deepEqual(once.variables,[{name:'DONATION_ONCE_URL',value:links.VITE_DONATION_ONCE_URL}]);
  assert.deepEqual(once.readiness,{accountPair:false,monthlyLink:false,onceLink:true});
  assert.deepEqual(planCommunityConfiguration(account).variables.map(value=>value.name),['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY']);
  for(const config of [{VITE_SUPABASE_URL:account.VITE_SUPABASE_URL},{VITE_SUPABASE_PUBLISHABLE_KEY:account.VITE_SUPABASE_PUBLISHABLE_KEY},{VITE_DONATION_ONCE_URL:links.VITE_DONATION_ONCE_URL,VITE_SUPABASE_URL:account.VITE_SUPABASE_URL}]) assert.throws(()=>planCommunityConfiguration(config),/both/);
});

test('empty, unknown, private and malformed fields are rejected without echoing supplied values',()=>{
  const privateValue='sk_live_private_value_do_not_print';
  for(const config of [{},null,[],{STRIPE_SECRET_KEY:privateValue},{PASSWORD:'private-user-password'},{VITE_SUPABASE_URL:privateValue,VITE_SUPABASE_PUBLISHABLE_KEY:privateValue}]) {
    assert.throws(()=>planCommunityConfiguration(config),error=>!error.message.includes(privateValue)&&!error.message.includes('private-user-password'));
  }
  for(const value of ['', ' ',null,1,false,[],{},'https://ko-fi.com/user\n','x'.repeat(4097)]) assert.throws(()=>planCommunityConfiguration({VITE_DONATION_ONCE_URL:value}));
  for(const value of ['https://buy.stripe.com/path?api_key=sk_live_private','https://ko-fi.com/name?access_token=private','https://buy.stripe.com/path?client_secret=private']) assert.throws(()=>planCommunityConfiguration({VITE_DONATION_ONCE_URL:value}),/Private/);
});

test('the account public-key guard rejects secret or service_role credentials but allows legacy anon',()=>{
  for(const key of ['sb_secret_A1b2C3d4E5f6G7h8I9j0',jwt('service_role'),jwt('authenticated')]) assert.throws(()=>planCommunityConfiguration({...account,VITE_SUPABASE_PUBLISHABLE_KEY:key}),/Private|public/);
  assert.equal(planCommunityConfiguration({...account,VITE_SUPABASE_PUBLISHABLE_KEY:jwt('anon')}).readiness.accountPair,true);
  for(const url of ['http://qwertyuiopasdfghjklzx.supabase.co','https://supabase.co.attacker.example','https://username:password@qwertyuiopasdfghjklzx.supabase.co','https://qwertyuiopasdfghjklzx.supabase.co/path']) assert.throws(()=>planCommunityConfiguration({...account,VITE_SUPABASE_URL:url}),/HTTPS/);
});

test('known browser fixtures, unresolved placeholders and Stripe test mode cannot activate the live site',()=>{
  for(const project of ['abcdefghijklmnopqrst','crystaltest','crystaltestsupabase','your-project','xyzcompany']) assert.throws(()=>planCommunityConfiguration({...account,VITE_SUPABASE_URL:'https://'+project+'.supabase.co'}),/example|Placeholder/i);
  for(const key of ['sb_publishable_public_test_key_123456789','sb_publishable_your-key-goes-here','sb_publishable_<replace-me>','${SUPABASE_KEY}']) assert.throws(()=>planCommunityConfiguration({...account,VITE_SUPABASE_PUBLISHABLE_KEY:key}),/Placeholder/);
  for(const url of ['https://buy.stripe.com/test_aAb123','https://checkout.stripe.com/c/pay/cs_test_ABC123','https://ko-fi.com/example','https://buy.stripe.com/<link>','https://buy.stripe.com/YOUR-LIVE-MONTHLY-LINK','https://buy.stripe.com/YOUR-LIVE-CHOSEN-AMOUNT-LINK','https://paypal.me/YOUR-NAME']) assert.throws(()=>planCommunityConfiguration({VITE_DONATION_ONCE_URL:url}),/test|Placeholder/);
  assert.equal(planCommunityConfiguration({VITE_DONATION_ONCE_URL:'https://paypal.me/yourcompany'}).readiness.onceLink,true);
});

test('donation destinations must match existing supported hosted payment links exactly',()=>{
  for(const url of ['javascript:alert(1)','http://ko-fi.com/crystalstudio','https://buy.stripe.com.attacker.example/x','https://user:password@buy.stripe.com/x','https://unrelated.example/donate','https://buy.stripe.com/','https://ko-fi.com/crystalstudio#fragment']) assert.throws(()=>planCommunityConfiguration({VITE_DONATION_ONCE_URL:url}),/payment link/);
  const checked=planCommunityConfiguration({VITE_DONATION_ONCE_URL:' https://paypal.me/crystalstudio '});
  assert.equal(checked.variables[0].value,'https://paypal.me/crystalstudio');
});

test('a default dry run performs no CLI or API calls and its summary contains no public values',async()=>{
  const calls=[],summary=await executeCommunityConfiguration(full(),{runner:runner(calls)});
  assert.equal(calls.length,0);assert.equal(summary.applied,false);assert.equal(summary.workflowStarted,false);
  assert.equal(summary.repository,REPOSITORY);assert.deepEqual(summary.settings,['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','DONATION_MONTHLY_URL','DONATION_ONCE_URL']);
  const printed=JSON.stringify(summary);
  for(const value of Object.values(full())) assert.ok(!printed.includes(value));
  assert.deepEqual(summary,publicConfigurationSummary(planCommunityConfiguration(full())));
});

test('explicit apply sends each value through stdin to the fixed repo without shell or body interpolation',async()=>{
  const calls=[],cli='C:\\Private Tools\\gh.exe';
  const summary=await executeCommunityConfiguration(full(),{apply:true,githubCli:cli,runner:runner(calls)});
  assert.equal(summary.applied,true);assert.equal(summary.workflowStarted,false);assert.equal(calls.length,4);
  const plan=planCommunityConfiguration(full());
  calls.forEach((call,index)=>{
    assert.equal(call.cli,cli);assert.deepEqual(call.args,['variable','set',plan.variables[index].name,'--repo','github.com/'+REPOSITORY]);
    assert.equal(call.options.input,plan.variables[index].value);assert.equal(call.options.timeoutMs,30000);
    assert.ok(!call.args.includes('--body'));assert.ok(!call.args.includes(plan.variables[index].value));
  });
});

test('deployment is an explicit fixed pages workflow dispatched after all writes complete',async()=>{
  const order=[],calls=[];
  const summary=await executeCommunityConfiguration(full(),{apply:true,deploy:true,runner:async(cli,args,options)=>{
    assert.equal(order.length,calls.length);calls.push({cli,args,options});
    await new Promise(accept=>setImmediate(accept));order.push(args[0]+':'+args[2]);
  }});
  assert.equal(calls.length,5);assert.equal(summary.workflowStarted,true);
  assert.deepEqual(calls[4].args,['workflow','run','pages.yml','--repo','github.com/'+REPOSITORY,'--ref','main']);assert.equal(calls[4].options.input,'');
  assert.deepEqual(order.slice(0,4),['variable:SUPABASE_URL','variable:SUPABASE_PUBLISHABLE_KEY','variable:DONATION_MONTHLY_URL','variable:DONATION_ONCE_URL']);
});

test('all input validation runs before the first update and arbitrary repo/deploy requests are refused',async()=>{
  const calls=[];
  for(const options of [{apply:true,repo:'OtherOwner/crystal-studio-web'},{deploy:true},{apply:true,githubCli:'bad\npath'}]) await assert.rejects(executeCommunityConfiguration(full(),{...options,runner:runner(calls)}));
  await assert.rejects(executeCommunityConfiguration({...account,VITE_DONATION_MONTHLY_URL:'javascript:alert(1)'},{apply:true,runner:runner(calls)}));
  assert.equal(calls.length,0);
});

test('a failed variable write stops later writes and never dispatches a workflow or prints private errors',async()=>{
  const calls=[];
  await assert.rejects(executeCommunityConfiguration(full(),{apply:true,deploy:true,runner:async(cli,args,options)=>{
    calls.push({args,options});if(calls.length===2) throw new Error('private provider error '+account.VITE_SUPABASE_PUBLISHABLE_KEY);
  }}),error=>/Earlier settings may have changed/.test(error.message)&&!error.message.includes(account.VITE_SUPABASE_PUBLISHABLE_KEY));
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.args[0]==='variable'));
});

test('an uncertain workflow failure does not claim a successful dispatch or repeat variable writes',async()=>{
  const calls=[];
  await assert.rejects(executeCommunityConfiguration(account,{apply:true,deploy:true,runner:async(cli,args)=>{calls.push(args);if(args[0]==='workflow') throw new Error('private detail');}}),/dispatch could not be confirmed/);
  assert.equal(calls.length,3);assert.equal(calls.filter(args=>args[0]==='workflow').length,1);
});

test('CLI parsing defaults to check, rejects ambiguous options, and restricts the target repository',()=>{
  const parsed=parseCommunityArguments(['--file','outside/public-settings.json']);
  assert.equal(parsed.apply,false);assert.equal(parsed.deploy,false);assert.equal(parsed.repo,REPOSITORY);
  assert.equal(parseCommunityArguments(['--help']).help,true);
  assert.equal(parseCommunityArguments(['--file','x.json','--apply','--deploy','--github-cli','C:\\Portable Tools\\gh.exe']).githubCli,'C:\\Portable Tools\\gh.exe');
  for(const argv of [[],['--file'],['--file','--apply'],['--file','x','--apply','--check'],['--file','x','--deploy'],['--file','x','--repo','other/repo'],['--file','x','--file','y'],['--file','x','--token','private']]) assert.throws(()=>parseCommunityArguments(argv));
});

test('CLI dry-run and file failures do not leak input contents or invoke GitHub',async()=>{
  const calls=[],output=[];
  const summary=await runCommunityCli(['--file','outside/public-settings.json'],{readConfig:async()=>full(),runner:runner(calls),print:text=>output.push(text)});
  assert.equal(summary.applied,false);assert.equal(calls.length,0);assert.equal(output.length,1);
  assert.ok(!output.join('').includes(account.VITE_SUPABASE_PUBLISHABLE_KEY));assert.ok(!output.join('').includes(links.VITE_DONATION_ONCE_URL));
  await assert.rejects(runCommunityCli(['--file','outside/public-settings.json','--apply'],{readConfig:async()=>{throw new Error('private file contents');},runner:runner(calls),print:text=>output.push(text)}),error=>!error.message.includes('private file contents'));
  assert.equal(calls.length,0);assert.equal(output.length,1);
});

test('importing the deployment module executes no CLI, file read, logging or auth initialization',()=>{
  const script=new URL('../scripts/configure-community.mjs',import.meta.url);
  const imported=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(script.href)+');'],{encoding:'utf8',timeout:10000});
  assert.equal(imported.status,0);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');
  const help=spawnSync(process.execPath,[fileURLToPath(script),'--help'],{encoding:'utf8',timeout:10000});
  assert.equal(help.status,0);assert.match(help.stdout,/Missing settings are preserved/);assert.match(help.stdout,/SMTP/);assert.equal(help.stderr,'');
});
