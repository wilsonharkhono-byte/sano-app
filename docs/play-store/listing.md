# SANO — Play Console answers

Copy-paste these when Play Console asks. Internal testing can roll out before
every item is filled; fill them anyway so nothing blocks later.

## Create app
- App name: **SANO**
- Default language: **Indonesian – id**
- App or game: **App**
- Free or paid: **Free**
- Declarations: tick both (developer policies, US export laws)

## Store listing (Grow → Store presence → Main store listing)

**Short description** (≤ 80 chars)
```
SANO: operasional lapangan, material, dan persetujuan proyek konstruksi
```

**Full description**
```
SANO adalah aplikasi operasional internal PT Saranah Arsitek Nugraha untuk staf kantor dan pengawas lapangan.

✦ FITUR UTAMA
• Permintaan material dari lapangan, persetujuan estimator, dan pemesanan oleh admin dalam satu alur.
• Penerimaan material dengan foto bukti dan verifikasi lokasi GPS.
• Catatan lapangan per ruangan: foto, catatan suara, dan status pekerjaan.
• Notifikasi langsung di HP saat ada permintaan, persetujuan, atau pekerjaan baru.
• Laporan progres dan grafik material vs progres per proyek.

✦ UNTUK SIAPA?
SANO hanya dapat digunakan oleh staf yang akunnya dibuat oleh admin PT Saranah Arsitek Nugraha. Aplikasi ini tidak menerima pendaftaran mandiri. Jika Anda staf dan belum punya akun, hubungi admin.

Kebijakan privasi: https://sano-app.vercel.app/privacy.html

PT Saranah Arsitek Nugraha
```

- App icon: `docs/play-store/icon-512.png` (512×512 PNG)
- Feature graphic / screenshots: not needed for internal testing.
- Category: **Business**
- Contact email: **wilsonharkhono@gmail.com**

## App content (Policy → App content)

| Item | Answer |
|---|---|
| Privacy policy | `https://sano-app.vercel.app/privacy.html` |
| App access | **All or some functionality is restricted** → add a reviewer login only if Google asks (internal testing rarely does). Create a dedicated reviewer account for it; never give a real staff password. |
| Ads | **No ads** |
| Content rating | Category **All other app types**; answer **No** to every question (no violence, sexual content, profanity, drugs, gambling, user chat, location sharing with other users, or purchases). Expected: **Everyone / 3+** |
| Target audience | **18 and over** only. Not designed for children. |
| News app | No |
| Government app | No |
| Financial features | None |
| Health | None |
| Data safety | See below |

## Data safety

- Does the app collect or share required user data types? **Yes**
- Is all user data encrypted in transit? **Yes**
- Do you provide a way for users to request deletion? **Yes** (via admin / email in the privacy policy)

| Data type | Collected | Shared | Optional? | Purposes |
|---|---|---|---|---|
| Personal info → Name | Yes | No | Required | App functionality, Account management |
| Personal info → Email address | Yes | No | Required | Account management |
| Personal info → Phone number | Yes | No | Optional | App functionality |
| Photos and videos → Photos | Yes | No | Required | App functionality, Fraud prevention |
| Audio → Voice or sound recordings | Yes | No | Optional | App functionality |
| Location → Precise location | Yes | No | Required | App functionality, Fraud prevention |
| Device or other IDs | Yes (push token) | No | Required | App functionality |

"Shared = No" is correct: Supabase, Anthropic, OpenAI, Expo and Firebase process
data on our behalf (service providers), which Play does not count as sharing.
Processing is ephemeral = No (data is stored).
