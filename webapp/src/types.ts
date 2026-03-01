export interface WordFrequency { lemma: string; frequency: number; ignored: boolean; }
export interface AnalyzeResponse { results: WordFrequency[]; total_unique: number; total_tokens: number; }
export interface SessionOut { id: number; name: string; language: string; srt_filename: string; created_at: string; }
export interface SessionDetail extends SessionOut { srt_content: string; results: WordFrequency[]; }
export interface SessionCreateRequest { name: string | null; language: string; srt_filename: string; srt_content: string; results: WordFrequency[]; }
