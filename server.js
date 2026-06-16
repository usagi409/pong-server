const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

const rooms = {}; // 全ての部屋データを管理するオブジェクト

io.on('connection', (socket) => {
    let currentRoom = null;

    // 1. 部屋を作る
    socket.on('createRoom', (data) => {
        const code = Math.floor(1000 + Math.random() * 9000).toString(); // 4桁のコード
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

    // 2. 部屋に入る（ここで存在チェックを行う）
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

        // 参加者に成功を通知
        socket.emit('roomJoined', { code: code });
        // 部屋の全員にメンバーが揃ったことを通知
        io.to(code).emit('roomReady', { p1Name: room.p1.name, p2Name: room.p2.name });
    });

    // 3. 準備完了ボタンの処理
    socket.on('playerReady', () => {
        const room = rooms[currentRoom];
        if (!room) return;

        if (socket.id === room.p1.id) room.p1.ready = true;
        if (room.p2 && socket.id === room.p2.id) room.p2.ready = true;

        // 両者準備完了でゲーム開始
        if (room.p1.ready && room.p2 && room.p2.ready && room.gameState !== 'PLAYING') {
            room.gameState = 'PLAYING';
            initRoomBalls(room);
            io.to(currentRoom).emit('gameStarted');
            
            // サーバー側ゲームループ開始 (60fps)
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

    // 5. 切断・退出処理
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

// オンライン用のボール初期化
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

// サーバー側での物理演算ループ
function updateRoomGame(room) {
    if (room.gameState !== 'PLAYING') return;

    let activeCount = 0;
    room.balls.forEach(b => {
        if (!b.active) return;
        activeCount++;

        b.x += b.dx; b.y += b.dy;

        // 壁衝突
        if (b.y < 0 || b.y > 390) b.dy *= -1;

        // パドル衝突 (P1:左, P2:右)
        if (b.x < 20 && b.y > room.p1.y && b.y < room.p1.y + 80) b.dx = Math.abs(b.dx) * 1.05;
        if (room.p2 && b.x > 570 && b.y > room.p2.y && b.y < room.p2.y + 80) b.dx = -Math.abs(b.dx) * 1.05;

        // ゴール判定
        if (b.x < -10) { room.score.p2++; b.active = false; }
        if (b.x > 610) { room.score.p1++; b.active = false; }
    });

    // 全てのボールが消えたら次のラウンドか終了判定
    if (activeCount === 0) {
        if (room.score.p1 < room.maxScore && room.score.p2 < room.maxScore) {
            initRoomBalls(room); // 次のラウンドへ
        } else {
            room.gameState = 'STOPPED';
            clearInterval(room.intervalId);
            const winner = room.score.p1 > room.score.p2 ? room.p1.name : room.p2.name;
            io.to(room.code).emit('matchResult', { winner: winner });
            return;
        }
    }

    // 両プレイヤーに最新状態を送信
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
