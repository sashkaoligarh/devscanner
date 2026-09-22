// @vitest-environment node
import { it, expect } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Codex } from '@openai/codex-sdk'
import { createRequire } from 'node:module'
const { codexOptions } = createRequire(import.meta.url)('../../../electron/utils/deploy-codex')

it('runs the pinned Codex SDK and native CLI against a local fixture endpoint without contacting OpenAI', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devscanner-sdk-runtime-'))
  const marker = path.join(directory, 'unexpected-mcp-start')
  const personal = path.join(directory, 'personal')
  fs.mkdirSync(personal)
  fs.writeFileSync(path.join(personal, 'auth.json'), '{"OPENAI_API_KEY":"sk-fixture-not-real"}', { mode: 0o600 })
  fs.writeFileSync(path.join(personal, 'config.toml'), '[mcp_servers.unrelated]\ncommand = ' + JSON.stringify(process.execPath) + '\nargs = ["-e", ' + JSON.stringify('require("fs").writeFileSync(' + JSON.stringify(marker) + ', "started")') + ']\n')
  const requests = []
  const answer = '{"summary":"Fixture diagnosis","findings":[],"checks":[],"changes":[]}'
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const data = body ? JSON.parse(body) : {}
    requests.push({ url: request.url, method: request.method, tools: (data.tools || []).map(tool => tool.name || tool.type) })
    if (!request.url.endsWith('/responses')) { response.writeHead(404); response.end('{}'); return }
    const item = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer', content: [{ type: 'output_text', text: answer }] }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = event => response.write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n')
    send({ type: 'response.created', response: { id: 'resp_fixture', status: 'in_progress', output: [] } })
    send({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } })
    send({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: answer })
    send({ type: 'response.output_item.done', output_index: 0, item })
    send({ type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { cached_tokens: 0 } } } })
    response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000)
  try {
    const sdk = new Codex({ ...codexOptions(directory, undefined, { PATH: process.env.PATH, HOME: personal, CODEX_HOME: personal }), baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1' })
    const result = await sdk.startThread({ model: 'gpt-5.6-terra', workingDirectory: directory, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', webSearchMode: 'disabled', networkAccessEnabled: false }).run('Return the fixture diagnosis. Do not use tools.', { signal: abort.signal })
    expect(result.finalResponse).toBe(answer)
    const turns = requests.filter(request => request.method === 'POST' && request.url.endsWith('/responses'))
    expect(turns).toHaveLength(1)
    expect(turns[0].tools).toEqual([])
    expect(fs.existsSync(marker)).toBe(false)
  } finally {
    clearTimeout(timer); server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 20000)
