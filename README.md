# KHELZ GAME SHOPE

Website toko top-up game full-stack dengan:
- Frontend toko responsif
- Login/register pelanggan
- Login admin
- PostgreSQL untuk produk, stok, order, dan payment
- Admin dapat mengubah harga, stok, dan status order
- Midtrans Snap untuk pembayaran otomatis
- Webhook Midtrans untuk memperbarui status pembayaran
- Halaman cek order
- Siap deploy ke Render + PostgreSQL
- Bisa memakai custom domain

## 1. Jalankan lokal

Install Node.js 20+ lalu:

```bash
npm install
cp .env.example .env
```

Isi `.env`:
- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `MIDTRANS_SERVER_KEY`
- `MIDTRANS_CLIENT_KEY`
- `MIDTRANS_IS_PRODUCTION=false` saat testing

Kemudian:

```bash
npm start
```

Buka:
`http://localhost:3000`

Admin:
`http://localhost:3000/admin.html`

## 2. Mengubah stok

Cara paling aman: login ke `/admin.html`.

1. Login memakai akun `ADMIN_EMAIL`.
2. Cari bagian **Produk & Stok**.
3. Ubah kolom harga/stok.
4. Tekan **Simpan**.
5. Website pelanggan akan mengambil stok terbaru dari PostgreSQL.

Jadi Anda TIDAK perlu mengedit `index.html` setiap kali stok berubah.

## 3. Menambah produk

Di Admin Panel:
1. Isi Game, contoh `ml`.
2. Isi Nama Produk.
3. Isi Harga dalam rupiah tanpa titik, contoh `20000`.
4. Isi Stok, contoh `100`.
5. Isi Icon.
6. Tekan Tambah.

Produk masuk ke database.

## 4. Mengubah payment

Website ini menggunakan Midtrans Snap.

Saat testing:
```env
MIDTRANS_IS_PRODUCTION=false
MIDTRANS_SERVER_KEY=SB-Mid-server-...
MIDTRANS_CLIENT_KEY=SB-Mid-client-...
```

Saat sudah siap menerima pembayaran asli:
```env
MIDTRANS_IS_PRODUCTION=true
MIDTRANS_SERVER_KEY=Mid-server-...
MIDTRANS_CLIENT_KEY=Mid-client-...
```

JANGAN masukkan Server Key ke `index.html`, `app.js`, GitHub, atau chat publik.

Di dashboard Midtrans, set Payment Notification URL ke:

```text
https://DOMAIN-KAMU.com/api/payments/notification
```

Endpoint tersebut menerima notifikasi status pembayaran dari Midtrans.

## 5. Mengubah nomor WhatsApp

Di `.env`:

```env
WHATSAPP_NUMBER=628xxxxxxxxxx
```

Nomor memakai format internasional tanpa `+`.

## 6. Deploy permanen

### Render

1. Upload project ini ke GitHub.
2. Buat PostgreSQL di Render.
3. Buat **Web Service** dari repository.
4. Build Command:
   `npm install`
5. Start Command:
   `npm start`
6. Tambahkan Environment Variables dari `.env`.
7. Hubungkan `DATABASE_URL` dari PostgreSQL.
8. Deploy.
9. Buka URL `https://nama-service.onrender.com`.

### Custom domain

Di Render Web Service, tambahkan custom domain Anda lalu ikuti DNS record yang diberikan Render.

Contoh:
`khelzgameshope.com`

## 7. Catatan penting tentang "permanen"

Website dan database production sebaiknya tidak memakai paket gratis untuk toko yang benar-benar berjualan. Paket gratis Render memiliki keterbatasan; dokumentasi Render juga menyebut free web service dapat spin down dan free Postgres memiliki masa berlaku terbatas. Untuk toko aktif, gunakan paket production/berbayar dan custom domain.

## 8. Struktur folder

```text
khelz-game-shope/
├── public/
│   ├── index.html
│   ├── app.js
│   └── admin.html
├── server.js
├── schema.sql
├── package.json
├── .env.example
└── README.md
```

## 9. Status order

Alur normal:

`pending_payment` → `processing` → `completed`

Jika pembayaran gagal/kedaluwarsa:

`pending_payment` → `cancelled`

Ketika Midtrans mengirim status pembayaran sukses, backend mengubah payment menjadi `paid` dan order menjadi `processing`.

## 10. Keamanan

- Gunakan `JWT_SECRET` random dan panjang.
- Jangan commit `.env`.
- Gunakan HTTPS.
- Gunakan Server Key Midtrans hanya di backend.
- Ganti password admin default.
- Aktifkan production mode Midtrans hanya setelah testing selesai.
