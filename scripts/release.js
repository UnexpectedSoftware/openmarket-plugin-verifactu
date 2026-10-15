'use strict';

/**
 * Builds dist/verifactu/ (plugin.json, index.js, src) and dist/verifactu-<version>.zip.
 * Pure Node (zlib), no external zip tool. The zip contains one top-level folder: verifactu/.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const out = path.join(dist, 'verifactu');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  throw new Error(`plugin.json version ${manifest.version} does not match package.json ${pkg.version}`);
}

fs.rmSync(dist, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
for (const entry of ['plugin.json', 'index.js', 'src', 'LICENSE']) {
  fs.cpSync(path.join(root, entry), path.join(out, entry), {recursive: true});
}

/** @param {string} dir @returns {string[]} */
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : [full];
  }).sort();
}

const local = [];
const central = [];
let offset = 0;
for (const file of files(out)) {
  const name = Buffer.from(path.relative(dist, file).split(path.sep).join('/'));
  const data = fs.readFileSync(file);
  const deflated = zlib.deflateRawSync(data);
  const crc = zlib.crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(deflated.length, 18); header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28);
  local.push(header, name, deflated);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0, 12); entry.writeUInt16LE(33, 14);
  entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(deflated.length, 20); entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + deflated.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
const zipPath = path.join(dist, `verifactu-${manifest.version}.zip`);
fs.writeFileSync(zipPath, Buffer.concat([...local, centralBuf, end]));
console.log(`built ${path.relative(root, out)}/ and ${path.relative(root, zipPath)}`);
