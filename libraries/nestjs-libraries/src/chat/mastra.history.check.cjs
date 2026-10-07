// Regression: AG-UI replay must not overwrite the text after a completed tool.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, 'mastra.service.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }
);
const exportsObject = {};
vm.compileFunction(compiled.outputText, ['require', 'exports'])(
  (name) => name === '@nestjs/common' ? require(name) : {},
  exportsObject
);

async function check() {
  const service = new exportsObject.MastraService();
  const stored = [{
    id: 'assistant-1',
    content: { parts: [
      { type: 'tool-invocation', toolInvocation: { state: 'result', toolCallId: 'saved-call' } },
      { type: 'text', text: 'Bài viết cần được giữ nguyên.' },
      { type: 'tool-invocation', toolInvocation: { state: 'call', toolCallId: 'pending-call' } },
    ] },
  }];
  let recalls = 0;
  service.mastra = async () => ({ getAgent: () => ({ getMemory: async () => ({
    recall: async (options) => {
      recalls++;
      assert.deepEqual(options, { threadId: 'thread-a', resourceId: 'org-a', perPage: false });
      return { messages: stored };
    },
  }) }) });
  const history = [
    { id: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'saved-call' }] },
    { id: 'fresh-client-id', role: 'tool', toolCallId: 'saved-call' },
    { id: 'assistant-1-agui-text', role: 'assistant', content: 'Bài viết cần được giữ nguyên.' },
    { id: 'user-2', role: 'user', content: 'Sửa lại bài vừa viết.' },
    { id: 'client-tool-result', role: 'tool', toolCallId: 'pending-call' },
    { id: 'new-tool-result', role: 'tool', toolCallId: 'new-call' },
  ];
  const before = JSON.stringify(stored);
  const result = await service.removeStoredToolResults('thread-a', 'org-a', history);
  assert.deepEqual(result, history.filter((message) => message.id !== 'fresh-client-id'));
  assert.equal(JSON.stringify(stored), before);
  assert.equal(history.length, 6, 'Do not mutate client history');
  const userOnly = [history[3]];
  assert.equal(await service.removeStoredToolResults('thread-a', 'org-a', userOnly), userOnly);
  assert.equal(recalls, 1, 'Plain turns need no extra recall');
  service.mastra = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(service.removeStoredToolResults('thread-a', 'org-a', history), /storage unavailable/);
  console.log('PASS: completed tool replay removed; assistant text, pending/client tools and new results preserved.');
}

check().catch((error) => { console.error(error); process.exitCode = 1; });
