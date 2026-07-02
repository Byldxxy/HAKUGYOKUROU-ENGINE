const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');

const emptyNotebook = () => ({
  freeNotes: '',
  clues: [],
  graphNodes: [],
  graphEdges: [],
  updatedAt: null,
});

const readNotebooks = () => {
  const data = readJson(config.paths.notebooksFile, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

const writeNotebooks = (data) => {
  writeJson(config.paths.notebooksFile, data);
};

const getRoomBucket = (db, roomId) => {
  if (!db[roomId]) db[roomId] = {};
  return db[roomId];
};

const getNotebook = ({ roomId, username }) => {
  const db = readNotebooks();
  return getRoomBucket(db, roomId)[username] || emptyNotebook();
};

const saveNotebook = ({ roomId, username, notebook }) => {
  const db = readNotebooks();
  const roomBucket = getRoomBucket(db, roomId);
  const savedNotebook = {
    ...emptyNotebook(),
    ...notebook,
    clues: Array.isArray(notebook.clues) ? notebook.clues : [],
    graphNodes: Array.isArray(notebook.graphNodes) ? notebook.graphNodes : [],
    graphEdges: Array.isArray(notebook.graphEdges) ? notebook.graphEdges : [],
    updatedAt: new Date().toISOString(),
  };

  roomBucket[username] = savedNotebook;
  writeNotebooks(db);
  return savedNotebook;
};

module.exports = {
  getNotebook,
  saveNotebook,
};
