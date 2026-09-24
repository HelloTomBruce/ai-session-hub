<script setup lang="ts">
import * as echarts from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { GraphVisualizationData } from '../../server/utils/memory-types'

echarts.use([GraphChart, LegendComponent, TooltipComponent, CanvasRenderer])

interface Props {
  data: GraphVisualizationData
}
const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'node-click', id: string): void }>()

const containerRef = ref<HTMLElement | null>(null)
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

const FALLBACK_COLOR = '#64748b'
const CATEGORIES = [
  { name: '记忆 Memory', label: 'Memory', color: '#8b5cf6' },
  { name: '项目 Project', label: 'Project', color: '#3b82f6' },
  { name: '技术概念 TechConcept', label: 'TechConcept', color: '#10b981' },
  { name: '痛点 Problem', label: 'Problem', color: '#f43f5e' }
]
const categoryIndex: Record<string, number> = Object.fromEntries(CATEGORIES.map((c, i) => [c.label, i]))

interface ChartNode {
  id: string
  name: string
  category: number
  symbolSize: number
  itemStyle: { color: string }
  labelKind: string
  memoryType?: string
  summary?: string
}

interface ChartEdge {
  source: string
  target: string
  rel: string
  lineStyle: { color: string, width: number, opacity: number, curveness: number, type: 'solid' | 'dashed' }
}

let chart: ReturnType<typeof echarts.init> | null = null
let resizeObserver: ResizeObserver | null = null

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildOption(dark: boolean): echarts.EChartsCoreOption {
  const textColor = dark ? '#a1a1aa' : '#52525b'
  const edgeColor = dark ? '#3f3f46' : '#d4d4d8'

  const nodes: ChartNode[] = props.data.nodes.map((n) => {
    const idx = categoryIndex[n.label] ?? 0
    return {
      id: n.id,
      name: n.name.length > 26 ? `${n.name.slice(0, 26)}…` : n.name,
      category: idx,
      symbolSize: n.label === 'Memory' ? 30 : 20,
      itemStyle: { color: n.color || CATEGORIES[idx]?.color || FALLBACK_COLOR },
      labelKind: n.label,
      memoryType: n.type,
      summary: typeof n.data?.summary === 'string' ? n.data.summary : undefined
    }
  })

  const edges: ChartEdge[] = props.data.edges.map(e => ({
    source: e.source,
    target: e.target,
    rel: e.label,
    lineStyle: {
      color: edgeColor,
      width: 1.2,
      opacity: 0.75,
      curveness: 0.15,
      type: e.label === 'SUPERSEDES' ? 'dashed' : 'solid'
    }
  }))

  return {
    backgroundColor: 'transparent',
    legend: {
      top: 6,
      icon: 'circle',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: textColor, fontSize: 11 },
      data: CATEGORIES.map(c => c.name)
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: dark ? '#18181b' : '#ffffff',
      borderColor: dark ? '#3f3f46' : '#e4e4e7',
      textStyle: { color: dark ? '#e4e4e7' : '#27272a', fontSize: 12 },
      formatter(params: unknown): string {
        // SAFETY: ECharts item-tooltip 回调传入单个 CallbackDataParams（trigger: 'item' 下非数组），
        // 其 data 即本组件构造的 ChartNode / ChartEdge；此处用可选字段形状承载后用 in 判别。
        const p = params as { dataType?: string, data?: ChartNode | ChartEdge }
        const d = p.data
        if (p.dataType === 'edge' && d && 'rel' in d) {
          return `<span style="font-family:monospace">${escapeHtml(d.rel)}</span>`
        }
        if (!d || !('labelKind' in d)) return ''
        const typeBadge = d.memoryType ? ` · ${escapeHtml(d.memoryType)}` : ''
        const summary = d.summary
          ? `<div style="max-width:280px;opacity:.75;margin-top:4px">${escapeHtml(d.summary.slice(0, 120))}${d.summary.length > 120 ? '…' : ''}</div>`
          : ''
        return `<div style="font-weight:600">${escapeHtml(d.name)}</div>`
          + `<div style="font-family:monospace;font-size:11px;opacity:.7">${escapeHtml(d.labelKind)}${typeBadge}</div>`
          + summary
      }
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        categories: CATEGORIES.map(c => ({ name: c.name, itemStyle: { color: c.color } })),
        data: nodes,
        links: edges,
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 7,
        force: {
          repulsion: 240,
          edgeLength: [60, 140],
          gravity: 0.08,
          friction: 0.25
        },
        label: {
          show: true,
          position: 'right',
          color: textColor,
          fontSize: 10,
          formatter: '{b}'
        },
        labelLayout: { hideOverlap: true },
        emphasis: {
          focus: 'adjacency',
          scale: 1.3,
          lineStyle: { width: 2 }
        }
      }
    ]
  }
}

function render() {
  if (!chart) return
  chart.setOption(buildOption(isDark.value), { notMerge: true })
}

onMounted(() => {
  if (!containerRef.value) return
  chart = echarts.init(containerRef.value)
  chart.on('click', (params) => {
    // SAFETY: ECharts 图节点 click 回调的 data 即 series data 项（ChartNode）。
    const d = params.data as ChartNode | undefined
    if (params.dataType === 'node' && d?.labelKind === 'Memory' && d.id) {
      emit('node-click', d.id)
    }
  })
  render()
  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(containerRef.value)
})

watch(() => props.data, render, { deep: true })
watch(isDark, render)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="containerRef" />
</template>
