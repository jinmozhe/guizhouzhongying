// Keep Sass and native configuration on the same palette without runtime dependencies.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = new URL('../../apps/miniapp/src/styles/palette.json', import.meta.url)
const target = new URL('../../apps/miniapp/src/styles/_palette.scss', import.meta.url)
const colors = JSON.parse(readFileSync(source, 'utf8'))
const lines = Object.entries(colors).map(([name, value]) => {
  assert.match(name, /^[a-z][a-zA-Z]+$/)
  assert.match(value, /^#[0-9A-F]{6}$/)
  return `$${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`
})
const expected = `// Generated from palette.json by scripts/design/generate-miniapp-palette.mjs. Do not edit.\n${lines.join('\n')}\n`
if (process.argv.includes('--check')) {
  assert.equal(readFileSync(target, 'utf8'), expected, 'Miniapp Sass palette drift')
  console.log('Miniapp Sass palette matches its JSON source.')
} else {
  writeFileSync(target, expected, 'utf8')
  console.log(`Generated ${fileURLToPath(target)}`)
}
