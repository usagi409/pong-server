const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const cors = require('cors');
app.use(cors());

const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    console.log('接続:', socket.id);

    // AI対戦のリクエスト
    socket.on('join-ai', (data) => {
        console.log('AI対戦開始:', data);
        // ここにAI対戦のロジック（ルーム作成など）を入れる
    });

    // 部屋作成のリクエスト
    socket.on('create-room', (data) => {
        const roomCode = Math.random().toString(36).substring(7).toUpperCase();
        socket.join(roomCode);
        console.log('部屋作成:', roomCode, data);
        // ここに部屋の設定保存ロジックを入れる
    });

    // 部屋参加のリクエスト
    socket.on('join-room', (data) => {
        socket.join(data.room);
        console.log('部屋参加:', data.room, data.user);
        // ここに参加処理ロジックを入れる
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`API Server running on port ${PORT}`));
