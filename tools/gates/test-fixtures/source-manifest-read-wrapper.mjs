import { readSourceManifest } from '../lib.mjs'

const [artifacts, sourceRoot] = process.argv.slice(2)
await readSourceManifest(artifacts, { sourceRoot })
