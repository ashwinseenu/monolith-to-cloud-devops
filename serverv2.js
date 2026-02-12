const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const http = require('http');
const os = require('os');
const session = require('express-session');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

/* ---------------- SESSION ---------------- */
app.use(session({
    secret: 'enterprise-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 60 * 60 * 1000 }
}));

/* ---------------- DB CONFIG ---------------- */
const baseConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'password',
    multipleStatements: true
};

let userPool, inventoryPool;

/* ---------------- GEO ---------------- */
async function getGeoLocation(ip) {
    return new Promise(resolve => {
        const qip = (ip === '::1' || ip === '127.0.0.1') ? '' : ip;
        http.get(`http://ip-api.com/json/${qip}`, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', () => resolve({ city: 'Unknown', country: 'Unknown' }));
    });
}

/* ---------------- INIT ---------------- */
async function initSystem() {
    const conn = await mysql.createConnection(baseConfig);
    await conn.query(`CREATE DATABASE IF NOT EXISTS users`);
    await conn.query(`CREATE DATABASE IF NOT EXISTS inventory_app`);

    userPool = mysql.createPool({ ...baseConfig, database: 'users' });
    inventoryPool = mysql.createPool({ ...baseConfig, database: 'inventory_app' });

    await userPool.query(`
        CREATE TABLE IF NOT EXISTS passwords (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE,
            password VARCHAR(255),
            last_login_ip VARCHAR(100),
            location VARCHAR(255)
        )
    `);

    await userPool.query(`
        CREATE TABLE IF NOT EXISTS login_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            ip VARCHAR(100),
            location VARCHAR(255),
            device TEXT,
            logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await inventoryPool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            name VARCHAR(255),
            price DECIMAL(10,2)
        )
    `);

    await inventoryPool.query(`
        CREATE TABLE IF NOT EXISTS comments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50),
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await userPool.query(
        `INSERT IGNORE INTO passwords (username,password) VALUES ('admin','admin')`
    );

    console.log('🚀 Databases Ready');
}
initSystem();

/* ---------------- AUTH MIDDLEWARE ---------------- */
const requireLogin = (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.username !== 'admin')
        return res.redirect('/');
    next();
};

/* ---------------- UI STYLES (UNCHANGED) ---------------- */
const uiStyles = `
<style>
body { font-family: 'Segoe UI', sans-serif; padding:20px; max-width:1200px; margin:auto; background:#f0f2f5; }
.server-info { background:#1a1a1a; color:#00ff00; padding:15px; border-radius:8px; margin-bottom:20px; font-family:monospace; }
.box { background:white; padding:20px; margin-bottom:20px; border-radius:10px; box-shadow:0 4px 6px rgba(0,0,0,.05); }
.admin-view { border-top:5px solid #ff4757; }
.stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:15px; }
.stat-card { background:white; padding:15px; border-radius:8px; border:1px solid #ddd; text-align:center; }
table { width:100%; border-collapse:collapse; margin-top:10px; }
th,td { padding:12px; border-bottom:1px solid #eee; }
.btn { padding:10px 15px; border:none; border-radius:5px; font-weight:bold; background:#3742fa; color:white; cursor:pointer; }
.btn-red { background:#ff4757; }
.btn-green { background:#2ed573; }
input { width:100%; padding:10px; border:1px solid #ddd; border-radius:5px; margin-bottom:10px; }
</style>
`;

/* ---------------- HOME ---------------- */
app.get('/', async (req, res) => {
    const currentUser = req.session.user;

    if (!currentUser) {
        return res.send(`<html><head>${uiStyles}</head><body>
        <div class="server-info">System Status: Online | Auto-Init: Active</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
            <div class="box">
                <h2>Sign Up</h2>
                <form action="/signup" method="POST">
                    <input name="username" placeholder="Username">
                    <input type="password" name="password" placeholder="Password">
                    <button class="btn btn-green">Register</button>
                </form>
            </div>
            <div class="box">
                <h2>Login</h2>
                <form action="/login" method="POST">
                    <input name="username" placeholder="Username">
                    <input type="password" name="password" placeholder="Password">
                    <button class="btn">Sign In</button>
                </form>
            </div>
        </div></body></html>`);
    }

    if (currentUser.username === 'admin') return res.redirect('/admin');

    const [prods] = await inventoryPool.query(
        'SELECT * FROM products WHERE user_id=?', [currentUser.id]
    );

    const prodRows = prods.map(p =>
        `<tr><td>${p.name}</td><td>$${p.price}</td></tr>`
    ).join('');

    res.send(`<html><head>${uiStyles}</head><body>
        <div class="box" style="display:flex; justify-content:space-between;">
            <div>Logged in as <b>${currentUser.username}</b><br>
            <small>${currentUser.ip} (${currentUser.location})</small></div>
            <form action="/logout" method="POST"><button class="btn btn-red">Logout</button></form>
        </div>

        <div class="stats-grid">
            <div class="stat-card"><h3>My Items</h3><p>${prods.length}</p></div>
            <div class="stat-card"><h3>Total Value</h3>
            <p>$${prods.reduce((s,p)=>s+Number(p.price),0).toFixed(2)}</p></div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
            <div class="box">
                <h2>Add Inventory</h2>
                <form action="/insert-product" method="POST">
                    <input name="name" placeholder="Item Name">
                    <input name="price" placeholder="Price">
                    <button class="btn btn-green">Add</button>
                </form>
                <table><tr><th>Item</th><th>Price</th></tr>${prodRows}</table>
            </div>
            <div class="box">
                <h2>Public Forum</h2>
                <form action="/post-comment" method="POST">
                    <input name="content" placeholder="Share something...">
                    <button class="btn" style="width:100%">Post</button>
                </form>
                <iframe src="/view-comments" style="width:100%;height:300px;border:none"></iframe>
            </div>
        </div></body></html>`);
});

/* ---------------- ADMIN ---------------- */
app.get('/admin', requireAdmin, async (req, res) => {
    const [users] = await userPool.query(`SELECT * FROM passwords`);

    const [allProds] = await inventoryPool.query(`
        SELECT p.id,p.name,p.price,u.username
        FROM products p
        JOIN users.passwords u ON p.user_id=u.id
    `);

    const [logins] = await userPool.query(`
        SELECT p.username,l.ip,l.location,l.device,l.logged_at
        FROM login_history l
        JOIN passwords p ON p.id=l.user_id
        ORDER BY l.logged_at DESC
    `);

    res.send(`<html><head>${uiStyles}</head><body>
        <div class="server-info">[ADMIN CONSOLE]</div>

        <div class="box admin-view">
            <h2>Users</h2>
            <table>
                <tr><th>User</th><th>IP</th><th>Location</th></tr>
                ${users.map(u=>`<tr><td>${u.username}</td><td>${u.last_login_ip||''}</td><td>${u.location||''}</td></tr>`).join('')}
            </table>
        </div>

        <div class="box admin-view">
            <h2>Global Inventory</h2>
            <table>
                <tr><th>User</th><th>Item</th><th>Price</th></tr>
                ${allProds.map(p=>`<tr><td>${p.username}</td><td>${p.name}</td><td>$${p.price}</td></tr>`).join('')}
            </table>
        </div>

        <div class="box admin-view">
            <h2>Login History</h2>
            <table>
                <tr><th>User</th><th>IP</th><th>Location</th><th>Device</th><th>Time</th></tr>
                ${logins.map(l=>`<tr><td>${l.username}</td><td>${l.ip}</td><td>${l.location}</td><td>${l.device}</td><td>${l.logged_at}</td></tr>`).join('')}
            </table>
        </div>

        <form action="/logout" method="POST"><button class="btn btn-red">Logout</button></form>
    </body></html>`);
});

/* ---------------- AUTH ---------------- */
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const [r] = await userPool.query(
        'SELECT * FROM passwords WHERE username=? AND password=?',
        [username, password]
    );
    if (!r.length) return res.send('Invalid Login');

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const geo = await getGeoLocation(ip);
    const location = `${geo.city}, ${geo.country}`;
    const device = req.headers['user-agent'];

    await userPool.query(
        'UPDATE passwords SET last_login_ip=?,location=? WHERE id=?',
        [ip, location, r[0].id]
    );

    await userPool.query(
        'INSERT INTO login_history (user_id,ip,location,device) VALUES (?,?,?,?)',
        [r[0].id, ip, location, device]
    );

    req.session.user = { id:r[0].id, username:r[0].username, ip, location };
    res.redirect('/');
});

app.post('/signup', async (req, res) => {
    await userPool.query(
        'INSERT INTO passwords (username,password) VALUES (?,?)',
        [req.body.username, req.body.password]
    );
    res.redirect('/');
});

app.post('/logout', (req,res)=>{
    req.session.destroy(()=>res.redirect('/'));
});

/* ---------------- ACTIONS ---------------- */
app.post('/insert-product', requireLogin, async (req,res)=>{
    await inventoryPool.query(
        'INSERT INTO products (user_id,name,price) VALUES (?,?,?)',
        [req.session.user.id, req.body.name, req.body.price]
    );
    res.redirect('/');
});

app.post('/post-comment', requireLogin, async (req,res)=>{
    await inventoryPool.query(
        'INSERT INTO comments (username,content) VALUES (?,?)',
        [req.session.user.username, req.body.content]
    );
    res.redirect('/');
});

app.get('/view-comments', async (req,res)=>{
    const [rows]=await inventoryPool.query('SELECT * FROM comments ORDER BY created_at DESC');
    res.send(rows.map(r=>`<b>@${r.username}</b>: ${r.content}<br>`).join(''));
});

/* ---------------- START ---------------- */
app.listen(3000, ()=>console.log('🚀 Running on port 3000'));
