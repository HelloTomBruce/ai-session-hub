import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

/**
 * AI Automated Demo Video Recorder for Session Hub
 * Optimized for compact laptop screens and complete 100% UI capture.
 */

const BASE_URL = process.env.URL || 'http://localhost:3000'
const RECORDINGS_DIR = path.resolve(process.cwd(), 'recordings')

// Compact viewport: perfectly fits MacBook displays without overflowing
const VIEWPORT_WIDTH = 1360
const VIEWPORT_HEIGHT = 840

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true })
}

// Bezier mouse movement simulation helper
async function smoothMouseMove(page: any, targetX: number, targetY: number, steps = 20) {
  // Update virtual cursor in DOM
  await page.evaluate(({ x, y, duration }: { x: number, y: number, duration: number }) => {
    const cursor = document.getElementById('ai-virtual-cursor')
    if (cursor) {
      cursor.style.transition = `all ${duration}ms cubic-bezier(0.25, 1, 0.5, 1)`
      cursor.style.transform = `translate(${x}px, ${y}px)`
    }
  }, { x: targetX, y: targetY, duration: steps * 16 })

  await page.mouse.move(targetX, targetY, { steps })
  await page.waitForTimeout(steps * 16)
}

async function smoothClick(page: any, selector?: string, x?: number, y?: number) {
  let clickX = x ?? 0
  let clickY = y ?? 0

  if (selector) {
    const element = await page.$(selector)
    if (element) {
      const box = await element.boundingBox()
      if (box) {
        clickX = box.x + box.width / 2
        clickY = box.y + box.height / 2
      }
    }
  }

  if (clickX > 0 && clickY > 0) {
    await smoothMouseMove(page, clickX, clickY)
    // Trigger visual click ripple
    await page.evaluate(({ x, y }: { x: number, y: number }) => {
      const ripple = document.createElement('div')
      ripple.className = 'ai-click-ripple'
      ripple.style.left = `${x}px`
      ripple.style.top = `${y}px`
      document.body.appendChild(ripple)
      setTimeout(() => ripple.remove(), 600)
    }, { x: clickX, y: clickY })

    await page.mouse.click(clickX, clickY)
    await page.waitForTimeout(400)
  }
}

async function main() {
  console.log('🎬 Starting AI Automated Demo Recording...')
  console.log(`🌐 Target: ${BASE_URL}`)
  console.log(`📐 Viewport: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} (Compact Full-View Mode)`)

  const browser = await chromium.launch({
    headless: false, // Visible compact browser window
    args: [
      `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT + 80}`,
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  })

  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: 2, // HiDPI Retina Crispness
    recordVideo: {
      dir: RECORDINGS_DIR,
      size: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }
    },
    colorScheme: 'dark' // Record in premium dark mode
  })

  const page = await context.newPage()

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 })
  } catch {
    console.log('⚠️ Server not responding on http://localhost:3000, please make sure `pnpm dev` is running!')
    await browser.close()
    process.exit(1)
  }

  // Adjust zoom slightly if needed so full layout fits effortlessly
  await page.evaluate(() => {
    // Inject High-Tech Virtual Cursor & Click Ripple Style
    const style = document.createElement('style')
    style.innerHTML = `
      #ai-virtual-cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(6, 182, 212, 0.45);
        border: 2px solid #38bdf8;
        box-shadow: 0 0 12px rgba(56, 189, 248, 0.9);
        pointer-events: none;
        z-index: 99999;
        transform: translate(680px, 400px);
        transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .ai-click-ripple {
        position: fixed;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 2px solid #38bdf8;
        transform: translate(-50%, -50%) scale(0.2);
        opacity: 1;
        pointer-events: none;
        z-index: 99998;
        animation: ai-ripple 0.5s ease-out forwards;
      }
      @keyframes ai-ripple {
        0% { transform: translate(-50%, -50%) scale(0.2); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
      }
    `
    document.head.appendChild(style)

    const cursor = document.createElement('div')
    cursor.id = 'ai-virtual-cursor'
    document.body.appendChild(cursor)
  })

  console.log('🎥 Recording Scene 1: Homepage & Background Aesthetics...')
  await page.waitForTimeout(2000)

  // Smooth mouse scan
  await smoothMouseMove(page, VIEWPORT_WIDTH / 2, 360)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(1000)
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(800)

  console.log('🎥 Recording Scene 2: Multi-Platform Filters & Navigation...')
  const navLinks = await page.$$('header nav a')
  if (navLinks.length >= 2) {
    // Search
    await smoothClick(page, 'header nav a:nth-child(2)')
    await page.waitForTimeout(1500)
    // Knowledge
    await smoothClick(page, 'header nav a:nth-child(3)')
    await page.waitForTimeout(1500)
    // Distill
    await smoothClick(page, 'header nav a:nth-child(4)')
    await page.waitForTimeout(1500)
    // Insights
    await smoothClick(page, 'header nav a:nth-child(5)')
    await page.waitForTimeout(1500)
    // Back to Sessions
    await smoothClick(page, 'header nav a:nth-child(1)')
    await page.waitForTimeout(1500)
  }

  console.log('🎥 Recording Scene 3: MCP Realtime Status Modal...')
  const mcpButton = await page.$('button:has-text("MCP")')
  if (mcpButton) {
    await smoothClick(page, 'button:has-text("MCP")')
    await page.waitForTimeout(2200) // View modal
    // Close modal via Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
  }

  console.log('🎥 Recording Scene 4: Quick Search & Filter...')
  await smoothClick(page, 'header nav a:nth-child(2)')
  await page.waitForTimeout(600)
  const searchInput = await page.$('input[type="text"], input[type="search"]')
  if (searchInput) {
    await smoothClick(page, 'input[type="text"], input[type="search"]')
    await page.keyboard.type('ADR architecture', { delay: 90 })
    await page.waitForTimeout(1800)
  }

  console.log('✨ Recording Completed! Finalizing video...')
  await page.waitForTimeout(1000)

  await page.close()
  await context.close()
  await browser.close()

  console.log(`\n🎉 Success! Compact Demo video recorded and saved to:\n📁 ${RECORDINGS_DIR}`)
}

main().catch(err => {
  console.error('Recording failed:', err)
  process.exit(1)
})
