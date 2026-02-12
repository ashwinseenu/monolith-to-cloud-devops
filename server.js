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

// --- MIDDLEWARE ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- CONFIGURATION ---
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: 'inventory_app',
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// --- SESSION STORE (Persistent Sessions in MySQL) ---
const sessionStore = new MySQLStore({
    createDatabaseTable: true,
    schema: {
        tableName: 'sessions',
        columnNames: {
            session_id: 'session_id',
            expires: 'expires',
            data: 'data'
        }
    }
}, pool);

// --- SESSION CONFIGURATION ---
app.use(session({
    key: 'inventory_session',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 3600000, // 1 hour
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'strict'
    }
}));

// --- METADATA (EC2 Instance Tracking) ---
let instanceId = 'Loading...';
let availabilityZone = 'Unknown';

function getEc2Metadata(path, callback) {
    const options = {
        hostname: '169.254.169.254',
        port: 80,
        path: '/latest/meta-data/' + path,
        method: 'GET',
        timeout: 1000
    };
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { callback(data); });
    });
    req.on('error', () => { callback(null); });
    req.on('timeout', () => { req.destroy(); callback(null); });
    req.end();
}

getEc2Metadata('instance-id', (id) => { instanceId = id || os.hostname(); });
getEc2Metadata('placement/availability-zone', (az) => { availabilityZone = az || 'Local'; });

// --- HELPER FUNCTIONS ---

// Input Validation
function validateUsername(username) {
    if (!username || username.length < 3 || username.length > 30) {
        return { valid: false, error: 'Username must be 3-30 characters' };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
    }
    return { valid: true };
}

function validateEmail(email) {
    if (!email || email.length > 100) {
        return { valid: false, error: 'Invalid email length' };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { valid: false, error: 'Invalid email format' };
    }
    return { valid: true };
}

function validatePassword(password) {
    if (!password || password.length < 6) {
        return { valid: false, error: 'Password must be at least 6 characters' };
    }
    if (password.length > 100) {
        return { valid: false, error: 'Password too long' };
    }
    return { valid: true };
}

function validateComment(content) {
    if (!content || content.trim().length === 0) {
        return { valid: false, error: 'Comment cannot be empty' };
    }
    if (content.length > 500) {
        return { valid: false, error: 'Comment too long (max 500 characters)' };
    }
    return { valid: true };
}

function sanitizeHtml(str) {
    return str.replace(/[&<>"']/g, (char) => {
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return escapeMap[char];
    });
}

// Auth Middleware
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).send(`
            <h2>🔒 Unauthorized</h2>
            <p>Please <a href="/">log in</a> to access this feature.</p>
        `);
    }
    next();
}

// --- MAIN UI ROUTE ---
app.get('/', (req, res) => {
    const user = req.session.user;
    const message = req.query.msg || '';
    const error = req.query.error || '';

    // Fetch comments with user details
    const commentQuery = `
        SELECT c.id, c.content, c.created_at, u.username, u.id as user_id
        FROM comments c 
        JOIN users u ON c.user_id = u.id 
        ORDER BY c.created_at DESC 
        LIMIT 20`;

    pool.query(commentQuery, (err, comments) => {
        if (err) comments = [];

        res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Monolith Dashboard</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * { box-sizing: border-box; }
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                        padding: 20px; 
                        max-width: 1000px; 
                        margin: auto; 
                        background: #f0f2f5;
                        line-height: 1.6;
                    }
                    
                    /* HEADER */
                    .server-info { 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        padding: 30px; 
                        border-radius: 12px; 
                        text-align: center; 
                        margin-bottom: 25px; 
                        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                    }
                    .server-info h1 { 
                        margin: 0 0 10px 0; 
                        font-size: 2.2em; 
                        text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
                    }
                    .server-info p { 
                        margin: 5px 0; 
                        font-size: 1em; 
                        opacity: 0.95;
                    }

                    /* BOXES */
                    .box { 
                        background: white; 
                        padding: 25px; 
                        margin-bottom: 20px; 
                        border-radius: 12px; 
                        box-shadow: 0 2px 10px rgba(0,0,0,0.08);
                        transition: transform 0.2s;
                    }
                    .box:hover { transform: translateY(-2px); }
                    
                    h2 { 
                        margin-top: 0; 
                        color: #333; 
                        border-bottom: 2px solid #f0f0f0; 
                        padding-bottom: 12px;
                        font-size: 1.5em;
                    }

                    /* FORMS & INPUTS */
                    .auth-grid { 
                        display: grid; 
                        grid-template-columns: 1fr 1fr; 
                        gap: 30px; 
                    }
                    
                    @media (max-width: 768px) {
                        .auth-grid { grid-template-columns: 1fr; }
                    }

                    input[type="text"], 
                    input[type="password"], 
                    input[type="email"], 
                    input[type="number"],
                    textarea { 
                        width: 100%; 
                        padding: 12px; 
                        border: 2px solid #e0e0e0; 
                        border-radius: 8px; 
                        margin-bottom: 12px;
                        font-size: 14px;
                        font-family: inherit;
                        transition: border-color 0.2s;
                    }
                    
                    input:focus, textarea:focus {
                        outline: none;
                        border-color: #667eea;
                    }

                    textarea {
                        resize: vertical;
                        min-height: 80px;
                    }

                    button { 
                        cursor: pointer; 
                        padding: 12px 24px; 
                        border: none; 
                        border-radius: 8px; 
                        font-weight: bold; 
                        font-size: 14px;
                        color: white; 
                        background: #3498db;
                        transition: all 0.2s;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                    }
                    button:hover { 
                        transform: translateY(-1px);
                        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                    }
                    button:active { transform: translateY(0); }
                    
                    .success { background: linear-gradient(to right, #11998e, #38ef7d); }
                    .danger { background: linear-gradient(to right, #cb2d3e, #ef473a); }
                    .warning { background: #f39c12; }
                    .secondary { background: #95a5a6; }

                    /* ALERTS */
                    .alert {
                        padding: 15px 20px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                        font-weight: 500;
                    }
                    .alert-success { background: #d4edda; color: #155724; border-left: 4px solid #28a745; }
                    .alert-error { background: #f8d7da; color: #721c24; border-left: 4px solid #dc3545; }

                    /* USER WELCOME */
                    .user-welcome {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 15px;
                    }
                    .username { 
                        font-weight: bold; 
                        color: #764ba2;
                        font-size: 1.1em;
                    }

                    /* COMMENTS */
                    .comment-item { 
                        border-bottom: 1px solid #eee; 
                        padding: 15px 0;
                        display: flex;
                        justify-content: space-between;
                        align-items: start;
                    }
                    .comment-item:last-child { border-bottom: none; }
                    .comment-content {
                        flex: 1;
                        word-wrap: break-word;
                    }
                    .comment-meta {
                        font-size: 0.85em;
                        color: #666;
                        margin-top: 5px;
                    }
                    .comment-actions {
                        margin-left: 15px;
                    }
                    .comment-actions form {
                        display: inline;
                        margin-left: 5px;
                    }
                    .comment-actions button {
                        padding: 6px 12px;
                        font-size: 12px;
                    }

                    /* IFRAME */
                    iframe { 
                        width: 100%; 
                        height: 350px; 
                        border: none; 
                        background: #fafafa; 
                        border-radius: 8px;
                        margin-top: 15px;
                    }

                    /* INVENTORY FORM */
                    .inventory-form {
                        display: flex;
                        gap: 10px;
                        flex-wrap: wrap;
                        align-items: end;
                    }
                    .inventory-form input {
                        margin-bottom: 0;
                        flex: 1;
                        min-width: 150px;
                    }
                    .inventory-form input[type="number"] {
                        max-width: 120px;
                    }

                    /* FORM LABELS */
                    label {
                        display: block;
                        margin-bottom: 5px;
                        font-weight: 500;
                        color: #555;
                        font-size: 14px;
                    }

                    .form-hint {
                        font-size: 12px;
                        color: #888;
                        margin-top: -8px;
                        margin-bottom: 12px;
                    }
                </style>
            </head>
            <body>
                <div class="server-info">
                    <h1>🚀 Cloud Inventory Platform</h1>
                    <p>Instance: <strong>${instanceId}</strong> | Zone: ${availabilityZone}</p>
                    ${user ? `<p>👤 Logged in as: <strong>${user.username}</strong></p>` : ''}
                </div>

                ${message ? `<div class="alert alert-success">${sanitizeHtml(message)}</div>` : ''}
                ${error ? `<div class="alert alert-error">${sanitizeHtml(error)}</div>` : ''}

                <div class="box">
                    ${!user ? `
                        <h2>🔐 User Access</h2>
                        <div class="auth-grid">
                            <div>
                                <h3>Register New Account</h3>
                                <form action="/register" method="POST">
                                    <label>Username</label>
                                    <input type="text" name="username" placeholder="Choose a username" required>
                                    <p class="form-hint">3-30 characters, letters/numbers/underscores only</p>
                                    
                                    <label>Email Address</label>
                                    <input type="email" name="email" placeholder="your@email.com" required>
                                    
                                    <label>Password</label>
                                    <input type="password" name="password" placeholder="Create a password" required>
                                    <p class="form-hint">Minimum 6 characters</p>
                                    
                                    <button class="success" type="submit">Create Account</button>
                                </form>
                            </div>
                            <div>
                                <h3>Login to Existing Account</h3>
                                <form action="/login" method="POST">
                                    <label>Username</label>
                                    <input type="text" name="username" placeholder="Your username" required>
                                    
                                    <label>Password</label>
                                    <input type="password" name="password" placeholder="Your password" required>
                                    
                                    <button type="submit">Sign In</button>
                                </form>
                            </div>
                        </div>
                    ` : `
                        <div class="user-welcome">
                            <div>
                                <h2>Welcome back, <span class="username">${sanitizeHtml(user.username)}</span>! 👋</h2>
                                <p style="color: #666; margin-top: 5px;">Email: ${sanitizeHtml(user.email)}</p>
                            </div>
                            <form action="/logout" method="GET">
                                <button class="danger" type="submit">Logout</button>
                            </form>
                        </div>
                    `}
                </div>

                <div class="box">
                    <h2>📦 Inventory Management</h2>
                    <form action="/insert" method="POST" class="inventory-form">
                        <div style="flex: 1;">
                            <label>Product Name</label>
                            <input type="text" name="name" placeholder="e.g., Laptop, Mouse, Keyboard" required>
                        </div>
                        <div>
                            <label>Price ($)</label>
                            <input type="number" name="price" placeholder="0.00" step="0.01" min="0" required>
                        </div>
                        <button class="success" type="submit">Add Product</button>
                    </form>
                    <iframe src="/view"></iframe>
                </div>

                <div class="box">
                    <h2>💬 Community Discussion</h2>
                    ${user ? `
                        <form action="/comment" method="POST">
                            <label>Share your thoughts</label>
                            <textarea name="content" placeholder="Write a comment... (max 500 characters)" required maxlength="500"></textarea>
                            <button type="submit">Post Comment</button>
                        </form>
                        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
                    ` : `
                        <p style="color: #666; font-style: italic; padding: 15px; background: #f9f9f9; border-radius: 6px;">
                            🔒 Please log in to participate in discussions.
                        </p>
                    `}
                    
                    <div class="comments-list">
                        ${comments && comments.length > 0 ? comments.map(c => `
                            <div class="comment-item">
                                <div class="comment-content">
                                    <span class="username">${sanitizeHtml(c.username)}</span>
                                    <p style="margin: 8px 0;">${sanitizeHtml(c.content)}</p>
                                    <div class="comment-meta">
                                        ${new Date(c.created_at).toLocaleString()}
                                    </div>
                                </div>
                                ${user && user.id === c.user_id ? `
                                    <div class="comment-actions">
                                        <form action="/comment/delete" method="POST" onsubmit="return confirm('Delete this comment?');">
                                            <input type="hidden" name="comment_id" value="${c.id}">
                                            <button class="danger" type="submit">Delete</button>
                                        </form>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('') : '<p style="text-align: center; color: #999; padding: 20px;">No comments yet. Be the first to share your thoughts!</p>'}
                    </div>
                </div>

                <div class="box">
                    <h2>⚙️ System Management</h2>
                    <form action="/setup" method="POST" onsubmit="return confirm('This will initialize/reset all database tables. Continue?');">
                        <button class="warning" type="submit">Initialize Database</button>
                    </form>
                </div>

                <div style="text-align: center; color: #999; font-size: 12px; margin-top: 20px;">
                    <p>Powered by Express.js & MySQL | Session-based Authentication</p>
                </div>
            </body>
        </html>
        `);
    });
});

// --- DATABASE SETUP ---
app.post('/setup', (req, res) => {
    const tempCon = mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password
    });

    tempCon.connect(err => {
        if (err) {
            return res.redirect('/?error=Database connection failed: ' + encodeURIComponent(err.message));
        }

        tempCon.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`, (err) => {
            if (err) {
                tempCon.end();
                return res.redirect('/?error=Failed to create database: ' + encodeURIComponent(err.message));
            }

            tempCon.changeUser({ database: dbConfig.database }, (err) => {
                if (err) {
                    tempCon.end();
                    return res.redirect('/?error=Failed to switch database: ' + encodeURIComponent(err.message));
                }

                const queries = [
                    `CREATE TABLE IF NOT EXISTS users (
                        id INT AUTO_INCREMENT PRIMARY KEY, 
                        username VARCHAR(30) UNIQUE NOT NULL, 
                        email VARCHAR(100) UNIQUE NOT NULL,
                        password_hash VARCHAR(255) NOT NULL, 
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_username (username),
                        INDEX idx_email (email)
                    )`,
                    `CREATE TABLE IF NOT EXISTS products (
                        id INT AUTO_INCREMENT PRIMARY KEY, 
                        name VARCHAR(255) NOT NULL, 
                        price DECIMAL(10,2) NOT NULL, 
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_created (created_at)
                    )`,
                    `CREATE TABLE IF NOT EXISTS comments (
                        id INT AUTO_INCREMENT PRIMARY KEY, 
                        user_id INT NOT NULL, 
                        content TEXT NOT NULL, 
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        INDEX idx_user_created (user_id, created_at)
                    )`
                ];

                let completed = 0;
                queries.forEach(query => {
                    tempCon.query(query, (err) => {
                        completed++;
                        if (err) console.error('Table creation error:', err);
                        
                        if (completed === queries.length) {
                            tempCon.end();
                            res.redirect('/?msg=Database initialized successfully!');
                        }
                    });
                });
            });
        });
    });
});

// --- AUTHENTICATION ROUTES ---
app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Validate inputs
        const usernameValidation = validateUsername(username);
        if (!usernameValidation.valid) {
            return res.redirect('/?error=' + encodeURIComponent(usernameValidation.error));
        }

        const emailValidation = validateEmail(email);
        if (!emailValidation.valid) {
            return res.redirect('/?error=' + encodeURIComponent(emailValidation.error));
        }

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            return res.redirect('/?error=' + encodeURIComponent(passwordValidation.error));
        }

        // Hash password
        const hash = await bcrypt.hash(password, 12);

        // Insert user
        pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
            [username.trim(), email.trim().toLowerCase(), hash],
            (err) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.redirect('/?error=Username or email already exists');
                    }
                    console.error('Registration error:', err);
                    return res.redirect('/?error=Registration failed. Please try again.');
                }
                res.redirect('/?msg=Registration successful! Please log in.');
            }
        );
    } catch (error) {
        console.error('Registration error:', error);
        res.redirect('/?error=An error occurred during registration');
    }
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.redirect('/?error=Please provide username and password');
    }

    pool.query(
        'SELECT id, username, email, password_hash FROM users WHERE username = ?',
        [username.trim()],
        async (err, results) => {
            if (err) {
                console.error('Login query error:', err);
                return res.redirect('/?error=Login failed. Please try again.');
            }

            if (results.length === 0) {
                return res.redirect('/?error=Invalid username or password');
            }

            try {
                const user = results[0];
                const match = await bcrypt.compare(password, user.password_hash);

                if (match) {
                    req.session.user = {
                        id: user.id,
                        username: user.username,
                        email: user.email
                    };
                    return res.redirect('/?msg=Welcome back, ' + user.username + '!');
                } else {
                    return res.redirect('/?error=Invalid username or password');
                }
            } catch (error) {
                console.error('Password comparison error:', error);
                return res.redirect('/?error=Login failed. Please try again.');
            }
        }
    );
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/?msg=Logged out successfully');
    });
});

// --- COMMENT ROUTES ---
app.post('/comment', requireAuth, (req, res) => {
    const { content } = req.body;

    const validation = validateComment(content);
    if (!validation.valid) {
        return res.redirect('/?error=' + encodeURIComponent(validation.error));
    }

    pool.query(
        'INSERT INTO comments (user_id, content) VALUES (?, ?)',
        [req.session.user.id, content.trim()],
        (err) => {
            if (err) {
                console.error('Comment insert error:', err);
                return res.redirect('/?error=Failed to post comment');
            }
            res.redirect('/?msg=Comment posted successfully!');
        }
    );
});

app.post('/comment/delete', requireAuth, (req, res) => {
    const { comment_id } = req.body;

    // Ensure user can only delete their own comments
    pool.query(
        'DELETE FROM comments WHERE id = ? AND user_id = ?',
        [comment_id, req.session.user.id],
        (err, result) => {
            if (err) {
                console.error('Comment delete error:', err);
                return res.redirect('/?error=Failed to delete comment');
            }
            if (result.affectedRows === 0) {
                return res.redirect('/?error=Comment not found or unauthorized');
            }
            res.redirect('/?msg=Comment deleted successfully');
        }
    );
});

// --- INVENTORY ROUTES ---
app.get('/view', (req, res) => {
    const query = "SELECT id, name, price, created_at FROM products ORDER BY id DESC LIMIT 100";

    pool.query(query, (err, rows) => {
        if (err) {
            return res.send(`
                <div style="padding: 20px; text-align: center; color: #999;">
                    <p>⚠️ Database not initialized. Please click "Initialize Database" button.</p>
                </div>
            `);
        }

        let html = `
            <style>
                body { 
                    font-family: 'Segoe UI', sans-serif; 
                    font-size: 14px; 
                    margin: 0; 
                    padding: 15px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                }
                thead th { 
                    background: #f8f9fa; 
                    color: #495057; 
                    font-weight: 600;
                    position: sticky;
                    top: 0;
                    z-index: 10;
                }
                th, td { 
                    padding: 12px; 
                    border-bottom: 1px solid #dee2e6; 
                    text-align: left;
                }
                tbody tr:hover { 
                    background-color: #f8f9fa; 
                }
                .price { 
                    color: #28a745; 
                    font-weight: 600; 
                }
                .empty-state {
                    text-align: center;
                    padding: 40px;
                    color: #999;
                }
            </style>
        `;

        if (rows.length === 0) {
            html += `
                <div class="empty-state">
                    <p>📦 No products in inventory</p>
                    <p style="font-size: 12px;">Add your first product using the form above</p>
                </div>
            `;
        } else {
            html += `
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Product Name</th>
                            <th>Price</th>
                            <th>Added</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            rows.forEach(row => {
                const date = new Date(row.created_at).toLocaleDateString();
                html += `
                    <tr>
                        <td>#${row.id}</td>
                        <td><strong>${sanitizeHtml(row.name)}</strong></td>
                        <td class="price">$${parseFloat(row.price).toFixed(2)}</td>
                        <td>${date}</td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                </table>
            `;
        }

        res.send(html);
    });
});

app.post('/insert', (req, res) => {
    const { name, price } = req.body;

    if (!name || !price) {
        return res.redirect('/?error=Product name and price are required');
    }

    if (name.length > 255) {
        return res.redirect('/?error=Product name too long');
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
        return res.redirect('/?error=Invalid price value');
    }

    pool.query(
        'INSERT INTO products (name, price) VALUES (?, ?)',
        [name.trim(), priceNum],
        (err) => {
            if (err) {
                console.error('Product insert error:', err);
                return res.redirect('/?error=Failed to add product');
            }
            res.redirect('/?msg=Product added successfully!');
        }
    );
});

// --- ERROR HANDLING ---
app.use((req, res) => {
    res.status(404).send(`
        <div style="text-align: center; padding: 50px; font-family: sans-serif;">
            <h1>404 - Page Not Found</h1>
            <p><a href="/">← Return to Dashboard</a></p>
        </div>
    `);
});

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║  🚀 Inventory Monolith Server        ║
    ║  Port: ${PORT}                           ║
    ║  Environment: ${process.env.NODE_ENV || 'development'}           ║
    ║  Session Store: MySQL                ║
    ╚═══════════════════════════════════════╝
    `);
});
