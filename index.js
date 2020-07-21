const PORT = process.env.PORT || 3000;
var express = require('express')
var app = require('express')();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var cors = require('cors')
var bodyParser = require('body-parser')
var corsOptions = {
    origin: [
        'capacitor://localhost',
        'ionic://localhost',
        'http://localhost',
        'http://localhost:8080',
        'http://localhost:8100',
        'http://localhost:8101',
        'http://localhost:3000',
        // 'https://bingo5x5.herokuapp.com',
        // 'https://bingo5x5-2.herokuapp.com'
    ],

    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}
app.use(cors(corsOptions))
app.use(bodyParser.json())
app.use(express.static('public'))
var socket = require('./endpoints/gameplay')
socket(io)
var scoreboard = require('./endpoints/scoreboard')
var users = require('./endpoints/users')

app.get('/', (req, res) => {
    res.send({
        status: "ok"
    })
});

app.use('/scoreboard', scoreboard);
app.use('/users', users);


http.listen(PORT, () => {
    console.log('listening on http://localhost:3000');
});
