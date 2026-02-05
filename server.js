const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const http = require('http');
const os = require('os');
const app = express();

app.use(bodyParser.urlencoded({ extended: true }));

// --- CONFIGURATION ---
const dbConfig = {
    host: process.env.DB_HOST,      // <--- INJECTED BY CLOUDFORMATION
    user: process.env.DB_USER,      // <--- INJECTED BY CLOUDFORMATION
    password: process.env.DB_PASS,  // <--- INJECTED BY CLOUDFORMATION
    database: 'inventory_app',
    connectionLimit: 10,
    waitForConnections: true
};

const pool = mysql.createPool(dbConfig);

// --- METADATA ---
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
    req.on('timeout', () => { req.destroy(); callback(null); });
    req.end();
}
getEc2Metadata('instance-id', (id) => { instanceId = id || os.hostname(); });
getEc2Metadata('placement/availability-zone', (az) => { availabilityZone = az || 'Local'; });

// --- UI & ROUTES ---
app.get('/', (req, res) => {
    res.send(`
    <html>
        <head>
            <title>Monolith Dashboard</title>
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    padding: 20px; 
                    max-width: 900px; 
                    margin: auto; 
                    background: #f0f2f5; 
                }
                
                /* VIBRANT HEADER STYLES */
                .server-info { 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); /* Purple/Blue Gradient */
                    color: white; 
                    padding: 30px; 
                    border-radius: 12px; 
                    text-align: center; 
                    margin-bottom: 25px; 
                    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                }
                .server-info h1 { 
                    margin: 0; 
                    font-size: 2.5em; 
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.3); /* Makes text readable */
                    color: #ffffff !important; /* Forces white color */
                }
                .server-info p { 
                    margin-top: 10px; 
                    font-size: 1.1em; 
                    color: #e0e0e0; 
                }

                /* BOX STYLES */
                .box { 
                    background: white; 
                    border: none; 
                    padding: 25px; 
                    margin-bottom: 20px; 
                    border-radius: 12px; 
                    box-shadow: 0 2px 10px rgba(0,0,0,0.05); 
                    transition: transform 0.2s;
                }
                .box:hover { transform: translateY(-2px); }
                h2 { margin-top: 0; color: #444; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; }

                /* INPUTS & BUTTONS */
                input, select { 
                    padding: 10px; 
                    border: 1px solid #ddd; 
                    border-radius: 6px; 
                    margin-right: 8px; 
                    font-size: 14px;
                }
                button { 
                    cursor: pointer; 
                    padding: 10px 20px; 
                    color: white; 
                    border: none; 
                    border-radius: 6px; 
                    font-weight: bold; 
                    transition: opacity 0.2s;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                }
                button:hover { opacity: 0.9; }
                
                /* BUTTON COLORS */
                button { background: #3498db; } /* Default Blue */
                button.success { background: linear-gradient(to right, #11998e, #38ef7d); } /* Green Gradient */
                button.danger { background: linear-gradient(to right, #cb2d3e, #ef473a); } /* Red Gradient */
                button.warning { background: #f1c40f; color: #333; } /* Yellow */

                /* IFRAME & GRID */
                iframe { width: 100%; height: 400px; border: none; border-radius: 8px; background: #fafafa; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            </style>
        </head>
        <body>
            <div class="server-info">
                <h1>Legacy Monolith Dashboard 🚀</h1>
                <p>⚡ Serving from Instance: <strong>${instanceId}</strong> | Zone: ${availabilityZone}</p>
            </div>

            <div class="box">
                <h2>🛠 System Configuration</h2>
                <div style="display: flex; gap: 10px;">
                    <form action="/setup" method="POST"><button class="success">Initialize DB & Table</button></form>
                    <form action="/drop" method="POST"><button class="danger">⚠ Reset (Drop Table)</button></form>
                </div>
            </div>

            <div class="grid">
                <div class="box">
                    <h2>➕ Add Product</h2>
                    <form action="/insert" method="POST">
                        <input type="text" name="name" placeholder="Product Name" required>
                        <input type="number" name="price" placeholder="Price" step="0.01" required style="width: 80px;">
                        <button>Add</button>
                    </form>
                </div>

                <div class="box">
                    <h2>🔍 Search & Filter</h2>
                    <form action="/view" method="GET" target="dataFrame">
                        <input type="text" name="search" placeholder="Search..." style="width: 120px;">
                        <select name="sort">
                            <option value="id_asc">Oldest</option>
                            <option value="price_asc">Price: Low</option>
                            <option value="price_desc">Price: High</option>
                        </select>
                        <button class="warning">Go</button>
                    </form>
                </div>
            </div>

            <div class="box">
                <h2>✏️ Manage Inventory</h2>
                <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                    <form action="/update" method="POST">
                        <input type="number" name="id" placeholder="ID" style="width: 60px;" required>
                        <input type="text" name="name" placeholder="New Name" required>
                        <input type="number" name="price" placeholder="New Price" step="0.01" required style="width: 80px;">
                        <button>Update</button>
                    </form>
                    <form action="/delete" method="POST">
                        <input type="number" name="id" placeholder="ID" style="width: 60px;" required>
                        <button class="danger">Delete</button>
                    </form>
                </div>
            </div>

            <div class="box">
                <h2>📊 Live Analytics</h2>
                <iframe name="dataFrame" src="/view"></iframe>
            </div>
        </body>
    </html>
    `);
});

// --- API ROUTES (Unchanged) ---
app.post('/setup', (req, res) => {
    const tempCon = mysql.createConnection({ host: dbConfig.host, user: dbConfig.user, password: dbConfig.password });
    tempCon.connect(err => {
        if (err) return res.send("DB Connection Failed: " + err.message);
        tempCon.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`, (err) => {
            if (err) { tempCon.end(); return res.send("Create DB Failed: " + err.message); }
            tempCon.changeUser({ database: dbConfig.database }, (err) => {
                if (err) { tempCon.end(); return res.send("Change DB Failed: " + err.message); }
                const sql = `CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), price DECIMAL(10,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
                tempCon.query(sql, (err) => {
                    tempCon.end();
                    if (err) return res.send("Create Table Failed: " + err.message);
                    res.send("<h1>✅ System Initialized!</h1><a href='/'>Go Back</a>");
                });
            });
        });
    });
});

app.get('/view', (req, res) => {
    let query = "SELECT * FROM products";
    let statsQuery = "SELECT COUNT(*) as count, AVG(price) as avg, MIN(price) as min, MAX(price) as max FROM products";
    let params = [];
    if (req.query.search) {
        query += " WHERE name LIKE ?";
        statsQuery += " WHERE name LIKE ?";
        params.push(`%${req.query.search}%`);
    }
    if (req.query.sort === 'price_asc') query += " ORDER BY price ASC";
    else if (req.query.sort === 'price_desc') query += " ORDER BY price DESC";
    else query += " ORDER BY id ASC";

    pool.query(statsQuery, params, (err, stats) => {
        if (err) return res.send(`<h3 style='color:red'>Error: ${err.message} (Run Setup first)</h3>`);
        pool.query(query, params, (err, rows) => {
            if (err) return res.send("Error: " + err.message);
            const s = stats[0];
            let html = `
                <style>
                    body { font-family: sans-serif; padding: 10px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border-bottom: 1px solid #ddd; padding: 12px; text-align: left; }
                    th { background-color: #f8f9fa; color: #666; }
                    tr:hover { background-color: #f1f1f1; }
                    .stats { padding: 15px; background: #e3f2fd; border-radius: 8px; margin-bottom: 15px; color: #0d47a1; }
                </style>
                <div class="stats">
                    <strong>Stats:</strong> Found ${s.count} items | Avg: $${Number(s.avg).toFixed(2)}
                </div>
                <table><tr><th>ID</th><th>Name</th><th>Price</th><th>Added</th></tr>`;
            if (rows.length === 0) html += "<tr><td colspan='4' style='text-align:center; padding:20px;'>No data found</td></tr>";
            rows.forEach(row => { html += `<tr><td>${row.id}</td><td><b>${row.name}</b></td><td>$${row.price}</td><td>${row.created_at}</td></tr>`; });
            html += "</table>";
            res.send(html);
        });
    });
});

app.post('/insert', (req, res) => { pool.query('INSERT INTO products (name, price) VALUES (?, ?)', [req.body.name, req.body.price], (err) => { res.redirect('/'); }); });
app.post('/update', (req, res) => { pool.query('UPDATE products SET name = ?, price = ? WHERE id = ?', [req.body.name, req.body.price, req.body.id], (err) => { res.redirect('/'); }); });
app.post('/delete', (req, res) => { pool.query('DELETE FROM products WHERE id = ?', [req.body.id], (err) => { res.redirect('/'); }); });
app.post('/drop', (req, res) => { pool.query('DROP TABLE products', (err) => { res.send("<h1>💥 Table Dropped!</h1><a href='/'>Go Back</a>"); }); });

app.listen(3000, () => console.log('Vibrant Dashboard running on port 3000'));