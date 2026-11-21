#!/usr/bin/env node
// Karlo → Claude Code helper for your Mac.
//
// Picks up cards you sent with "Ask Claude" in Karlo, runs Claude Code in the chosen project folder
// (with the card's text and images), and reports back to the card: waiting → working → done / failed.
//
//   node ~/.karlo/claude-runner.mjs --setup <key>   save the key from Karlo and start on every login
//   node ~/.karlo/claude-runner.mjs --status        is it set up / running?
//   node ~/.karlo/claude-runner.mjs --folders       list the project folders Karlo will offer
//   node ~/.karlo/claude-runner.mjs --uninstall     stop it and remove the login item
//   node ~/.karlo/claude-runner.mjs                 run in this Terminal (what the login item does)
//
// Files: ~/.karlo/claude.json (settings, private), ~/.karlo/claude-runner.log, ~/.karlo/tasks/<id>/ (images)

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.karlo');
const CONF = path.join(DIR, 'claude.json');
const LOG = path.join(DIR, 'claude-runner.log');
const TASKS = path.join(DIR, 'tasks');
const LABEL = 'com.orionsoftsol.karlo-claude';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const POLL_MS = 10_000;
const MAX_RUN_MS = 90 * 60_000;
const PATHS = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

const log = (...a) => console.log(new Date().toISOString(), ...a);

function readConf() {
  try {
    return JSON.parse(fs.readFileSync(CONF, 'utf8'));
  } catch {
    return {};
  }
}
function writeConf(c) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CONF, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.chmodSync(CONF, 0o600);
}

function findClaude() {
  for (const p of PATHS) {
    const f = path.join(p, 'claude');
    if (fs.existsSync(f)) return f;
  }
  try {
    return execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

async function rpc(conf, name, body) {
  const res = await fetch(`${conf.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: conf.anonKey, Authorization: `Bearer ${conf.anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---- project folders on this Mac (so Karlo can offer a list instead of asking for a path)
const ROOTS = ['Desktop', 'Documents', 'Projects', 'projects', 'Developer', 'Code', 'code', 'dev', 'src', 'repos', 'GitHub', 'Sites', 'workspace'];
const MARKERS = ['.git', 'package.json', 'pubspec.yaml', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'composer.json', 'Gemfile', 'pom.xml', 'build.gradle'];
const SKIP = new Set(['node_modules', 'Library', 'build', 'dist', 'Pods', 'vendor', 'venv', '.venv', 'DerivedData', 'android', 'ios', 'macos', 'windows', 'linux', 'web']);

function scanFolders() {
  const found = [];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth > 3 || found.length >= 300) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no permission / gone
    }
    const names = new Set(entries.map((e) => e.name));
    if (depth > 0 && MARKERS.some((m) => names.has(m))) {
      let real = dir;
      try {
        real = fs.realpathSync(dir);
      } catch {
        /* ignore */
      }
      if (!seen.has(real.toLowerCase())) {
        seen.add(real.toLowerCase()); // the Mac's disk ignores upper/lower case: Code and code are one folder
        let mtime = 0;
        try {
          mtime = fs.statSync(dir).mtimeMs;
        } catch {
          /* ignore */
        }
        found.push({ name: path.basename(real), path: real, git: names.has('.git'), mtime });
      }
      if (names.has('.git')) return; // a repo: don't list its sub-folders separately
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const r of ROOTS) {
    const d = path.join(os.homedir(), r);
    if (fs.existsSync(d)) walk(d, 0);
  }
  return found.sort((a, b) => b.mtime - a.mtime).map(({ name, path: p, git }) => ({ name, path: p, git }));
}

async function reportFolders(conf) {
  const folders = scanFolders();
  await rpc(conf, 'claude_runner_folders', { p_key: conf.key, p_folders: folders });
  return folders.length;
}

const update = (conf, id, status, extra = {}) =>
  rpc(conf, 'claude_runner_update', { p_key: conf.key, p_id: id, p_status: status, p_session: extra.session ?? null, p_result: extra.result ?? null });

const safeName = (n, i) => `${String(i + 1).padStart(2, '0')}-${(n || 'image').replace(/[^\w.-]+/g, '_').slice(0, 80)}`;

async function downloadImages(task, dir) {
  const saved = [];
  for (const [i, img] of (task.images ?? []).entries()) {
    try {
      const res = await fetch(img.url);
      if (!res.ok) throw new Error(String(res.status));
      const file = path.join(dir, safeName(img.name, i));
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      saved.push(file);
    } catch (e) {
      log(`  could not download ${img.name}: ${e.message}`);
    }
  }
  return saved;
}

function buildPrompt(task, images) {
  const notes = [
    '',
    '---',
    'Notes from Karlo (sent from a card by the project owner):',
    images.length
      ? `- The card's images are saved here — open and look at them, they show what the task is about:\n${images.map((f) => `  - ${f}`).join('\n')}`
      : '- The card has no images.',
    '- Work in this project folder. Make the change, then run the project\'s own checks (type check, lint, tests) if it has them.',
    '- Do not commit, push or deploy unless the task above asks for it.',
    '- Finish with a short, plain-language summary: what you changed (files), anything you could not do, and how to check it.',
  ];
  return task.prompt + '\n' + notes.join('\n');
}

function runClaude(conf, task, prompt, dir, sessionId) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--permission-mode', 'auto', '--name', `Karlo: ${task.card_title}`.slice(0, 80), '--session-id', sessionId, '--add-dir', dir, '--output-format', 'json'];
    const child = spawn(conf.claudePath, args, {
      cwd: task.project_path,
      env: { ...process.env, PATH: [...PATHS, process.env.PATH ?? ''].join(':') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      err += '\nStopped after 90 minutes.';
      child.kill('SIGTERM');
    }, MAX_RUN_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed = null;
      try {
        parsed = JSON.parse(out.trim().split('\n').filter(Boolean).pop() ?? '');
      } catch {
        /* not JSON */
      }
      if (parsed && typeof parsed.result === 'string') resolve({ ok: !parsed.is_error && code === 0, text: parsed.result });
      else resolve({ ok: false, text: (err || out || `Claude exited with code ${code}`).trim().slice(-4000) });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: `Could not start Claude Code: ${e.message}` });
    });
  });
}

async function handle(conf, task) {
  log(`task ${task.id} — "${task.card_title}" → ${task.project_name} (${task.project_path})`);
  if (!fs.existsSync(task.project_path)) {
    await update(conf, task.id, 'failed', { result: `The project folder was not found on this Mac:\n${task.project_path}\n\nFix the folder in Karlo → Ask Claude → Projects & Mac.` });
    return;
  }
  const dir = path.join(TASKS, task.id);
  fs.mkdirSync(dir, { recursive: true });
  const images = await downloadImages(task, dir);
  const sessionId = randomUUID();
  await update(conf, task.id, 'working', { session: sessionId });
  const r = await runClaude(conf, task, buildPrompt(task, images), dir, sessionId);
  if (!r.ok && /authenticat|log ?in|oauth/i.test(r.text)) r.text += '\n\nClaude Code on your Mac needs you to sign in: open Terminal, run `claude`, type /login, then send the card again.';
  await update(conf, task.id, r.ok ? 'done' : 'failed', { result: r.text.slice(0, 12000) });
  log(`  ${r.ok ? 'done' : 'failed'}`);
}

async function loop() {
  const conf = readConf();
  if (!conf.url || !conf.anonKey || !conf.key) {
    log('Not set up yet. In Karlo open a card → Ask Claude → Projects & Mac → Connect my Mac, then run the command it shows.');
    process.exit(1);
  }
  conf.claudePath ||= findClaude();
  if (!conf.claudePath) {
    log('Claude Code was not found. Install it, then run --setup again.');
    process.exit(1);
  }
  log(`Karlo Claude helper running (Claude Code: ${conf.claudePath}). Checking for tasks every ${POLL_MS / 1000}s.`);
  let lastErr = '';
  let lastScan = 0;
  for (;;) {
    if (Date.now() - lastScan > 10 * 60_000) {
      lastScan = Date.now();
      await reportFolders(conf).then(
        (n) => log(`Sent Karlo a list of ${n} project folders.`),
        (e) => log(`Could not send the folder list: ${e.message}`),
      );
    }
    try {
      const tasks = (await rpc(conf, 'claude_runner_poll', { p_key: conf.key })) ?? [];
      lastErr = '';
      for (const t of tasks) {
        try {
          await handle(conf, t);
        } catch (e) {
          log(`  task ${t.id} error: ${e.message}`);
          await update(conf, t.id, 'failed', { result: `The Mac helper hit a problem: ${e.message}` }).catch(() => {});
        }
      }
    } catch (e) {
      // Offline or asleep: say it once, keep trying.
      if (e.message !== lastErr) log(`Could not reach Karlo: ${e.message}`);
      lastErr = e.message;
      if (/Unknown key/.test(e.message)) log('The key was replaced in Karlo. Run --setup with the new key.');
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function installLoginItem() {
  const script = path.join(DIR, 'claude-runner.mjs');
  if (path.resolve(process.argv[1]) !== script) fs.copyFileSync(process.argv[1], script);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(script)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>WorkingDirectory</key><string>${xml(os.homedir())}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(PATHS.join(':'))}</string>
    <key>HOME</key><string>${xml(os.homedir())}</string>
  </dict>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist);
  const uid = process.getuid();
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  } catch {
    /* not loaded yet */
  }
  execFileSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST]);
}

function status() {
  const conf = readConf();
  let running = false;
  try {
    running = execFileSync('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes('state = running');
  } catch {
    /* not loaded */
  }
  console.log(`Key saved:     ${conf.key ? 'yes' : 'no'}`);
  console.log(`Claude Code:   ${conf.claudePath || findClaude() || 'not found'}`);
  console.log(`Login item:    ${fs.existsSync(PLIST) ? 'installed' : 'not installed'}${running ? ' (running)' : ''}`);
  console.log(`Log:           ${LOG}`);
}

const [flag, value] = process.argv.slice(2);
if (flag === '--setup') {
  if (!value?.startsWith('karlo_')) {
    console.error('Usage: node claude-runner.mjs --setup karlo_…   (copy the command from Karlo → Ask Claude → Projects & Mac)');
    process.exit(1);
  }
  const conf = readConf();
  if (!conf.url || !conf.anonKey) {
    console.error('~/.karlo/claude.json is missing the Karlo server details. Ask Claude Code to reinstall the Karlo helper.');
    process.exit(1);
  }
  const claudePath = findClaude();
  if (!claudePath) {
    console.error('Claude Code is not installed on this Mac (the `claude` command was not found).');
    process.exit(1);
  }
  conf.key = value;
  conf.claudePath = claudePath;
  writeConf(conf);
  try {
    await rpc(conf, 'claude_runner_poll', { p_key: conf.key });
  } catch (e) {
    console.error(`The key didn't work: ${e.message}`);
    process.exit(1);
  }
  const n = await reportFolders(conf).catch(() => 0);
  installLoginItem();
  console.log(`✓ Found ${n} project folders — pick one in Karlo (Ask Claude → Projects & Mac).`);
  console.log('✓ Connected to Karlo. The helper now runs in the background and starts whenever you log in.');
  console.log(`  Claude Code: ${claudePath}`);
  console.log(`  Log: ${LOG}`);
} else if (flag === '--uninstall') {
  try {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
  } catch {
    /* not loaded */
  }
  fs.rmSync(PLIST, { force: true });
  console.log('Stopped. The helper no longer starts at login.');
} else if (flag === '--folders') {
  for (const f of scanFolders()) console.log(`${f.name.padEnd(28)} ${f.path}`);
} else if (flag === '--status') {
  status();
} else {
  await loop();
}
