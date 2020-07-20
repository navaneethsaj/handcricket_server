const AsyncLock = require('async-lock');
const randomstring = require('randomstring')
let counterLock = new AsyncLock();
let counterOnlineLock = new AsyncLock();
let waitingListLock = new AsyncLock();
let io;
let playerSockets = {
    count: 0,
    sockets: {}
}
let liveGames = {
    count: 0,
    games: {},
    waiting: [],
    playingSockets: {},
}
let onlineUsers = { count : 0, socketsidtouser: {}, useridtosockets: {}
}
let liveInvites = {

}
function checkAndAddToWaitingList(socket, data) {
    console.log('s', socket.id)
    // console.log('waiting', liveGames.waiting.length)
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
            console.log(waitingName, data.name)
            let gameid = randomstring.generate();
            liveGames.games[gameid] = {
                lastPing: Date(),
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
            liveGames.playingSockets[socket.id] = gameid;
            liveGames.playingSockets[waitingMan.id] = gameid;
            // console.log(gameid)
        }
    })
}
function incrementDecrementPlayerCount(increment){
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
}
function removeFromWL(socket) {
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
}
function removeFromLiveGame(socket) {
    let gameid = liveGames.playingSockets[socket];
    if (gameid !== undefined){
        let game = liveGames.games[gameid];
        game.sockets.forEach(sock => {
            if (sock !== socket){
                sock.emit('opponentdisconnected', {msg: 'disconnected'})
                console.log('sock disconnected, removed from live game')
            }
        })
    }
}

function removeFromPlayerSockets(socket) {
    delete playerSockets.sockets[socket.id]
}

function gameOverClean() {

}
function initListeners(socket){
    playerSockets.sockets[socket.id] = {socket}
    socket.on('init', (data) => {
        console.log(data)
    })
    socket.on('choice', data => {
        console.log(data, liveGames.count)
        liveGames.count++;
    })
    socket.on('findgame', (data) => {
        console.log('findgame', data)
        checkAndAddToWaitingList(socket, data)
    })
    socket.on('gameoveraction', (data) => {
        console.log('gameoveraction', data)
        liveGames.games[data.gameid].sockets.forEach(sock => {
            sock.emit('opponentgameoveraction', data)
        })
    })
    socket.on('playmove', data => {
        let gameId = data.gameid;
        let playerId = data.playerid;
        let move = data.move;
        let game = liveGames.games[gameId]
        game[playerId].moves.push(move);
        console.log(gameId)
        console.log(game)
        // return
        if (game.batting === playerId){
            game[playerId].score += move;
        }
        console.log(playerId, game[playerId])
        if (game[playerId].moves.length === game[(playerId + 1) % 2].moves.length){
            console.log('a')
            // console.log('move result', data)
            let moveresult = {0: game[0], 1: game[1]};
            if (game[playerId].moves[game[playerId].moves.length - 1] ===
                game[(playerId + 1) % 2].moves[game[(playerId + 1) % 2].moves.length - 1]){
                console.log('c')

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
                    console.log('draw',game[0].score, game[1].score)
                    game.sockets.forEach(sock => {
                        sock.emit('moveresult', moveresult)
                        sock.emit('gameover', {winner, draw})
                        gameOverClean(gameId);
                    })
                }else if (game.wicket >=1){
                    // one wicket gone
                    game[game.batting].score -= game[game.batting].moves[game[game.batting].moves.length - 1];
                    game.batting = (game.batting +1 ) % 2;
                    game.sockets.forEach(sock => {
                        sock.emit('moveresult', moveresult)
                        sock.emit('wicketgone', {batting: game.batting})
                        gameOverClean(gameId)
                    })
                }
            }
            else {
                console.log('d')
                // scored
                if (game.wicket >= 1
                    && game[game.batting].score > game[(game.batting + 1 ) % 2].score){
                    console.log('scored more')
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
                    console.log('e', game.sockets.length)
                    game.sockets.forEach(sock => {
                        console.log('sock', sock.id)
                        sock.emit('moveresult', moveresult)
                    })
                }

            }
        } else {
            console.log('a')
            game.sockets.forEach(sock => {
                console.log('opp chosed')
                sock.emit('opponentchosed', {playerid: playerId})
            })

        }
        console.log('end')
    })
    socket.on('choice', (data) => {
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
    });
    socket.on('disconnect', () => {
        console.log('user disconnected');
        incrementDecrementPlayerCount(false);
        removeFromWL(socket)
        removeFromLiveGame(socket)
        removeFromPlayerSockets(socket)
    });
}
function initListenersForOnline(socket){
    console.log(onlineUsers)
    onlineUsers.socketsidtouser[socket.id] = {
    }
    console.log(onlineUsers)
    socket.on('disconnect', () => {
        console.log('online user disconnected');
        incrementDecrementOnlineCount(false)
        delete onlineUsers.socketsidtouser[socket.id]
    });
    socket.on('customgame', (data) => {
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
            playername
        }
        oppuser.socket.emit('invite', {playername, playerid, inviteid})
    });
    socket.on('inviteresponse', (data) => {
        let action = data.action;
        let noftifyplayerid = data.notifyplayerid;
        let oppSock = onlineUsers.useridtosockets[noftifyplayerid].socket;
        if (action === 'accept'){
            oppSock.emit('inviteresponded', data)
        }else if (action === 'reject'){
            oppSock.emit('inviteresponded', data)
        }
    })
    socket.on('joinedinvite', (data) => {
        let inviteid = data.inviteid;
        let mygamesocket = playerSockets.sockets[data.mygamesocketid].socket
        let playerSocks1 = liveInvites[inviteid].gameSockets
        let playerSocks2 = mygamesocket;
        // player 1 is first player
        let player1Name = liveInvites[inviteid].playername;
        let player2Name = data.playername;
        console.log('ps', player1Name, player2Name)
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
        liveGames.playingSockets[playerSocks1.id] = gameid;
        liveGames.playingSockets[playerSocks2.id] = gameid;
    })
    socket.on('playerdata', (data) => {
        let playername = data.name;
        let uniqueid = data.uniqueid;
        let score = data.score;
        console.log('playername', playername, uniqueid);
        onlineUsers.socketsidtouser[socket.id].name = playername;
        onlineUsers.socketsidtouser[socket.id].uniqueid = uniqueid;
        onlineUsers.socketsidtouser[socket.id].score = score;
        onlineUsers.useridtosockets[uniqueid] = {socket, playername, score};
        // console.log(onlineUsers)
    });
    socket.on('getonlineplayers', () => {
        let users = []
        for (let sockid in onlineUsers.socketsidtouser){
            let user = onlineUsers.socketsidtouser[sockid]
            users.push(user)
        }
        // console.log(users);
        socket.emit('onlineplayers', users);
    });
}
function incrementDecrementOnlineCount(increment){
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
}

module.exports = function (io_) {
    console.log('initialised socket io')
    io = io_;
    io.of('/multiplayer').on('connection', (socket) => {
        console.log('a user connectez', socket.id);
        initListeners(socket);
        incrementDecrementPlayerCount(true);
    });
    io.of('/online').on('connection', (socket) => {
        console.log('a user connected');
        initListenersForOnline(socket);
        incrementDecrementOnlineCount(true);
    });
}

