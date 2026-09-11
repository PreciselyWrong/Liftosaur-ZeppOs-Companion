export function exerciseInfoPages(textPages, enabled, imageUrl) {
  return enabled && imageUrl ? [null, ...textPages] : textPages;
}
