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
        rooms[roomCode] = { 
            config: { points: data.points, balls: data.balls, p2Name: data.user, p1Name: '相手' } 
        };
        socket.join(roomCode);
        socket.emit('room-created', roomCode);
    });

    socket.on('join-room', (data) => {
        if (rooms[data.room]) {
            const config = rooms[data.room].config;
            config.p1Name = data.user; // 参加者の名前をセット
            io.to(data.room).emit('game-start', config);
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running`));
