const { Client } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./utils/formatter')
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({ extended:true }));

const SESSION_FILE_PATH = './session.json';
let sessionCfg;
if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
}

app.get('/', (req, res) => {
    res.sendFile('index.html', { 
        root: __dirname 
    });
})

const client = new Client({ 
    puppeteer: { 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- this one doesn't works in Windows
            '--disable-gpu'
        ],
        headless: true 
    }, 
    session: sessionCfg 
});

const checkRegisteredNumber = (number) => {
    const isRegistered = client.isRegisteredUser(number);

    return isRegistered;
}

app.post('/sendMessage', [
    body('number').notEmpty(),
    body('message').notEmpty(),
] ,(req, res) => {
    const errors = validationResult(req).formatWith(({
        msg
    }) => {
        return msg;
    });

    if(!errors.isEmpty()){
        return res.status(422).json({
            success: false,
            message: errors.mapped()
        })
    }

    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;

    const isRegisteredNumber = checkRegisteredNumber(number)

    if(!isRegisteredNumber){
        return res.status(422).json({
            success: false,
            message: 'Number not registered'
        })
    }

    client.sendMessage(number, message).then(response => {
        res.status(201).json({
            success: true,
            message: response
        })
    }).catch(error => {
        res.status(500).json({
            success: false,
            message: error
        })
    }); 
});


client.on('message', msg => {
    if (msg.body == '!ping') {
        msg.reply('pong');
    }
});


client.initialize();

// Socket.io
io.on('connection', (socket) => {
    socket.emit('message', 'Connecting....')

    client.on('qr', (qr) => {
        // Generate and scan this code with your phone
        console.log('QR RECEIVED', qr);
        qrcode.toDataURL(qr, (err, url) => {
            socket.emit('qr', url);
            socket.emit('message', 'QR Code Received!')
        })
    });

    client.on('ready', () => {
        socket.emit('ready', 'Client is ready!')
        socket.emit('message', 'Client is ready!')
    });

    client.on('authenticated', (session) => {
        socket.emit('authenticated', 'Client is authenticated!')
        socket.emit('message', 'Client is authenticated!')
        console.log('AUTHENTICATED', session);
        sessionCfg=session;
        fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
            if (err) {
                console.error(err);
            }
        });
    });
    
})

server.listen(port, () => {
    console.log('App Running On port ' + port);
})