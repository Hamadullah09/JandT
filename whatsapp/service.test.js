'use strict';
/**
 * Sending logic of service.js, driven by a fake WhatsApp connection.
 *
 *   node --test
 *
 * No WhatsApp account is involved: nothing here can reach a real group.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { beforeEach, after, test } = require('node:test');

// Must be set before service.js is loaded: its folders are fixed at load time.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-whatsapp-test-'));
process.env.JT_WHATSAPP_OUTBOX_DIR = path.join(TMP, 'outbox');

const {
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
} = require('./service.js');

const GROUP = { id: '120363000000000000@g.us', name: 'Orders' };
const NO_WAIT = { messageGap: [0, 1] };
// A real photo name from the images folder: the "#" must not cut the path.
const IMAGE = path.join(TMP, '#1 (5).jpeg');
const PDF = path.join(TMP, 'OrderNo_12809.pdf');

function fakeWhatsApp({ failOnCall = [] } = {}) {
  const delivered = [];
  let calls = 0;
  return {
    delivered,
    async send(groupId, message) {
      calls += 1;
      if (failOnCall.includes(calls)) throw new Error(`network down on call ${calls}`);
      delivered.push({ groupId, message });
      return { key: { id: `msg-${calls}` } };
    },
  };
}

function writeJob(name, overrides = {}) {
  const job = {
    version: 1,
    id: name,
    order_no: '12809',
    tracking_no: '632158575344',
    messages: [
      { type: 'text', text: 'Order created #12809\nTracking: 632158575344' },
      { type: 'image', path: IMAGE, caption: 'Purple / L\n\nNur Aisyah Rahman' },
      { type: 'document', path: PDF },
    ],
    sent: 0,
    attempts: 0,
    last_error: null,
    ...overrides,
  };
  const file = path.join(OUTBOX, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(job));
  return file;
}

const readJob = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

beforeEach(() => {
  for (const dir of [OUTBOX, SENT, FAILED]) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(OUTBOX, { recursive: true });
  fs.writeFileSync(IMAGE, 'jpeg bytes');
  fs.writeFileSync(PDF, '%PDF-1.4');
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// message content
// ---------------------------------------------------------------------------
test('a text message becomes plain text', () => {
  assert.deepEqual(toBaileysContent({ type: 'text', text: 'Order created #12809' }), {
    text: 'Order created #12809',
  });
});

test('a photo is sent as its bytes with a caption, so a "#" in the file name is harmless', () => {
  const content = toBaileysContent({ type: 'image', path: IMAGE, caption: 'Purple / L' });
  assert.equal(content.image.toString(), 'jpeg bytes');
  assert.equal(content.mimetype, 'image/jpeg');
  assert.equal(content.caption, 'Purple / L');
});

test('the waybill goes as a PDF document under its own file name', () => {
  const content = toBaileysContent({ type: 'document', path: PDF });
  assert.equal(content.document.toString(), '%PDF-1.4');
  assert.equal(content.mimetype, 'application/pdf');
  assert.equal(content.fileName, 'OrderNo_12809.pdf');
});

test('an unknown message type is refused', () => {
  assert.throws(() => toBaileysContent({ type: 'sticker' }), /unknown message type/);
});

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------
test('sends the text, the captioned photo and the PDF, in order, then files the job', async () => {
  const whatsapp = fakeWhatsApp();
  const file = writeJob('job-a');

  assert.equal(await processJob(whatsapp, GROUP, file, NO_WAIT), true);

  assert.deepEqual(whatsapp.delivered.map((d) => d.message.type), ['text', 'image', 'document']);
  assert.ok(whatsapp.delivered.every((d) => d.groupId === GROUP.id));
  assert.equal(fs.existsSync(file), false);
  const filed = readJob(path.join(SENT, 'job-a.json'));
  assert.equal(filed.sent, 3);
  assert.ok(filed.sent_at);
});

test('a failed send resumes after the last delivered message, so nothing is posted twice', async () => {
  const whatsapp = fakeWhatsApp({ failOnCall: [2] });   // the photo fails once
  const file = writeJob('job-b');

  assert.equal(await processJob(whatsapp, GROUP, file, NO_WAIT), false);
  const waiting = readJob(file);
  assert.equal(waiting.sent, 1);
  assert.equal(waiting.attempts, 1);
  assert.match(waiting.last_error, /network down/);

  assert.equal(await processJob(whatsapp, GROUP, file, NO_WAIT), true);

  const headers = whatsapp.delivered.filter((d) => d.message.type === 'text');
  assert.equal(headers.length, 1, 'the order header must be posted exactly once');
  assert.equal(whatsapp.delivered.length, 3);
  assert.equal(readJob(path.join(SENT, 'job-b.json')).sent, 3);
});

test('a job that keeps failing moves to failed/ instead of blocking the queue', async () => {
  const whatsapp = fakeWhatsApp({ failOnCall: [1] });
  const file = writeJob('job-c', { attempts: MAX_ATTEMPTS - 1 });

  assert.equal(await processJob(whatsapp, GROUP, file, NO_WAIT), true);
  assert.equal(fs.existsSync(file), false);
  assert.match(readJob(path.join(FAILED, 'job-c.json')).last_error, /network down/);
});

test('a restriction mid-order pauses the job without using up its attempts', async () => {
  const whatsapp = fakeWhatsApp({ failOnCall: [2] });
  let restricted = false;
  const send = whatsapp.send;
  whatsapp.send = async (groupId, message) => {
    try {
      return await send(groupId, message);
    } catch (error) {
      restricted = true;            // WhatsApp restricted the number mid-order
      throw error;
    }
  };
  whatsapp.isRestricted = () => restricted;
  const file = writeJob('job-r', { attempts: MAX_ATTEMPTS - 1 });

  assert.equal(await processJob(whatsapp, GROUP, file, NO_WAIT), false);
  const waiting = readJob(file);
  assert.equal(waiting.attempts, MAX_ATTEMPTS - 1, 'a restriction must not count as an attempt');
  assert.equal(waiting.sent, 1);
  assert.equal(fs.existsSync(path.join(FAILED, 'job-r.json')), false);
});

test('a deleted photo or PDF fails the job at once, before anything is sent', async () => {
  const whatsapp = fakeWhatsApp();
  fs.rmSync(PDF);
  const file = writeJob('job-d');

  assert.equal(await processJob(whatsapp, GROUP, file, NO_WAIT), true);
  assert.equal(whatsapp.delivered.length, 0);
  assert.match(readJob(path.join(FAILED, 'job-d.json')).last_error, /file not found/);
});

test('an unreadable job file is set aside', async () => {
  const file = path.join(OUTBOX, 'job-f.json');
  fs.writeFileSync(file, '{ not json');

  assert.equal(await processJob(fakeWhatsApp(), GROUP, file, NO_WAIT), true);
  assert.equal(fs.existsSync(path.join(FAILED, 'job-f.json')), true);
});

test('pending jobs skip half-written files and come back oldest first', () => {
  for (const name of ['20260916T2-b.json', '20260916T1-a.json', '.x.json.tmp', '.hidden.json']) {
    fs.writeFileSync(path.join(OUTBOX, name), '{}');
  }
  assert.deepEqual(pendingJobs().map((f) => path.basename(f)), [
    '20260916T1-a.json',
    '20260916T2-b.json',
  ]);
});

test('.env values lose inline comments, and real environment variables win', () => {
  const env = path.join(TMP, 'test.env');
  fs.writeFileSync(env, 'JT_A=one   # a comment\nJT_B="quoted"\n# JT_C=skipped\nJT_TRACKING_PREFIX=63\n');
  process.env.JT_TRACKING_PREFIX = '99';
  try {
    const values = readEnv(env);
    assert.equal(values.JT_A, 'one');
    assert.equal(values.JT_B, 'quoted');
    assert.equal(values.JT_C, undefined);
    assert.equal(values.JT_TRACKING_PREFIX, '99');
  } finally {
    delete process.env.JT_TRACKING_PREFIX;
  }
});

// ---------------------------------------------------------------------------
// group picker
// ---------------------------------------------------------------------------
/** listGroups() returns each snapshot in turn, then keeps returning the last. */
function fakeGroups(...snapshots) {
  return {
    async listGroups() {
      const names = snapshots.length > 1 ? snapshots.shift() : snapshots[0];
      return names.map((name) => ({ id: `${name}@g.us`, name }));
    },
  };
}

function answers(...queue) {
  return async () => {
    if (queue.length === 0) throw new Error('picker asked more questions than expected');
    return queue.shift();
  };
}

test('the picker returns the group chosen by number', async () => {
  const group = await chooseGroup(fakeGroups(['J&T Orders', 'Zeta']), answers('2'));
  assert.deepEqual(group, { id: 'Zeta@g.us', name: 'Zeta' });
});

test('0 refreshes the list, so a group created a moment ago can still be picked', async () => {
  const group = await chooseGroup(fakeGroups([], ['J&T Orders']), answers('0', '1'));
  assert.equal(group.name, 'J&T Orders');
});

test('an answer that is not on the list just asks again', async () => {
  const group = await chooseGroup(fakeGroups(['Orders']), answers('9', 'abc', '', '-1', '1'));
  assert.equal(group.name, 'Orders');
});

test('with no keyboard input the picker stops with a clear message instead of hanging', async () => {
  const input = new PassThrough();
  const ask = terminalAsk(input, new PassThrough());
  const pending = ask('  Post orders to which group? ');
  input.end();
  await assert.rejects(pending, /terminal window/);
  await assert.rejects(ask('again? '), /terminal window/);
  ask.close();
});

// ---------------------------------------------------------------------------
// drop-ship routing
// ---------------------------------------------------------------------------
const MAIN = { id: 'main@g.us', name: 'Orders' };
const SUPPLIER = { id: 'supplier@g.us', name: 'Supplier' };

test('a drop-ship job goes to the drop-ship group, anything else to the main group', () => {
  const groups = { main: MAIN, dropship: SUPPLIER };
  assert.equal(groupForJob({ route: 'dropship' }, groups), SUPPLIER);
  assert.equal(groupForJob({ route: 'main' }, groups), MAIN);
  // jobs queued before routing existed have no route: they stay in the main group
  assert.equal(groupForJob({}, groups), MAIN);
});

test('drop-ship jobs wait while no drop-ship group is chosen, the rest still go out', () => {
  const drop = writeJob('job-drop', { route: 'dropship' });
  const normal = writeJob('job-main', { route: 'main' });
  const { ready, held } = planRound(pendingJobs(), { main: MAIN, dropship: null });
  assert.deepEqual(ready.map((r) => [path.basename(r.file), r.group.name]), [['job-main.json', 'Orders']]);
  assert.deepEqual(held.map((f) => path.basename(f)), ['job-drop.json']);
  assert.ok(fs.existsSync(drop) && fs.existsSync(normal), 'nothing is moved or failed');
});

test('once a drop-ship group is chosen its jobs are ready too', () => {
  writeJob('job-drop', { route: 'dropship' });
  const { ready, held } = planRound(pendingJobs(), { main: MAIN, dropship: SUPPLIER });
  assert.deepEqual(ready.map((r) => r.group.name), ['Supplier']);
  assert.equal(held.length, 0);
});

test('the drop-ship picker can be skipped with Enter; the main picker cannot', async () => {
  const skipped = await chooseGroup(fakeGroups(['Orders', 'Supplier']), answers(''), {
    question: 'Send paid drop-ship orders to which group?',
    allowSkip: true,
  });
  assert.equal(skipped, null);
  const main = await chooseGroup(fakeGroups(['Orders', 'Supplier']), answers('', '1'));
  assert.equal(main.name, 'Orders');
});

test('with --pick-group, Enter keeps the group already chosen', async () => {
  const kept = await chooseGroup(fakeGroups(['Orders', 'Supplier']), answers(''), { current: MAIN });
  assert.equal(kept, MAIN);
  const dropship = await chooseGroup(fakeGroups(['Orders', 'Supplier']), answers(''), {
    current: SUPPLIER,
    allowSkip: true,
  });
  assert.equal(dropship, SUPPLIER, 'Enter must not throw away the drop-ship group');
});

// ---------------------------------------------------------------------------
// startup questions
// ---------------------------------------------------------------------------
const IN = [MAIN, SUPPLIER, { id: 'family@g.us', name: 'Family' }];
const asks = (plan) => [plan.askMain, plan.askDropship];

test('first start: both groups are asked for', () => {
  assert.deepEqual(asks(planGroups({}, IN)), [true, true]);
});

test('updating from before drop-ship: only the drop-ship group is asked for, once', () => {
  const plan = planGroups({ groupId: MAIN.id, groupName: 'Orders' }, IN);
  assert.deepEqual(asks(plan), [false, true]);
  assert.equal(plan.main, MAIN);
});

test('a restart after "decide later" asks nothing, so sending never stops at a question', () => {
  const plan = planGroups({ groupId: MAIN.id, dropshipSkipped: true }, IN);
  assert.deepEqual(asks(plan), [false, false]);
  assert.equal(plan.dropship, null);
  assert.deepEqual(plan.notes, []);
});

test('a restart with both groups saved asks nothing and uses them', () => {
  const plan = planGroups({ groupId: MAIN.id, dropshipGroupId: SUPPLIER.id }, IN);
  assert.deepEqual(asks(plan), [false, false]);
  assert.deepEqual([plan.main, plan.dropship], [MAIN, SUPPLIER]);
});

test('leaving the drop-ship group holds its orders without blocking, and says how to pick again', () => {
  const plan = planGroups(
    { groupId: MAIN.id, dropshipGroupId: 'gone@g.us', dropshipGroupName: 'Old supplier' },
    IN,
  );
  assert.deepEqual(asks(plan), [false, false]);
  assert.equal(plan.dropship, null);
  assert.match(plan.notes.join(' '), /"Old supplier".*jt-whatsapp --pick-group/);
});

test('leaving the orders group asks for it again', () => {
  const plan = planGroups({ groupId: 'gone@g.us', groupName: 'Old orders', dropshipSkipped: true }, IN);
  assert.deepEqual(asks(plan), [true, false]);
  assert.match(plan.notes[0], /"Old orders"/);
});

test('--pick-group asks for both, offering the current choices', () => {
  const plan = planGroups({ groupId: MAIN.id, dropshipGroupId: SUPPLIER.id }, IN, true);
  assert.deepEqual(asks(plan), [true, true]);
  assert.deepEqual([plan.main, plan.dropship], [MAIN, SUPPLIER]);
});
