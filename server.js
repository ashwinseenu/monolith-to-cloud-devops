const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const http = require('http');
const os = require('os');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const crypto = require('crypto');

const app = express();

// --- CONFIGURATION & ENV VARS ---
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: 'inventory_app',
    connectionLimit: 10
};

const pool = mysql.createPool(dbConfig);

// --- PERSISTENT SESSION STORE ---
// This allows sessions to survive server restarts/auto-scaling events
const sessionStore = new MySQLStore({
    createDatabaseTable: true,
    schema: { tableName: 'sessions' }
}, pool);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
    key: 'inventory_session',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 3600000, // 1 hour
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
    }
}));

// --- EC2 METADATA TRACKING ---
let instanceId = 'Loading...';
let availabilityZone = 'Unknown';

function getEc2Metadata(path, callback) {
    const options = { hostname: '169.254.169.254', port: 80, path: '/latest/meta-data/' + path, method: 'GET', timeout: 800 };
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { callback(data); });
    });
    req.on('error', () => { callback(null); });
    req.end();
}
getEc2Metadata('instance-id', (id) => { instanceId = id || os.hostname(); });
getEc2Metadata('placement/availability-zone', (az) => { availabilityZone = az || 'Local'; });

// --- SECURITY & VALIDATION HELPERS ---
const sanitize = (str) => str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.status(401).send('<h2>🔒 Unauthorized</h2><a href="/">Back to Login</a>');
    next();
};

// --- ROUTES ---

// 1. Dashboard UI
app.get('/', (req, res) => {
    const user = req.session.user;
    const msg = req.query.msg || '';
    
    const commentQuery = `SELECT c.content, u.username, c.created_at FROM comments c 
                          JOIN users u ON c.user_id = u.id ORDER BY c.created_at DESC LIMIT 5`;

    pool.query(commentQuery, (err, comments) => {
        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Inventory Cloud Monolith</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; padding: 20px; color: #333; }
                .container { max-width: 900px; margin: auto; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 15px; text-align: center; box-shadow: 0 10px 20px rgba(0,0,0,0.1); margin-bottom: 25px; }
                .card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 20px; }
                .btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; }
                .btn-primary { background: #667eea; color: white; }
                .btn-danger { background: #ff4b2b; color: white; }
                input { padding: 12px; border: 1px solid #ddd; border-radius: 6px; width: 100%; margin-bottom: 10px; box-sizing: border-box; }
                .comment { border-left: 4px solid #764ba2; background: #f9f9f9; padding: 10px; margin-bottom: 10px; border-radius: 0 6px 6px 0; }
                iframe { width: 100%; height: 300px; border: none; border-radius: 8px; background: #fff; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Inventory Platform v2.0 🚀</h1>
                    <p>Node: <strong>${instanceId}</strong> | Zone: <strong>${availabilityZone}</strong></p>
                    ${user ? `<p>Welcome, <strong>${user.username}</strong> | <a href="/logout" style="color:white">Logout</a></p>` : ''}
                </div>

                ${msg ? `<div style="background:#d4edda; color:#155724; padding:15px; border-radius:8px; margin-bottom:20px;">${sanitize(msg)}</div>` : ''}

                <div class="card">
                    ${!user ? `
                        <h3>🔐 Secure Access</h3>
                        <div style="display:flex; gap:20px;">
                            <form action="/register" method="POST" style="flex:1;">
                                <input type="text" name="username" placeholder="New Username" required>
                                <input type="password" name="password" placeholder="New Password" required>
                                <button class="btn btn-primary" style="width:100%">Create Account</button>
                            </form>
                            <form action="/login" method="POST" style="flex:1;">
                                <input type="text" name="username" placeholder="Username" required>
                                <input type="password" name="password" placeholder="Password" required>
                                <button class="btn btn-primary" style="width:100%; background:#764ba2">Login</button>
                            </form>
                        </div>
                    ` : `
                        <h3>📦 Add to Inventory</h3>
                        <form action="/insert" method="POST" style="display:flex; gap:10px;">
                            <input type="text" name="name" placeholder="Item Name" required>
                            <input type="number" name="price" placeholder="Price" step="0.01" required style="width:150px">
                            <button class="btn btn-primary">Add</button>
                        </form>
                        <iframe src="/view" style="margin-top:20px;"></iframe>
                    `}
                </div>

                <div class="card">
                    <h3>💬 Community Activity</h3>
                    ${user ? `
                        <form action="/comment" method="POST" style="margin-bottom:20px;">
                            <input type="text" name="content" placeholder="Write a comment..." required>
                            <button class="btn btn-primary">Post</button>
                        </form>
                    ` : '<p><i>Login to post comments</i></p>'}
                    
                    <div class="comments-list">
                        ${comments ? comments.map(c => `
                            <div class="comment">
                                <strong>${sanitize(c.username)}</strong>: ${sanitize(c.content)}
                                <br><small style="color:#888">${new Date(c.created_at).toLocaleString()}</small>
                            </div>
                        `).join('') : 'No comments yet.'}
                    </div>
                </div>

                <form action="/setup" method="POST" style="text-align:center;">
                    <button class="btn" style="background:#999; color:white">Initialize Database</button>
                </form>
            </div>
        </body>
        </html>
        `);
    });
});

// 2. Auth Endpoints
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hash = await bcrypt.hash(password, 12);
    pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], (err) => {
        if (err) return res.redirect('/?msg=Username taken');
        res.redirect('/?msg=Account created! Please login.');
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    pool.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
        if (results.length > 0 && await bcrypt.compare(password, results[0].password_hash)) {
            req.session.user = { id: results[0].id, username: results[0].username };
            return res.redirect('/');
        }
        res.redirect('/?msg=Invalid credentials');
    });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// 3. Application Endpoints
app.post('/comment', requireAuth, (req, res) => {
    pool.query('INSERT INTO comments (user_id, content) VALUES (?, ?)', [req.session.user.id, req.body.content], () => {
        res.redirect('/?msg=Comment posted!');
    });
});

app.get('/view', (req, res) => {
    pool.query("SELECT * FROM products ORDER BY id DESC", (err, rows) => {
        if (err) return res.send("DB Error. Run Setup.");
        let html = '<style>body{font-family:sans-serif; margin:0;} table{width:100%; border-collapse:collapse;} td,th{padding:12px; border-bottom:1px solid #eee; text-align:left;}</style><table><tr><th>Item</th><th>Price</th></tr>';
        rows.forEach(r => html += `<tr><td>${sanitize(r.name)}</td><td>$${r.price}</td></tr>`);
        res.send(html + '</table>');
    });
});

app.post('/insert', requireAuth, (req, res) => {
    pool.query('INSERT INTO products (name, price) VALUES (?, ?)', [req.body.name, req.body.price], () => res.redirect('/'));
});

// 4. Initialization
app.post('/setup', (req, res) => {
    const queries = [
        `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) UNIQUE, password_hash VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), price DECIMAL(10,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS comments (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, content TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`
    ];
    queries.forEach(q => pool.query(q));
    res.redirect('/?msg=Tables initialized');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Monolith v2 running on port ${PORT}`));
