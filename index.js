var app = require('express')();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var cors = require('cors')
var bodyParser = require('body-parser')
var corsOptions = {
    origin: ['http://localhost:8100', ],
    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}
app.use(cors(corsOptions))
app.use(bodyParser.json())
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


http.listen(3000, () => {
    console.log('listening on http://localhost:3000');
});
