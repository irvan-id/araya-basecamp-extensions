# ⏱️ Araya Basecamp Extensions

![Chrome Extension](https://img.shields.io/badge/Platform-Chrome%20Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?logo=googlechrome&logoColor=white)
![Google Apps Script](https://img.shields.io/badge/Backend-Google%20Apps%20Script-0F9D58?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)

---

## 📋 Deskripsi

**Araya Basecamp Extensions** adalah Chrome Extension yang memudahkan pencatatan waktu kerja (time tracking) langsung dari halaman Basecamp. Extension ini menambahkan tombol timer di setiap to-do Basecamp, sehingga Anda bisa melacak waktu kerja tanpa perlu berpindah aplikasi.

Semua data disinkronkan ke **Google Spreadsheet** melalui Google Apps Script, memberikan Anda kontrol penuh atas data time tracking tim Anda.

---

## ✨ Fitur

| Fitur | Keterangan |
|-------|------------|
| ⏱️ **Timer di To-Do** | Tombol timer muncul di setiap to-do Basecamp — start/stop dengan satu klik |
| ▶️ **Start/Stop Timer** | Timer real-time yang berjalan saat Anda bekerja, atau masukkan waktu secara manual |
| 👤 **Auto-detect Profil** | Otomatis mendeteksi nama dan profil Basecamp Anda |
| 📊 **Sinkronisasi ke Google Sheets** | Data time tracking langsung tersimpan di Google Spreadsheet |
| 📴 **Offline Support** | Entry yang dibuat saat offline akan di-queue dan otomatis dikirim saat online kembali |
| 🔒 **Data Privacy** | Setiap anggota tim hanya bisa melihat data miliknya sendiri |

---

## 🚀 Instalasi

### Prasyarat

- Google Chrome browser (versi terbaru disarankan)
- Akun Google untuk Google Spreadsheet

### Langkah-langkah:

1. **Clone repository ini**

   ```bash
   git clone https://github.com/your-username/basecamp-timesheetLite-chrome.git
   ```

2. **Buka halaman Extensions di Chrome**

   Ketik di address bar:
   ```
   chrome://extensions
   ```

3. **Aktifkan Developer Mode**

   Toggle switch **"Developer mode"** di pojok kanan atas halaman

4. **Load Extension**

   - Klik tombol **"Load unpacked"**
   - Pilih folder project yang sudah di-clone
   - Extension akan muncul di toolbar Chrome

5. **Pin Extension** (opsional)

   - Klik ikon puzzle 🧩 di toolbar Chrome
   - Klik pin 📌 di sebelah **Araya Basecamp Extensions**
   - Extension akan selalu terlihat di toolbar

---

## 📊 Setup Google Sheets (Backend)

Extension ini memerlukan Google Spreadsheet sebagai backend untuk menyimpan data time tracking.

👉 **Ikuti panduan lengkap di: [google-apps-script/README.md](google-apps-script/README.md)**

Panduan tersebut mencakup:
- Membuat Google Spreadsheet
- Setup Google Apps Script
- Deploy sebagai Web App
- Konfigurasi API Key
- Test koneksi

---

## 📖 Cara Penggunaan

### 1. Konfigurasi Awal

Setelah instalasi, Anda perlu menghubungkan extension dengan Google Spreadsheet:

1. Klik ikon extension di toolbar
2. Buka **Settings** (⚙️)
3. Masukkan **Google Apps Script URL** dan **API Key**
4. Klik **Save**, lalu **Test Connection**

### 2. Menggunakan Timer

1. Buka halaman **to-do list** di Basecamp
2. Anda akan melihat tombol ⏱️ di setiap to-do item
3. Klik **▶️ Start** untuk mulai tracking waktu
4. Kerjakan task Anda seperti biasa
5. Klik **⏹️ Stop** saat selesai
6. Timer akan otomatis menghitung durasi dan menyimpan entry

### 3. Manual Entry

Jika lupa menjalankan timer, Anda bisa memasukkan waktu secara manual:

1. Klik ikon extension di toolbar
2. Pilih **Manual Entry**
3. Isi project, task, durasi, dan catatan
4. Klik **Submit**

### 4. Melihat Summary

1. Klik ikon extension di toolbar
2. Dashboard menampilkan:
   - ⏱️ **Hari ini:** Total jam kerja hari ini
   - 📅 **Minggu ini:** Total jam kerja minggu ini
   - 📋 **Entry terakhir:** Daftar entry terbaru

### 5. Melihat Data di Spreadsheet

1. Buka Google Spreadsheet yang sudah di-setup
2. Data ada di sheet **"Timesheet"**
3. Anda bisa membuat pivot table, chart, atau analisis lainnya

---

## 📸 Screenshots

> *Screenshots akan ditambahkan setelah development selesai.*

| View | Deskripsi |
|------|-----------|
| **Popup Dashboard** | Tampilan utama extension dengan summary dan entry terbaru |
| **Timer Button** | Tombol timer yang muncul di setiap to-do Basecamp |
| **Settings** | Halaman konfigurasi URL dan API Key |
| **Manual Entry** | Form untuk input waktu secara manual |
| **Spreadsheet** | Contoh data di Google Spreadsheet |

---

## 🛠️ Tech Stack

| Teknologi | Penggunaan |
|-----------|------------|
| **Chrome Extension Manifest V3** | Platform utama extension |
| **Content Scripts** | Inject timer button ke halaman Basecamp |
| **Service Worker** | Background processing & offline queue |
| **Google Apps Script** | Backend API (Web App) |
| **Google Spreadsheet** | Database / penyimpanan data |
| **Chrome Storage API** | Penyimpanan lokal (settings, cache, queue) |
| **HTML / CSS / JavaScript** | UI popup dan content scripts |

### Struktur Project

```
basecamp-timesheetLite-chrome/
├── manifest.json              # Chrome extension manifest (V3)
├── background.js              # Service worker
├── content.js                 # Content script (inject ke Basecamp)
├── popup/
│   ├── popup.html             # UI popup
│   ├── popup.css              # Styling popup
│   └── popup.js               # Logic popup
├── icons/                     # Extension icons
├── google-apps-script/
│   ├── Code.gs                # Google Apps Script backend
│   └── README.md              # Panduan setup backend
└── README.md                  # File ini
```

---

## 🤝 Kontribusi

Kontribusi sangat diterima! Berikut cara berkontribusi:

1. **Fork** repository ini
2. Buat **branch** baru untuk fitur Anda:
   ```bash
   git checkout -b feature/fitur-baru
   ```
3. **Commit** perubahan Anda:
   ```bash
   git commit -m "Tambah fitur: deskripsi singkat"
   ```
4. **Push** ke branch Anda:
   ```bash
   git push origin feature/fitur-baru
   ```
5. Buat **Pull Request** ke branch `main`

### Panduan Kontribusi:

- Pastikan kode bersih dan terdokumentasi
- Ikuti style yang sudah ada di project
- Test extension secara lokal sebelum membuat PR
- Jelaskan perubahan dengan detail di PR description
- Tambahkan screenshot jika ada perubahan UI

### Melaporkan Bug:

1. Buka halaman [Issues](../../issues)
2. Klik **New Issue**
3. Jelaskan bug dengan detail:
   - Langkah untuk mereproduksi
   - Perilaku yang diharapkan vs aktual
   - Screenshot atau error log
   - Versi Chrome dan OS

---

## 📄 Lisensi

Project ini dilisensikan di bawah **MIT License**.

```
MIT License

Copyright (c) 2025 Araya Basecamp Extensions Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<p align="center">
  Made with ❤️ for Basecamp users who need simple time tracking
</p>
