import type { WordAnalysis } from '../types';

const FIELD_LABELS: Record<string, string> = {
  lex: 'Lemma', root: 'Root', gloss: 'Gloss', diac: 'Diacritized',
  bw: 'Buckwalter', caphi: 'CAPHI', pattern: 'Pattern',
  pos: 'POS', per: 'Person', gen: 'Gender', num: 'Number',
  asp: 'Aspect', mod: 'Mood', vox: 'Voice', stt: 'State', cas: 'Case',
  form_gen: 'Form gender', form_num: 'Form number',
  prc0: 'Proclitic 0', prc1: 'Proclitic 1', prc2: 'Proclitic 2', prc3: 'Proclitic 3',
  enc0: 'Enclitic 0', enc1: 'Enclitic 1', enc2: 'Enclitic 2',
};

const LEXICAL_FIELDS  = ['lex', 'root', 'gloss', 'diac', 'bw', 'caphi', 'pattern'];
const MORPH_FIELDS    = ['pos', 'per', 'gen', 'num', 'asp', 'mod', 'vox', 'stt', 'cas', 'form_gen', 'form_num'];
const CLITIC_FIELDS   = ['prc0', 'prc1', 'prc2', 'prc3', 'enc0', 'enc1', 'enc2'];

let tooltipEl: HTMLElement | null = null;

export function initWordTooltip(): void {
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'word-tooltip';
  tooltipEl.className = 'word-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);

  document.addEventListener('click', e => {
    if (tooltipEl && !tooltipEl.contains(e.target as Node)) {
      hideWordTooltip();
    }
  }, true);
}

export function hideWordTooltip(): void {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

export function showWordTooltip(analysis: WordAnalysis, anchorEl: HTMLElement, token?: string): void {
  if (!tooltipEl) return;

  const sections: Array<{ label: string; fields: string[] }> = [
    { label: 'Lexical', fields: LEXICAL_FIELDS },
    { label: 'Morphology', fields: MORPH_FIELDS },
    { label: 'Clitics', fields: CLITIC_FIELDS },
  ];

  const ana = analysis as Record<string, string | undefined>;
  let bodyHtml = '';
  for (const { label, fields } of sections) {
    const entries = fields.filter(f => ana[f] != null && ana[f] !== '');
    if (!entries.length) continue;
    bodyHtml += `<p class="word-tooltip-section-label">${label}</p><dl class="word-tooltip-dl">`;
    for (const f of entries) {
      bodyHtml += `<dt>${FIELD_LABELS[f] ?? f}</dt><dd>${escapeHtml(String(ana[f]))}</dd>`;
    }
    bodyHtml += '</dl>';
  }

  const title = token ?? ana['lex'] ?? '';
  tooltipEl.innerHTML = `
    <div class="word-tooltip-header">
      <span class="word-tooltip-title" dir="rtl">${escapeHtml(title)}</span>
      <button class="word-tooltip-close" aria-label="Close">&times;</button>
    </div>
    <div class="word-tooltip-body">${bodyHtml}</div>`;

  tooltipEl.querySelector('.word-tooltip-close')?.addEventListener('click', e => {
    e.stopPropagation();
    hideWordTooltip();
  });

  // Show off-screen first to measure
  tooltipEl.style.display = 'block';
  tooltipEl.style.visibility = 'hidden';
  tooltipEl.style.position = 'fixed';
  tooltipEl.style.top = '0';
  tooltipEl.style.left = '0';

  const anchor = anchorEl.getBoundingClientRect();
  const tip = tooltipEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const GAP = 6;
  let top = anchor.bottom + GAP;
  let left = anchor.left;

  // Flip above if clipped at bottom
  if (top + tip.height > vh) top = anchor.top - tip.height - GAP;
  // Shift left if clipped at right
  if (left + tip.width > vw) left = vw - tip.width - GAP;
  if (left < 0) left = GAP;

  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.visibility = 'visible';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
