'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
try {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../references/config.json'), 'utf8'));
  const [tool, ...args] = process.argv.slice(2);
  if (!['mtg', 'spellbook'].includes(tool)) throw new Error('Choose mtg or spellbook, followed by --help or a command');
  const script = path.join(config.vaultRoot, 'tools', tool + '.js');
  if (!fs.existsSync(script)) throw new Error('Vault tool missing. Check references/config.json: ' + script);
  const result = spawnSync(process.execPath, [script, ...args], { cwd: config.vaultRoot, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
