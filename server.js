import express from "express";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import midtransClient from "midtrans-client";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const { Pool } = pg;
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET belum diisi.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY || "",
  clientKey: process.env.MIDTRANS_CLIENT_KEY || ""
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const q = (text, params = []) => pool.query(text, params);
const money = n => Number(n);
const tokenFor = u => jwt.sign(
  { id: u.id, email: u.email, role: u.role },
  JWT_SECRET,
  { expiresIn: "7d" }
);

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "Login diperlukan." });
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Sesi tidak valid." });
  }
}

function admin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin saja." });
  next();
}

async function bootstrap() {
  const schema = await import("fs/promises");
  const sql = await schema.readFile(path.join(__dirname, "schema.sql"), "utf8");
  await q(sql);

  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!adminEmail) throw new Error("ADMIN_EMAIL belum diisi.");
  const found = await q("SELECT id FROM users WHERE email=$1", [adminEmail]);
  if (!found.rowCount) {
    const password = process.env.ADMIN_PASSWORD || "CHANGE_ME_NOW";
    const hash = await bcrypt.hash(password, 12);
    await q(
      "INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin')",
      [adminEmail, hash]
    );
    console.log("Admin dibuat:", adminEmail);
  }

  const count = await q("SELECT COUNT(*)::int AS n FROM products");
  if (count.rows[0].n === 0) {
    await q(
      `INSERT INTO products(game,name,price,stock,icon) VALUES
      ('ml','Mobile Legends 86 Diamonds',20000,100,'⚔️'),
      ('ff','Free Fire 70 Diamonds',10000,100,'🔥'),
      ('pubg','PUBG Mobile 60 UC',16000,100,'🎯'),
      ('val','Valorant 475 VP',55000,50,'💎')`
    );
  }
}

app.get("/api/config", (req, res) => {
  res.json({
    storeName: process.env.STORE_NAME || "KHELZ GAME SHOPE",
    whatsapp: process.env.WHATSAPP_NUMBER || "",
    midtransEnabled: Boolean(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_CLIENT_KEY)
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || password.length < 8)
      return res.status(400).json({ error: "Email dan password minimal 8 karakter." });
    const hash = await bcrypt.hash(password, 12);
    const r = await q(
      "INSERT INTO users(email,password_hash,role) VALUES($1,$2,'customer') RETURNING id,email,role",
      [email, hash]
    );
    res.json({ token: tokenFor(r.rows[0]), user: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.code === "23505" ? "Email sudah terdaftar." : "Gagal membuat akun." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const r = await q("SELECT id,email,password_hash,role FROM users WHERE email=$1", [email]);
  if (!r.rowCount || !(await bcrypt.compare(password, r.rows[0].password_hash)))
    return res.status(401).json({ error: "Email/password salah." });
  const u = r.rows[0];
  res.json({ token: tokenFor(u), user: { id: u.id, email: u.email, role: u.role } });
});

app.get("/api/products", async (req, res) => {
  const r = await q(
    "SELECT id,game,name,price,stock,icon FROM products WHERE active=true ORDER BY id"
  );
  res.json(r.rows);
});

app.get("/api/orders/:id", async (req, res) => {
  const r = await q(
    `SELECT o.id,o.customer_name,o.game_id,o.server_id,o.total,o.status,o.payment_status,
            o.created_at,COALESCE(json_agg(json_build_object(
              'name',i.product_name,'quantity',i.quantity,'price',i.price
            )) FILTER (WHERE i.id IS NOT NULL),'[]') items
     FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
     WHERE o.id=$1 GROUP BY o.id`,
    [req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
  res.json(r.rows[0]);
});

app.get("/api/me/orders", auth, async (req, res) => {
  const r = await q(
    `SELECT o.id,o.customer_name,o.game_id,o.server_id,o.total,o.status,o.payment_status,o.created_at,
            COALESCE(json_agg(json_build_object(
              'name',i.product_name,'quantity',i.quantity,'price',i.price
            )) FILTER (WHERE i.id IS NOT NULL),'[]') items
     FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
     WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  res.json(r.rows);
});

app.post("/api/orders", auth, async (req, res) => {
  if (!process.env.MIDTRANS_SERVER_KEY || !process.env.MIDTRANS_CLIENT_KEY)
    return res.status(503).json({ error: "Payment otomatis belum dikonfigurasi admin." });

  const client = await pool.connect();
  try {
    const { items, customerName, customerWa, gameId, serverId, note } = req.body;
    if (!Array.isArray(items) || !items.length) throw new Error("Keranjang kosong.");

    await client.query("BEGIN");
    let total = 0;
    const normalized = [];

    for (const item of items) {
      const r = await client.query(
        "SELECT id,name,price,stock FROM products WHERE id=$1 AND active=true FOR UPDATE",
        [item.productId]
      );
      if (!r.rowCount) throw new Error("Produk tidak ditemukan.");
      const p = r.rows[0];
      const qty = Math.max(1, parseInt(item.quantity, 10) || 0);
      if (qty > p.stock) throw new Error(`Stok ${p.name} tidak cukup.`);
      total += money(p.price) * qty;
      normalized.push({ ...p, quantity: qty });
    }

    const orderId = `KZ-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    await client.query(
      `INSERT INTO orders(id,user_id,customer_name,customer_wa,game_id,server_id,note,total)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orderId, req.user.id, customerName || "", customerWa || "", gameId || "", serverId || "", note || "", total]
    );

    for (const p of normalized) {
      await client.query(
        `INSERT INTO order_items(order_id,product_id,product_name,quantity,price)
         VALUES($1,$2,$3,$4,$5)`,
        [orderId, p.id, p.name, p.quantity, p.price]
      );
      await client.query(
        "UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2",
        [p.quantity, p.id]
      );
    }

    const snapResp = await snap.createTransaction({
      transaction_details: { order_id: orderId, gross_amount: total },
      customer_details: {
        first_name: customerName || "Customer",
        email: req.user.email,
        phone: customerWa || undefined
      }
    });

    await client.query(
      `UPDATE orders SET midtrans_token=$1,midtrans_redirect_url=$2,updated_at=NOW()
       WHERE id=$3`,
      [snapResp.token, snapResp.redirect_url, orderId]
    );
    await client.query("COMMIT");

    res.json({ orderId, token: snapResp.token, redirect_url: snapResp.redirect_url, total });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post("/api/payments/notification", async (req, res) => {
  try {
    const status = await snap.transaction.notification(req.body);
    const orderId = status.order_id;
    const ts = status.transaction_status;
    const fs = status.fraud_status;
    const paid = ["settlement", "capture"].includes(ts) && (!fs || fs === "accept");
    const cancelled = ["cancel", "deny", "expire"].includes(ts);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO payments(order_id,provider,provider_order_id,transaction_status,fraud_status,raw_payload)
         VALUES($1,'midtrans',$1,$2,$3,$4)
         ON CONFLICT(provider_order_id)
         DO UPDATE SET transaction_status=EXCLUDED.transaction_status,
                       fraud_status=EXCLUDED.fraud_status,
                       raw_payload=EXCLUDED.raw_payload`,
        [orderId, orderId, ts, fs || null, req.body]
      );

      if (paid) {
        await client.query(
          "UPDATE orders SET payment_status='paid',status='processing',updated_at=NOW() WHERE id=$1",
          [orderId]
        );
      } else if (cancelled) {
        const o = await client.query("SELECT status FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
        if (o.rowCount && o.rows[0].status !== "cancelled") {
          const its = await client.query(
            "SELECT product_id,quantity FROM order_items WHERE order_id=$1",
            [orderId]
          );
          for (const i of its.rows) {
            if (i.product_id)
              await client.query("UPDATE products SET stock=stock+$1,updated_at=NOW() WHERE id=$2", [i.quantity, i.product_id]);
          }
          await client.query(
            "UPDATE orders SET payment_status='failed',status='cancelled',updated_at=NOW() WHERE id=$1",
            [orderId]
          );
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.sendStatus(200);
  } catch (e) {
    console.error("Midtrans notification:", e);
    res.status(500).json({ error: "notification error" });
  }
});

/* ADMIN */
app.get("/api/admin/products", auth, admin, async (req, res) => {
  res.json((await q("SELECT * FROM products ORDER BY id")).rows);
});

app.post("/api/admin/products", auth, admin, async (req, res) => {
  const { game, name, price, stock, icon } = req.body;
  if (!game || !name) return res.status(400).json({ error: "Game dan nama produk wajib." });
  const r = await q(
    `INSERT INTO products(game,name,price,stock,icon)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [game, name, Math.max(0, Number(price) || 0), Math.max(0, Number(stock) || 0), icon || "🎮"]
  );
  res.json(r.rows[0]);
});

app.patch("/api/admin/products/:id", auth, admin, async (req, res) => {
  const { price, stock, active, name, game, icon } = req.body;
  const r = await q(
    `UPDATE products SET
      price=COALESCE($1,price), stock=COALESCE($2,stock), active=COALESCE($3,active),
      name=COALESCE($4,name), game=COALESCE($5,game), icon=COALESCE($6,icon), updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [price == null ? null : Number(price), stock == null ? null : Number(stock),
     active == null ? null : Boolean(active), name || null, game || null, icon || null, req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Produk tidak ditemukan." });
  res.json(r.rows[0]);
});

app.delete("/api/admin/products/:id", auth, admin, async (req, res) => {
  await q("UPDATE products SET active=false,updated_at=NOW() WHERE id=$1", [req.params.id]);
  res.sendStatus(204);
});

app.get("/api/admin/orders", auth, admin, async (req, res) => {
  const r = await q(
    `SELECT o.*,COALESCE(json_agg(json_build_object(
      'name',i.product_name,'quantity',i.quantity,'price',i.price
    )) FILTER (WHERE i.id IS NOT NULL),'[]') items
     FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
     GROUP BY o.id ORDER BY o.created_at DESC`
  );
  res.json(r.rows);
});

app.patch("/api/admin/orders/:id", auth, admin, async (req, res) => {
  const allowed = ["pending_payment","processing","completed","cancelled"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "Status tidak valid." });
  const r = await q(
    "UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
    [req.body.status, req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Order tidak ditemukan." });
  res.json(r.rows[0]);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

bootstrap()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`KHELZ GAME SHOPE running on port ${PORT}`)))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
