const fs = jest.createMockFromModule('fs/promises');

let mockFiles = {};

function __setMockFiles(newMockFiles) {
  mockFiles = newMockFiles;
}

async function readdir(directoryPath) {
  if (mockFiles[directoryPath]) {
    return Object.keys(mockFiles[directoryPath]);
  }
  // Fallback for other directories if needed, or throw an error.
  // For this case, we assume tests will mock necessary directories.
  const error = new Error(`ENOENT: no such file or directory, scandir '${directoryPath}'`);
  error.code = 'ENOENT';
  throw error;
}

async function readFile(filePath, options) {
    for (const dir in mockFiles) {
        if (mockFiles[dir][filePath]) {
            return mockFiles[dir][filePath];
        }
    }
    const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    error.code = 'ENOENT';
    throw error;
}

async function writeFile(filePath, data) {
  // For now, we just mock the success of writing a file.
  return Promise.resolve();
}

fs.__setMockFiles = __setMockFiles;
fs.readdir = readdir;
fs.readFile = readFile;
fs.writeFile = writeFile;

module.exports = fs;