var express = require('express')
var router = express.Router()
var MongoClient = require('mongodb').MongoClient;
var url = "mongodb+srv://dbUser:PeKJbo9j9PTMLKYk@cluster0.l7sqz.mongodb.net?retryWrites=true&w=majority";
var dBName = 'UserDataBase';

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
// define the home page route
router.post('', function (req, res) {
    try{
        let uniqueid = req.body.uniqueid;
        var dbo = mongoClient.db(dBName);
        var mysort = { score: -1 };
        dbo.collection("users").find().sort(mysort).limit(200).toArray(function(err, result) {
            if (err){
                res.send({status: 201})
            }else {
                res.send({status: 200, result})
            }
            console.log(result);
        });
    }catch(e){
        console.log(e)
    }
})

router.post('/myrank', (req, res) => {
    try{
        let id = req.body.uniqueid;
        const db = mongoClient.db(dBName);
        db.collection('users').find().sort({score: -1}).toArray((err, result) => {
            if (err){
                console.log(err);
                res.send({ranks: 0});
                return
            }
            console.log('calculating myrank');
            let ranks = 0;
            for (const i of result){
                ranks ++;
                if (i._id.toString() === id){
                    break;
                }
            }
            console.log('my rank', ranks);
            res.send({ranks: ranks, status: 200});
        })
    }catch(e){
        console.log(e)
    }

});
// define the about route


module.exports = router
