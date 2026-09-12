// SANO - Indonesian site vocabulary for site-event-analyze.
//
// Used twice: as the transcription prompt, so gpt-4o-mini-transcribe writes
// "acian" and "bobok" instead of guessing at them, and inside the Claude system
// prompt, so the model reads site slang correctly. Plain words only; nothing
// here is an instruction.

export const SITE_GLOSSARY: ReadonlyArray<string> = [
  // Struktur dan pasangan
  'bekisting', 'cor', 'besi', 'sloof', 'kolom', 'balok', 'dak', 'sparing', 'bobok',
  'bata ringan', 'hebel', 'mortar', 'kamprot', 'plesteran', 'acian', 'screed', 'rabat',
  'waterproofing', 'grouting', 'nat',
  // Cacat dan mutu - kata-kata yang dipakai pengawas saat melaporkan masalah
  'kopong', 'rembes', 'keropos', 'gompal', 'melendut', 'retak rambut', 'mengelupas', 'bergelombang',
  // Ukur dan pasang
  'peil', 'waterpass', 'siku', 'lot',
  // Lantai, dinding, kusen
  'keramik', 'granit', 'marmer', 'parket', 'vinyl', 'skirting', 'plint', 'kusen', 'engsel', 'handle',
  'rel', 'kaca', 'tempered', 'HPL', 'multipleks',
  // Plafon
  'plafon', 'gypsum', 'compound', 'rangka hollow', 'list plafon', 'drop ceiling',
  // Pengecatan dan sealing
  'cat dasar', 'plamir', 'sealant', 'silikon',
  // MEP
  'stop kontak', 'saklar', 'titik lampu', 'downlight', 'armatur', 'MCB', 'kabel', 'conduit',
  'pipa AC', 'ducting', 'floor drain', 'kran', 'shower', 'kloset', 'wastafel', 'sanitair',
  'water heater', 'shaft',
  // Furniture dan logam
  'kitchen set', 'railing', 'stainless',
  // Orang di lapangan
  'mandor', 'tukang', 'kenek',
];

/**
 * Sized for gpt-4o-mini-transcribe, whose prompt is a short vocabulary hint,
 * not a set of instructions. Keep the whole glossary comfortably inside it:
 * transcriptionPrompt() stops adding terms at the cap, so anything past it is
 * silently never seen by the transcriber. The margin also matters if the model
 * is ever swapped for whisper-1, which truncates the prompt to the FIRST 224
 * tokens and drops the tail without a word.
 */
export const TRANSCRIPTION_PROMPT_MAX_CHARS = 900;

/** A short, natural-language vocabulary prompt; terms are added until the cap. */
export function transcriptionPrompt(): string {
  const head = 'Catatan suara pengawas proyek rumah di Indonesia. Istilah lapangan: ';
  let text = head;
  for (const term of SITE_GLOSSARY) {
    const next = text === head ? `${text}${term}` : `${text}, ${term}`;
    if (next.length + 1 > TRANSCRIPTION_PROMPT_MAX_CHARS) break;
    text = next;
  }
  return `${text}.`;
}
