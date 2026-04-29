const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GRID_SIZE = 25;
const GAME_SECONDS = 120;
const MAX_CHARS = 50;

const patterns = [
  [2, 7, 12, 17, 22, 11, 13],
  [0, 1, 2, 5, 10, 15, 20, 21, 22],
  [4, 8, 12, 16, 20, 9, 14],
  [6, 7, 8, 11, 13, 16, 17, 18],
  [1, 5, 6, 7, 11, 15, 16, 17, 21]
];

const rooms = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function createId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createEmptyGrid() {
  return Array.from({ length: GRID_SIZE }, () => false);
}

function patternToGrid(pattern) {
  const grid = createEmptyGrid();
  pattern.forEach((index) => {
    grid[index] = true;
  });
  return grid;
}

function sanitizeRooms() {
  const now = Date.now();
  Object.entries(rooms).forEach(([id, room]) => {
    if (now - room.updatedAt > 1000 * 60 * 45) {
      delete rooms[id];
    }
  });
}

function findRoom(req, res) {
  const room = rooms[req.params.id.toUpperCase()];
  if (!room) {
    res.status(404).json({ error: 'Room introuvable' });
    return null;
  }
  return room;
}

function touchRoom(room) {
  room.updatedAt = Date.now();
}

function validateRoom(room) {
  const won = room.target.every((cell, index) => cell === room.grid[index]);
  if (won) {
    room.status = 'ended';
    room.won = true;
    room.message = 'Bravo, la forme est parfaitement reproduite.';
  }
}

app.get('/api/info', (req, res) => {
  res.json({
    projet: 'exo3node',
    serveur: 'Node.js + Express',
    date: new Date().toISOString()
  });
});

app.get('/api/state', (req, res) => {
  sanitizeRooms();
  res.json({ rooms });
});

app.post('/api/rooms', (req, res) => {
  const player = req.body.player;
  const id = createId();
  const target = patternToGrid(patterns[Math.floor(Math.random() * patterns.length)]);

  rooms[id] = {
    id,
    status: 'waiting',
    players: [{ ...player, role: 'Designer' }],
    target,
    grid: createEmptyGrid(),
    instructions: [],
    usedChars: 0,
    startedAt: null,
    message: 'En attente des Builders.',
    won: false,
    updatedAt: Date.now()
  };

  res.status(201).json({ room: rooms[id], rooms });
});

app.post('/api/rooms/:id/join', (req, res) => {
  const room = findRoom(req, res);
  if (!room) return;

  const player = req.body.player;
  if (!room.players.some((item) => item.id === player.id)) {
    room.players.push({ ...player, role: 'Builder' });
  }
  room.message = `${player.name} a rejoint la room.`;
  touchRoom(room);
  res.json({ room, rooms });
});

app.post('/api/rooms/:id/leave', (req, res) => {
  const room = findRoom(req, res);
  if (!room) return;

  room.players = room.players.filter((player) => player.id !== req.body.playerId);
  if (!room.players.length) {
    delete rooms[room.id];
  } else if (!room.players.some((player) => player.role === 'Designer')) {
    room.players[0].role = 'Designer';
    room.message = `${room.players[0].name} devient Designer.`;
    touchRoom(room);
  }
  res.json({ rooms });
});

app.post('/api/rooms/:id/start', (req, res) => {
  const room = findRoom(req, res);
  if (!room) return;

  room.status = 'playing';
  room.grid = createEmptyGrid();
  room.instructions = [];
  room.usedChars = 0;
  room.startedAt = Date.now();
  room.message = 'Partie lancee.';
  room.won = false;
  touchRoom(room);
  res.json({ room, rooms });
});

app.post('/api/rooms/:id/instruction', (req, res) => {
  const room = findRoom(req, res);
  if (!room) return;

  const text = String(req.body.text || '').slice(0, MAX_CHARS);
  const addedChars = Math.max(0, Number(req.body.addedChars) || 0);
  room.usedChars = Math.min(MAX_CHARS, room.usedChars + addedChars);
  room.instructions = [{
    id: `I-${createId()}`,
    author: req.body.playerName,
    text,
    at: Date.now()
  }];

  if (room.usedChars >= MAX_CHARS) {
    room.status = 'ended';
    room.won = false;
    room.message = 'Plus de caracteres disponibles. La partie est perdue.';
  }

  touchRoom(room);
  res.json({ room, rooms });
});

app.post('/api/rooms/:id/cell', (req, res) => {
  const room = findRoom(req, res);
  if (!room) return;

  const index = Number(req.body.index);
  if (room.status === 'playing' && Number.isInteger(index) && index >= 0 && index < GRID_SIZE) {
    room.grid[index] = Boolean(req.body.value);
    room.message = `${req.body.playerName} modifie la grille.`;
    validateRoom(room);
    touchRoom(room);
  }
  res.json({ room, rooms });
});

app.post('/api/rooms/:id/end', (req, res) => {
  const room = findRoom(req, res);
  if (!room) return;

  room.status = 'ended';
  room.won = Boolean(req.body.won);
  room.message = req.body.message || 'Partie terminee.';
  touchRoom(room);
  res.json({ room, rooms });
});

setInterval(() => {
  const now = Date.now();
  Object.values(rooms).forEach((room) => {
    if (room.status === 'playing' && now - room.startedAt >= GAME_SECONDS * 1000) {
      room.status = 'ended';
      room.won = false;
      room.message = 'Temps ecoule. La partie est perdue.';
      touchRoom(room);
    }
  });
  sanitizeRooms();
}, 1000);

app.listen(PORT, () => {
  console.log(`Serveur lance sur http://localhost:${PORT}`);
});
