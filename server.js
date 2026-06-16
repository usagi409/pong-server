const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

const rooms = {};
const MAX_SPEED = 12; // ボールの最高速度制限

io.on('connection', (socket) => {
    let currentRoom = null;

    // 1. 部屋を作る
    socket.on('createRoom', (data) => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[code] = {
            code: code,
            maxScore: parseInt(data.maxScore) || 5,
            ballCount: parseInt(data.ballCount) || 1,
            gameState: 'READY',
            p1: { id: socket.id, name: data.name, y: 160, ready: false },
            p2: null,
            score: { p1: 0, p2: 0 },
            balls: [],
            intervalId: null
        };
        currentRoom = code;
        socket.join(code);
        socket.emit('roomCreated', { code: code });
    });

    // 2. 部屋に入る
    socket.on('joinRoom', (data) => {
        const code = data.code;
        const room = rooms[code];

        if (!room) {
            socket.emit('roomError', "部屋が見つかりません。コードを確認してください。");
            return;
        }
        if (room.p2) {
            socket.emit('roomError', "この部屋は満員です。");
            return;
        }

        room.p2 = { id: socket.id, name: data.name, y: 160, ready: false };
        currentRoom = code;
        socket.join(code);

        socket.emit('roomJoined', { code: code });
        io.to(code).emit('roomReady', { p1Name: room.p1.name, p2Name: room.p2.name });
    });

    // 3. 準備完了ボタンの処理（最初のスタート＆ラウンド移行時共通）
    socket.on('playerReady', () => {
        const room = rooms[currentRoom];
        if (!room) return;

        if (socket.id === room.p1.id) room.p1.ready = true;
        if (room.p2 && socket.id === room.p2.id) room.p2.ready = true;

        if (room.p1.ready && room.p2 && room.p2.ready && room.gameState !== 'PLAYING') {
            room.gameState = 'PLAYING';
            initRoomBalls(room); // ここでボールをセット
            io.to(currentRoom).emit('gameStarted');
            
            if (!room.intervalId) {
                room.intervalId = setInterval(() => updateRoomGame(room), 1000 / 60);
            }
        }
    });

    // 4. パドル移動の同期
    socket.on('paddleMove', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;
        if (socket.id === room.p1.id) room.p1.y = data.y;
        if (room.p2 && socket.id === room.p2.id) room.p2.y = data.y;
    });

    const handleLeave = () => {
        const room = rooms[currentRoom];
        if (room) {
            clearInterval(room.intervalId);
            io.to(currentRoom).emit('roomError', "対戦相手が切断しました。");
            delete rooms[currentRoom];
        }
    };
    socket.on('leaveRoom', handleLeave);
    socket.on('disconnect', handleLeave);
});

function initRoomBalls(room) {
    room.balls = [];
    const baseAngle = Math.PI;
    const angleDiff = 5 * (Math.PI / 180);
    for (let i = 0; i < room.ballCount; i++) {
        const speed = (room.ballCount === 2) ? (i === 0 ? 5.5 : 4.5) : 5;
        const angle = (i === 1) ? baseAngle + angleDiff : baseAngle - angleDiff;
        room.balls.push({ x: 300, y: 200, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, active: true });
    }
}

// サーバー側物理演算
function updateRoomGame(room) {
    if (room.gameState !== 'PLAYING') return;

    let activeCount = 0;
    room.balls.forEach(b => {
        if (!b.active) return;
        activeCount++;

        b.x += b.dx; b.y += b.dy;

        if (b.y < 0 || b.y > 390) b.dy *= -1;

        // パドル衝突時の加速に上限（MAX_SPEED）を設定
        if (b.x < 20 && b.y > room.p1.y && b.y < room.p1.y + 80) {
            let nextDx = Math.abs(b.dx) * 1.05;
            b.dx = nextDx > MAX_SPEED ? MAX_SPEED : nextDx;
        }
        if (room.p2 && b.x > 570 && b.y > room.p2.y && b.y < room.p2.y + 80) {
            let nextDx = Math.abs(b.dx) * 1.05;
            b.dx = nextDx > MAX_SPEED ? -MAX_SPEED : -nextDx;
        }

        if (b.x < -10) { room.score.p2++; b.active = false; }
        if (b.x > 610) { room.score.p1++; b.active = false; }
    });

    if (activeCount === 0) {
        if (room.score.p1 < room.maxScore && room.score.p2 < room.maxScore) {
            // 次のラウンドの準備状態へ（プレイヤーの準備フラグをリセットして同期）
            room.gameState = 'READY';
            room.p1.ready = false;
            if (room.p2) room.p2.ready = false;
            io.to(room.code).emit('roundCleared', { score: room.score });
            return; 
        } else {
            room.gameState = 'STOPPED';
            clearInterval(room.intervalId);
            const winner = room.score.p1 > room.score.p2 ? room.p1.name : room.p2.name;
            io.to(room.code).emit('matchResult', { winner: winner });
            return;
        }
    }

    io.to(room.code).emit('gameState', {
        balls: room.balls,
        score: room.score,
        p1Y: room.p1.y,
        p2Y: room.p2 ? room.p2.y : 160,
        gameState: room.gameState
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
