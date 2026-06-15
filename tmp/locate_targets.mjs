import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const rab = wb.Sheets['RAB (A)'];
const range = XLSX.utils.decode_range(rab['!ref']);

function get(addr) {
  const c = rab[addr];
  return c ? c.v : null;
}

// Print rows 47..85 fully so we can pin down III.A.1.* through III.A.4.*
console.log('=== RAB (A) rows 47..85 — cols A..AA ===');
console.log('row | A | B | C | D=vol | E=unit_marked | N=at_cost | R | S | T | V | W | Z | AA');
for (let r = 46; r < 85; r++) {
  const vals = {
    A: get(XLSX.utils.encode_cell({ r, c: 0 })),
    B: get(XLSX.utils.encode_cell({ r, c: 1 })),
    C: get(XLSX.utils.encode_cell({ r, c: 2 })),
    D: get(XLSX.utils.encode_cell({ r, c: 3 })),
    E: get(XLSX.utils.encode_cell({ r, c: 4 })),
    N: get(XLSX.utils.encode_cell({ r, c: 13 })),
    R: get(XLSX.utils.encode_cell({ r, c: 17 })),
    S: get(XLSX.utils.encode_cell({ r, c: 18 })),
    T: get(XLSX.utils.encode_cell({ r, c: 19 })),
    V: get(XLSX.utils.encode_cell({ r, c: 21 })),
    W: get(XLSX.utils.encode_cell({ r, c: 22 })),
    Z: get(XLSX.utils.encode_cell({ r, c: 25 })),
    AA: get(XLSX.utils.encode_cell({ r, c: 26 })),
  };
  // Compact line
  const line = `r${(r+1).toString().padStart(3)} | A=${String(vals.A ?? '').slice(0, 4)} | B=${String(vals.B ?? '').slice(0, 22)} | D=${vals.D ?? ''} | N=${vals.N ?? ''} | R=${vals.R ?? ''} | S=${vals.S ?? ''} | T=${vals.T ?? ''} | V=${vals.V ?? ''} | W=${vals.W ?? ''} | Z=${vals.Z ?? ''} | AA=${vals.AA ?? ''}`;
  console.log(line);
}
