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

const FEATURE_VALUE_LABELS: Record<string, Record<string, string>> = {
  asp: { c: 'Command', i: 'Imperfective', p: 'Perfective', na: 'N/A' },
  cas: { n: 'Nominative', a: 'Accusative', g: 'Genitive', u: 'Undefined', na: 'N/A' },
  gen: { f: 'Feminine', m: 'Masculine', na: 'N/A' },
  form_gen: { f: 'Feminine', m: 'Masculine', na: 'N/A' },
  num: { s: 'Singular', d: 'Dual', p: 'Plural', u: 'Undefined', na: 'N/A' },
  form_num: { s: 'Singular', d: 'Dual', p: 'Plural', u: 'Undefined', na: 'N/A' },
  mod: { i: 'Indicative', j: 'Jussive', s: 'Subjunctive', u: 'Undefined', na: 'N/A' },
  vox: { a: 'Active', p: 'Passive', u: 'Undefined', na: 'N/A' },
  per: { '1': '1st person', '2': '2nd person', '3': '3rd person', na: 'N/A' },
  rat: { y: 'Rational', n: 'Irrational', na: 'N/A' },
  stt: { c: 'Construct (idafa)', d: 'Definite', i: 'Indefinite', u: 'Undefined', na: 'N/A' },
  pos: {
    noun: 'Noun', noun_prop: 'Proper noun', noun_num: 'Number noun', noun_quant: 'Quantity noun',
    adj: 'Adjective', adj_comp: 'Comparative adjective', adj_num: 'Numerical adjective',
    adv: 'Adverb', adv_interrog: 'Interrogative adverb', adv_rel: 'Relative adverb',
    pron: 'Pronoun', pron_dem: 'Demonstrative pronoun', pron_exclam: 'Exclamatory pronoun',
    pron_interrog: 'Interrogative pronoun', pron_rel: 'Relative pronoun',
    verb: 'Verb', verb_pseudo: 'Pseudo verb',
    part: 'Particle', part_dem: 'Demonstrative particle', part_det: 'Determiner particle',
    part_focus: 'Focus particle', part_fut: 'Future marker particle',
    part_interrog: 'Interrogative particle', part_neg: 'Negative particle',
    part_restrict: 'Restrictive particle', part_verb: 'Verbal particle', part_voc: 'Vocative particle',
    prep: 'Preposition', abbrev: 'Abbreviation', punc: 'Punctuation',
    conj: 'Conjunction', conj_sub: 'Subordinating conjunction',
    interj: 'Interjection', digit: 'Digit', latin: 'Latin/Foreign',
  },
  prc0: {
    '0': 'None', na: 'N/A',
    Aa_prondem: 'Demonstrative particle Aa', Al_det: 'Definite article Al',
    AlmA_neg: 'Al + negative mA', lA_neg: 'Negative lA', mA_neg: 'Negative mA',
    ma_neg: 'Negative ma', mA_part: 'Particle mA', mA_rel: 'Relative mA',
  },
  prc1: {
    '0': 'None', na: 'N/A',
    '<i$_interrog': 'Interrogative ish', bi_part: 'Particle bi', bi_prep: 'Preposition bi',
    bi_prog: 'Progressive bi', Ea_prep: 'Preposition Ea', EalaY_prep: 'Preposition EalaY',
    fiy_prep: 'Preposition fi', hA_dem: 'Demonstrative hA', Ha_fut: 'Future marker Ha',
    ka_prep: 'Preposition ka', la_emph: 'Emphatic la', la_prep: 'Preposition la',
    la_rc: 'Conditional la', libi_prep: 'Preposition li+bi',
    laHa_emphfut: 'Emphatic la + future Ha', laHa_rcfut: 'Conditional la + future Ha',
    li_jus: 'Jussive li', li_sub: 'Subjunctive li', li_prep: 'Preposition li',
    min_prep: 'Preposition min', sa_fut: 'Future marker sa', ta_prep: 'Preposition ta',
    wa_part: 'Particle wa', wa_prep: 'Preposition wa', wA_voc: 'Vocative wA', yA_voc: 'Vocative yA',
  },
  prc2: {
    '0': 'None', na: 'N/A',
    fa_conj: 'Conjunction fa', fa_conn: 'Connective fa', fa_rc: 'Conditional fa',
    fa_sub: 'Subordinating fa', wa_conj: 'Conjunction wa', wa_part: 'Particle wa',
    wa_sub: 'Subordinating wa',
  },
  prc3: {
    '0': 'None', na: 'N/A',
    '>a_ques': 'Interrogative >a',
  },
  enc0: {
    '0': 'None', na: 'N/A',
    '1s_dobj': '1st person singular direct object', '1s_poss': '1st person singular possessive', '1s_pron': '1st person singular pronoun',
    '1p_dobj': '1st person plural direct object', '1p_poss': '1st person plural possessive', '1p_pron': '1st person plural pronoun',
    '2d_dobj': '2nd person dual direct object', '2d_poss': '2nd person dual possessive', '2d_pron': '2nd person dual pronoun',
    '2fs_dobj': '2nd person feminine singular direct object', '2fs_poss': '2nd person feminine singular possessive', '2fs_pron': '2nd person feminine singular pronoun',
    '2fp_dobj': '2nd person feminine plural direct object', '2fp_poss': '2nd person feminine plural possessive', '2fp_pron': '2nd person feminine plural pronoun',
    '2ms_dobj': '2nd person masculine singular direct object', '2ms_poss': '2nd person masculine singular possessive', '2ms_pron': '2nd person masculine singular pronoun',
    '2mp_dobj': '2nd person masculine plural direct object', '2mp_poss': '2nd person masculine plural possessive', '2mp_pron': '2nd person masculine plural pronoun',
    '3d_dobj': '3rd person dual direct object', '3d_poss': '3rd person dual possessive', '3d_pron': '3rd person dual pronoun',
    '3fs_dobj': '3rd person feminine singular direct object', '3fs_poss': '3rd person feminine singular possessive', '3fs_pron': '3rd person feminine singular pronoun',
    '3fp_dobj': '3rd person feminine plural direct object', '3fp_poss': '3rd person feminine plural possessive', '3fp_pron': '3rd person feminine plural pronoun',
    '3ms_dobj': '3rd person masculine singular direct object', '3ms_poss': '3rd person masculine singular possessive', '3ms_pron': '3rd person masculine singular pronoun',
    '3mp_dobj': '3rd person masculine plural direct object', '3mp_poss': '3rd person masculine plural possessive', '3mp_pron': '3rd person masculine plural pronoun',
    Ah_voc: 'Vocative Ah', lA_neg: 'Negative lA',
    ma_interrog: 'Interrogative ma', mA_interrog: 'Interrogative mA', man_interrog: 'Interrogative man',
    ma_rel: 'Relative ma', mA_rel: 'Relative mA', man_rel: 'Relative man',
    ma_sub: 'Subordinating ma', mA_sub: 'Subordinating mA',
  },
};

function expandValue(field: string, raw: string): string {
  return FEATURE_VALUE_LABELS[field]?.[raw] ?? raw;
}

const LEXICAL_FIELDS  = ['lex', 'root', 'gloss', 'diac', 'bw', 'caphi', 'pattern'];
const MORPH_FIELDS    = ['pos', 'per', 'gen', 'num', 'asp', 'mod', 'vox', 'stt', 'cas', 'form_gen', 'form_num'];
const CLITIC_FIELDS   = ['prc0', 'prc1', 'prc2', 'prc3', 'enc0', 'enc1', 'enc2'];

let tooltipEl: HTMLElement | null = null;
let anchorEl: HTMLElement | null = null;

export function initWordTooltip(): void {
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'word-tooltip';
  tooltipEl.className = 'word-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);

  document.addEventListener('click', e => {
    if (tooltipEl && !tooltipEl.contains(e.target as Node)) {
      // Let sub-word click handlers manage the tooltip themselves
      if ((e.target as Element).closest?.('.sub-word[data-lemma]')) return;
      hideWordTooltip();
    }
  }, true);
}

export function hideWordTooltip(): void {
  if (tooltipEl) tooltipEl.style.display = 'none';
  anchorEl = null;
}

export function isWordTooltipVisible(): boolean {
  return !!tooltipEl && tooltipEl.style.display !== 'none';
}

export function isWordTooltipAnchor(el: HTMLElement): boolean {
  return isWordTooltipVisible() && anchorEl === el;
}

export function showWordTooltip(analysis: WordAnalysis, anchor: HTMLElement, token?: string): void {
  anchorEl = anchor;
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
      const raw = String(ana[f]);
      const val = f === 'gloss'
        ? raw.replace(/_\[CALIMA\]/g, '')
        : expandValue(f, raw);
      bodyHtml += `<dt>${FIELD_LABELS[f] ?? f}</dt><dd>${escapeHtml(val)}</dd>`;
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

  const anchorRect = anchor.getBoundingClientRect();
  const tip = tooltipEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const GAP = 6;
  let top = anchorRect.bottom + GAP;
  let left = anchorRect.left;

  // Flip above if clipped at bottom
  if (top + tip.height > vh) top = anchorRect.top - tip.height - GAP;
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
