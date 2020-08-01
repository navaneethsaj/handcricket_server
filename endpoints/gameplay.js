const AsyncLock = require('async-lock');
const randomstring = require('randomstring')
let counterLock = new AsyncLock();
let counterOnlineLock = new AsyncLock();
let waitingListLock = new AsyncLock();
let io;
// garbage collected at disconnect
let playerSockets = {
    count: 0,
    sockets: {}
}
let liveGames = {
    count: 0,
    // garbage collected by garb collector
    games: {},
    waiting: [],
    playingSockets: {},
}
// garbage collected
let onlineUsers = { count : 0, socketsidtouser: {}, useridtosockets: {}
}
// garbage collected by collector
let liveInvites = {

}
function checkAndAddToWaitingList(socket, data) {
    // console.log('s', socket.id)
    // console.log('waiting', liveGames.waiting.length)
    try {
        if (liveGames.waiting.includes(socket)){
            console.log('already in WL')
            socket.emit('errormsg', ({status: 100, msg: 'player already in WL'}))
            return
        }
        waitingListLock.acquire("key", (done) => {
            if (liveGames.waiting.length > 0){
                let waitingMan = liveGames.waiting.shift();
                let waitingManName = playerSockets.sockets[waitingMan.id].name;
                // console.log('1', waitingManName)
                done(false, {socket: waitingMan, waitingManName: waitingManName})
            }else {
                // console.log('2', data.name, )
                liveGames.waiting.push(socket);
                playerSockets.sockets[socket.id].name =  data.name;
                // console.log('ss', playerSockets)
                done(true, {socket, waitingManName: null})
            }
        }, (waiting, otherData) =>{
            let waitingMan = otherData.socket;
            let waitingName = otherData.waitingManName;
            // console.log(waiting)
            if (!waiting){
                // console.log(waitingName, data.name)
                let gameid = randomstring.generate();
                liveGames.games[gameid] = {
                    lastPing: new Date(),
                    turn: 0,
                    sockets: [waitingMan, socket],
                    0: {moves: [], score: 0, name: waitingName},
                    1: {moves: [], score: 0, name: data.name},
                    bet: Math.floor((Math.random() * 2)),
                    batting: null,
                    wicket : 0,
                }
                waitingMan.emit('foundgame', {gameid, playerid: 0, bet: liveGames.games[gameid].bet === 0, opponentname: data.name})
                socket.emit('foundgame', {gameid, playerid:1, turn: 0, bet: liveGames.games[gameid].bet === 1, opponentname: waitingName})
                liveGames.playingSockets[socket.id] = {gameid, lastPing: new Date()};
                liveGames.playingSockets[waitingMan.id] = {gameid, lastPing: new Date()};
                // console.log(gameid)
            }
        })
    }catch (e) {
        console.log('check and add waiting list', e)
    }
}
function incrementDecrementPlayerCount(increment){
    try {
        counterLock.acquire("key", function(done) {
            // async work
            if (increment){
                playerSockets.count++;
            }else {
                playerSockets.count--;
            }
            done();
        }, function() {
            // lock released
            console.log('Player Count changed ', playerSockets.count)
        });
    }catch (e) {
        console.log('inc dec player count', e);
    }
}
function removeFromWL(socket) {
    try {
        if (liveGames.waiting.includes(socket)){
            console.log('removing from wl')
            waitingListLock.acquire("key", done => {
                let index = liveGames.waiting.indexOf(socket)
                liveGames.waiting.splice(index, 1);
                done("ok")
            }, (data) => {
                console.log("removed from wl, socket disconnect", data)
            })
        }
    }catch (e) {
        console.log('remove from wl', e);
    }
}
function removeFromLiveGame(socket) {
    try {
        let gameid = liveGames.playingSockets[socket.id].gameid;
        console.log(gameid)
        if (gameid !== undefined){
            let game = liveGames.games[gameid];
            game.sockets.forEach(sock => {
                if (sock !== socket){
                    sock.emit('opponentdisconnected', {msg: 'disconnected'})
                    console.log('sock disconnected, removed from live game')
                }
            })
        }
    }catch (e) {
        console.log('remove from live game', e)
    }
}

function removeFromPlayerSockets(socket) {
    try {
        delete playerSockets.sockets[socket.id]
    }catch (e) {
        console.log('remove from player scoket', e);
    }
}

function gameOverClean(gameid) {
    console.log(gameid)
    console.log('gameover clearn')
    // delete liveGames.games[gameid]
}

function initListeners(socket){
    try {
        playerSockets.sockets[socket.id] = {socket}
        socket.on('init', (data) => {
            // console.log(data)
        })
        socket.on('choice', data => {
            console.log(data, liveGames.count)
            liveGames.count++;
        })
        socket.on('chat', data => {
            try {
                liveGames.games[data.gameid].sockets.forEach(sock => {
                    sock.emit('chat', data)
                })
            }catch (e) {
                console.log(e)
            }
        })
        socket.on('findgame', (data) => {
            console.log('findgame', data)
            try {
                checkAndAddToWaitingList(socket, data)
            }catch (e) {
                console.log(e)
            }
        })
        socket.on('gameoveraction', (data) => {
            try {
                console.log('gameoveraction', data, liveGames.games[data.gameid])
                liveGames.games[data.gameid].sockets.forEach(sock => {
                    sock.emit('opponentgameoveraction', data)
                })
            }catch (e) {
                console.log(e)
            }
        })
        socket.on('playmove', data => {
            try {
                let gameId = data.gameid;
                let playerId = data.playerid;
                let move = data.move;
                let game = liveGames.games[gameId]
                game[playerId].moves.push(move);
                console.log(gameId)
                // console.log(game)
                // return
                if (game.batting === playerId){
                    game[playerId].score += move;
                }
                // console.log(playerId, game[playerId])
                if (game[playerId].moves.length === game[(playerId + 1) % 2].moves.length){
                    // console.log('a')
                    // console.log('move result', data)
                    let moveresult = {0: game[0], 1: game[1]};
                    if (game[playerId].moves[game[playerId].moves.length - 1] ===
                        game[(playerId + 1) % 2].moves[game[(playerId + 1) % 2].moves.length - 1]){
                        // console.log('c')

                        // wicket
                        game.wicket++;
                        if (game.wicket >= 2){
                            // gameover
                            let winner;
                            let draw = false;
                            game[game.batting].score -= game[game.batting].moves[game[game.batting].moves.length - 1];
                            if ( game[0].score > game[1].score){
                                winner = 0;
                            }else if (game[0].score < game[1].score){
                                winner = 1;
                            }else {
                                winner = null;
                                draw = true;
                            }
                            // console.log('draw',game[0].score, game[1].score)
                            game.sockets.forEach(sock => {
                                sock.emit('moveresult', moveresult)
                                sock.emit('gameover', {winner, draw})
                            })
                            gameOverClean(gameId);
                        }else if (game.wicket >=1){
                            // one wicket gone
                            game[game.batting].score -= game[game.batting].moves[game[game.batting].moves.length - 1];
                            game.batting = (game.batting +1 ) % 2;
                            game.sockets.forEach(sock => {
                                sock.emit('moveresult', moveresult)
                                sock.emit('wicketgone', {batting: game.batting})
                            })
                        }
                    }
                    else {
                        // console.log('d')
                        // scored
                        if (game.wicket >= 1
                            && game[game.batting].score > game[(game.batting + 1 ) % 2].score){
                            // console.log('scored more')
                            let winner;
                            let draw = false;
                            if ( game[0].score > game[1].score){
                                winner = 0;
                            }else{
                                winner = 1;
                            }
                            game.sockets.forEach(sock => {
                                sock.emit('moveresult', moveresult)
                                sock.emit('gameover', {winner, draw})
                            })
                        }
                        else {
                            // console.log('e', game.sockets.length)
                            game.sockets.forEach(sock => {
                                // console.log('sock', sock.id)
                                sock.emit('moveresult', moveresult)
                            })
                        }

                    }
                } else {
                    // console.log('a')
                    game.sockets.forEach(sock => {
                        // console.log('opp chosed')
                        sock.emit('opponentchosed', {playerid: playerId})
                    })

                }
                // console.log('end')
            }catch (e) {
                console.log(e)
            }
        })
        socket.on('choice', (data) => {
            try {
                let gameid = data.gameid;
                let playerid = data.playerid;
                let batting = data.batting;
                console.log('user choice', );
                if (batting){
                    liveGames.games[gameid].batting = playerid;
                }else {
                    liveGames.games[gameid].batting = (playerid + 1) % 2;
                }
                let sockets = liveGames.games[gameid].sockets;
                sockets.forEach(sock => {
                    sock.emit('batting', {batting: liveGames.games[gameid].batting})
                })
            }catch (e) {
                console.log(e)
            }
        });
        socket.on('disconnect', () => {
            try {
                console.log('user disconnected');
                incrementDecrementPlayerCount(false);
                removeFromWL(socket)
                removeFromLiveGame(socket)
                removeFromPlayerSockets(socket)
            }catch (e) {
                console.log(e)
            }
        });
    }catch (e) {
        console.log('init listners', e)
    }
}
function initListenersForOnline(socket){
    try {
        // console.log(onlineUsers)
        onlineUsers.socketsidtouser[socket.id] = {
        }
        // console.log(onlineUsers)
        socket.on('disconnect', () => {
            try {
                console.log('online user disconnected');
                incrementDecrementOnlineCount(false)
                delete onlineUsers.socketsidtouser[socket.id]
            }catch (e) {
                console.log(e)
            }
        });
        socket.on('customgame', (data) => {
            try {
                console.log('custom game');
                let playername = data.playername;
                let oppuserid = data.uniqueidopp;
                let playerid = data.uniqueidplayer;
                // playerSockets.sockets[socket.id].name =  data.name;
                // data.finalgamesockets[0].emit('test', "testing this")
                // console.log('sa', data.finalgamesocketsid[0],)
                // console.log('s', playerSockets,)
                playerSockets.sockets[data.finalgamesocketsid].name =  data.name;
                let tsocket = playerSockets.sockets[data.finalgamesocketsid].socket
                // console.log('tsock', tsocket)
                // tsocket.emit('test', 'test')
                let oppuser = onlineUsers.useridtosockets[oppuserid];
                let inviteid = randomstring.generate();
                liveInvites[inviteid] = {
                    gameSockets: tsocket,
                    lastPing: new Date(),
                    playername
                }
                oppuser.socket.emit('invite', {playername, playerid, inviteid})
            }catch (e) {
                console.log(e)
            }
        });
        socket.on('inviteresponse', (data) => {
            try {
                let action = data.action;
                let noftifyplayerid = data.notifyplayerid;
                let oppSock = onlineUsers.useridtosockets[noftifyplayerid].socket;
                if (action === 'accept'){
                    oppSock.emit('inviteresponded', data)
                }else if (action === 'reject'){
                    oppSock.emit('inviteresponded', data)
                }
            }catch (e) {
                console.log(e)
            }
        })
        socket.on('joinedinvite', (data) => {
            try {
                let inviteid = data.inviteid;
                let mygamesocket = playerSockets.sockets[data.mygamesocketid].socket
                let playerSocks1 = liveInvites[inviteid].gameSockets
                let playerSocks2 = mygamesocket;
                // player 1 is first player
                let player1Name = liveInvites[inviteid].playername;
                let player2Name = data.playername;
                // console.log('ps', player1Name, player2Name)
                const gameid = randomstring.generate();
                liveGames.games[gameid] = {
                    lastPing: new Date(),
                    turn: 0,
                    sockets: [playerSocks1, playerSocks2],
                    0: {moves: [], score: 0, name: player1Name},
                    1: {moves: [], score: 0, name: player2Name},
                    bet: Math.floor((Math.random() * 2)),
                    batting: null,
                    wicket : 0,
                }
                // playerSocks1.emit('test', 'test')
                // playerSocks2.emit('test', 'test')
                playerSocks1.emit('foundgame', {gameid, playerid: 0, bet: liveGames.games[gameid].bet === 0, opponentname: player2Name})
                playerSocks2.emit('foundgame', {gameid, playerid:1, turn: 0, bet: liveGames.games[gameid].bet === 1, opponentname: player1Name})
                liveGames.playingSockets[playerSocks1.id] = {gameid, lastPing: new Date()};
                liveGames.playingSockets[playerSocks2.id] = {gameid, lastPing: new Date()};
            }catch (e) {
                console.log(e)
            }
        })
        socket.on('playerdata', (data) => {
            try {
                let playername = data.name;
                let uniqueid = data.uniqueid;
                let score = data.score;
                let playing = false;
                // console.log('playername', playername, uniqueid);
                onlineUsers.socketsidtouser[socket.id].name = playername;
                onlineUsers.socketsidtouser[socket.id].uniqueid = uniqueid;
                onlineUsers.socketsidtouser[socket.id].score = score;
                onlineUsers.socketsidtouser[socket.id].playing = playing;
                onlineUsers.useridtosockets[uniqueid] = {socket, playername, score};
                // console.log(onlineUsers)
            }catch (e) {
                console.log(e)
            }
        });
        socket.on('playing', data => {
            onlineUsers.socketsidtouser[socket.id].playing = data.playing;
        })
        socket.on('getonlineplayers', () => {
            try {
                let users = []
                for (let sockid in onlineUsers.socketsidtouser){
                    let user = onlineUsers.socketsidtouser[sockid]
                    users.push(user)
                }
                // console.log(users);
                socket.emit('onlineplayers', users);
            }catch (e) {
                console.log(e)
            }
        });
    }catch (e) {
        console.log('init listners online', e);
    }
}
function incrementDecrementOnlineCount(increment){
    try {
        counterOnlineLock.acquire("key", function(done) {
            // async work
            if (increment){
                onlineUsers.count++;
            }else {
                onlineUsers.count--;
            }
            done();
        }, function() {
            // lock released
            console.log('online user Count changed ', onlineUsers.count)
        });
    }catch (e) {
        console.log('inc dec online count', e)
    }
}

module.exports = function (io_) {
    console.log('initialised socket io')
    io = io_;
    io.of('/multiplayer').on('connection', (socket) => {
        console.log('a user on multiplayer', socket.id);
        initListeners(socket);
        incrementDecrementPlayerCount(true);
    });
    io.of('/online').on('connection', (socket) => {
        console.log('a user connected on online');
        initListenersForOnline(socket);
        incrementDecrementOnlineCount(true);
    });
}


setInterval(() => {
    console.log('garbage collecting round started')
    try {
        for (let gameid in liveGames.games){
            try {
                if (new Date().getTime() - liveGames.games[gameid].lastPing.getTime() > 60 * 1000 * 15){
                    delete liveGames.games[gameid]
                    console.log('deleted game garb collector', gameid)
                }
            }catch (e) {
                console.log(e)
            }
        }

    }catch (e) {
        console.log(e)
    }
    try{
        for (let socketid in liveGames.playingSockets){
            try {
                if (new Date().getTime() - liveGames.playingSockets[socketid].lastPing.getTime() > 60 * 1000 * 15){
                    delete liveGames.playingSockets[socketid]
                    console.log('deleted livegame playing socket garb collector', socketid)
                }
            }catch (e) {
                console.log(e)
            }
        }
    }catch (e) {
        console.log(e)
    }
    try{
        for (let inviteid in liveInvites){
            try {
                if (new Date().getTime() - liveInvites[inviteid].lastPing > 60 * 1000 * 15){
                    delete liveInvites[inviteid]
                    console.log('deleted invite garb collector', inviteid)
                }
            }catch (e) {
                console.log(e)
            }
        }
    }catch (e) {
        console.log(e)
    }
    console.log('garbage collected done')
}, 1000 * 60 * 15);

