const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const cors = require('cors');

app.use(cors());

const { Server } = require('socket.io');
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('test-message', (data) => {
        io.emit('test-broadcast', data);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`API Server running on port ${PORT}`));
