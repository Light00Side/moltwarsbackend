import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 8080;
const TICK_RATE = 5; // ticks per second
const WORLD_SIZE = 256;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// In-memory state (MVP)
const players = new Map(); // playerId -> {id, name, x, y, hp, apiKey}
const sockets = new Map(); // playerId -> ws

function spawnPlayer(name) {
  return {
    id: randomUUID(),
    name,
    x: Math.floor(Math.random() * WORLD_SIZE),
    y: Math.floor(Math.random() * WORLD_SIZE),
    hp: 100,
    apiKey: randomUUID().replace(/-/g, ''),
  };
}

// REST: join
app.post('/join', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const player = spawnPlayer(name);
  players.set(player.id, player);
  res.json({ ok: true, playerId: player.id, apiKey: player.apiKey, spawn: { x: player.x, y: player.y } });
});

// REST: get state (simple)
app.get('/state', (req, res) => {
  const { playerId, apiKey } = req.query;
  const p = players.get(playerId);
  if (!p || p.apiKey !== apiKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  res.json({ ok: true, player: p, players: Array.from(players.values()) });
});

const server = app.listen(PORT, () => {
  console.log(`Moltwars server running on :${PORT}`);
});

// WebSocket for realtime actions
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const playerId = url.searchParams.get('playerId');
  const apiKey = url.searchParams.get('apiKey');
  const p = players.get(playerId);
  if (!p || p.apiKey !== apiKey) {
    ws.close();
    return;
  }

  sockets.set(playerId, ws);

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'move') {
        p.x += data.dx || 0;
        p.y += data.dy || 0;
      }
      if (data.type === 'attack' && data.targetId) {
        const t = players.get(data.targetId);
        if (t) t.hp = Math.max(0, t.hp - 5);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    sockets.delete(playerId);
  });
});

// Tick loop
setInterval(() => {
  const snapshot = Array.from(players.values()).map(({ apiKey, ...rest }) => rest);
  const payload = JSON.stringify({ type: 'tick', players: snapshot });
  for (const ws of sockets.values()) {
    if (ws.readyState === 1) ws.send(payload);
  }
}, 1000 / TICK_RATE);
