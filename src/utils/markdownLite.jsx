/**
 * Renders `**bold**` runs from /v1/ask's markdown-formatted answers as
 * <strong>, leaving everything else as plain text. Not a full markdown
 * parser on purpose: the answers only ever use bold + paragraph breaks
 * (confirmed across the memos generated in this project), so a regex
 * split covers what's actually there without pulling in a markdown lib.
 */
export function renderMarkdownLite(text) {
  if (!text) return null;
  return text.split('\n\n').map((paragraph, pIdx) => (
    <p key={pIdx} style={{ margin: pIdx === 0 ? '0 0 0.85em' : '0.85em 0' }}>
      {paragraph.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
        chunk.startsWith('**') && chunk.endsWith('**') ? <strong key={i}>{chunk.slice(2, -2)}</strong> : chunk
      )}
    </p>
  ));
}
