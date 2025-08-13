const express = require('express');
const http = require('http');
const { Server } = require('socket.io'); 
const cors = require('cors');
const passport = require('passport');
const session = require('express-session');
const authRoutes = require('./routes/GauthRoutes');  
const connectDB = require('./config/db');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const headRoutes = require('./routes/headRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const bodyParser = require('body-parser');
const { assign } = require('nodemailer/lib/shared');
const AssignmentReminderService = require('./services/assignmentReminderService');
require('./config/passport');   
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
    cors({
      origin: "http://localhost:5173", 
      methods: "GET,POST,PUT,PATCH,DELETE", 
      credentials: true,             
    })
  );

// we need to create an HTTP server instance to bind with Socket.IO
const server = http.createServer(app);
app.use('/uploads', express.static('uploads'));

const io = new Server(server, {
    cors: {
        origin: '*', 
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
});

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());


app.use(authRoutes);


connectDB();


app.use(express.json());


io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

   
    socket.on('message', (data) => {
        console.log(`Message received: ${data}`);
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// Routes
app.use('/api/users', userRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/heads', headRoutes);
app.use('/api/assignments', assignmentRoutes);

app.get('/', (req, res) => {
    res.json({ 
        message: 'WorkQueue Backend API is running!',
        status: 'success',
        version: '1.0.0'
    });
});

app.get('/', (req, res) => {
    res.json({ message: 'Backend is running successfully!' });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.set('io', io); // with this we can use app.get('io') to access it in other files

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    
    
    AssignmentReminderService.initializeReminderScheduler();
    console.log('🔔 Assignment deadline reminder system activated');
});