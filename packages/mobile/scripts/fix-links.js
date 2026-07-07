/**
 * npm hoists a mismatched react-native under the root expo package and
 * leaves expo-router un-hoisted, which breaks Metro/babel resolution in
 * this monorepo. Runs on postinstall to keep one coherent dependency tree.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');
const mobileNM = path.resolve(__dirname, '..', 'node_modules');
const rootNM = path.join(root, 'node_modules');

// 1. Remove the stray react-native nested under root expo (wrong major version)
const strayRN = path.join(rootNM, 'expo', 'node_modules', 'react-native');
if (fs.existsSync(strayRN)) {
  fs.rmSync(strayRN, { recursive: true, force: true });
  console.log('fix-links: removed stray', strayRN);
}

// 2. Symlink the mobile app's copies at the root so root-level tooling resolves them
for (const pkg of ['react-native', 'expo-router']) {
  const target = path.join(mobileNM, pkg);
  const link = path.join(rootNM, pkg);
  if (!fs.existsSync(target)) continue;
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink()) fs.unlinkSync(link);
    else continue; // real dir at root — leave it alone
  } catch { /* link doesn't exist yet */ }
  fs.symlinkSync(target, link, 'dir');
  console.log('fix-links: linked', pkg);
}
