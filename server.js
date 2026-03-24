const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, '.cache', 'audio');

fs.mkdirSync(CACHE_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8'
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_SCRIPT_MODEL = process.env.OPENAI_SCRIPT_MODEL || 'gpt-4o-mini';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

const FALLBACK_PACK = {
  title: 'The Hidden Pattern Behind Viral Short Videos',
  script: 'Most short videos fail in the first second. The winners do three things fast. A bold hook. One clear visual idea. And captions that feel alive. If the first scene sparks curiosity, people stay. If every next scene answers one question and opens another, views keep climbing.',
  scenes: [
    { text: 'Most short videos fail in the first second.', prompt: 'bold opening hook, creator staring at a dead analytics screen, cinematic lighting, curiosity, vertical short-form scene, no text' },
    { text: 'The winners do three things fast.', prompt: 'three strong visual pillars, dramatic composition, social media growth concept, vertical 9:16, no text' },
    { text: 'A bold hook.', prompt: 'extreme close-up, shocked expression, high contrast, attention-grabbing opening frame, vertical short-form scene, no text' },
    { text: 'One clear visual idea.', prompt: 'single clean subject, simple striking composition, cinematic storytelling, vertical 9:16, no text' },
    { text: 'And captions that feel alive.', prompt: 'fast social video captions feel, energetic storytelling rhythm, creator pointing at a phone, vertical 9:16, no text' },
    { text: 'If every next scene answers one question and opens another, views keep climbing.', prompt: 'rising analytics graph, social media momentum, dramatic final payoff, vertical short-form scene, no text' }
  ]
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/script-pack') {
      return await handleScriptPack(req, res);
    }
    if (req.method === 'POST' && req.url === '/api/tts') {
      return await handleTts(req, res);
    }
    if (req.method === 'POST' && req.url === '/api/captions') {
      return await handleCaptions(req, res);
    }
    if (req.method === 'GET' && req.url.startsWith('/api/audio/')) {
      return await handleAudio(req, res);
    }
    if (req.method === 'GET') {
      return await serveStatic(req, res);
    }
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`AutoShorts relay running on http://localhost:${PORT}`);
});

async function handleScriptPack(req, res) {
  const body = await readJson(req);
  const topic = String(body.topic || body.customText || body.niche || 'Custom topic');
  if (!OPENAI_API_KEY) {
    return sendJson(res, 200, FALLBACK_PACK);
  }

  const system = [
    'You create high-retention faceless short-video scripts.',
    'Return valid JSON only.',
    'Make the hook immediate, specific, and visual.',
    'Keep the script punchy and conversational.',
    'Every scene should describe a concrete visual moment for image generation.'
  ].join(' ');

  const user = {
    topic,
    niche: body.niche || '',
    style: body.style?.name || '',
    targetDuration: Math.max(15, Math.min(120, Number(body.targetDuration) || 60)),
    targetWords: {
      min: Math.max(40, Math.min(260, Number(body?.targetWords?.min) || 115)),
      max: Math.max(50, Math.min(300, Number(body?.targetWords?.max) || 145))
    },
    sceneCount: Math.max(3, Math.min(8, Number(body.sceneCount) || 5)),
    regenerate: Boolean(body.regenerate)
  };

  const payload = {
    model: OPENAI_SCRIPT_MODEL,
    temperature: body.regenerate ? 1.15 : 0.8,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          'Create a viral TikTok/YouTube Shorts package for this topic.',
          JSON.stringify(user),
          'Requirements:',
          '- if regenerate is true, produce a clearly different angle, hook, structure, and scene progression from the prior attempt',
          '- title: max 60 chars',
          `- script: ${user.targetWords.min} to ${user.targetWords.max} spoken words, hook-first, spoken naturally, paced for about ${user.targetDuration} seconds`,
          `- scenes: exactly ${user.sceneCount} items`,
          '- each scene needs "text" and "prompt"',
          '- prompts must be image-generation-ready, vertical, cinematic, no on-image text'
        ].join('\n')
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'script_pack',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'script', 'scenes'],
          properties: {
            title: { type: 'string' },
            script: { type: 'string' },
            scenes: {
              type: 'array',
              minItems: user.sceneCount,
              maxItems: user.sceneCount,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'prompt'],
                properties: {
                  text: { type: 'string' },
                  prompt: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  };

  try {
    const data = await openaiJson('/v1/chat/completions', payload);
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    sendJson(res, 200, parsed);
  } catch (error) {
    console.error('script-pack fallback:', error.message);
    sendJson(res, 200, buildFallbackPack(topic));
  }
}

async function handleTts(req, res) {
  const body = await readJson(req);
  const script = String(body.script || '').trim();
  if (!script) return sendJson(res, 400, { error: 'Missing script' });
  const voice = String(body.voice || 'James');
  const key = makeCacheKey({ title: body.title || '', script, voice });
  let meta = await readMeta(key);
  if (!meta.audioPath || !fs.existsSync(meta.audioPath)) {
    const buffer = await synthesizeSpeech(script, voice);
    const audioPath = path.join(CACHE_DIR, `${key}.mp3`);
    await fsp.writeFile(audioPath, buffer);
    meta.audioPath = audioPath;
    await writeMeta(key, meta);
  }
  if (!meta.words?.length) {
    meta.words = await transcribeAudio(meta.audioPath);
    await writeMeta(key, meta);
  }
  sendJson(res, 200, {
    audioUrl: `/api/audio/${path.basename(meta.audioPath)}`,
    words: meta.words || [],
    duration: getWordTrackDuration(meta.words || [])
  });
}

async function handleCaptions(req, res) {
  const body = await readJson(req);
  const script = String(body.script || '').trim();
  const voice = String(body.voice || 'James');
  if (!script) return sendJson(res, 400, { error: 'Missing script' });
  const key = makeCacheKey({ title: body.title || '', script, voice });
  let meta = await readMeta(key);
  if (!meta.words?.length) {
    if (!meta.audioPath || !fs.existsSync(meta.audioPath)) {
      const buffer = await synthesizeSpeech(script, voice);
      meta.audioPath = path.join(CACHE_DIR, `${key}.mp3`);
      await fsp.writeFile(meta.audioPath, buffer);
    }
    meta.words = await transcribeAudio(meta.audioPath);
    await writeMeta(key, meta);
  }
  const words = meta.words || approximateWordTimings(script);
  sendJson(res, 200, { words, duration: getWordTrackDuration(words) });
}

async function handleAudio(req, res) {
  const fileName = path.basename(req.url.replace('/api/audio/', ''));
  const audioPath = path.join(CACHE_DIR, fileName);
  if (!audioPath.startsWith(CACHE_DIR) || !fs.existsSync(audioPath)) {
    return sendJson(res, 404, { error: 'Audio not found' });
  }
  const stream = fs.createReadStream(audioPath);
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  stream.pipe(res);
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url === '/' ? '/index.html' : req.url.split('?')[0]);
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendJson(res, 404, { error: 'Not found' });
  }
  const finalPath = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
  const ext = path.extname(finalPath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(finalPath).pipe(res);
}

async function synthesizeSpeech(script, voiceLabel) {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  const voiceMap = {
    James: 'alloy',
    Emma: 'sage',
    Marcus: 'ash',
    Epic: 'onyx',
    Calm: 'verse'
  };
  const voice = voiceMap[voiceLabel.replace(/[^\w]/g, '')] || 'alloy';
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice,
      speed: 0.92,
      format: 'mp3',
      input: script
    })
  });
  if (!response.ok) {
    throw new Error(`TTS failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function transcribeAudio(audioPath) {
  if (!OPENAI_API_KEY) {
    return approximateWordTimings('');
  }
  const audioBuffer = await fsp.readFile(audioPath);
  const form = new FormData();
  form.append('model', OPENAI_TRANSCRIBE_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), path.basename(audioPath));
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  if (!response.ok) {
    throw new Error(`Transcription failed (${response.status})`);
  }
  const data = await response.json();
  if (Array.isArray(data.words) && data.words.length) return data.words;
  return approximateWordTimings(data.text || '');
}

function approximateWordTimings(script) {
  const words = String(script || '').trim().split(/\s+/).filter(Boolean);
  let cursor = 0;
  return words.map((word) => {
    const start = cursor;
    const duration = /[,.!?]$/.test(word) ? 0.32 : 0.22;
    cursor += duration;
    return { word, start, end: cursor };
  });
}
function getWordTrackDuration(words) {
  if (!Array.isArray(words) || !words.length) return 0;
  return Math.max(0, Number(words[words.length - 1]?.end) || 0);
}

function buildFallbackPack(topic) {
  const clone = JSON.parse(JSON.stringify(FALLBACK_PACK));
  clone.title = topic.slice(0, 60) || clone.title;
  clone.scenes = clone.scenes.map((scene) => ({
    text: scene.text,
    prompt: `${scene.prompt}, ${topic}, faceless short-form storytelling`
  }));
  return clone;
}

function makeCacheKey(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

async function readMeta(key) {
  const metaPath = path.join(CACHE_DIR, `${key}.json`);
  try {
    return JSON.parse(await fsp.readFile(metaPath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeMeta(key, meta) {
  const metaPath = path.join(CACHE_DIR, `${key}.json`);
  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

async function openaiJson(pathname, payload) {
  const response = await fetch(`https://api.openai.com${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status})`);
  }
  return await response.json();
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
