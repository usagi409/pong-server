const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const cors = require('cors');
const { Server } = require('socket.io');

app.use(cors());
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

io.on('connection', (socket) => {
    socket.on('create-room', (data) => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomCode] = { host: socket.id, players: [data.user] };
        socket.join(roomCode);
        socket.emit('room-created', roomCode);
    });

    socket.on('join-room', (data) => {
        if (rooms[data.room]) {
            socket.join(data.room);
            io.to(data.room).emit('game-start');
        }
    });

    socket.on('join-ai', (data) => {
        socket.emit('game-start');
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
