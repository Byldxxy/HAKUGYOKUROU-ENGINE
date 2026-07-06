const roomIdPattern = /^\d{6}$/;

const isValidRoomId = (value) => roomIdPattern.test(String(value || ''));

const normalizeText = (value, maxLength) => String(value || '').trim().slice(0, maxLength);

const sanitizeNotebook = (notebook = {}) => ({
  freeNotes: String(notebook.freeNotes || '').slice(0, 100_000),
  clues: Array.isArray(notebook.clues) ? notebook.clues.slice(0, 500) : [],
  graphNodes: Array.isArray(notebook.graphNodes) ? notebook.graphNodes.slice(0, 200) : [],
  graphEdges: Array.isArray(notebook.graphEdges) ? notebook.graphEdges.slice(0, 400) : [],
});

module.exports = {
  isValidRoomId,
  normalizeText,
  sanitizeNotebook,
};
