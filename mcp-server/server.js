const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 5100;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: !!OPENAI_KEY });
});

// Minimal MCP-like endpoint: forwards a simple chat request to OpenAI if key is set,
// otherwise returns a helpful mock/echo response so the server is usable without a key.
app.post('/mcp/query', async (req, res) => {
  try {
    const { model = 'gpt-4o-mini', messages, prompt } = req.body || {};

    if (!OPENAI_KEY) {
      return res.json({
        ok: true,
        mock: true,
        message: 'OPENAI_API_KEY not set. This is a mock response from local MCP server.',
        echo: { model, messages, prompt },
      });
    }

    const payload = messages
      ? { model, messages }
      : { model, messages: [{ role: 'user', content: prompt || '' }] };

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        ...payload,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json({ ok: true, mocked: false, data: response.data });
  } catch (err) {
    console.error('MCP QUERY ERROR', err?.response?.data || err.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'unknown error' });
  }
});

app.listen(PORT, () => {
  console.log(`GoldRegenDB MCP server listening on http://localhost:${PORT}`);
});
