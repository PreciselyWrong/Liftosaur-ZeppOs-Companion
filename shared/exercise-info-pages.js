import { paginateNotes } from './exercise-notes.js';

export function exerciseInfoPages(content, enabled, imageUrl, imageStatus = null) {
  const hasImage = enabled && Boolean(imageUrl) && imageStatus !== 'unavailable';
  const sections = String(content || '').trim().split(/(?=^##\s+)/m);
  const pages = [];
  for (const section of sections) {
    const match = /^##\s+([^\n]+)\n?/.exec(section);
    const subtitle = match ? match[1].trim() : 'Details';
    const body = (match ? section.slice(match[0].length) : section).trim();
    if (!body) continue;
    const firstPage = hasImage && pages.length === 0 ? { chars: 110, lines: 3 } : null;
    for (const text of paginateNotes(body, 175, 6, 23, firstPage)) pages.push({ subtitle, body: text });
  }
  return pages.length ? pages : [{ subtitle: 'Details', body: 'No notes for this exercise.' }];
}
