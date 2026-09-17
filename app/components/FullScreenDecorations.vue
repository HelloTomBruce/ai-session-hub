<script setup lang="ts">
const isVisible = ref(true)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let animationFrameId: number | null = null

// Metaphorical Elements:
// 1. Drifting Thought Embers (灵感流尘): Soft glowing organic particles floating in fluid currents
// 2. Crystallized Wisdom Prisms (知识晶体): 3D Wireframe/Faceted polyhedra slowly tumbling in zero gravity
// 3. Harmonic Resonance Ripples (回响光环): Delicate concentric rings expanding from insight sparks
// 4. Astrolabe Rings (浑天仪/时光星轨): Subtle fine-metal orbital rings marking time & distillation

interface Ember {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  baseAlpha: number
  phase: number
  color: string
}

interface Crystal {
  x: number
  y: number
  vx: number
  vy: number
  rotX: number
  rotY: number
  rotZ: number
  vRotX: number
  vRotY: number
  vRotZ: number
  scale: number
  color: string
  vertices: [number, number, number][]
  edges: [number, number][]
}

interface Ripple {
  x: number
  y: number
  radius: number
  maxRadius: number
  alpha: number
  color: string
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  let width = (canvas.width = window.innerWidth)
  let height = (canvas.height = window.innerHeight)

  const handleResize = () => {
    if (!canvas) return
    width = canvas.width = window.innerWidth
    height = canvas.height = window.innerHeight
  }
  window.addEventListener('resize', handleResize)

  // Palette: Gold, Platinum, Sapphire, Amethyst, Emerald
  const emberColors = [
    '#f59e0b', // Golden Honey Amber (Wisdom)
    '#38bdf8', // Luminous Cyan (Insight)
    '#c084fc', // Soft Amethyst (Memory)
    '#34d399', // Pale Emerald (Growth)
    '#fb7185'  // Rose Quartz (Spark)
  ]

  // Create Embers (Floating Thought Spores)
  const emberCount = Math.min(Math.floor((width * height) / 32000), 45)
  const embers: Ember[] = []
  for (let i = 0; i < emberCount; i++) {
    embers.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -0.15 - Math.random() * 0.25, // Naturally float upward like warm breath/embers
      size: Math.random() * 2.5 + 1.2,
      alpha: Math.random() * 0.6 + 0.2,
      baseAlpha: Math.random() * 0.5 + 0.3,
      phase: Math.random() * Math.PI * 2,
      color: emberColors[i % emberColors.length]!
    })
  }

  // Define 3D Polyhedron Models (Octahedron & Icosahedron Crystals)
  const createOctahedron = (size: number): { vertices: [number, number, number][], edges: [number, number][] } => {
    const s = size
    const v: [number, number, number][] = [
      [0, -s * 1.3, 0], // Top
      [s, 0, 0], [0, 0, s], [-s, 0, 0], [0, 0, -s], // Middle ring
      [0, s * 1.3, 0]  // Bottom
    ]
    const e: [number, number][] = [
      [0, 1], [0, 2], [0, 3], [0, 4], // Top to ring
      [1, 2], [2, 3], [3, 4], [4, 1], // Ring edges
      [5, 1], [5, 2], [5, 3], [5, 4]  // Bottom to ring
    ]
    return { vertices: v, edges: e }
  }

  const crystalPalette = ['#f59e0b', '#38bdf8', '#a855f7', '#10b981', '#fbbf24']
  const crystals: Crystal[] = []
  const crystalCount = Math.min(Math.max(Math.floor(width / 380), 3), 6)

  for (let i = 0; i < crystalCount; i++) {
    const model = createOctahedron(18 + Math.random() * 14)
    crystals.push({
      x: (width / (crystalCount + 1)) * (i + 1) + (Math.random() - 0.5) * 80,
      y: height * 0.2 + Math.random() * height * 0.6,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      rotX: Math.random() * Math.PI,
      rotY: Math.random() * Math.PI,
      rotZ: Math.random() * Math.PI,
      vRotX: 0.003 + Math.random() * 0.005,
      vRotY: 0.004 + Math.random() * 0.006,
      vRotZ: 0.002 + Math.random() * 0.004,
      scale: 1,
      color: crystalPalette[i % crystalPalette.length]!,
      vertices: model.vertices,
      edges: model.edges
    })
  }

  // Occasional Resonance Ripples
  const ripples: Ripple[] = []
  let lastRippleTime = 0

  // 3D Projection Helper
  const project3D = (
    x: number, y: number, z: number,
    rotX: number, rotY: number, rotZ: number,
    cx: number, cy: number
  ): [number, number, number] => {
    // Rotate Y
    let x1 = x * Math.cos(rotY) + z * Math.sin(rotY)
    let y1 = y
    let z1 = -x * Math.sin(rotY) + z * Math.cos(rotY)

    // Rotate X
    let x2 = x1
    let y2 = y1 * Math.cos(rotX) - z1 * Math.sin(rotX)
    let z2 = y1 * Math.sin(rotX) + z1 * Math.cos(rotX)

    // Rotate Z
    let x3 = x2 * Math.cos(rotZ) - y2 * Math.sin(rotZ)
    let y3 = x2 * Math.sin(rotZ) + y2 * Math.cos(rotZ)
    let z3 = z2

    const fov = 350
    const scale = fov / (fov + z3 + 100)
    return [cx + x3 * scale, cy + y3 * scale, z3]
  }

  // Master Render Loop
  let time = 0
  const render = () => {
    time += 0.016
    ctx.clearRect(0, 0, width, height)

    const isDark = document.documentElement.classList.contains('dark')

    // 1. Spawning Rare Ethereal Ripples
    if (time - lastRippleTime > 3.5 && Math.random() < 0.3) {
      lastRippleTime = time
      const targetCrystal = crystals[Math.floor(Math.random() * crystals.length)]
      if (targetCrystal) {
        ripples.push({
          x: targetCrystal.x,
          y: targetCrystal.y,
          radius: 10,
          maxRadius: 140 + Math.random() * 80,
          alpha: isDark ? 0.35 : 0.2,
          color: targetCrystal.color
        })
      }
    }

    // 2. Render Ripples (Resonating Insight Waves)
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]!
      r.radius += 0.6
      r.alpha *= 0.985

      if (r.alpha < 0.01 || r.radius >= r.maxRadius) {
        ripples.splice(i, 1)
        continue
      }

      ctx.beginPath()
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2)
      ctx.strokeStyle = r.color
      ctx.globalAlpha = r.alpha
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // 3. Render Floating Thought Embers
    for (const ember of embers) {
      ember.x += ember.vx + Math.sin(time + ember.phase) * 0.35
      ember.y += ember.vy

      // Wrap around screen gently
      if (ember.y < -10) {
        ember.y = height + 10
        ember.x = Math.random() * width
      }
      if (ember.x < -10) ember.x = width + 10
      if (ember.x > width + 10) ember.x = -10

      // Breathing luminescence
      const currentAlpha = ember.baseAlpha * (0.6 + 0.4 * Math.sin(time * 1.5 + ember.phase))

      // Glowing Ember Core
      ctx.beginPath()
      ctx.arc(ember.x, ember.y, ember.size, 0, Math.PI * 2)
      ctx.fillStyle = ember.color
      ctx.globalAlpha = isDark ? currentAlpha : currentAlpha * 0.75
      ctx.shadowColor = ember.color
      ctx.shadowBlur = isDark ? 8 : 4
      ctx.fill()
      ctx.shadowBlur = 0
    }

    // 4. Render Crystallized Wisdom Prisms (3D Tumble & Facet Shimmer)
    for (const c of crystals) {
      // Slow Zero-G Drift
      c.x += c.vx + Math.sin(time * 0.5 + c.rotX) * 0.2
      c.y += c.vy + Math.cos(time * 0.4 + c.rotY) * 0.2

      if (c.x < 50 || c.x > width - 50) c.vx *= -1
      if (c.y < 50 || c.y > height - 50) c.vy *= -1

      // 3D Rotations
      c.rotX += c.vRotX
      c.rotY += c.vRotY
      c.rotZ += c.vRotZ

      // Project vertices to 2D screen space
      const projected = c.vertices.map(v =>
        project3D(v[0], v[1], v[2], c.rotX, c.rotY, c.rotZ, c.x, c.y)
      )

      // Draw Facet Edges (Fine Skeuomorphic Brass/Prismatic Wireframe)
      for (const [i1, i2] of c.edges) {
        const p1 = projected[i1]!
        const p2 = projected[i2]!

        const edgeZ = (p1[2] + p2[2]) / 2
        const edgeAlpha = Math.max(0.08, Math.min(0.45, 0.25 + edgeZ * 0.005))

        ctx.beginPath()
        ctx.moveTo(p1[0], p1[1])
        ctx.lineTo(p2[0], p2[1])
        ctx.strokeStyle = c.color
        ctx.globalAlpha = isDark ? edgeAlpha : edgeAlpha * 0.65
        ctx.lineWidth = 1.2
        ctx.stroke()
      }

      // Draw Vertex Dewdrop Sparks
      for (const p of projected) {
        ctx.beginPath()
        ctx.arc(p[0], p[1], 2, 0, Math.PI * 2)
        ctx.fillStyle = c.color
        ctx.globalAlpha = isDark ? 0.7 : 0.45
        ctx.fill()
      }

      // Core Prismatic Glint at Crystal Center
      const centerSparkle = Math.sin(time * 2 + c.rotX * 2)
      if (centerSparkle > 0.4) {
        ctx.beginPath()
        ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.globalAlpha = isDark ? (centerSparkle - 0.4) * 1.5 : (centerSparkle - 0.4) * 0.9
        ctx.shadowColor = '#ffffff'
        ctx.shadowBlur = 6
        ctx.fill()
        ctx.shadowBlur = 0
      }
    }

    ctx.globalAlpha = 1
    animationFrameId = requestAnimationFrame(render)
  }

  render()

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }
  })
})
</script>

<template>
  <div
    v-if="isVisible"
    class="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    aria-hidden="true"
  >
    <!-- Layer 1: Ethereal Light Caustics & Deep Atmospheric Voids -->
    <div class="absolute inset-0 opacity-40 dark:opacity-25 transition-opacity duration-1000">
      <!-- Amber/Gold Starlight Focus (Wisdom Hearth) -->
      <div class="absolute top-[15%] left-[20%] w-[45vw] h-[45vw] max-w-[600px] max-h-[600px] rounded-full bg-amber-500/20 dark:bg-amber-500/15 blur-[120px] animate-breathe-1" />
      
      <!-- Deep Cyan Caustic Pool (Clarity & Flow) -->
      <div class="absolute bottom-[20%] right-[15%] w-[50vw] h-[50vw] max-w-[650px] max-h-[650px] rounded-full bg-sky-500/20 dark:bg-sky-500/15 blur-[130px] animate-breathe-2" />
      
      <!-- Violet Resonance Glow (Memory & Synthesis) -->
      <div class="absolute top-[55%] left-[45%] w-[40vw] h-[40vw] max-w-[500px] max-h-[500px] rounded-full bg-violet-500/15 dark:bg-violet-500/10 blur-[110px] animate-breathe-3" />
    </div>

    <!-- Layer 2: Subtle Skeuomorphic Astrolabe Celestial Orbit Lines (SVG Hairlines) -->
    <svg
      class="absolute inset-0 w-full h-full opacity-35 dark:opacity-20 pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="orbitGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.6" />
          <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.2" />
          <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- Center-Right Celestial Astrolabe Ring Structure -->
      <g transform="translate(850, 480)" class="astrolabe-group">
        <circle cx="0" cy="0" r="320" fill="none" stroke="url(#orbitGrad1)" stroke-width="0.8" stroke-dasharray="4,8" class="astrolabe-slow-cw" />
        <circle cx="0" cy="0" r="240" fill="none" stroke="#f59e0b" stroke-width="0.6" stroke-opacity="0.3" stroke-dasharray="1,6" class="astrolabe-slow-ccw" />
        <circle cx="0" cy="0" r="160" fill="none" stroke="#38bdf8" stroke-width="0.6" stroke-opacity="0.25" />
      </g>
    </svg>

    <!-- Layer 3: Living Canvas of Thought Embers & Prismatic Crystals -->
    <canvas
      ref="canvasRef"
      class="absolute inset-0 w-full h-full"
    />

    <!-- Layer 4: Soft Radial Vignette for Supreme Content Readability -->
    <div class="absolute inset-0 bg-radial from-transparent via-transparent to-neutral-50/60 dark:to-zinc-950/70" />
  </div>
</template>

<style scoped>
/* Atmospheric Slow Breathing Lights */
@keyframes breathe1 {
  0%, 100% { transform: translate(0px, 0px) scale(1); opacity: 0.8; }
  50% { transform: translate(30px, 20px) scale(1.08); opacity: 1; }
}

@keyframes breathe2 {
  0%, 100% { transform: translate(0px, 0px) scale(1); opacity: 0.85; }
  50% { transform: translate(-25px, -30px) scale(1.06); opacity: 0.95; }
}

@keyframes breathe3 {
  0%, 100% { transform: translate(0px, 0px) scale(1); opacity: 0.7; }
  50% { transform: translate(20px, -25px) scale(1.1); opacity: 1; }
}

.animate-breathe-1 {
  animation: breathe1 20s ease-in-out infinite;
}
.animate-breathe-2 {
  animation: breathe2 24s ease-in-out infinite;
}
.animate-breathe-3 {
  animation: breathe3 22s ease-in-out infinite;
}

/* Subtle Clockwork Astrolabe Orbit Rotation */
.astrolabe-slow-cw {
  transform-origin: 0px 0px;
  animation: spinAstrolabe 120s linear infinite;
}

.astrolabe-slow-ccw {
  transform-origin: 0px 0px;
  animation: spinAstrolabeRev 160s linear infinite;
}

@keyframes spinAstrolabe {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes spinAstrolabeRev {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(-360deg); }
}
</style>
