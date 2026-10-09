// Regenerate public/favicon.ico (16/32/48) from public/favicon.svg.
// Uses the bundled Playwright Chromium so rasterization matches the browser.
// Usage: node scripts/generate-favicon.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')
const sizes = [16, 32, 48]

const browser = await chromium.launch()
try {
  const page = await browser.newPage()

  const { pngs, samples } = await page.evaluate(
    async ({ svg, sizes }) => {
      const load = size =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error(`SVG failed to load at ${size}px`))
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        })

      const render = async (size) => {
        const img = await load(size)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, size, size)
        const png = canvas.toDataURL('image/png')
        return { data: png.split(',')[1], ctx, canvas }
      }

      const pngs = []
      const samples = {}
      for (const size of sizes) {
        const { data, ctx, canvas } = await render(size)
        pngs.push(data)
        if (size === 32) {
          // center should be the warm bright core; corner should be dark indigo/transparent
          const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data)
          samples.center = px(16, 16)
          samples.corner = px(0, 0)
          samples.gemTop = px(16, 6)
          void canvas
        }
      }
      return { pngs, samples }
    },
    { svg, sizes }
  )

  const [c, g, k] = [samples.center, samples.gemTop, samples.corner]
  console.log('center (core)  rgb:', c.slice(0, 3).join(','), 'alpha:', c[3])
  console.log('gem top        rgb:', g.slice(0, 3).join(','), 'alpha:', g[3])
  console.log('corner         rgb:', k.slice(0, 3).join(','), 'alpha:', k[3])
  if (!(c[0] > 200 && c[1] > 180 && c[3] === 255)) throw new Error('core is not bright/warm as expected')
  if (!(k[3] === 0 || (k[0] < 60 && k[1] < 50))) throw new Error('corner is not dark/transparent as expected')

  const blobs = pngs.map(d => Buffer.from(d, 'base64'))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(blobs.length, 4)
  const entries = Buffer.alloc(16 * blobs.length)
  let offset = 6 + entries.length
  blobs.forEach((blob, i) => {
    entries.writeUInt8(sizes[i], i * 16) // width
    entries.writeUInt8(sizes[i], i * 16 + 1) // height
    entries.writeUInt8(0, i * 16 + 2) // palette colors
    entries.writeUInt8(0, i * 16 + 3) // reserved
    entries.writeUInt16LE(1, i * 16 + 4) // color planes
    entries.writeUInt16LE(32, i * 16 + 6) // bits per pixel
    entries.writeUInt32LE(blob.length, i * 16 + 8)
    entries.writeUInt32LE(offset, i * 16 + 12)
    offset += blob.length
  })
  writeFileSync(join(root, 'public/favicon.ico'), Buffer.concat([header, entries, ...blobs]))
  console.log(`favicon.ico written: ${sizes.join('/')}px, ${offset} bytes`)
} finally {
  await browser.close()
}
