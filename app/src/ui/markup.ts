export function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

const paths = {
  home: '<path d="m3 10 9-7 9 7v10H15v-7H9v7H3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 20h7"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  book: '<path d="M12 5v16M3 4q5-2 9 1 4-3 9-1v15q-5-2-9 1-4-3-9-1z"/>',
  external: '<path d="M14 3h7v7m0-7L10 14m0-10H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 1 2h4l1-2 4-2v-4l2-2-2-4-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  more: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m7-11-3 3 3 3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  forward: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  reload: '<path d="M20 4v6h-6M20 10a8 8 0 1 0 0 6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
} satisfies Record<string, string>;

export function icon(name: keyof typeof paths): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

export function emptyState(title: string, description: string): string {
  return `<div class="empty-state"><span class="empty-symbol">${icon('globe')}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>`;
}
