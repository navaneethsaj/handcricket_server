const AsyncLock = require('async-lock');
const randomstring = require('randomstring')
let counterLock = new AsyncLock();
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
function checkAndAddToWaitingList(socket, data) {
    // console.log('waiting', liveGames.waiting.length)
    if (liveGames.waiting.includes(socket)){
        console.log('already in WL')
        socket.emit('errormsg', ({status: 100, msg: 'player already in WL'}))
        return
    }
    waitingListLock.acquire("key", (done) => {
        if (liveGames.waiting.length > 0){
            let waitingMan = liveGames.waiting.shift();
            let waitingManName = playerSockets[waitingMan].name;
            console.log('1', waitingManName)
            done(false, {socket: waitingMan, waitingManName: waitingManName})
        }else {
            console.log('2', data.name, )
            liveGames.waiting.push(socket);
            playerSockets[socket] = {name: data.name};
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
            liveGames.playingSockets[socket] = gameid;
            liveGames.playingSockets[socket] = gameid;
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
    delete playerSockets[socket]
}

function gameOverClean() {

}
function initListeners(socket){
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
        if (game.batting === playerId){
            game[playerId].score += move;
        }
        console.log(playerId, game[playerId])
        if (game[playerId].moves.length === game[(playerId + 1) % 2].moves.length){
            console.log('move result')
            let moveresult = {0: game[0], 1: game[1]};
            if (game[playerId].moves[game[playerId].moves.length - 1] ===
                game[(playerId + 1) % 2].moves[game[(playerId + 1) % 2].moves.length - 1]){
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
                    game.sockets.forEach(sock => {
                        sock.emit('moveresult', moveresult)
                    })
                }

            }
        } else {
            game.sockets.forEach(sock => {
                console.log('opp chosed')
                sock.emit('opponentchosed', {playerid: playerId})
            })

        }

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
module.exports = function (io_) {
    console.log('initialised socket io')
    io = io_;
    io.on('connection', (socket) => {
        console.log('a user connected');
        initListeners(socket);
        incrementDecrementPlayerCount(true);
    });
}

