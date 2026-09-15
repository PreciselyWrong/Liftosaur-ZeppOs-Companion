import { paginateNotes } from './exercise-notes.js';

export function exerciseInfoPages(content, enabled, imageUrl) {
  const hasImage = enabled && Boolean(imageUrl);
  return paginateNotes(content, hasImage ? 60 : 90, hasImage ? 3 : 6);
}
