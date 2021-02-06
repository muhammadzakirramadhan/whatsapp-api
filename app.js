const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const fileupload = require('express-fileupload');
const axios = require('axios')

const { phoneNumberFormatter } = require('./utils/formatter');
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({ 
    extended:true
 }));
app.use(fileupload({
    debug: true
}))

const SESSION_FILE_PATH = './session.json';

let sessionCfg;
if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
}

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

const checkRegisteredNumber = async (number) => {
    const isRegistered = await client.isRegisteredUser(number);

    return isRegistered;
}

app.get('/', (req, res) => {
    res.sendFile('home.html', { 
        root: __dirname 
    });
})

app.get('/updateMessage', async (req, res) => {
    await client.on('message', async msg => {
        res.status(201).json({
            success:true ,
            message: msg
        })
    });
})

// Send Message
app.post('/sendMessage', [
    body('number').notEmpty(),
    body('message').notEmpty(),
] , async (req, res) => {
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

    const isRegisteredNumber = await checkRegisteredNumber(number)

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

// Send Media
app.post('/sendMedia',  (req, res) => {

    const number = phoneNumberFormatter(req.body.number);
    const caption = req.body.caption;
    // const media = MessageMedia.fromFilePath('./haru.jpg')
    const file = req.files.file;
    const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name)

    client.sendMessage(number, media, { caption: caption }).then(response => {
        res.status(201).json({
            success: true,
            message: response
        });
    }).catch(error => {
        res.status(500).json({
            success: false,
            message: error
        })
    }); 
});

app.post('/sendMediaUrl',  async (req, res) => {

    const number = phoneNumberFormatter(req.body.number);
    const caption = req.body.caption;
    const fileUrl = req.body.file;

    // const media = MessageMedia.fromFilePath('./haru.jpg')
    // const file = req.files.file;
    // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name)
    let mimetype;
    const attachment = await axios.get(fileUrl, { responseType: 'arraybuffer' }).then(response => {
        mimetype = response.headers['content-type'];
        return response.data.toString('base64');
    })

    const media = new MessageMedia(mimetype, attachment, 'Media');

    client.sendMessage(number, media, { caption: caption }).then(response => {
        res.status(201).json({
            success: true,
            message: response
        });
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