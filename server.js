import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.get("/health", (_req, res) => res.status(200).json({ ok: true, app: "KORA SUS" }));
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const CHARACTERS = ["Salah", "Ronaldo", "Messi", "Mbappe", "Haaland", "Neymar", "Bellingham", "Vinicius"];
const cleanName = (v) => String(v || "Player").trim().replace(/[<>]/g, "").slice(0, 18) || "Player";
const makeCode = () => {
  let code;
  do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(code));
  return code;
};
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, character: p.character, ready: p.ready,
      host: p.id === room.hostId, x: p.x, z: p.z
    }))
  };
}
function emitRoom(room) { io.to(room.code).emit("room:update", publicRoom(room)); }
function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.players.delete(socket.id);
  if (room.players.size === 0) rooms.delete(code);
  else {
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    emitRoom(room);
  }
}
io.on("connection", socket => {
  socket.on("room:create", ({ name, character } = {}, cb = () => {}) => {
    leaveRoom(socket);
    const code = makeCode();
    const player = { id: socket.id, name: cleanName(name), character: CHARACTERS.includes(character) ? character : "Salah", ready: false, x: 0, z: 0 };
    const room = { code, hostId: socket.id, started: false, players: new Map([[socket.id, player]]) };
    rooms.set(code, room);
    socket.join(code); socket.data.roomCode = code;
    cb({ ok: true, room: publicRoom(room) }); emitRoom(room);
  });
  socket.on("room:join", ({ code, name, character } = {}, cb = () => {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "مش لاقيين روم بالكود ده." });
    if (room.started) return cb({ ok: false, error: "الجيم بدأ بالفعل." });
    if (room.players.size >= 10) return cb({ ok: false, error: "الروم كاملة (10 لاعبين)." });
    leaveRoom(socket);
    const used = new Set([...room.players.values()].map(p => p.character));
    let chosen = CHARACTERS.includes(character) ? character : "Salah";
    if (used.has(chosen)) chosen = CHARACTERS.find(c => !used.has(c)) || chosen;
    room.players.set(socket.id, { id: socket.id, name: cleanName(name), character: chosen, ready: false, x: Math.random()*3-1.5, z: Math.random()*3-1.5 });
    socket.join(code); socket.data.roomCode = code;
    cb({ ok: true, room: publicRoom(room) }); emitRoom(room);
  });
  socket.on("player:customize", ({ name, character } = {}) => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const p = room.players.get(socket.id); if (!p || room.started) return;
    const cleanCharacter = CHARACTERS.includes(character) ? character : p.character;
    const used = [...room.players.values()].some(other => other.id !== socket.id && other.character === cleanCharacter);
    if (used) return socket.emit("notice", "الشخصية دي مختارة بالفعل.");
    p.name = cleanName(name || p.name); p.character = cleanCharacter; p.ready = false; emitRoom(room);
  });
  socket.on("player:ready", ready => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.started) return;
    const p = room.players.get(socket.id); if (p) { p.ready = !!ready; emitRoom(room); }
  });
  socket.on("room:start", () => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.hostId !== socket.id || room.started) return;
    if (room.players.size < 4) return socket.emit("notice", "محتاجين 4 لاعبين على الأقل لبدء الجولة.");
    if ([...room.players.values()].some(p => !p.ready)) return socket.emit("notice", "كل اللاعبين لازم يكونوا جاهزين الأول.");
    room.started = true;
    const players = [...room.players.values()];
    const impostor = players[Math.floor(Math.random()*players.length)].id;
    for (const p of players) io.to(p.id).emit("game:role", { role: p.id === impostor ? "impostor" : "player" });
    emitRoom(room);
    io.to(room.code).emit("game:started", publicRoom(room));
  });
  socket.on("game:move", ({ x, z } = {}) => {
    const room = rooms.get(socket.data.roomCode); if (!room || !room.started) return;
    const p = room.players.get(socket.id); if (!p) return;
    p.x = Math.max(-9, Math.min(9, Number(x) || 0));
    p.z = Math.max(-6, Math.min(6, Number(z) || 0));
    socket.to(room.code).emit("game:playerMoved", { id: p.id, x: p.x, z: p.z });
  });
  socket.on("room:leave", () => leaveRoom(socket));
  socket.on("disconnect", () => leaveRoom(socket));
});
server.listen(PORT, "0.0.0.0", () => console.log(`KORA SUS running at http://localhost:${PORT}`));