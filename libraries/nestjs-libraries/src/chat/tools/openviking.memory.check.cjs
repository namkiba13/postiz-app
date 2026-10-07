// Run with node; dependencies are already in the Postiz workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'openviking.memory.tool.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
    experimentalDecorators: true,
  },
});
const exportsObject = {};
vm.compileFunction(compiled.outputText, ['require', 'exports'])(
  (name) => {
    // Exercise the real tool handler/schema with only its Mastra/auth adapters stubbed.
    if (name === '@mastra/core/tools') return { createTool: (tool) => tool };
    if (name.endsWith('/chat/auth.context')) return { checkAuth: () => {} };
    return require(name);
  },
  exportsObject
);

async function check() {
  const savedEnv = { ...process.env };
  const savedFetch = global.fetch;
  const calls = [];
  const taskId = '721ee782-7cd9-4f89-9872-81217291fc5e';
  let respond = () => ({ rendered: 'Saved voice', entries: [{ uri: 'viking://user/agent/memories/voice.md' }] });
  try {
    Object.assign(process.env, {
      OPENVIKING_URL: 'https://memory.example.invalid',
      OPENVIKING_API_KEY: 'private-test-key',
      OPENVIKING_ORGANIZATION_ID: 'organization-a',
    });
    global.fetch = async (url, options) => {
      calls.push({ url: new URL(url), ...options });
      return { ok: true, json: async () => ({ status: 'ok', result: respond(new URL(url)) }) };
    };
    const memory = new exportsObject.OpenVikingMemoryTool();
    const tool = memory.run();
    const run = (action, text, org = 'organization-a') => tool.execute(
      tool.inputSchema.parse({ action, text }),
      { requestContext: { get: () => JSON.stringify({ id: org }) } }
    );

    assert.ok(memory.available());
    assert.ok((await run('search', 'voice', 'organization-b')).error);
    assert.equal(calls.length, 0, 'Cross-organization access must never reach OpenViking');
    delete process.env.OPENVIKING_ORGANIZATION_ID;
    assert.equal(memory.available(), false);
    assert.ok((await run('search', 'voice')).error);
    process.env.OPENVIKING_ORGANIZATION_ID = 'organization-a';
    process.env.OPENVIKING_URL = 'http://memory.example.invalid';
    assert.ok((await run('search', 'voice')).error);
    assert.equal(calls.length, 0, 'Insecure endpoints must not receive credentials');
    process.env.OPENVIKING_URL = 'https://memory.example.invalid';

    assert.equal((await run('search', 'voice')).result.context, 'Saved voice');
    assert.equal(calls[0].headers['X-API-Key'], 'private-test-key');
    assert.equal(calls[0].redirect, 'error');
    assert.equal(JSON.parse(calls[0].body).max_tokens, 1600);

    respond = (url) => url.pathname.endsWith('/commit') ? { task_id: taskId, archive_uri: 'viking://user/agent/sessions/sample/history/archive_001' } : {};
    const note = 'Giọng văn gần gũi. Giữ nguyên model gpt-6.1-sol.';
    const saved = (await run('remember', note)).result;
    assert.equal(saved.status, 'accepted', 'Queued extraction must not be reported as complete');
    assert.equal(saved.taskId, taskId);
    assert.match(saved.sessionId, /^postiz-[a-f0-9-]{36}$/);
    assert.equal(JSON.parse(calls.at(-2).body).content, note);
    assert.equal(JSON.parse(calls.at(-2).body).role, 'user');
    assert.equal(calls.at(-1).url.pathname, `/api/v1/sessions/${saved.sessionId}/commit`);

    respond = () => ({ status: 'completed', result: { memories_extracted: { memory_write: 1 } } });
    assert.equal((await run('status', taskId)).result.memoriesExtracted.memory_write, 1);
    respond = () => 'Nội dung mẫu';
    const uri = 'viking://user/agent/memories/giọng viết.md';
    assert.equal((await run('read', uri)).result.content, 'Nội dung mẫu');
    assert.equal(calls.at(-1).url.searchParams.get('uri'), uri);
    assert.equal(calls.at(-1).url.searchParams.get('limit'), '200');
    const count = calls.length;
    assert.ok((await run('read', 'https://other.example/secret')).error);
    assert.ok((await run('status', '../admin/accounts')).error);
    assert.equal(calls.length, count, 'Invalid source/task inputs must not be fetched');

    global.fetch = async () => ({ ok: false, status: 401 });
    assert.match((await run('search', 'voice')).error, /401/);
    global.fetch = async () => { throw new Error('private-test-key'); };
    const failed = await run('remember', note);
    assert.ok(failed.error);
    assert.ok(!JSON.stringify(failed).includes('private-test-key'));
    assert.ok(!failed.result, 'Failed requests must not claim a memory was saved');
    console.log('PASS: OpenViking organization isolation, request boundaries, save/status/read and failure handling.');
  } finally {
    global.fetch = savedFetch;
    process.env = savedEnv;
  }
}

check().catch((error) => { console.error(error); process.exitCode = 1; });
