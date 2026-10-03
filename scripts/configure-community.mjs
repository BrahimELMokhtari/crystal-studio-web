import {readFile, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAccountConfig} from '../frontend/account-service.js';
import {supportConfig} from '../frontend/support.js';

export const REPOSITORY = 'BrahimELMokhtari/crystal-studio-web';
const REPO_ARGUMENT = 'github.com/' + REPOSITORY;
const SETTINGS = Object.freeze({
  VITE_SUPABASE_URL:'SUPABASE_URL',
  VITE_SUPABASE_PUBLISHABLE_KEY:'SUPABASE_PUBLISHABLE_KEY',
  VITE_DONATION_MONTHLY_URL:'DONATION_MONTHLY_URL',
  VITE_DONATION_ONCE_URL:'DONATION_ONCE_URL',
});
const PLACEHOLDER = /(?:^|[\s_\/-])(?:example|dummy|synthetic|placeholder|sample|your|your-project|your-key|test-key|test)(?:[\s_\/-]|$)|\$\{|<[^>]*>|\.\.\./i;
const PRIVATE = /sb_secret_|\bsk_(?:live|test)_|\bghp_|\bgithub_pat_|-----BEGIN|(?:[?&])(?:client_secret|api_key|access_token|refresh_token|password|secret)=/i;
const EXAMPLE_PROJECTS = new Set(['abcdefghijklmnopqrst','crystaltest','crystaltestsupabase','xyzcompany','your-project','your-project-id','project','example','test','dummy','placeholder']);

function checkRepository(repository) {
  if (typeof repository !== 'string' || repository.toLowerCase() !== REPOSITORY.toLowerCase()) throw new Error('This script is restricted to ' + REPOSITORY + '.');
}

/** Validate the entire update before starting any CLI process. Omitted settings are untouched. */
export function planCommunityConfiguration(config, {repo = REPOSITORY, deploy = false} = {}) {
  checkRepository(repo);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Public configuration must be a JSON object.');
  const keys = Object.keys(config);
  if (!keys.length) throw new Error('Provide at least one public setting; no configuration was supplied.');
  if (keys.some(name=>!Object.hasOwn(SETTINGS,name))) throw new Error('Unsupported configuration fields. Supply only the four documented public VITE_* settings.');
  const values = {};
  for (const name of keys) {
    const value = config[name];
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(name + ' must be a nonempty public string. Blank values cannot delete settings.');
    if (PRIVATE.test(value)) throw new Error('Private credentials are not accepted. Use only public account settings and hosted donation links.');
    if (PLACEHOLDER.test(value)) throw new Error('Placeholder or test settings cannot be used for this live site.');
    values[name] = value.trim();
  }
  const hasUrl = Object.hasOwn(values,'VITE_SUPABASE_URL'), hasKey = Object.hasOwn(values,'VITE_SUPABASE_PUBLISHABLE_KEY');
  if (hasUrl !== hasKey) throw new Error('Supply both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY together.');
  if (hasUrl) {
    const accounts = validateAccountConfig(values);
    if (!accounts.enabled) throw new Error(accounts.reason);
    if (EXAMPLE_PROJECTS.has(new URL(accounts.url).hostname.split('.')[0])) throw new Error('An example Supabase project cannot be used for this live site.');
    values.VITE_SUPABASE_URL = accounts.url;
    values.VITE_SUPABASE_PUBLISHABLE_KEY = accounts.key;
  }
  const support = supportConfig(values);
  for (const [name,link] of [['VITE_DONATION_MONTHLY_URL',support.monthly],['VITE_DONATION_ONCE_URL',support.once]]) {
    if (!Object.hasOwn(values,name)) continue;
    if (!link) throw new Error(name + ' must be a supported HTTPS hosted payment link.');
    const payment = new URL(link);
    if (payment.hostname.endsWith('.stripe.com') && /(?:^|\/)(?:test_|cs_test_)/i.test(payment.pathname)) throw new Error('Stripe test payment links cannot be used for this live site.');
    values[name] = link;
  }
  return Object.freeze({repository:REPOSITORY,deploy:!!deploy,
    readiness:Object.freeze({accountPair:hasUrl,monthlyLink:!!support.monthly,onceLink:!!support.once}),
    variables:Object.freeze(Object.entries(SETTINGS).filter(([name])=>Object.hasOwn(values,name)).map(([name,variable])=>Object.freeze({name:variable,value:values[name]})))});
}

export function publicConfigurationSummary(plan, {applied = false, workflowStarted = false} = {}) {
  return {repository:REPOSITORY,validated:plan.readiness,settings:plan.variables.map(variable=>variable.name),applied:!!applied,workflowStarted:!!workflowStarted};
}

// gh reads a variable's value from stdin when --body is absent. Never invoke a shell.
// https://cli.github.com/manual/gh_variable_set
export function runGitHub(cli, args, {input = '', timeoutMs = 30000} = {}) {
  return new Promise((accept,reject)=>{
    let process;
    try { process = spawn(cli,args,{shell:false,windowsHide:true,stdio:['pipe','ignore','ignore'],env:{...globalThis.process.env,GH_PROMPT_DISABLED:'1',GH_HOST:'github.com'}}); }
    catch { reject(new Error('GitHub CLI could not be started.'));return; }
    const timer = setTimeout(()=>{process.kill();reject(new Error('GitHub CLI timed out.'));},timeoutMs);
    process.once('error',()=>{clearTimeout(timer);reject(new Error('GitHub CLI could not be started.'));});
    process.once('close',code=>{clearTimeout(timer);code === 0 ? accept() : reject(new Error('GitHub CLI request failed.'));});
    // An early process exit can close stdin; the close/error events determine success.
    process.stdin.on('error',()=>{});
    process.stdin.end(input);
  });
}

/** An explicit apply is required; all live values travel through stdin, never command arguments. */
export async function executeCommunityConfiguration(config, {apply = false,deploy = false,repo = REPOSITORY,githubCli = 'gh',runner = runGitHub} = {}) {
  if (deploy && !apply) throw new Error('--deploy requires --apply.');
  if (typeof githubCli !== 'string' || !githubCli.trim() || githubCli.length > 2048 || /[\x00-\x1f\x7f]/.test(githubCli)) throw new Error('Provide a valid GitHub CLI executable path.');
  const plan = planCommunityConfiguration(config,{repo,deploy});
  if (!apply) return publicConfigurationSummary(plan);
  for (const variable of plan.variables) {
    try { await runner(githubCli,['variable','set',variable.name,'--repo',REPO_ARGUMENT],{input:variable.value,timeoutMs:30000}); }
    catch { throw new Error('Could not confirm update of ' + variable.name + '. Earlier settings may have changed; no workflow was dispatched. Retry the complete configuration after checking GitHub variables.'); }
  }
  if (deploy) {
    try { await runner(githubCli,['workflow','run','pages.yml','--repo',REPO_ARGUMENT,'--ref','main'],{input:'',timeoutMs:30000}); }
    catch { throw new Error('Settings were updated, but workflow dispatch could not be confirmed. Check GitHub Actions before retrying deployment.'); }
  }
  return publicConfigurationSummary(plan,{applied:true,workflowStarted:deploy});
}

export function parseCommunityArguments(argv) {
  const options = {apply:false,deploy:false,repo:REPOSITORY,githubCli:'gh',help:false};
  const used = new Set();let explicitCheck = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (used.has(flag)) throw new Error('Each option may be supplied only once.');
    used.add(flag);
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--apply') options.apply = true;
    else if (flag === '--check') explicitCheck = true;
    else if (flag === '--deploy') options.deploy = true;
    else if (['--file','--github-cli','--repo'].includes(flag)) {
      const value = argv[++index];
      if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('The file, executable and repository options each require a value.');
      options[{'--file':'file','--github-cli':'githubCli','--repo':'repo'}[flag]] = value;
    } else throw new Error('Unknown option. Use --help for supported options.');
  }
  if (options.apply && explicitCheck) throw new Error('Choose --check or --apply, not both.');
  checkRepository(options.repo);
  if (!options.help && !options.file) throw new Error('--file is required. Supply public JSON outside the project directory.');
  if (options.deploy && !options.apply) throw new Error('--deploy requires --apply.');
  return options;
}

const HELP = `Validate optional community settings without changing the site:
  node scripts/configure-community.mjs --file <public-settings.json> [--check]

Apply public settings to the fixed repository, optionally deploy Pages:
  node scripts/configure-community.mjs --file <public-settings.json> --apply [--deploy] [--github-cli <gh.exe>]

Repository: ${REPOSITORY} (--repo may specify only this repository).
JSON fields: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY,
VITE_DONATION_MONTHLY_URL, VITE_DONATION_ONCE_URL.
The account pair must be supplied together. Missing settings are preserved.
Keep the JSON outside the public project, for example in .deployment_auth/community/.
Never supply passwords, private keys or payment API credentials.
Validation does not confirm SMTP delivery, checkout prices or recurring terms.
`;

async function readPublicConfiguration(filename) {
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > 32768) throw new Error();
    const content = await readFile(filename,'utf8');
    if (Buffer.byteLength(content) > 32768) throw new Error();
    return JSON.parse(content.replace(/^\uFEFF/,''));
  } catch { throw new Error('Unable to read a valid public JSON file of at most 32 KiB. No settings were changed.'); }
}

export async function runCommunityCli(argv, {readConfig = readPublicConfiguration,runner = runGitHub,print = console.log} = {}) {
  const options = parseCommunityArguments(argv);
  if (options.help) { print(HELP);return null; }
  let config;
  try { config = await readConfig(options.file); } catch { throw new Error('Unable to read public configuration. No settings were changed.'); }
  const summary = await executeCommunityConfiguration(config,{...options,runner});
  print(JSON.stringify(summary,null,2));
  return summary;
}

const invokedPath = globalThis.process.argv[1] ? resolve(globalThis.process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath && (globalThis.process.platform === 'win32' ? invokedPath.toLowerCase() === modulePath.toLowerCase() : invokedPath === modulePath)) {
  runCommunityCli(globalThis.process.argv.slice(2)).catch(error=>{console.error(error.message);globalThis.process.exitCode = 1;});
}
