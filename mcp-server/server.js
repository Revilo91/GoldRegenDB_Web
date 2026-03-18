const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 5100;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL; // e.g. http://localhost:11434
const PROVIDER_PRIORITY = (process.env.PROVIDER_PRIORITY || 'openai,huggingface,ollama')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', providers: { openai: !!OPENAI_API_KEY, huggingface: !!HUGGINGFACE_API_KEY, ollama: !!OLLAMA_URL } });
});

// Adapter: OpenAI (chat completions)
async function callOpenAI({ model = 'gpt-4o-mini', messages, prompt }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const payload = messages ? { model, messages } : { model, messages: [{ role: 'user', content: prompt || '' }] };
  const resp = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
  });
  const text = resp.data?.choices?.[0]?.message?.content ?? JSON.stringify(resp.data);
  return { success: true, provider: 'openai', text, raw: resp.data };
}

// Adapter: Hugging Face Inference (simple single-request API)
async function callHuggingFace({ model = 'gpt2', messages, prompt }) {
  if (!HUGGINGFACE_API_KEY) throw new Error('HUGGINGFACE_API_KEY not configured');
  const input = messages ? messages.map((m) => `${m.role}: ${m.content}`).join('\n') : (prompt || '');
  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;
  const resp = await axios.post(url, { inputs: input }, { headers: { Authorization: `Bearer ${HUGGINGFACE_API_KEY}` }, timeout: 120000 });
  // Hugging Face can return text or array of objects
  let text = '';
  if (typeof resp.data === 'string') text = resp.data;
  else if (Array.isArray(resp.data) && resp.data[0]?.generated_text) text = resp.data[0].generated_text;
  else if (resp.data?.generated_text) text = resp.data.generated_text;
  else text = JSON.stringify(resp.data);
  return { success: true, provider: 'huggingface', text, raw: resp.data };
}

// Adapter: Ollama (local LLM host)
async function callOllama({ model = 'llama2', messages, prompt }) {
  if (!OLLAMA_URL) throw new Error('OLLAMA_URL not configured');
  const textPrompt = messages ? messages.map((m) => `${m.role}: ${m.content}`).join('\n') : (prompt || '');
  const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const resp = await axios.post(url, { model, prompt: textPrompt }, { timeout: 120000 });
  // Ollama may stream; the simple response may contain 'output'
  const data = resp.data;
  const text = data?.output ?? JSON.stringify(data);
  return { success: true, provider: 'ollama', text, raw: data };
}

// Dispatcher: try provider specified or fall back through PROVIDER_PRIORITY
async function dispatchCall({ provider, model, messages, prompt }) {
  const tried = [];
  const toTry = provider ? [provider] : PROVIDER_PRIORITY;
  for (const p of toTry) {
    try {
      tried.push(p);
      if (p === 'openai') return await callOpenAI({ model, messages, prompt });
      if (p === 'huggingface') return await callHuggingFace({ model, messages, prompt });
      if (p === 'ollama') return await callOllama({ model, messages, prompt });
    } catch (err) {
      // continue to next provider
      console.warn(`Provider ${p} failed:`, err?.message || err);
      continue;
    }
  }
  throw new Error(`No provider available. Tried: ${tried.join(', ')}`);
}

app.post('/mcp/query', async (req, res) => {
  try {
    const { provider, model, messages, prompt } = req.body || {};
    // If no provider configured at all, return mock echo
    if (PROVIDER_PRIORITY.length === 0) {
      return res.json({ ok: true, mock: true, message: 'No providers configured', echo: { provider, model, messages, prompt } });
    }
    const result = await dispatchCall({ provider, model, messages, prompt });
    res.json({ ok: true, provider: result.provider, text: result.text, raw: result.raw });
  } catch (err) {
    console.error('MCP QUERY ERROR', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'unknown error' });
  }
});

app.listen(PORT, () => {
  console.log(`GoldRegenDB MCP server listening on http://localhost:${PORT}`);
});
