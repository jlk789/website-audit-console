import { readFileSync } from 'node:fs';

// Same relative path from src/ and dist/.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const version = pkg.version;
