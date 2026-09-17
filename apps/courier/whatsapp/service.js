'use strict';
/**
 * J&T WhatsApp service - posts every new order into a WhatsApp group.
 *
 * Start it with jt-whatsapp.bat and leave the window open.
 *
 * The order code never talks to WhatsApp.  It drops one JSON job per created
 * order into the outbox (backend/app/notify/whatsapp.py), and this service -
 * the only process holding the linked WhatsApp session - sends them.  Jobs
 * created while the service is stopped simply wait in the outbox.
 *
 * Each job carries its messages ready-made (text, photo, PDF).  Progress is
 * saved after every message, so a retry resumes where it stopped instead of
 * posting duplicates.  Finished jobs move to sent/; a job that keeps failing
 * moves to failed/ with the reason, so one bad job can never block the rest.
 *
 * WhatsApp is reached with Baileys, which speaks WhatsApp's own protocol.  An
 * earlier version drove WhatsApp Web in a hidden Chrome and broke whenever
 * WhatsApp renamed something inside its web app (September 2026: `r: r`).
 *
 *   node service.js               link (first run), pick a group, then send
 *   node service.js --qr          link with a QR code instead of a pairing code
 *   node service.js --pick-group  choose the groups again (orders, drop-ship)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const qrcode = require('qrcode-terminal');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..');
const ENV = readEnv(path.join(REPO, '.env'));

const OUTBOX = path.resolve(ENV.JT_WHATSAPP_OUTBOX_DIR || path.join(HERE, 'outbox'));
const SENT = path.join(path.dirname(OUTBOX), 'sent');
const FAILED = path.join(path.dirname(OUTBOX), 'failed');
// The linked-device keys.  Anyone holding this folder can use the WhatsApp
// account, so it is git-ignored and must never be shared.
const AUTH = path.join(HERE, '.auth');
const CONFIG = path.join(HERE, 'config.json');
// Rewritten every few seconds while running.  The order code reads it to
// tell the user whether queued orders will actually go out.
const HEARTBEAT = path.join(path.dirname(OUTBOX), 'heartbeat.json');

const POLL_MS = 3000;
// Human-like pacing keeps the account from looking like a bot.
const MESSAGE_GAP_MS = [2000, 4000];     // between the messages of one order
const ORDER_GAP_MS = [5000, 9000];       // between orders
const RETRY_WAIT_MS = 30000;             // after a failed send
const MAX_ATTEMPTS = 5;
// Each attempt to link without success sends a notification to the phone, so
// stop asking after a few instead of pestering it indefinitely.
const MAX_LINK_ATTEMPTS = 3;

const MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const args = new Set(process.argv.slice(2));

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
function readEnv(file) {
  const values = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // no .env - defaults and real environment variables only
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line || line.startsWith('#') || eq < 1) continue;
    let value = line.slice(eq + 1).trim().replace(/\s+#.*$/, '');
    value = value.replace(/^(['"])(.*)\1$/, '$2');
    values[line.slice(0, eq).trim()] = value;
  }
  // a real environment variable wins, as it does for the Python settings
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('JT_')) values[key] = process.env[key];
  }
  return values;
}

function log(message) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] ${message}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = ([low, high]) => low + Math.floor(Math.random() * (high - low));

function writeJsonAtomic(file, data) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function beat(state, groups, held = 0) {
  try {
    writeJsonAtomic(HEARTBEAT, {
      at: new Date().toISOString(),
      state,
      group: groups && groups.main ? groups.main.name : null,
      dropship_group: groups && groups.dropship ? groups.dropship.name : null,
      // paid drop-ship orders waiting because no drop-ship group is chosen
      held,
      pid: process.pid,
    });
  } catch {
    // a missed heartbeat only makes the status line pessimistic
  }
}

function clearBeat() {
  fs.rmSync(HEARTBEAT, { force: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function pairingPhone() {
  const raw = ENV.JT_WHATSAPP_PHONE || '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) {
    throw new Error(
      `JT_WHATSAPP_PHONE needs the country code without the leading 0 ` +
        `(e.g. 60123456789), got "${raw}"`,
    );
  }
  return digits;
}

// ---------------------------------------------------------------------------
// group selection
// ---------------------------------------------------------------------------
const NO_TERMINAL =
  'No keyboard input - start jt-whatsapp.bat in a terminal window to choose the group.';

/**
 * Prompt on the terminal.  Rejects instead of hanging when there is no input,
 * and passes Ctrl+C on: while readline owns the keyboard it would otherwise
 * swallow Ctrl+C, and the service could not be stopped from the picker.
 */
function terminalAsk(input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, output });
  let closed = false;
  let interrupted = false;
  const why = () => new Error(interrupted ? 'cancelled with Ctrl+C' : NO_TERMINAL);
  rl.on('close', () => {
    closed = true;
  });
  rl.on('SIGINT', () => {
    interrupted = true;
    rl.close();
    process.emit('SIGINT');
  });
  const ask = (prompt) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(why());
      const onClose = () => reject(why());
      rl.once('close', onClose);
      rl.question(prompt).then(
        (answer) => {
          rl.off('close', onClose);
          resolve(answer);
        },
        (error) => {
          rl.off('close', onClose);
          reject(closed ? why() : error);
        },
      );
    });
  ask.close = () => rl.close();
  return ask;
}

function printGroups(groups) {
  console.log('\n  Your WhatsApp groups');
  console.log('  --------------------');
  if (groups.length === 0) {
    console.log('    (none yet - this number must be a member of the orders group)');
  }
  groups.forEach((group, i) => console.log(`    [${i + 1}] ${group.name}`));
  console.log('    [0] refresh - a group created a moment ago can take a minute to appear\n');
}

/**
 * Numbered picker.  0 re-reads the list, so a brand-new group can still be
 * chosen.  With `allowSkip`, Enter answers "not now" and returns null.
 */
async function chooseGroup(
  whatsapp,
  ask,
  { question = 'Post orders to which group?', current = null, allowSkip = false } = {},
) {
  let groups = await whatsapp.listGroups();
  printGroups(groups);
  for (;;) {
    const range = groups.length ? `1-${groups.length}, or 0 to refresh` : '0 to refresh';
    const enter = current
      ? `, Enter to keep "${current.name}"`
      : allowSkip
        ? ', Enter to decide later'
        : '';
    const answer = String(await ask(`  ${question} ${range}${enter}: `)).trim();
    if (answer === '' && current) return current;
    if (answer === '' && allowSkip) return null;
    if (answer === '0') {
      groups = await whatsapp.listGroups();
      printGroups(groups);
      continue;
    }
    const pick = Number(answer);
    if (answer && Number.isInteger(pick) && pick >= 1 && pick <= groups.length) {
      return groups[pick - 1];
    }
    console.log(`  "${answer}" is not on the list.`);
  }
}

/** The group a job goes to; null while its group has not been chosen yet. */
function groupForJob(job, groups) {
  return job && job.route === 'dropship' ? groups.dropship : groups.main;
}

/** Group list with a few retries: a lookup can fail while the link settles. */
async function listGroupsPatiently(whatsapp) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await whatsapp.listGroups();
    } catch (error) {
      if (attempt >= 5) throw error;
      await sleep(3000);
    }
  }
}

const PICK_AGAIN = 'close this window and run:  jt-whatsapp --pick-group';

/**
 * Which groups have to be asked for at startup - from config.json and the
 * groups this number is in.  No WhatsApp or keyboard involved, so it is tested.
 *
 * - The orders group is asked for until one is saved, and again when this
 *   number has left it: nothing can be sent without it.
 * - The drop-ship group is asked for ONCE.  A choice, or Enter to decide
 *   later, is remembered - so the automatic restart after a disconnect never
 *   stops at a question with orders waiting.  If this number leaves that
 *   group, drop-ship orders wait and the window says how to pick again.
 * - --pick-group asks for both again; Enter keeps the current choice.
 */
function planGroups(config, known, repick = false) {
  const find = (id) => (id && known.find((g) => g.id === id)) || null;
  const main = find(config.groupId);
  const dropship = find(config.dropshipGroupId);
  const notes = [];
  if (config.groupId && !main) {
    notes.push(`This number is no longer in "${config.groupName}" - pick the orders group again.`);
  }
  if (config.dropshipGroupId && !dropship && !repick) {
    notes.push(
      `This number is no longer in "${config.dropshipGroupName}" - paid drop-ship orders ` +
        `will wait. To choose another group, ${PICK_AGAIN}`,
    );
  }
  const dropshipDecided = Boolean(config.dropshipGroupId) || config.dropshipSkipped === true;
  return { main, dropship, askMain: repick || !main, askDropship: repick || !dropshipDecided, notes };
}

/**
 * The main orders group and the drop-ship group.
 *
 * Paid orders whose items are all drop-shipped go to the drop-ship group; the
 * rest to the main group.  Both are remembered in config.json and chosen again
 * with --pick-group.  The drop-ship group may be left for later: its orders
 * then wait in the outbox, and everything else still goes out.
 */
async function resolveGroups(whatsapp) {
  const config = readJson(CONFIG, {});
  const known = await listGroupsPatiently(whatsapp);
  const plan = planGroups(config, known, args.has('--pick-group'));
  plan.notes.forEach((note) => log(note));
  let { main, dropship } = plan;
  if (!plan.askMain && !plan.askDropship) return { main, dropship };

  const ask = terminalAsk();
  try {
    if (plan.askMain) {
      main = await chooseGroup(whatsapp, ask, { current: main });
      config.groupId = main.id;
      config.groupName = main.name;
      log(`Saved: orders will go to "${main.name}".`);
    }
    if (plan.askDropship) {
      console.log('\n  Paid orders where every item is drop-shipped go to a separate group.');
      dropship = await chooseGroup(whatsapp, ask, {
        question: 'Send paid drop-ship orders to which group?',
        current: dropship,
        allowSkip: true,
      });
      if (dropship) {
        config.dropshipGroupId = dropship.id;
        config.dropshipGroupName = dropship.name;
        delete config.dropshipSkipped;
        log(`Saved: paid drop-ship orders will go to "${dropship.name}".`);
      } else {
        delete config.dropshipGroupId;
        delete config.dropshipGroupName;
        config.dropshipSkipped = true;
        log(`No drop-ship group for now - paid drop-ship orders will wait. To choose one later, ${PICK_AGAIN}`);
      }
    }
    writeJsonAtomic(CONFIG, config);
    return { main, dropship };
  } finally {
    ask.close();
  }
}

// ---------------------------------------------------------------------------
// sending
// ---------------------------------------------------------------------------
/**
 * A job message as Baileys message content.  Files are passed as their bytes,
 * never as a path: Baileys treats a path as a URL, and a photo named
 * "#1 (5).jpeg" would be cut off at the "#".
 */
function toBaileysContent(message) {
  const mimetype = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  switch (message.type) {
    case 'text':
      return { text: message.text };
    case 'image':
      return {
        image: fs.readFileSync(message.path),
        mimetype: mimetype(message.path),
        caption: message.caption || undefined,
      };
    case 'document':
      return {
        document: fs.readFileSync(message.path),
        mimetype: mimetype(message.path),
        fileName: path.basename(message.path),
      };
    default:
      throw new Error(`unknown message type "${message.type}"`);
  }
}

function missingFiles(job) {
  return job.messages
    .slice(job.sent || 0)
    .filter((m) => m.path && !fs.existsSync(m.path))
    .map((m) => m.path);
}

function moveJob(file, folder, job) {
  fs.mkdirSync(folder, { recursive: true });
  writeJsonAtomic(file, job);
  fs.renameSync(file, path.join(folder, path.basename(file)));
}

/** Returns false when sending failed, so the caller can back off. */
async function processJob(whatsapp, group, file, { messageGap = MESSAGE_GAP_MS } = {}) {
  const job = readJson(file, null);
  const name = path.basename(file);
  if (!job || !Array.isArray(job.messages)) {
    moveJob(file, FAILED, { raw: fs.readFileSync(file, 'utf8'), last_error: 'unreadable job file' });
    log(`FAILED ${name}: unreadable job file - moved to failed/`);
    return true;
  }
  const label = `#${job.order_no || job.tracking_no}`;

  // A deleted photo or PDF will not come back by retrying.
  const missing = missingFiles(job);
  if (missing.length) {
    job.last_error = `file not found: ${missing.join(', ')}`;
    moveJob(file, FAILED, job);
    log(`FAILED ${label}: ${job.last_error} - moved to failed/`);
    return true;
  }

  job.attempts = (job.attempts || 0) + 1;
  try {
    for (let i = job.sent || 0; i < job.messages.length; i++) {
      if (i > 0) await sleep(between(messageGap));
      await whatsapp.send(group.id, job.messages[i]);
      job.sent = i + 1;
      job.last_error = null;
      writeJsonAtomic(file, job);    // resume point, saved before anything else can fail
    }
    job.sent_at = new Date().toISOString();
    moveJob(file, SENT, job);
    log(`sent ${label} (${job.messages.length} messages) to "${group.name}"`);
    return true;
  } catch (error) {
    job.last_error = String((error && error.message) || error);
    // Failing because WhatsApp restricted the number is not this job's fault:
    // keep its attempts, so a long restriction cannot push orders to failed/.
    if (whatsapp.isRestricted && whatsapp.isRestricted()) {
      job.attempts -= 1;
      writeJsonAtomic(file, job);
      log(`paused ${label} (${job.sent}/${job.messages.length} sent): WhatsApp restricted this number`);
      return false;
    }
    if (job.attempts >= MAX_ATTEMPTS) {
      moveJob(file, FAILED, job);
      log(`FAILED ${label} after ${job.attempts} attempts: ${job.last_error} - moved to failed/`);
      return true;
    }
    writeJsonAtomic(file, job);
    log(`retry later ${label} (attempt ${job.attempts}/${MAX_ATTEMPTS}, ${job.sent}/${job.messages.length} sent): ${job.last_error}`);
    return false;
  }
}

function pendingJobs() {
  try {
    return fs
      .readdirSync(OUTBOX)
      .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
      .sort()
      .map((name) => path.join(OUTBOX, name));
  } catch {
    return [];
  }
}

/**
 * Pending jobs that can go out now, each with its group, and those waiting
 * for a group that has not been chosen.  An unreadable job counts as ready:
 * processJob files it under failed/.
 */
function planRound(files, groups) {
  const ready = [];
  const held = [];
  for (const file of files) {
    const job = readJson(file, null);
    const group = job ? groupForJob(job, groups) : groups.main;
    if (group) ready.push({ file, group });
    else held.push(file);
  }
  return { ready, held };
}

async function drainForever(whatsapp, groups) {
  let announcedIdle = false;
  let announcedOffline = false;
  let announcedRestricted = false;
  let announcedHeld = 0;
  for (;;) {
    const connected = whatsapp.isConnected();
    const restricted = connected && whatsapp.isRestricted();
    const { ready, held } = planRound(pendingJobs(), groups);
    beat(restricted ? 'RESTRICTED' : connected ? 'CONNECTED' : 'RECONNECTING', groups, held.length);

    if (held.length !== announcedHeld) {
      if (held.length) {
        log(
          `${held.length} paid drop-ship order(s) waiting: no drop-ship group chosen. ` +
            `To choose it, ${PICK_AGAIN}`,
        );
      }
      announcedHeld = held.length;
    }

    if (ready.length === 0) {
      if (!announcedIdle) log('Waiting for new orders...');
      announcedIdle = true;
      await sleep(POLL_MS);
      continue;
    }
    announcedIdle = false;

    if (!connected) {
      if (!announcedOffline) log(`Not connected to WhatsApp - ${ready.length} order(s) waiting`);
      announcedOffline = true;
      await sleep(POLL_MS);
      continue;
    }
    announcedOffline = false;

    if (restricted) {
      if (!announcedRestricted) {
        log(`Sending paused: WhatsApp restriction${whatsapp.restrictionText()} - ${ready.length} order(s) waiting`);
      }
      announcedRestricted = true;
      await sleep(POLL_MS);
      continue;
    }
    announcedRestricted = false;

    log(`${ready.length} order(s) to send`);
    for (let i = 0; i < ready.length; i++) {
      if (i > 0) await sleep(between(ORDER_GAP_MS));
      // a restriction can arrive in the middle of a batch
      if (whatsapp.isRestricted()) break;
      beat('CONNECTED', groups, held.length);
      const ok = await processJob(whatsapp, ready[i].group, ready[i].file);
      if (!ok) {
        // Stop this round: keep the group in order, and give a flaky
        // connection time to recover instead of failing every job at once.
        await sleep(RETRY_WAIT_MS);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// WhatsApp connection
// ---------------------------------------------------------------------------
function showPairingCode(code, phone) {
  const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  console.log(`\n  Link this computer to WhatsApp (+${phone}):`);
  console.log('  WhatsApp on your phone > Settings > Linked devices > Link a device');
  console.log('  > "Link with phone number instead", then enter:\n');
  console.log(`        ${pretty}\n`);
  console.log('  Run with --qr to scan a QR code instead.\n');
}

function showQr(qr) {
  console.log('\n  Link this computer to WhatsApp:');
  console.log('  WhatsApp on your phone > Settings > Linked devices > Link a device\n');
  qrcode.generate(qr, { small: true });
}

/**
 * Keeps one WhatsApp connection alive, reconnecting on its own, and exposes
 * the three things the rest of the service needs.
 */
async function connectWhatsApp({ phone, onFirstOpen, onFatal }) {
  const baileys = await import('baileys');
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, DisconnectReason, Browsers } = baileys;
  const pino = require('pino');

  const whatsapp = {
    sock: null,
    connected: false,
    stopping: false,
    // Set while WhatsApp blocks this number from sending ("reachout timelock").
    restriction: null,
    isConnected: () => whatsapp.connected,
    isRestricted() {
      const r = whatsapp.restriction;
      if (!r) return false;
      if (r.until && r.until.getTime() <= Date.now()) {
        // The end time passed without a "lifted" notice: resume, and ask
        // WhatsApp again so a renewed restriction is picked up at once.
        whatsapp.restriction = null;
        whatsapp.checkStanding();
        return false;
      }
      return true;
    },
    restrictionText() {
      const r = whatsapp.restriction;
      return r && r.until ? ` until ${r.until.toLocaleString()}` : '';
    },
    checkStanding() {
      if (!whatsapp.connected || !whatsapp.sock) return;
      // The answer arrives through connection.update like a pushed notice.
      Promise.resolve()
        .then(() => whatsapp.sock.fetchAccountReachoutTimelock())
        .catch(() => {});
    },
    async send(groupId, message) {
      if (!whatsapp.connected) throw new Error('not connected to WhatsApp');
      const sent = await whatsapp.sock.sendMessage(groupId, toBaileysContent(message));
      if (!sent) throw new Error('WhatsApp did not accept the message');
      return sent;
    },
    async listGroups() {
      if (!whatsapp.connected) throw new Error('not connected to WhatsApp');
      const groups = await whatsapp.sock.groupFetchAllParticipating();
      return Object.values(groups)
        .map((g) => ({ id: g.id, name: g.subject || '(unnamed group)' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    stop() {
      whatsapp.stopping = true;
      // end() closes the connection but keeps this computer linked.
      // (logout() would unlink it from the phone.)
      if (whatsapp.sock) whatsapp.sock.end(undefined);
    },
  };

  let opened = false;
  let failures = 0;
  let linkAttempts = 0;

  const connect = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH);
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.windows('Chrome'),
      // Showing as "online" would stop the phone's own notifications.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    whatsapp.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    let codeRequested = false;
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (update.reachoutTimeLock) {
        const lock = update.reachoutTimeLock;
        if (lock.isActive) {
          const until = lock.timeEnforcementEnds ? new Date(lock.timeEnforcementEnds) : null;
          const known = whatsapp.restriction;
          whatsapp.restriction = { until };
          if (!known || String(known.until) !== String(until)) {
            log(
              `WARNING: WhatsApp has restricted this number from sending messages${whatsapp.restrictionText()}. ` +
                'Sending is paused and orders wait in the outbox - trying anyway could make it worse.',
            );
          }
        } else if (whatsapp.restriction) {
          whatsapp.restriction = null;
          log('WhatsApp lifted the restriction on this number. Sending resumes.');
        }
      }

      if (qr && !state.creds.registered) {
        if (!phone) {
          showQr(qr);
        } else if (!codeRequested) {
          codeRequested = true;
          try {
            showPairingCode(await sock.requestPairingCode(phone), phone);
          } catch (error) {
            log(`Could not get a pairing code (${error.message}). Run jt-whatsapp --qr to use a QR code.`);
          }
        }
      }

      if (connection === 'open') {
        whatsapp.connected = true;
        failures = 0;
        log('Connected to WhatsApp.');
        // A restriction set while the service was stopped would not be pushed
        // again, so ask for the account's standing on every connect.
        whatsapp.checkStanding();
        if (!opened) {
          opened = true;
          onFirstOpen(whatsapp);
        }
        return;
      }

      if (connection !== 'close') return;
      whatsapp.connected = false;
      if (whatsapp.stopping) return;

      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode
        : undefined;

      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(AUTH, { recursive: true, force: true });
        return onFatal(
          'This computer was unlinked from WhatsApp (Linked devices > Log out). ' +
            'Run jt-whatsapp again to link it.',
        );
      }
      if (code === DisconnectReason.connectionReplaced) {
        return onFatal(
          'Another jt-whatsapp window took over this WhatsApp link. Only one may run - close the extra one.',
        );
      }
      if (code === DisconnectReason.forbidden) {
        return onFatal(
          'WhatsApp refused this number (forbidden). It may be restricted or banned - check WhatsApp on the phone.',
        );
      }
      if (!state.creds.registered && code !== DisconnectReason.restartRequired) {
        linkAttempts += 1;
        if (linkAttempts >= MAX_LINK_ATTEMPTS) {
          return onFatal('Linking timed out. Run jt-whatsapp again when your phone is ready.');
        }
      }

      // WhatsApp asks for a fresh connection right after linking; that is
      // expected, not an error.
      if (code === DisconnectReason.restartRequired) {
        log('Linked. Reconnecting...');
        return setTimeout(() => connect().catch((e) => onFatal(e.message)), 0);
      }
      failures += 1;
      const wait = Math.min(60000, 2000 * 2 ** Math.min(failures - 1, 5));
      const reason = lastDisconnect && lastDisconnect.error ? lastDisconnect.error.message : 'unknown';
      log(`Connection closed (${reason}) - reconnecting in ${Math.round(wait / 1000)}s`);
      if (failures === 8) {
        log('Still failing. If this keeps up, delete the whatsapp\\.auth folder and run jt-whatsapp to re-link.');
      }
      setTimeout(() => connect().catch((e) => onFatal(e.message)), wait);
    });
  };

  await connect();
  return whatsapp;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(OUTBOX, { recursive: true });
  const phone = args.has('--qr') ? null : pairingPhone();
  let whatsapp = null;

  const fatal = async (message, code = 1) => {
    clearBeat();
    log(`Stopped: ${message}`);
    if (whatsapp) whatsapp.stop();
    await sleep(500);
    process.exit(code);
  };

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log('Stopping...');
    clearBeat();
    if (whatsapp) whatsapp.stop();
    await sleep(500);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Anything unexpected: exit with 2 so jt-whatsapp.bat restarts the service.
  process.on('unhandledRejection', (error) =>
    fatal(`unexpected error: ${(error && error.stack) || error}`, 2),
  );

  log(phone ? 'Starting WhatsApp...' : 'Starting WhatsApp (QR code)...');
  whatsapp = await connectWhatsApp({
    phone,
    onFatal: (message) => fatal(message),
    onFirstOpen: (wa) => {
      (async () => {
        const groups = await resolveGroups(wa);
        log(`Ready. Posting new orders to "${groups.main.name}".`);
        if (groups.dropship) log(`Paid drop-ship orders go to "${groups.dropship.name}".`);
        else log('Paid drop-ship orders wait: no drop-ship group chosen.');
        log(`Outbox: ${OUTBOX}`);
        await drainForever(wa, groups);
      })().catch((error) => fatal((error && error.message) || String(error)));
    },
  });
}

if (require.main === module) {
  main().catch((error) => {
    log(`Could not start: ${(error && error.stack) || error}`);
    process.exit(1);
  });
}

module.exports = {
  chooseGroup,
  groupForJob,
  planGroups,
  planRound,
  terminalAsk,
  toBaileysContent,
  processJob,
  pendingJobs,
  readEnv,
  OUTBOX,
  SENT,
  FAILED,
  MAX_ATTEMPTS,
};
