export interface WordFrequency { lemma: string; frequency: number; ignored: boolean; }

export interface WordAnalysis {
  // Lexical
  lex?: string; root?: string; gloss?: string; diac?: string;
  bw?: string; caphi?: string; pattern?: string;
  // Morphology
  pos?: string; per?: string; gen?: string; num?: string; asp?: string;
  mod?: string; vox?: string; stt?: string; cas?: string;
  form_gen?: string; form_num?: string; xpos?: string; feats?: string;
  // Clitics
  prc0?: string; prc1?: string; prc2?: string; prc3?: string;
  enc0?: string; enc1?: string; enc2?: string;
}

/** Definitions under one part-of-speech heading (Wiktionary or model gloss). */
export interface DefinitionEntry { pos: string; definitions: string[]; }
export interface DefinitionsResponse { lemma: string; entries: DefinitionEntry[]; source: string; }

export interface SubtitleSegment { lemma: string; start: number; length: number; analysis?: WordAnalysis | null; }
export interface SubtitleEntry {
  index: number;
  start_time: string;
  end_time: string;
  start_seconds: number;
  text: string;
  segments: SubtitleSegment[];
}

export interface AnalyzeResponse { results: WordFrequency[]; total_unique: number; total_tokens: number; subtitles: SubtitleEntry[]; }
export interface SessionOut { id: number; name: string; language: string; srt_filename: string; created_at: string; }
export interface SessionDetail extends SessionOut { subtitles: SubtitleEntry[]; native_subtitles: SubtitleEntry[]; results: WordFrequency[]; }
export interface SessionCreateRequest { language: string; srt_filename: string; subtitles: SubtitleEntry[]; native_subtitles: SubtitleEntry[]; results: WordFrequency[]; }
