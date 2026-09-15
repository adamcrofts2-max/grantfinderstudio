/**
 * An Anthropic-shaped API that answers from the schema it is asked for.
 *
 * Exists so the WHOLE Writer path can be walked: paste the funder's questions,
 * draft, critic pass, review panel, copy out. Before this, everything between
 * "paste the questions" and "here is your draft" was covered only by unit
 * tests holding a fake provider object — the real SDK call, the real wire
 * format, the real parse and the real rendering were exercised by nothing but
 * production. That is the shape of blind spot that has cost this project every
 * fault it has had.
 *
 * It is NOT a model. It returns something schema-valid and recognisable, which
 * is enough to prove the plumbing. Whether the prose is any good is a question
 * only the real model can answer.
 */

import { createServer } from 'node:http';

/** Fact ids mentioned in the prompt, so a draft can cite something real. */
function factIds(prompt) {
  // The prompt lists facts as `- id=<id> | <claim>: <value>` (see
  // buildWriterPrompt), so match THAT rather than guessing an id shape. The
  // first version guessed `fact_…`, matched nothing, and cited nothing — so
  // the walk exercised only the "no factual claim" path and never the
  // supported one, which is half the thing being walked.
  return [...new Set([...String(prompt).matchAll(/^- id=([^ |]+)/gmu)].map((m) => m[1]))];
}


/**
 * Something valid for a JSON Schema, walked generically.
 *
 * Generic on purpose: the writer, the critic and the analyst each declare
 * their own schema, and a stub hard-coded to one of them would stop proving
 * anything the moment a schema changed.
 */
function fromSchema(schema, context) {
  const type = Array.isArray(schema?.type) ? schema.type.find((t) => t !== 'null') : schema?.type;

  if (Array.isArray(schema?.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (type) {
    case 'object': {
      const out = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        out[key] = fromSchema(sub, { ...context, key });
      }
      return out;
    }
    case 'array': {
      const items = schema.items ?? {};
      // Two entries rather than one: a screen that renders a list correctly
      // for a single element and wrongly for two is a common fault.
      return [fromSchema(items, { ...context, index: 0 }), fromSchema(items, { ...context, index: 1 })];
    }
    case 'boolean':
      // `unsupported: false` is the honest default — a stub must not claim a
      // sentence is unsupported when it has cited a fact.
      return false;
    case 'integer':
    case 'number':
      return 1;
    case 'null':
      return null;
    default: {
      // Strings carry the interesting part, so they are named after the field
      // they fill — a draft full of "string" proves nothing about rendering.
      const key = context.key ?? 'text';
      if (key === 'factId') {
        const ids = context.facts;
        return ids.length === 0 ? null : ids[(context.index ?? 0) % ids.length];
      }
      if (key === 'text' || key === 'sentence') {
        return context.index === 1
          ? 'We are asking for £18,000 over twelve months. [stub]'
          : 'We run practical skills training for young people in Somerset. [stub]';
      }
      return `${key} from the stub`;
    }
  }
}

const PORT = Number(process.env['STUB_ANTHROPIC_PORT'] ?? 4600);
const seen = [];

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url?.includes('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }

    let request = {};
    try { request = JSON.parse(body); } catch { /* answered below anyway */ }
    seen.push({ model: request.model, system: String(request.system ?? '').slice(0, 60) });

    const schema = request.output_config?.format?.schema ?? { type: 'object' };
    const prompt = request.messages?.[0]?.content ?? '';
    const payload = fromSchema(schema, { facts: factIds(prompt) });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `msg_stub_${seen.length}`,
      type: 'message',
      role: 'assistant',
      model: request.model ?? 'stub',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      usage: { input_tokens: 100, output_tokens: 100 },
    }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub Anthropic on http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => server.close());
