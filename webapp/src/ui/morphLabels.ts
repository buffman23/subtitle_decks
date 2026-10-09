/* Human-readable labels for the raw tags the language processors emit:
   CAMeL Tools features (Arabic), Universal Dependencies UPOS + feats
   (Stanza, calamancy) and UniDic pos1 (Japanese). */

// CAMeL Tools feature values, keyed by feature name.
export const CAMEL_VALUE_LABELS: Record<string, Record<string, string>> = {
  asp: { c: 'Command', i: 'Imperfective', p: 'Perfective' },
  cas: { n: 'Nominative', a: 'Accusative', g: 'Genitive' },
  gen: { f: 'Feminine', m: 'Masculine' },
  form_gen: { f: 'Feminine', m: 'Masculine' },
  num: { s: 'Singular', d: 'Dual', p: 'Plural' },
  form_num: { s: 'Singular', d: 'Dual', p: 'Plural' },
  mod: { i: 'Indicative', j: 'Jussive', s: 'Subjunctive' },
  vox: { a: 'Active', p: 'Passive' },
  per: { '1': '1st person', '2': '2nd person', '3': '3rd person' },
  rat: { y: 'Rational', n: 'Irrational' },
  stt: { c: 'Construct (idafa)', d: 'Definite', i: 'Indefinite' },
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
};

/** Readable label for a CAMeL Tools POS tag, or undefined if unknown. */
export function expandArabicPos(raw: string): string | undefined {
  return CAMEL_VALUE_LABELS['pos'][raw];
}

// Universal Dependencies UPOS (Stanza, calamancy/spaCy)
const UPOS_LABELS: Record<string, string> = {
  NOUN: 'Noun', PROPN: 'Proper noun', VERB: 'Verb', AUX: 'Auxiliary',
  ADJ: 'Adjective', ADV: 'Adverb', PRON: 'Pronoun', DET: 'Determiner',
  ADP: 'Preposition', CCONJ: 'Conjunction', SCONJ: 'Conjunction',
  PART: 'Particle', INTJ: 'Interjection', NUM: 'Number',
  PUNCT: 'Punctuation', SYM: 'Symbol', X: 'Other',
};

// UniDic pos1 (Japanese)
const UNIDIC_LABELS: Record<string, string> = {
  '名詞': 'Noun', '動詞': 'Verb', '形容詞': 'Adjective', '形状詞': 'Adjectival noun',
  '副詞': 'Adverb', '助詞': 'Particle', '助動詞': 'Auxiliary', '代名詞': 'Pronoun',
  '連体詞': 'Adnominal', '接続詞': 'Conjunction', '感動詞': 'Interjection',
  '接頭辞': 'Prefix', '接尾辞': 'Suffix',
};

export function posLabel(raw: string): string {
  return UPOS_LABELS[raw] ?? UNIDIC_LABELS[raw] ?? expandArabicPos(raw) ?? raw;
}

// Universal Dependencies feature values (the `feats` string: "Case=Nom|Number=Sing").
const UD_FEAT_LABELS: Record<string, Record<string, string>> = {
  Person: { '1': '1st person', '2': '2nd person', '3': '3rd person' },
  Gender: { Masc: 'Masculine', Fem: 'Feminine', Neut: 'Neuter', Com: 'Common' },
  Number: { Sing: 'Singular', Plur: 'Plural', Dual: 'Dual' },
  Case: {
    Nom: 'Nominative', Acc: 'Accusative', Gen: 'Genitive', Dat: 'Dative', Voc: 'Vocative',
  },
  Definite: { Def: 'Definite', Ind: 'Indefinite' },
  Degree: { Pos: 'Positive', Cmp: 'Comparative', Sup: 'Superlative' },
  VerbForm: {
    Fin: 'Finite', Inf: 'Infinitive', Part: 'Participle', Ger: 'Gerund', Conv: 'Converb',
  },
  Mood: { Ind: 'Indicative', Imp: 'Imperative', Sub: 'Subjunctive', Cnd: 'Conditional' },
  Tense: { Past: 'Past', Pres: 'Present', Fut: 'Future', Imp: 'Imperfect', Pqp: 'Pluperfect' },
  Aspect: { Perf: 'Perfective', Imp: 'Imperfective', Prog: 'Progressive' },
  Voice: { Act: 'Active', Pass: 'Passive' },
  Polarity: { Neg: 'Negative' },
  Poss: { Yes: 'Possessive' },
  Reflex: { Yes: 'Reflexive' },
  PronType: {
    Prs: 'Personal', Dem: 'Demonstrative', Int: 'Interrogative', Rel: 'Relative',
    Art: 'Article', Ind: 'Indefinite', Neg: 'Negative', Tot: 'Total',
  },
};

// Display order for UD features in the grammar line; unlisted ones go last.
const UD_FEAT_ORDER = [
  'PronType', 'Person', 'Gender', 'Number', 'Case', 'Definite', 'Degree',
  'VerbForm', 'Mood', 'Tense', 'Aspect', 'Voice', 'Polarity', 'Poss', 'Reflex',
];

// Merged into one "3rd person masculine singular" phrase.
const PGN_FEATS = new Set(['Person', 'Gender', 'Number']);

/** Joins person/gender/number labels into one phrase: "3rd person masculine singular". */
export function pgnPhrase(labels: string[]): string | undefined {
  if (!labels.length) return undefined;
  const phrase = labels.join(' ').toLowerCase();
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Readable values from a UD feats string, in a stable order. */
export function expandUdFeats(feats: string): string[] {
  const pairs = feats.split('|')
    .map(p => p.split('='))
    .filter((kv): kv is [string, string] => kv.length === 2 && !!kv[0] && !!kv[1])
    // "Finite" is the default verb form and tells a learner nothing.
    .filter(([k, v]) => !(k === 'VerbForm' && v === 'Fin'));
  const rank = (k: string) => {
    const i = UD_FEAT_ORDER.indexOf(k);
    return i === -1 ? UD_FEAT_ORDER.length : i;
  };
  pairs.sort((a, b) => rank(a[0]) - rank(b[0]));

  const label = ([k, v]: [string, string]): string => {
    // Possessor features ("Number[psor]=Plur" on German "ihr" = "their").
    const psor = /^(\w+)\[psor\]$/.exec(k);
    if (psor) return `Possessor: ${label([psor[1], v]).toLowerCase()}`;
    return UD_FEAT_LABELS[k]?.[v]
      // Unknown feature: keep the information, lightly formatted ("Foreign: Yes").
      ?? `${k.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${v}`;
  };

  const parts: string[] = [];
  const pgn = pgnPhrase(pairs.filter(([k]) => PGN_FEATS.has(k)).map(label));
  for (const kv of pairs) {
    if (PGN_FEATS.has(kv[0])) {
      // Emit the merged phrase where the first of the three would have gone.
      if (pgn && !parts.includes(pgn)) parts.push(pgn);
    } else {
      parts.push(label(kv));
    }
  }
  return parts;
}

// Arabic proclitics (CAMeL prc0–prc3) as short learner-facing glosses.
const PROCLITIC_LABELS: Record<string, string> = {
  Al_det: 'the (al-)', Aa_prondem: 'this (ha-)',
  lA_neg: 'not (lā)', mA_neg: 'not (mā)', ma_neg: 'not (ma-)', AlmA_neg: 'not (mā)',
  mA_part: 'mā', mA_rel: 'what (mā)',
  '<i$_interrog': 'what? (ʾēsh)',
  bi_prep: 'with/by (bi-)', bi_part: 'bi-', bi_prog: 'progressive (bi-)',
  Ea_prep: 'on (ʿa-)', EalaY_prep: 'on (ʿalā)', fiy_prep: 'in (fī)',
  hA_dem: 'this (hā-)', Ha_fut: 'will (ḥa-)', sa_fut: 'will (sa-)',
  ka_prep: 'like (ka-)', la_prep: 'for/to (la-)', li_prep: 'for/to (li-)',
  libi_prep: 'for/to (li-)', min_prep: 'from (min)', ta_prep: 'by (ta-, oath)',
  la_emph: 'indeed (la-)', la_rc: 'then (la-)',
  laHa_emphfut: 'indeed will (laḥa-)', laHa_rcfut: 'then will (laḥa-)',
  li_jus: 'let (li-)', li_sub: 'in order to (li-)',
  wa_part: 'wa-', wa_prep: 'by (wa-, oath)', wa_conj: 'and (wa-)', wa_sub: 'while (wa-)',
  wA_voc: 'O (wā)', yA_voc: 'O (yā)',
  fa_conj: 'and so (fa-)', fa_conn: 'then (fa-)', fa_rc: 'then (fa-)', fa_sub: 'so that (fa-)',
  '>a_ques': 'question (ʾa-)',
};

const ENCLITIC_PERSONS: Record<string, { poss: string; obj: string }> = {
  '1s': { poss: 'my', obj: 'me' },
  '1p': { poss: 'our', obj: 'us' },
  '2ms': { poss: 'your (m.)', obj: 'you (m.)' },
  '2fs': { poss: 'your (f.)', obj: 'you (f.)' },
  '2d': { poss: 'your (two)', obj: 'you (two)' },
  '2mp': { poss: 'your (m. pl.)', obj: 'you (m. pl.)' },
  '2fp': { poss: 'your (f. pl.)', obj: 'you (f. pl.)' },
  '2p': { poss: 'your (pl.)', obj: 'you (pl.)' },
  '3ms': { poss: 'his', obj: 'him' },
  '3fs': { poss: 'her', obj: 'her' },
  '3d': { poss: 'their (two)', obj: 'them (two)' },
  '3mp': { poss: 'their (m.)', obj: 'them (m.)' },
  '3fp': { poss: 'their (f.)', obj: 'them (f.)' },
  '3p': { poss: 'their', obj: 'them' },
};

const ENCLITIC_OTHER: Record<string, string> = {
  Ah_voc: 'O (-āh)', lA_neg: 'not (lā)',
  ma_interrog: 'what?', mA_interrog: 'what?', man_interrog: 'who?',
  ma_rel: 'what', mA_rel: 'what', man_rel: 'who',
  ma_sub: 'mā', mA_sub: 'mā',
};

/** Short gloss for a CAMeL clitic value (proclitic or enclitic). */
export function cliticLabel(field: string, raw: string): string {
  if (field.startsWith('prc')) return PROCLITIC_LABELS[raw] ?? raw;
  const m = /^(\d[a-z]*)_(poss|dobj|iobj|pron)$/.exec(raw);
  const person = m ? ENCLITIC_PERSONS[m[1]] : undefined;
  if (m && person) {
    if (m[2] === 'poss') return person.poss;
    return m[2] === 'iobj' ? `to ${person.obj}` : person.obj;
  }
  return ENCLITIC_OTHER[raw] ?? raw;
}
