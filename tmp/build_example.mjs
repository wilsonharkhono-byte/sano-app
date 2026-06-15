import XLSX from 'xlsx';

// Build example workbook with BOTH formulas AND cached computed values
// so the parser can read .v immediately without Excel re-opening the file.

const wb = XLSX.utils.book_new();

// Price constants we can reuse to pre-compute cached values
const P = {
  pasirPasangLumajang: 350000,
  split: 290000,
  semen: 65000,
  rmK300: 1040000,
  rmK350: 1100000,
  rmK400: 1160000,
  besiD10: 13500,
  besiD13: 13500,
  besiD16: 13500,
  kawat: 22000,
  air: 40000,
  multipleks: 365000,
  paku: 25000,
  bata: 900,
  pvc4: 460000,
  // Upah
  pekerja: 130000,
  tukangBatu: 175000,
  tukangBesi: 175000,
  tukangKayu: 175000,
  kepalaTukang: 200000,
  mandor: 210000,
  corManual: 100000,
  pasangBesi: 2500,
  pasangBekisting: 60000,
  bongkarBekisting: 25000,
};

// ═══ 1. Material sheet ═══
const matData = [
  ['Tanggal', null, ':', null, null, null, null],
  ['Proyek', null, ':', null, 'RAB Contoh', null, null],
  ['Lokasi', null, ':', null, 'Surabaya', null, null],
  [null, null, null, null, null, null, null],
  ['No.', 'MATERIALS', null, null, 'PRODUK / MODEL / TIPE', 'SAT', 'HARGA NET'],
  [null, null, null, null, null, 'Rp.', null],
  [null, null, null, null, null, null, null],
  [1,  'Pasir Pasang',                  null, null, 'ex Lumajang',         'm3',  P.pasirPasangLumajang],
  [2,  'Split 1:2',                      null, null, 'ex Lokal',            'm3',  P.split],
  [3,  'Semen PC @50kg',                 null, null, 'Semen Gresik',        'sak', P.semen],
  [4,  'Readymix K-300',                 null, null, 'Jayamix slump 12±2',  'm3',  P.rmK300],   // row 11
  [5,  'Readymix K-350',                 null, null, 'Jayamix slump 12±2',  'm3',  P.rmK350],   // row 12
  [6,  'Readymix K-400',                 null, null, 'Jayamix slump 12±2',  'm3',  P.rmK400],   // row 13
  [7,  'Besi beton BJTD U40 D10',        null, null, 'SNI',                 'kg',  P.besiD10],  // row 14
  [8,  'Besi beton BJTD U40 D13',        null, null, 'SNI',                 'kg',  P.besiD13],  // row 15
  [9,  'Besi beton BJTD U40 D16',        null, null, 'SNI',                 'kg',  P.besiD16],  // row 16
  [10, 'Kawat beton',                    null, null, 'ex lokal',            'kg',  P.kawat],    // row 17
  [11, 'Air kerja',                      null, null, null,                  'm3',  P.air],      // row 18
  [12, 'Multipleks phenol film t=12mm',  null, null, 'Dynea',               'lbr', P.multipleks], // row 19
  [13, 'Paku 5cm',                       null, null, null,                  'kg',  P.paku],     // row 20
  [14, 'Bata merah',                     null, null, 'lokal poklu',         'pcs', P.bata],     // row 21
  [15, 'Pipa PVC 4 inch AW',             null, null, 'Rucika',              'btg', P.pvc4],     // row 22
];
const matSheet = XLSX.utils.aoa_to_sheet(matData);
matSheet['!ref'] = 'A1:G22';
XLSX.utils.book_append_sheet(wb, matSheet, 'Material');

// ═══ 2. Upah sheet ═══
const upahData = [
  [null], [null], [null],
  ['No.', 'P E K E R J A A N', 'SAT', 'UPAH NET'],
  [null, null, null, 'Rp.'],
  [null],
  [1,  'Pekerja',            'OH', P.pekerja],       // row 7
  [2,  'Tukang batu',        'OH', P.tukangBatu],
  [3,  'Tukang besi',        'OH', P.tukangBesi],
  [4,  'Tukang kayu',        'OH', P.tukangKayu],
  [5,  'Kepala tukang',      'OH', P.kepalaTukang],
  [6,  'Mandor',             'OH', P.mandor],
  [7,  'Cor beton manual',   'm3', P.corManual],     // row 13
  [8,  'Pasang besi manual', 'kg', P.pasangBesi],    // row 14
  [9,  'Pasang bekisting',   'm2', P.pasangBekisting], // row 15
  [10, 'Bongkar bekisting',  'm2', P.bongkarBekisting], // row 16
];
const upahSheet = XLSX.utils.aoa_to_sheet(upahData);
XLSX.utils.book_append_sheet(wb, upahSheet, 'Upah');

// ═══ 3. Analisa sheet ═══
// Build rows as plain objects, then inject cells with {f, v} pairs so cached values exist.
const anaRows = [
  ['DAFTAR ANALISA HARGA SATUAN'],
  [], ['Proyek', ': RAB Contoh'], ['Lokasi', ': Surabaya'],
  [], [], [], [],
  ['No.', 'URAIAN PEKERJAAN', null, null, 'HARGA SATUAN', 'MATERIAL', 'UPAH', 'PERALATAN', 'JUMLAH HARGA'],
  [null, null, null, null, '(Rp.)', '(Rp.)', '(Rp.)', '(Rp.)', '(Rp.)'],
  [], [],
  // Block 1 — row 13 title, row 14 component, row 15 jumlah
  [null, '1 m3 Beton Readymix K-300'],
  [null, 1.02, 'm3', 'Readymix K-300'],
  [null, null, null, null, 'Jumlah'],
  [],
  // Block 2 — row 17 title, row 18-21 components, row 22 jumlah
  [null, '1 m2 Bekisting Kolom Multipleks'],
  [null, 0.35, 'lbr', 'Multipleks phenol film t=12mm'],
  [null, 0.40, 'kg',  'Paku 5cm'],
  [null, 1,    'm2',  'Pasang bekisting'],
  [null, 1,    'm2',  'Bongkar bekisting'],
  [null, null, null, null, 'Jumlah'],
  [],
  // Block 3 — row 24 title, row 25-27 components, row 28 jumlah
  [null, '1 kg Pembesian Besi BJTD D13'],
  [null, 1.05,  'kg', 'Besi beton BJTD U40 D13'],
  [null, 0.015, 'kg', 'Kawat beton'],
  [null, 1,     'kg', 'Pasang besi manual'],
  [null, null, null, null, 'Jumlah'],
];
const anaSheet = XLSX.utils.aoa_to_sheet(anaRows);

// Helper: set both formula and cached value
const setFV = (sheet, addr, formula, value) => {
  sheet[addr] = { t: 'n', f: formula, v: value };
};

// --- Block 1 (row 13 title, row 14 component, row 15 jumlah) ---
// Component row 14: coeff 1.02 × Material!$G$11 (Readymix K-300 = 1040000)
setFV(anaSheet, 'E14', 'Material!$G$11', P.rmK300);
setFV(anaSheet, 'F14', 'B14*E14', 1.02 * P.rmK300);
anaSheet['E15'] = { t: 's', v: 'Jumlah' };
setFV(anaSheet, 'F15', 'SUM(F13:F14)', 1.02 * P.rmK300);
setFV(anaSheet, 'G15', 'SUM(G13:G14)', 0);
setFV(anaSheet, 'H15', 'SUM(H13:H14)', 0);
setFV(anaSheet, 'I15', 'F15+G15+H15',  1.02 * P.rmK300);

// --- Block 2 (row 17 title, rows 18-21 components, row 22 jumlah) ---
// row 18: 0.35 × Material!$G$19 (Multipleks = 365000)
setFV(anaSheet, 'E18', 'Material!$G$19', P.multipleks);
setFV(anaSheet, 'F18', 'B18*E18', 0.35 * P.multipleks);
// row 19: 0.40 × Material!$G$20 (Paku = 25000)
setFV(anaSheet, 'E19', 'Material!$G$20', P.paku);
setFV(anaSheet, 'F19', 'B19*E19', 0.40 * P.paku);
// row 20: 1 × Upah!$D$15 (Pasang bekisting = 60000) — LABOR col G
setFV(anaSheet, 'E20', 'Upah!$D$15', P.pasangBekisting);
setFV(anaSheet, 'G20', 'B20*E20', 1 * P.pasangBekisting);
// row 21: 1 × Upah!$D$16 (Bongkar bekisting = 25000) — LABOR col G
setFV(anaSheet, 'E21', 'Upah!$D$16', P.bongkarBekisting);
setFV(anaSheet, 'G21', 'B21*E21', 1 * P.bongkarBekisting);
anaSheet['E22'] = { t: 's', v: 'Jumlah' };
const b2mat = 0.35 * P.multipleks + 0.40 * P.paku;
const b2lab = P.pasangBekisting + P.bongkarBekisting;
setFV(anaSheet, 'F22', 'SUM(F17:F21)', b2mat);
setFV(anaSheet, 'G22', 'SUM(G17:G21)', b2lab);
setFV(anaSheet, 'H22', 'SUM(H17:H21)', 0);
setFV(anaSheet, 'I22', 'F22+G22+H22',  b2mat + b2lab);

// --- Block 3 (row 24 title, rows 25-27 components, row 28 jumlah) ---
// row 25: 1.05 × Material!$G$15 (BJTD D13 = 13500)
setFV(anaSheet, 'E25', 'Material!$G$15', P.besiD13);
setFV(anaSheet, 'F25', 'B25*E25', 1.05 * P.besiD13);
// row 26: 0.015 × Material!$G$17 (Kawat beton = 22000)
setFV(anaSheet, 'E26', 'Material!$G$17', P.kawat);
setFV(anaSheet, 'F26', 'B26*E26', 0.015 * P.kawat);
// row 27: 1 × Upah!$D$14 (Pasang besi manual = 2500) — LABOR col G
setFV(anaSheet, 'E27', 'Upah!$D$14', P.pasangBesi);
setFV(anaSheet, 'G27', 'B27*E27', 1 * P.pasangBesi);
anaSheet['E28'] = { t: 's', v: 'Jumlah' };
const b3mat = 1.05 * P.besiD13 + 0.015 * P.kawat;
const b3lab = P.pasangBesi;
setFV(anaSheet, 'F28', 'SUM(F24:F27)', b3mat);
setFV(anaSheet, 'G28', 'SUM(G24:G27)', b3lab);
setFV(anaSheet, 'H28', 'SUM(H24:H27)', 0);
setFV(anaSheet, 'I28', 'F28+G28+H28',  b3mat + b3lab);

anaSheet['!ref'] = 'A1:I30';
XLSX.utils.book_append_sheet(wb, anaSheet, 'Analisa');

// ═══ 4. RAB (A) sheet ═══
// Layout: A=NO B=URAIAN C=SAT D=VOL(display) E=HARGA_SAT F=TOTAL G=_ H=VOL(source)
// I=Material J=Upah K=Peralatan L=Subkon M=Prelim N=TOTAL_HARGA_SAT O=TOTAL
const rabData = [
  ['Estimasi Biaya — Contoh'],
  ['Pekerjaan', ': Struktur Contoh'],
  ['Lokasi', ': Surabaya'],
  [], [], [],
  ['NO', 'URAIAN PEKERJAAN', 'SAT', 'VOLUME', 'HARGA SATUAN', 'TOTAL HARGA', null, 'VOLUME', 'Material', 'Upah', 'Peralatan', 'Subkon', 'Prelim', 'TOTAL HARGA SATUAN', 'TOTAL HARGA'],
  [],
  ['I', 'PEKERJAAN STRUKTUR'],
  [],
  [1, 'Pengecoran kolom beton K-300', 'm3', null, null, null, null, 12.5, null, null, null, null, null, null, null],
  [2, 'Pembesian kolom BJTD D13',     'kg', null, null, null, null, 1850, null, null, null, null, null, null, null],
  [3, 'Bekisting kolom multipleks',   'm2', null, null, null, null, 85,   null, null, null, null, null, null, null],
];
const rabSheet = XLSX.utils.aoa_to_sheet(rabData);

// Block totals we'll reference from each BoQ item
const b1totalMat = 1.02 * P.rmK300;        // 1 m3 K-300  → $F$15
const b1totalLab = 0;
const b2totalMat = 0.35 * P.multipleks + 0.40 * P.paku;  // 1 m2 Bekisting → $F$22
const b2totalLab = P.pasangBekisting + P.bongkarBekisting;
const b3totalMat = 1.05 * P.besiD13 + 0.015 * P.kawat;   // 1 kg Pembesian → $F$28
const b3totalLab = P.pasangBesi;

// Item 1 (sheet row 11) — Beton K-300, block 1 jumlah = row 15
const vol1 = 12.5;
setFV(rabSheet, 'D11', 'H11', vol1);
setFV(rabSheet, 'I11', 'Analisa!$F$15', b1totalMat);
setFV(rabSheet, 'J11', 'Analisa!$G$15', b1totalLab);
setFV(rabSheet, 'K11', 'Analisa!$H$15', 0);
const n11 = b1totalMat + b1totalLab;
setFV(rabSheet, 'N11', 'SUM(I11:M11)', n11);
setFV(rabSheet, 'O11', 'H11*N11', vol1 * n11);
setFV(rabSheet, 'E11', 'N11', n11);
setFV(rabSheet, 'F11', 'O11', vol1 * n11);

// Item 2 (sheet row 12) — Pembesian D13, block 3 jumlah = row 28
const vol2 = 1850;
setFV(rabSheet, 'D12', 'H12', vol2);
setFV(rabSheet, 'I12', 'Analisa!$F$28', b3totalMat);
setFV(rabSheet, 'J12', 'Analisa!$G$28', b3totalLab);
setFV(rabSheet, 'K12', 'Analisa!$H$28', 0);
const n12 = b3totalMat + b3totalLab;
setFV(rabSheet, 'N12', 'SUM(I12:M12)', n12);
setFV(rabSheet, 'O12', 'H12*N12', vol2 * n12);
setFV(rabSheet, 'E12', 'N12', n12);
setFV(rabSheet, 'F12', 'O12', vol2 * n12);

// Item 3 (sheet row 13) — Bekisting kolom, block 2 jumlah = row 22
const vol3 = 85;
setFV(rabSheet, 'D13', 'H13', vol3);
setFV(rabSheet, 'I13', 'Analisa!$F$22', b2totalMat);
setFV(rabSheet, 'J13', 'Analisa!$G$22', b2totalLab);
setFV(rabSheet, 'K13', 'Analisa!$H$22', 0);
const n13 = b2totalMat + b2totalLab;
setFV(rabSheet, 'N13', 'SUM(I13:M13)', n13);
setFV(rabSheet, 'O13', 'H13*N13', vol3 * n13);
setFV(rabSheet, 'E13', 'N13', n13);
setFV(rabSheet, 'F13', 'O13', vol3 * n13);

rabSheet['!ref'] = 'A1:O15';
XLSX.utils.book_append_sheet(wb, rabSheet, 'RAB (A)');

const outPath = 'assets/BOQ/CONTOH_Template_Parser.xlsx';
XLSX.writeFile(wb, outPath);
console.log(`Wrote ${outPath}`);
