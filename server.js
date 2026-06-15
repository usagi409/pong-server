const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');

// CORS設定を明示的に許可
const io = new Server(server, {
    cors: { origin: "*" }
});

io.on('connection', (socket) => {
    console.log('★サーバー接続成功！ ID:', socket.id);
    
    socket.on('broadcast-test', (data) => {
        console.log('メッセージ受信:', data);
        io.emit('server-echo', `「${data}」をサーバー経由で受け取ったよ！`);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`サーバー起動中... ポート: ${PORT}`);
});