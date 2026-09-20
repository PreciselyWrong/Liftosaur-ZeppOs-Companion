import { paginateNotes } from './exercise-notes.js';

export function exerciseInfoPages(content, enabled, imageUrl, imageStatus = null) {
  const hasImage = Boolean(enabled && imageUrl && imageStatus === 'ready');
  const sections = String(content || '').trim().split(/(?=^##\s+)/m);
  const pages = [];
  if (hasImage) {
    pages.push({ image: true, subtitle: '', body: '' });
  }
  for (const section of sections) {
    const match = /^##\s+([^\n]+)\n?/.exec(section);
    const subtitle = match ? match[1].trim() : 'Details';
    const body = (match ? section.slice(match[0].length) : section).trim();
    if (!body) continue;
    for (const text of paginateNotes(body, 175, 6, 23)) {
      pages.push({ subtitle, body: text });
    }
  }
  if (!pages.length) {
    return [{ subtitle: 'Details', body: 'No notes for this exercise.' }];
  }
  if (hasImage && pages.length === 1) {
    pages.push({ subtitle: 'Details', body: 'No notes for this exercise.' });
  }
  return pages;
}
