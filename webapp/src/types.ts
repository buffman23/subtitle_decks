export interface WordFrequency { lemma: string; frequency: number; ignored: boolean; }

export interface SubtitleSegment { lemma: string; start: number; length: number; }
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
