const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const http = require('http');
const os = require('os');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();

// --- MIDDLEWARE ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'inventory-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 Hour
}));

// --- CONFIGURATION ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: 'inventory_app',
    connectionLimit: 10
};

const pool = mysql.createPool(dbConfig);

// --- METADATA (EC2 Instance Tracking) ---
let instanceId = 'Loading...';
let availabilityZone = 'Unknown';

function getEc2Metadata(path, callback) {
    const options = { hostname: '169.254.169.254', port: 80, path: '/latest/meta-data/' + path, method: 'GET', timeout: 1000 };
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

// --- MAIN UI ROUTE ---
app.get('/', (req, res) => {
    const user = req.session.user;

    // Fetch comments with user details for the display
    const commentQuery = `
        SELECT c.content, u.username, c.created_at 
        FROM comments c 
        JOIN users u ON c.user_id = u.id 
        ORDER BY c.created_at DESC LIMIT 10`;

    pool.query(commentQuery, (err, comments) => {
        res.send(`
        <html>
            <head>
                <title>Monolith Dashboard</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; padding: 20px; max-width: 900px; margin: auto; background: #f0f2f5; }
                    .server-info { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; text-align: center; margin-bottom: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
                    .box { background: white; padding: 20px; margin-bottom: 20px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                    .auth-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                    input, select { padding: 10px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 10px; }
                    button { cursor: pointer; padding: 10px 15px; border: none; border-radius: 6px; font-weight: bold; color: white; background: #3498db; }
                    .success { background: #2ecc71; }
                    .danger { background: #e74c3c; }
                    .comment-item { border-bottom: 1px solid #eee; padding: 10px 0; }
                    .username { font-weight: bold; color: #764ba2; }
                    iframe { width: 100%; height: 300px; border: none; background: #fafafa; border-radius: 8px; }
                </style>
            </head>
            <body>
                <div class="server-info">
                    <h1>Cloud Inventory Monolith 🚀</h1>
                    <p>Serving from: <strong>${instanceId}</strong> (${availabilityZone})</p>
                </div>

                <div class="box">
                    ${!user ? `
                        <h2>🔐 User Access</h2>
                        <div class="auth-grid">
                            <form action="/register" method="POST">
                                <h3>Register</h3>
                                <input type="text" name="username" placeholder="New Username" required><br>
                                <input type="password" name="password" placeholder="New Password" required><br>
                                <button class="success">Create Account</button>
                            </form>
                            <form action="/login" method="POST">
                                <h3>Login</h3>
                                <input type="text" name="username" placeholder="Username" required><br>
                                <input type="password" name="password" placeholder="Password" required><br>
                                <button>Sign In</button>
                            </form>
                        </div>
                    ` : `
                        <h2>Welcome back, <span class="username">${user.username}</span>!</h2>
                        <a href="/logout"><button class="danger">Logout</button></a>
                    `}
                </div>

                <div class="box">
                    <h2>📦 Inventory Management</h2>
                    <form action="/insert" method="POST">
                        <input type="text" name="name" placeholder="Product Name" required>
                        <input type="number" name="price" placeholder="Price" step="0.01" required>
                        <button class="success">Add Item</button>
                    </form>
                    <iframe src="/view"></iframe>
                </div>

                <div class="box">
                    <h2>💬 Discussion Board</h2>
                    ${user ? `
                        <form action="/comment" method="POST">
                            <input type="text" name="content" placeholder="Share your thoughts..." style="width: 80%;" required>
                            <button>Post</button>
                        </form>
                    ` : `<p><i>Log in to participate in the discussion.</i></p>`}
                    
                    <div class="comments-list">
                        ${comments && comments.length > 0 ? comments.map(c => `
                            <div class="comment-item">
                                <span class="username">${c.username}</span>: ${c.content}
                                <br><small style="color:gray">${c.created_at}</small>
                            </div>
                        `).join('') : '<p>No comments yet.</p>'}
                    </div>
                </div>

                <div class="box">
                    <form action="/setup" method="POST"><button>Reset & Re-Initialize Database</button></form>
                </div>
            </body>
        </html>
        `);
    });
});

// --- DATABASE SETUP (Updated for Users and Comments) ---
app.post('/setup', (req, res) => {
    const tempCon = mysql.createConnection({ host: dbConfig.host, user: dbConfig.user, password: dbConfig.password });
    tempCon.connect(err => {
        if (err) return res.send("Connection Failed: " + err.message);
        tempCon.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`, (err) => {
            tempCon.changeUser({ database: dbConfig.database }, (err) => {
                const queries = [
                    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) UNIQUE, password_hash VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
                    `CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), price DECIMAL(10,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
                    `CREATE TABLE IF NOT EXISTS comments (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, content TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`
                ];
                
                queries.forEach(q => tempCon.query(q));
                setTimeout(() => { tempCon.end(); res.redirect('/'); }, 1000);
            });
        });
    });
});

// --- AUTH LOGIC ---
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], (err) => {
        if (err) return res.send("Error: User exists. <a href='/'>Back</a>");
        res.send("Registration Success! <a href='/'>Login now</a>");
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    pool.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
        if (results.length > 0) {
            const match = await bcrypt.compare(password, results[0].password_hash);
            if (match) {
                req.session.user = { id: results[0].id, username: results[0].username };
                return res.redirect('/');
            }
        }
        res.send("Invalid credentials. <a href='/'>Back</a>");
    });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- COMMENT LOGIC ---
app.post('/comment', (req, res) => {
    if (!req.session.user) return res.status(401).send("Unauthorized");
    pool.query('INSERT INTO comments (user_id, content) VALUES (?, ?)', [req.session.user.id, req.body.content], () => {
        res.redirect('/');
    });
});

// --- INVENTORY LOGIC ---
app.get('/view', (req, res) => {
    pool.query("SELECT * FROM products ORDER BY id DESC", (err, rows) => {
        if (err) return res.send("Run Setup First.");
        let html = '<style>body{font-family:sans-serif; font-size:14px;} table{width:100%; border-collapse:collapse;} td,th{padding:8px; border-bottom:1px solid #ddd;}</style><table><tr><th>ID</th><th>Item</th><th>Price</th></tr>';
        rows.forEach(r => html += `<tr><td>${r.id}</td><td>${r.name}</td><td>$${r.price}</td></tr>`);
        res.send(html + '</table>');
    });
});

app.post('/insert', (req, res) => {
    pool.query('INSERT INTO products (name, price) VALUES (?, ?)', [req.body.name, req.body.price], () => res.redirect('/'));
});

app.listen(3000, () => console.log('Monolith online on port 3000'));
