// Deterministically maps an id (peer id or site id) to a stable color, so
// the same participant always shows up with the same dot color for
// everyone in the room without any coordination — every peer computes it
// independently from the id string alone.
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
