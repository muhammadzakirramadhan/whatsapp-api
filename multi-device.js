const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const axios = require('axios')

const { phoneNumberFormatter } = require('./utils/formatter');
const { json } = require('express');
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({ 
    extended:true
 }));

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const setSessionsFile = (sessions) => {
    fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), (err) => {
        if(err){
            console.log(err)
        }
    })
}

const getSessionsFile = () => {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE))
}

const createSession = (id, description) => {
    console.log('Create sessions : ' + id);
    const SESSION_FILE_PATH = `./whatsapp-session-${id}.json`;
    let sessionCfg;
    if (fs.existsSync(SESSION_FILE_PATH)) {
        sessionCfg = require(SESSION_FILE_PATH);
    }

    const client = new Client({
        restartOnAuthFail: true,
        puppeteer: {
        headless: true,
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
        },
        session: sessionCfg
    });

    client.initialize();

    client.on('qr', (qr) => {
        // Generate and scan this code with your phone
        console.log('QR RECEIVED', qr);
        qrcode.toDataURL(qr, (err, url) => {
            console.log('QR RECEIVED', url);
            io.emit('qr', { 
                id: id, 
                src: url 
            });
            io.emit('message', { id: id, text: 'QR Code received, scan please!' });
        })
    });

    client.on('ready', () => {
        io.emit('ready', {
            id:id
        });

        io.emit('message', {
            id:id,
            text:'WhatsApp Ready!'
        });

        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id = id);
        savedSessions[sessionIndex].ready = true;
        setSessionsFile(savedSessions);
    });

    client.on('authenticated', (session) => {
        io.emit('authenticated', {
            id:id
        });

        io.emit('message',  {
            id:id,
            text:'Client is authenticated!'
        });

        console.log('AUTHENTICATED', session);
        sessionCfg=session;
        fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
            if (err) {
                console.error(err);
            }
        });
    });

    client.on('auth_failure', function(session) {
        io.emit('message', { id: id, text: 'Auth failure, restarting...' });
    });
    
    client.on('disconnected', (reason) => {
        io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
        fs.unlinkSync(SESSION_FILE_PATH, function(err) {
            if(err) return console.log(err);
            console.log('Session file deleted!');
        });

        client.destroy();
        client.initialize();
    
        // Menghapus pada file sessions
        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
        savedSessions.splice(sessionIndex, 1);
        setSessionsFile(savedSessions);
    
        io.emit('remove-session', id);
    });

    sessions.push({
        id:id,
        description:description,
        client:client
    });

    const savedSessions = getSessionsFile()
    const sessionsIndex = savedSessions.findIndex(sess => sess.id = id)

    if(sessionsIndex == -1){
        savedSessions.push({
            id:id,
            description:description,
            ready:false
        });

        setSessionsFile(savedSessions);
    }
} 

app.get('/', (req, res) => {
    res.sendFile('index.html', { 
        root: __dirname 
    });
})

// Send Message
app.post('/sendMessage', (req, res) => {
    const sender = req.body.sender;
    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;
    
    const client = sessions.find(sess => sess.id == sender).client;
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

const init = (socket) => {
    const savedSessions = getSessionsFile();

    if(savedSessions.length > 0){
        if(socket){
            socket.emit('init', savedSessions);
        } else {
            savedSessions.forEach(sess => {
                createSession(sess.id, sess.description)
            });
        }
    }
}

// Socket.io
io.on('connection', (socket) => {
    init(socket)
    socket.on('create-session', (data) => {
        console.log(data)
        createSession(data.id, data.description);
    })
})
// io.on('connection', (socket) => {
//     socket.emit('message', 'Connecting....')

//     client.on('qr', (qr) => {
//         // Generate and scan this code with your phone
//         console.log('QR RECEIVED', qr);
//         qrcode.toDataURL(qr, (err, url) => {
//             socket.emit('qr', url);
//             socket.emit('message', 'QR Code Received!')
//         })
//     });

//     client.on('ready', () => {
//         socket.emit('ready', 'Client is ready!')
//         socket.emit('message', 'Client is ready!')
//     });

//     client.on('authenticated', (session) => {
//         socket.emit('authenticated', 'Client is authenticated!')
//         socket.emit('message', 'Client is authenticated!')
//         console.log('AUTHENTICATED', session);
//         sessionCfg=session;
//         fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
//             if (err) {
//                 console.error(err);
//             }
//         });
//     });
    
// })

server.listen(port, () => {
    console.log('App Running On port ' + port);
})