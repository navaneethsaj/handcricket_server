var express = require('express')
var router = express.Router()
var MongoClient = require('mongodb').MongoClient;
var url = "mongodb+srv://dbUser:PeKJbo9j9PTMLKYk@cluster0.l7sqz.mongodb.net?retryWrites=true&w=majority";
var dBName = 'UserDataBase';
var ObjectId = require('mongodb').ObjectID;

var mongoClient;

MongoClient.connect(url, { useUnifiedTopology: true }, function(err, client) {
    if (err) throw err;
    mongoClient = client
    console.log("DataBase Connected!");
});

// middleware that is specific to this router
router.use(function timeLog (req, res, next) {
    console.log('Time: ', Date.now())
    next()
})

router.post('/register', function (req, res) {
    let body = req.body;
    let name = body.name;
    let email = body.email;
    let score = Number(body.score) || 0;

    let db = mongoClient.db(dBName);
    let myObj = { name, email, score};
    db.collection("users").insertOne(myObj, function(err, data) {
        if (err || data === null){
            res.send({status: 201})
        }else {
            res.send({status: 200, data})
            console.log("1 document inserted");
        }
    });
})

router.post('/updatescore', function (req, res) {
    let body = req.body;
    let uniqueid = ObjectId(body.uniqueid);
    let score = body.score;

    var dbo = mongoClient.db(dBName);
    var myquery = {_id: uniqueid};
    var newvalues = { $set: {score} };
    dbo.collection("users").updateOne(myquery, newvalues, function(err, data) {
        if (err) {
            res.send({'status': 201})
            return
        }
        if (data.matchedCount > 0){
            res.send({'status': 200})
        }else {
            res.send({'status': 202})
        }
    });
})

module.exports = router
