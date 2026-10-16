export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Plain multi-line text as HTML (escaped, newlines as <br>).
export function textHtml(str: string): string {
  return escapeHtml(str.trim()).replace(/\n/g, '<br>');
}
