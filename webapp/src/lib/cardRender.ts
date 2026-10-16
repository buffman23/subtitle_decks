/* Renders a SubtitleDecks note the way its Anki card templates do (see
   app/services/anki_client.py), for the card wizard's preview and the Study
   page. Rendering from the note's fields avoids Anki's own question/answer
   HTML, whose [sound:] tags only play inside Anki. */
import { escapeHtml, textHtml } from './html';

export interface CardContent {
  word: string;
  native: string;
  example_foreign: string;
  example_native: string;
}

export interface CardMedia {
  imageUrl: string | null;
  audioUrl: string | null;
}

// 0 = Forward (foreign word on the front), 1 = Reverse (native word on the front)
export type CardOrd = 0 | 1;

function wordLine(c: CardContent, m: CardMedia): string {
  // The audio play button sits right after the foreign word.
  const play = m.audioUrl
    ? ` <button type="button" class="anki-play" data-audio="${escapeHtml(m.audioUrl)}" title="Play audio" aria-label="Play audio"><i class="bi bi-play-circle-fill"></i></button>`
    : '';
  return `<div class="anki-word" dir="auto">${textHtml(c.word)}${play}</div>`;
}

const block = (cls: string, text: string): string =>
  text.trim() ? `<div class="${cls}" dir="auto">${textHtml(text)}</div>` : '';

const image = (m: CardMedia): string =>
  m.imageUrl ? `<div class="anki-image"><img src="${escapeHtml(m.imageUrl)}" alt=""></div>` : '';

export function renderFront(c: CardContent, m: CardMedia, ord: CardOrd): string {
  if (ord === 0) return wordLine(c, m) + block('anki-example', c.example_foreign);
  return block('anki-native', c.native) + image(m);
}

export function renderBack(c: CardContent, m: CardMedia, ord: CardOrd): string {
  const front = renderFront(c, m, ord);
  if (ord === 0) {
    return front + '<hr class="anki-answer">' + block('anki-native', c.native)
      + block('anki-example', c.example_native) + image(m);
  }
  return front + '<hr class="anki-answer">' + wordLine(c, m)
    + block('anki-example', c.example_foreign) + block('anki-example', c.example_native);
}

/** Make .anki-play buttons inside `root` play their audio through `player`. */
export function wireAudioButtons(root: HTMLElement, player: HTMLAudioElement): void {
  root.addEventListener('click', e => {
    const btn = (e.target as Element).closest<HTMLElement>('.anki-play');
    if (!btn) return;
    e.preventDefault();
    playAudio(player, btn.dataset['audio'] ?? '');
  });
}

export function playAudio(player: HTMLAudioElement, url: string): void {
  if (!url) return;
  if (player.getAttribute('src') !== url) player.src = url;
  player.currentTime = 0;
  void player.play().catch(() => { /* autoplay blocked or bad file */ });
}
