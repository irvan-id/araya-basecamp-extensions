# 📊 Araya Basecamp Extensions — Panduan Setup Google Apps Script

> Backend Google Spreadsheet untuk Chrome Extension Araya Basecamp Extensions.

---

## Pendahuluan

Google Apps Script ini berfungsi sebagai **backend** untuk extension Araya Basecamp Extensions. Script ini menerima data time tracking dari extension dan menyimpannya di Google Spreadsheet. Setiap anggota tim hanya bisa melihat data miliknya sendiri.

**Cara kerjanya:**

```
Chrome Extension  →  Google Apps Script (Web App)  →  Google Spreadsheet
     (POST)              (proses & validasi)             (simpan data)
     (GET)               (filter per user)               (ambil data)
```

---

## Langkah 1: Buat Google Spreadsheet Baru

1. Buka [Google Sheets](https://sheets.google.com)
2. Klik **"+ Blank"** atau **"Spreadsheet kosong"** untuk membuat spreadsheet baru
3. Beri nama spreadsheet, misalnya: `Araya Basecamp Extensions`
4. Spreadsheet ini akan menjadi tempat penyimpanan semua data time tracking

> **💡 Tips:** Anda tidak perlu membuat kolom atau header apapun — script akan membuatnya secara otomatis saat data pertama masuk.

---

## Langkah 2: Buka Apps Script

1. Di spreadsheet yang baru dibuat, klik menu **Extensions** (atau **Ekstensi**)
2. Pilih **Apps Script**
3. Tab baru akan terbuka dengan editor Apps Script
4. Anda akan melihat file default `Code.gs` dengan fungsi `myFunction()` kosong

---

## Langkah 3: Paste Kode

1. **Hapus semua** kode yang ada di editor (fungsi `myFunction()` default)
2. Buka file `Code.gs` dari folder ini
3. **Copy seluruh isi** file `Code.gs`
4. **Paste** ke editor Apps Script (menggantikan kode yang dihapus tadi)
5. Klik **Ctrl+S** (atau **Cmd+S** di Mac) untuk menyimpan
6. Beri nama project, misalnya: `Basecamp Timesheet Backend`

Kode yang di-paste berisi:
- `doPost(e)` — Menerima dan menyimpan time entry baru
- `doGet(e)` — Mengambil data summary per user
- Helper functions untuk validasi, formatting, dll.

---

## Langkah 4: Set API Key

API Key digunakan untuk mengamankan akses ke Web App. Hanya request dengan API Key yang benar yang akan diproses.

### Membuat API Key:

1. Di editor Apps Script, klik ikon ⚙️ **Project Settings** (Setelan Project) di sidebar kiri
2. Scroll ke bawah ke bagian **Script Properties**
3. Klik **Add script property** (Tambahkan properti skrip)
4. Isi:
   - **Property:** `API_KEY`
   - **Value:** *(masukkan key yang kuat dan acak)*
5. Klik **Save script properties**

### Tips membuat API Key yang kuat:

Anda bisa generate API Key menggunakan salah satu cara berikut:

**Opsi 1 — Dari browser console:**
```javascript
// Buka browser console (F12), paste dan tekan Enter:
crypto.randomUUID() + '-' + crypto.randomUUID()
```

**Opsi 2 — Buat sendiri:**
Gunakan kombinasi huruf besar, huruf kecil, angka, dan simbol. Minimal 32 karakter.
Contoh format: `xK9m2Lp7-qR4w8Yz-bN6v3Jt1-hF5d0Cs`

> **⚠️ Penting:** Simpan API Key ini dengan aman! Anda akan memerlukannya saat mengkonfigurasi extension. Jangan bagikan ke orang yang tidak berwenang.

---

## Langkah 5: Deploy sebagai Web App

Setelah kode di-paste dan API Key di-set, saatnya deploy script sebagai Web App:

1. Klik tombol **Deploy** (biru, pojok kanan atas)
2. Pilih **New deployment** (Deployment baru)
3. Klik ikon ⚙️ di sebelah **Select type**, pilih **Web app**
4. Isi konfigurasi berikut:

   | Setting | Value |
   |---------|-------|
   | **Description** | `Basecamp Timesheet v1.0` (atau versi anda) |
   | **Execute as** | **Me** (akun Google anda) |
   | **Who has access** | **Anyone** |

5. Klik **Deploy**

### Proses Autorisasi:

6. Akan muncul dialog autorisasi. Klik **Authorize access**
7. Pilih akun Google Anda
8. Jika muncul peringatan "Google hasn't verified this app":
   - Klik **Advanced** (Lanjutan)
   - Klik **Go to [nama project] (unsafe)**
   - Ini aman karena Anda sendiri yang membuat script ini
9. Klik **Allow** (Izinkan) untuk memberikan akses

### Salin URL:

10. Setelah deploy berhasil, Anda akan melihat **Web App URL**
11. **Copy URL tersebut** — Anda memerlukan ini untuk konfigurasi extension

URL akan terlihat seperti:
```
https://script.google.com/macros/s/AKfycbx.../exec
```

> **💡 Tips:** Setiap kali mengubah kode, Anda perlu membuat **New deployment** baru agar perubahan berlaku pada Web App.

---

## Langkah 6: Konfigurasi Extension

1. Buka Chrome browser
2. Klik ikon extension **Araya Basecamp Extensions** di toolbar
3. Klik tombol **⚙️ Settings** atau ikon gear
4. Isi kolom-kolom berikut:

   | Field | Value |
   |-------|-------|
   | **Google Apps Script URL** | Paste URL Web App dari Langkah 5 |
   | **API Key** | Paste API Key dari Langkah 4 |

5. Klik **Save** / **Simpan**

---

## Langkah 7: Test Koneksi

1. Setelah konfigurasi disimpan, klik tombol **Test Connection** / **Test Koneksi**
2. Jika berhasil, Anda akan melihat pesan: ✅ **Connection successful**
3. Jika gagal, periksa kembali URL dan API Key

### Verifikasi di Spreadsheet:

1. Buka spreadsheet yang Anda buat di Langkah 1
2. Coba log sebuah time entry dari extension
3. Cek apakah data muncul di sheet **"Timesheet"**

---

## Troubleshooting

### ❌ "Invalid API key"
- Pastikan API Key di extension **sama persis** dengan yang ada di Script Properties
- Cek apakah ada spasi tambahan di awal/akhir key
- Pastikan property name di Script Properties adalah `API_KEY` (huruf kapital semua)

### ❌ "Connection failed" / Tidak bisa connect
- Pastikan URL Web App sudah benar (harus diakhiri `/exec`)
- Pastikan deployment menggunakan setting **"Anyone"** untuk access
- Coba buat **New deployment** baru jika URL lama tidak berfungsi
- Periksa koneksi internet Anda

### ❌ "Authorization required"
- Buka Apps Script editor
- Jalankan fungsi `doGet` secara manual (klik Run)
- Ikuti proses autorisasi yang muncul
- Setelah autorisasi selesai, coba lagi dari extension

### ❌ Data tidak muncul di spreadsheet
- Pastikan sheet bernama **"Timesheet"** ada (atau biarkan script membuatnya otomatis)
- Cek tab sheet di bagian bawah spreadsheet
- Periksa Apps Script execution log: **View > Executions** di editor Apps Script

### ❌ "Missing required fields"
- Pastikan extension mengirim data dengan field `user`, `project`, dan `hours`
- Cek apakah profil Basecamp sudah terdeteksi dengan benar

### ❌ Perubahan kode tidak berlaku
- Setiap mengubah kode, Anda **harus** membuat **New deployment** baru
- Deploy lama tetap menggunakan kode versi lama
- Update URL di extension setelah membuat deployment baru

---

## Keamanan

### 🔐 Bagaimana data dilindungi?

1. **API Key Validation**
   - Setiap request (POST dan GET) divalidasi dengan API Key
   - Request tanpa API Key yang valid akan ditolak
   - API Key disimpan di Script Properties (tidak terlihat dalam kode)

2. **User-based Data Filtering**
   - Saat mengambil data (GET), script **hanya mengembalikan entries milik user yang diminta**
   - User A tidak bisa melihat data User B
   - Filtering dilakukan di sisi server (Apps Script), bukan di extension

3. **Google Account Protection**
   - Script berjalan dengan akun Google Anda (admin)
   - Spreadsheet hanya bisa diakses oleh pemilik dan orang yang di-share
   - Data disimpan di Google Drive Anda yang dilindungi autentikasi Google

4. **HTTPS Only**
   - Semua komunikasi antara extension dan Web App menggunakan HTTPS
   - Data terenkripsi saat transit

### ⚠️ Yang perlu diperhatikan:

- **Jangan share API Key** ke orang yang tidak berwenang
- **Jangan set spreadsheet ke "Anyone with the link can edit"** kecuali memang diperlukan
- **Ganti API Key** secara berkala untuk keamanan yang lebih baik
- Jika API Key bocor, segera ganti di Script Properties dan update di semua extension

---

## Format Data di Spreadsheet

Script akan otomatis membuat sheet **"Timesheet"** dengan format berikut:

| Kolom | Header | Keterangan |
|-------|--------|------------|
| A | Timestamp | Waktu entry dibuat (format: yyyy-MM-dd HH:mm:ss) |
| B | User | Nama user dari profil Basecamp |
| C | Project | Nama project Basecamp |
| D | Task | Nama to-do / task |
| E | Hours (decimal) | Jam kerja dalam desimal (contoh: 1.50 = 1 jam 30 menit) |
| F | Notes | Catatan tambahan |
| G | Basecamp URL | Link ke to-do di Basecamp |
| H | Entry ID | ID unik untuk setiap entry (auto-generated) |

---

## Butuh Bantuan?

Jika Anda mengalami masalah yang tidak tercakup di panduan ini:

1. Cek [Issues](../../issues) di repository GitHub
2. Buat issue baru dengan deskripsi masalah yang detail
3. Sertakan screenshot dan error message jika ada
