<script setup>
/**
 * 线性图标:统一 24×24 描边风格(2px 圆角描边),颜色跟随 currentColor
 */
import { computed, h } from 'vue'
import { ICONS } from '../lib/icons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
  strokeWidth: { type: [Number, String], default: 2 }
})

const vnode = computed(() =>
  h('svg', {
    class: 'app-icon',
    width: props.size,
    height: props.size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': props.strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  }, (ICONS[props.name] || []).map(([tag, attrs]) => h(tag, attrs)))
)
</script>

<template>
  <component :is="vnode" />
</template>
