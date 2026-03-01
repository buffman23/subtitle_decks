import { state } from '../state';
import { closeFab } from './fab';

export function initCsvExport(): void {
  document.getElementById('btn-csv')?.addEventListener('click', () => {
    closeFab();
    if (!state.allResults.length) return;
    const header = 'rank,lemma,frequency,ignored\n';
    const rows = state.allResults.map((r, i) => `${i + 1},"${r.lemma}",${r.frequency},${r.ignored}`).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.currentFilename || 'results').replace(/\.srt$/i, '') + '_freq.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
}
